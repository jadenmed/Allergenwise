/**
 * tests/integration/cert-dispute-path.test.ts
 *
 * Wave 2C — dispute lifecycle.
 *
 *   active cert ── dispute.created ──→ disputed (verify masks to revoked)
 *   disputed   ── dispute.closed(won) ──→ active again
 *   disputed   ── dispute.closed(lost) ──→ revoked with reason=dispute_lost
 */

import { describe, vi, beforeAll, beforeEach, afterAll, expect, test } from 'vitest';
import { purgeFixtures } from '../helpers/fixture-cleanup';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type Stripe from 'stripe';
import { config } from 'dotenv';
import { handleDisputeCreated, handleDisputeClosed } from '@/lib/stripe/cert-event-handlers';
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

const ts = `WAVE3-DISP-${Date.now()}`;
const restId = 'bbbbbbbb-bbbb-bbbb-bbbb-' + Date.now().toString().padStart(12, '0').slice(-12);
const learnerEmail = `${ts}-learner@example.test`;
const piId = `pi_dispute_e2e_${Date.now()}`;
const dispId = `dp_e2e_${Date.now()}`;

let learnerId = '';
let db: SupabaseClient;
let serviceDb: ServiceDb;
let certIdWon = '';
let certIdLost = '';
const certCodeWon = generateCertCode();
const certCodeLost = generateCertCode();

describe.skipIf(!hasLocalSupabase())('Wave 2C cert dispute path', () => {
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
      name: 'Dispute Path Restaurant',
      status: 'unlisted',
    });
    const { data: authData, error } = await db.auth.admin.createUser({
      email: learnerEmail,
      password: 'DspPass!1234',
      email_confirm: true,
    });
    if (error || !authData.user) throw new Error(`auth: ${error?.message}`);
    learnerId = authData.user.id;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (db as any).from('profiles').upsert({
      id: learnerId,
      full_name: 'Dispute Learner',
      email: learnerEmail,
      role: 'learner',
      restaurant_id: restId,
    });

    const expiresAt = new Date(Date.now() + 365 * 86_400_000).toISOString();
    // Seed two active certs sharing the disputed PI — one for the won path,
    // one for the lost path. Both will go to disputed under the same
    // dispute.created event; we then split with separate dispute.closed
    // calls (different PI to keep them independent).
    // Simpler: use distinct PIs for the two scenarios.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const wonInsert = await (db as any)
      .from('certificates')
      .insert({
        cert_code: certCodeWon,
        profile_id: learnerId,
        restaurant_id: restId,
        expires_at: expiresAt,
        status: 'active',
        stripe_payment_intent_id: piId + '-won',
        fee_charged_cents: 3500,
      })
      .select('id')
      .single();
    certIdWon = (wonInsert.data as { id: string }).id;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const lostInsert = await (db as any)
      .from('certificates')
      .insert({
        cert_code: certCodeLost,
        profile_id: learnerId,
        restaurant_id: restId,
        expires_at: expiresAt,
        status: 'active',
        stripe_payment_intent_id: piId + '-lost',
        fee_charged_cents: 3500,
      })
      .select('id')
      .single();
    certIdLost = (lostInsert.data as { id: string }).id;
  });

  afterAll(async () => {
    if (!hasLocalSupabase()) return;
    // T-30: scoped by this run's token and re-resolved from the database, so it
    // still cleans up when beforeAll threw before restId/learnerId were set.
    const { errors } = await purgeFixtures(db, ts);
    if (errors.length > 0) console.error('[cert-dispute-path] teardown:', errors);
  });

  test('pre: both certs active, directory count = 2', async () => {
    expect(await countPubliclyActiveCerts(serviceDb, restId)).toBe(2);
  });

  test('dispute.created → both certs go to disputed (publicly mask as revoked)', async () => {
    const disputeWon = {
      id: dispId + '-won',
      object: 'dispute',
      payment_intent: piId + '-won',
      amount: 3500,
      status: 'needs_response',
    } as unknown as Stripe.Dispute;
    const disputeLost = {
      id: dispId + '-lost',
      object: 'dispute',
      payment_intent: piId + '-lost',
      amount: 3500,
      status: 'needs_response',
    } as unknown as Stripe.Dispute;

    await handleDisputeCreated(serviceDb, disputeWon, `evt_dc_won_${Date.now()}`);
    await handleDisputeCreated(serviceDb, disputeLost, `evt_dc_lost_${Date.now()}`);

    expect(await countPubliclyActiveCerts(serviceDb, restId)).toBe(0);

    const wonReq = new NextRequest(`http://localhost:3000/api/certs/${certCodeWon}/verify`);
    const wonRes = await verifyGet(wonReq, { params: { certCode: certCodeWon } });
    expect((await wonRes.json()).status).toBe('revoked'); // public masking
  });

  test('dispute.closed (won) → cert returns to active', async () => {
    const disputeClosed = {
      id: dispId + '-won',
      object: 'dispute',
      payment_intent: piId + '-won',
      amount: 3500,
      status: 'won',
    } as unknown as Stripe.Dispute;
    await handleDisputeClosed(serviceDb, disputeClosed, `evt_dc_won_close_${Date.now()}`);

    const { data } = await db.from('certificates').select('status').eq('id', certIdWon).single();
    expect((data as { status: string }).status).toBe('active');

    const req = new NextRequest(`http://localhost:3000/api/certs/${certCodeWon}/verify`);
    const res = await verifyGet(req, { params: { certCode: certCodeWon } });
    expect((await res.json()).status).toBe('active');
  });

  test('dispute.closed (lost) → cert revoked with reason=dispute_lost', async () => {
    const disputeClosed = {
      id: dispId + '-lost',
      object: 'dispute',
      payment_intent: piId + '-lost',
      amount: 3500,
      status: 'lost',
    } as unknown as Stripe.Dispute;
    await handleDisputeClosed(serviceDb, disputeClosed, `evt_dc_lost_close_${Date.now()}`);

    const { data } = await db
      .from('certificates')
      .select('status, revocation_reason')
      .eq('id', certIdLost)
      .single();
    expect((data as { status: string }).status).toBe('revoked');
    expect((data as { revocation_reason: string }).revocation_reason).toBe('dispute_lost');
  });
});
