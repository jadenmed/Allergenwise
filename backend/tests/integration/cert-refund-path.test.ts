/**
 * tests/integration/cert-refund-path.test.ts
 *
 * Wave 2C — refund flow ends in cert revocation, directory count drops.
 *
 *   Pre: active cert paid by a known PI
 *   Stripe charge.refunded webhook → handleChargeRefunded
 *   Verify endpoint reports `revoked`
 *   Directory count goes to 0
 *   activity_events records cert_revoked with reason='refund'
 */

import { describe, vi, beforeAll, beforeEach, afterAll, expect, test } from 'vitest';
import { purgeFixtures } from '../helpers/fixture-cleanup';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type Stripe from 'stripe';
import { config } from 'dotenv';
import { handleChargeRefunded } from '@/lib/stripe/cert-event-handlers';
import { GET as verifyGet } from '@/app/api/certs/[certCode]/verify/route';
import { countPubliclyActiveCerts } from '@/lib/learner/cert-status';
import type { ServiceDb } from '@/lib/db/service';
import { NextRequest } from 'next/server';
import { generateCertCode } from '@/lib/learner/cert-code';
import { _resetForTests as resetRateLimit } from '@/lib/security/rate-limit';
import { hasLocalSupabase } from '../helpers/local-db';

vi.mock('@upstash/ratelimit', () => ({
  Ratelimit: class {
    static slidingWindow() {
      return {};
    }
    limit = vi
      .fn()
      .mockResolvedValue({ success: true, remaining: 100, reset: Date.now() + 60_000, limit: 100 });
  },
}));
vi.mock('@upstash/redis', () => ({
  Redis: class {
    constructor() {}
  },
}));

config({ path: '.env.local' });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
// T-25 — the gate below asks whether the target database is on THIS machine,
// not merely whether the vars are set. tests/helpers/local-db.ts is the one
// definition; it reads locality from tests/env-guard.ts, so "local" means the
// same thing here, in vitest.config.ts and in playwright.config.ts.

function makeServiceClient(): SupabaseClient {
  return createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

const ts = `WAVE3-REFUND-${Date.now()}`;
const restId = 'aaaaaaaa-aaaa-aaaa-aaaa-' + Date.now().toString().padStart(12, '0').slice(-12);
const learnerEmail = `${ts}-learner@example.test`;
const certCode = generateCertCode();
const piId = `pi_refund_e2e_${Date.now()}`;

let learnerId = '';
let db: SupabaseClient;
let serviceDb: ServiceDb;
let certificateId = '';

describe.skipIf(!hasLocalSupabase())('Wave 2C cert refund path', () => {
  beforeEach(() => {
    resetRateLimit();
    process.env.KV_REST_API_URL = 'http://test-kv';
    process.env.KV_REST_API_TOKEN = 'test-kv-token';
    process.env.RATELIMIT_IP_PEPPER = 'test-pepper';
  });

  beforeAll(async () => {
    db = makeServiceClient();
    serviceDb = db as unknown as ServiceDb;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (db as any).from('restaurants').insert({
      id: restId,
      slug: `${ts.toLowerCase()}-${restId.slice(0, 8)}`,
      name: 'Refund Path Restaurant',
      status: 'unlisted',
    });
    const { data: authData, error } = await db.auth.admin.createUser({
      email: learnerEmail,
      password: 'RefPass!1234',
      email_confirm: true,
    });
    if (error || !authData.user) throw new Error(`auth: ${error?.message}`);
    learnerId = authData.user.id;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (db as any).from('profiles').upsert({
      id: learnerId,
      full_name: 'Refund Learner',
      email: learnerEmail,
      role: 'learner',
      restaurant_id: restId,
    });

    // Seed an active cert directly (skip the activation hop).
    const expiresAt = new Date(Date.now() + 365 * 86_400_000).toISOString();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: cert } = await (db as any)
      .from('certificates')
      .insert({
        cert_code: certCode,
        profile_id: learnerId,
        restaurant_id: restId,
        expires_at: expiresAt,
        status: 'active',
        stripe_payment_intent_id: piId,
        fee_charged_cents: 3500,
      })
      .select('id')
      .single();
    certificateId = (cert as { id: string }).id;
  });

  afterAll(async () => {
    if (!hasLocalSupabase()) return;
    // T-30: scoped by this run's token and re-resolved from the database, so it
    // still cleans up when beforeAll threw before restId/learnerId were set.
    const { errors } = await purgeFixtures(db, ts);
    if (errors.length > 0) console.error('[cert-refund-path] teardown:', errors);
  });

  test('pre: cert is active, directory count = 1', async () => {
    expect(await countPubliclyActiveCerts(serviceDb, restId)).toBe(1);
    const req = new NextRequest(`http://localhost:3000/api/certs/${certCode}/verify`);
    const res = await verifyGet(req, { params: { certCode } });
    const body = await res.json();
    expect(body.status).toBe('active');
  });

  test('charge.refunded → cert flips to revoked', async () => {
    const charge = {
      id: `ch_e2e_${Date.now()}`,
      object: 'charge',
      payment_intent: piId,
      amount: 3500,
      amount_refunded: 3500,
      refunded: true,
    } as unknown as Stripe.Charge;
    await handleChargeRefunded(serviceDb, charge, `evt_ref_${Date.now()}`);

    const { data } = await db
      .from('certificates')
      .select('status, revocation_reason')
      .eq('id', certificateId)
      .single();
    expect((data as { status: string }).status).toBe('revoked');
    expect((data as { revocation_reason: string }).revocation_reason).toBe('refund');
  });

  test('verify endpoint reports revoked + directory count = 0', async () => {
    const req = new NextRequest(`http://localhost:3000/api/certs/${certCode}/verify`);
    const res = await verifyGet(req, { params: { certCode } });
    const body = await res.json();
    expect(body.status).toBe('revoked');
    expect(body.valid).toBe(false);
    expect(body.restaurantName).toBe('Refund Path Restaurant');

    expect(await countPubliclyActiveCerts(serviceDb, restId)).toBe(0);
  });

  test('cert_revoked activity event recorded with reason=refund', async () => {
    const { data: events } = await db
      .from('activity_events')
      .select('payload')
      .eq('type', 'cert_revoked')
      .order('created_at', { ascending: false });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mine = (events ?? []).find((e: any) => e.payload?.certificate_id === certificateId);
    expect(mine).toBeDefined();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((mine as any).payload.reason).toBe('refund');
  });
});
