/**
 * tests/integration/cert-payment-happy-path.test.ts
 *
 * Wave 2C — gate-to-gate happy-path scenario, exercised via direct module
 * imports against the real local Supabase. The sub-pieces are also covered
 * exhaustively elsewhere; this file proves they compose correctly:
 *
 *   1. Seed pending cert (as exam/submit would have done)
 *   2. Verify endpoint says not_found
 *   3. Directory count is 0
 *   4. handleCertFeeSucceeded webhook → cert flips to active
 *   5. Verify endpoint returns 4-field active response
 *   6. Directory count is 1
 */

import { describe, vi, beforeAll, beforeEach, afterAll, expect, test } from 'vitest';
import { purgeFixtures } from '../helpers/fixture-cleanup';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type Stripe from 'stripe';
import { config } from 'dotenv';
import { handleCertFeeSucceeded } from '@/lib/stripe/cert-event-handlers';
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

const ts = `WAVE3-HAPPY-${Date.now()}`;
const restId = '99999999-9999-9999-9999-' + Date.now().toString().padStart(12, '0').slice(-12);
const learnerEmail = `${ts}-learner@example.test`;
const certCode = generateCertCode();

let learnerId = '';
let db: SupabaseClient;
let serviceDb: ServiceDb;
let certificateId = '';

describe.skipIf(!hasLocalSupabase())('Wave 2C cert payment happy path (real DB)', () => {
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
      name: 'Happy Path Restaurant',
      status: 'unlisted',
    });

    const { data: authData, error } = await db.auth.admin.createUser({
      email: learnerEmail,
      password: 'HappyPass!1234',
      email_confirm: true,
    });
    if (error || !authData.user) throw new Error(`auth: ${error?.message}`);
    learnerId = authData.user.id;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (db as any).from('profiles').upsert({
      id: learnerId,
      full_name: 'Happy Learner',
      email: learnerEmail,
      role: 'learner',
      restaurant_id: restId,
    });
  });

  afterAll(async () => {
    if (!hasLocalSupabase()) return;
    // T-30: scoped by this run's token and re-resolved from the database, so it
    // still cleans up when beforeAll threw before restId/learnerId were set.
    const { errors } = await purgeFixtures(db, ts);
    if (errors.length > 0) console.error('[cert-payment-happy-path] teardown:', errors);
  });

  test('1) seed pending cert (simulating exam pass)', async () => {
    const expiresAt = new Date(Date.now() + 365 * 86_400_000).toISOString();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (db as any)
      .from('certificates')
      .insert({
        cert_code: certCode,
        profile_id: learnerId,
        restaurant_id: restId,
        expires_at: expiresAt,
        status: 'pending',
      })
      .select('id')
      .single();
    expect(error).toBeNull();
    certificateId = (data as { id: string }).id;
  });

  test('2) verify endpoint returns not_found while pending', async () => {
    const req = new NextRequest(`http://localhost:3000/api/certs/${certCode}/verify`);
    const res = await verifyGet(req, { params: { certCode } });
    const body = await res.json();
    expect(body.valid).toBe(false);
    expect(body.status).toBe('not_found');
    expect(body.restaurantName).toBeUndefined();
  });

  test('3) directory count is 0 while pending', async () => {
    const n = await countPubliclyActiveCerts(serviceDb, restId);
    expect(n).toBe(0);
  });

  test('4) cert-fee PI succeeds → activation handler flips cert to active', async () => {
    const pi = {
      id: `pi_happy_${Date.now()}`,
      object: 'payment_intent',
      amount: 3500,
      currency: 'usd',
      status: 'succeeded',
      metadata: { kind: 'cert_fee', restaurant_id: restId },
    } as unknown as Stripe.PaymentIntent;

    // Adapted the same way app/api/stripe/webhook/route.ts adapts it (T-41b):
    // the handler takes metadata + amount + id, not a Stripe object.
    await handleCertFeeSucceeded(
      serviceDb,
      { metadata: pi.metadata, amountCents: pi.amount, paymentId: pi.id },
      `evt_happy_${Date.now()}`
    );

    const { data: row } = await db
      .from('certificates')
      .select('status, stripe_payment_intent_id, fee_charged_cents')
      .eq('id', certificateId)
      .single();
    expect((row as { status: string }).status).toBe('active');
    expect((row as { stripe_payment_intent_id: string }).stripe_payment_intent_id).toBe(pi.id);
    expect((row as { fee_charged_cents: number }).fee_charged_cents).toBe(3500);
  });

  test('5) verify endpoint returns 4-field active response', async () => {
    const req = new NextRequest(`http://localhost:3000/api/certs/${certCode}/verify`);
    const res = await verifyGet(req, { params: { certCode } });
    const body = await res.json();
    expect(body.valid).toBe(true);
    expect(body.status).toBe('active');
    expect(body.restaurantName).toBe('Happy Path Restaurant');
    expect(typeof body.issuedAt).toBe('string');
    expect(typeof body.expiresAt).toBe('string');
  });

  test('6) directory count is 1 after activation', async () => {
    const n = await countPubliclyActiveCerts(serviceDb, restId);
    expect(n).toBe(1);
  });
});
