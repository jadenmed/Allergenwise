/**
 * tests/integration/cert-race-conditions.test.ts
 *
 * Wave 2C — race-condition coverage for the cert state machine.
 *
 * Per cert-payment-state-design.md (e):
 *   R1 — exam pass + later activation in sequence (happy path)
 *   R3 — activation + refund interleaved → end state revoked
 *   R5 — cron expire + refund interleaved → end state revoked (carve-out)
 *   R6 — dispute on already-expired cert → no transition + activity event
 *   R7 — two cert-fee PIs for same restaurant; second activates 0 →
 *        cert_payment_orphaned event written
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { purgeFixtures } from '../helpers/fixture-cleanup';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type Stripe from 'stripe';
import { config } from 'dotenv';
import {
  handleCertFeeSucceeded,
  handleChargeRefunded,
  handleDisputeCreated,
  type CertFeePaymentInput,
} from '@/lib/stripe/cert-event-handlers';
import type { ServiceDb } from '@/lib/db/service';
import { generateCertCode } from '@/lib/learner/cert-code';
import { hasLocalSupabase } from '../helpers/local-db';

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

const ts = `WAVE3-RACE-${Date.now()}`;
const restId = '88888888-8888-8888-8888-' + Date.now().toString().padStart(12, '0').slice(-12);
const learnerEmail = `${ts}-learner@example.test`;
let learnerId: string;
let serviceDb: ServiceDb;
let db: SupabaseClient;

/**
 * A succeeded cert-fee PaymentIntent, adapted to the plain input
 * `handleCertFeeSucceeded` takes since T-41b. Built from a real PaymentIntent
 * shape and mapped exactly the way app/api/stripe/webhook/route.ts maps it, so
 * the fixture cannot silently disagree with production about which field goes
 * where.
 */
function piSucceeded(piId: string, amountCents: number, restaurantId: string): CertFeePaymentInput {
  const pi = {
    id: piId,
    object: 'payment_intent',
    amount: amountCents,
    currency: 'usd',
    status: 'succeeded',
    metadata: { kind: 'cert_fee', restaurant_id: restaurantId },
  } as unknown as Stripe.PaymentIntent;

  return { metadata: pi.metadata, amountCents: pi.amount, paymentId: pi.id };
}

function chargeRefunded(piId: string, refundAmountCents: number): Stripe.Charge {
  return {
    id: `ch_${ts}_${piId}`,
    object: 'charge',
    payment_intent: piId,
    amount: refundAmountCents * 2,
    amount_refunded: refundAmountCents,
    refunded: true,
  } as unknown as Stripe.Charge;
}

function disputeCreated(piId: string, dispId: string): Stripe.Dispute {
  return {
    id: dispId,
    object: 'dispute',
    payment_intent: piId,
    amount: 7000,
    status: 'needs_response',
    reason: 'fraudulent',
  } as unknown as Stripe.Dispute;
}

async function insertCert(opts: {
  certCode: string;
  status: string;
  pi?: string | null;
  expiresAtIso?: string;
}) {
  const expiresAt = opts.expiresAtIso ?? new Date(Date.now() + 365 * 86_400_000).toISOString();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const row: any = {
    cert_code: opts.certCode,
    profile_id: learnerId,
    restaurant_id: restId,
    expires_at: expiresAt,
    status: opts.status,
  };
  if (opts.pi !== undefined && opts.pi !== null) row.stripe_payment_intent_id = opts.pi;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (db as any).from('certificates').insert(row).select('id').single();
  if (error) throw new Error(`insertCert ${opts.certCode}: ${error.message}`);
  return (data as { id: string }).id;
}

async function getCert(id: string) {
  const { data } = await db
    .from('certificates')
    .select('id, status, revocation_reason')
    .eq('id', id)
    .single();
  return data as { id: string; status: string; revocation_reason: string | null };
}

async function activityEventsByType(type: string) {
  const { data } = await db
    .from('activity_events')
    .select('type, payload, created_at')
    .eq('type', type)
    .order('created_at', { ascending: false })
    .limit(20);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data ?? []) as Array<{ type: string; payload: any; created_at: string }>;
}

async function deleteAllCerts() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (db as any).from('certificates').delete().eq('restaurant_id', restId);
}

describe.skipIf(!hasLocalSupabase())('cert race conditions — Wave 2C', () => {
  beforeAll(async () => {
    db = makeServiceClient();
    serviceDb = db as unknown as ServiceDb;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (db as any).from('restaurants').insert({
      id: restId,
      slug: `${ts.toLowerCase()}-${restId.slice(0, 8)}`,
      name: 'Race Test Restaurant',
      status: 'unlisted',
    });
    const { data: authData, error: authErr } = await db.auth.admin.createUser({
      email: learnerEmail,
      password: 'RacePass!1234',
      email_confirm: true,
    });
    if (authErr || !authData.user) throw new Error(`auth: ${authErr?.message}`);
    learnerId = authData.user.id;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (db as any).from('profiles').upsert({
      id: learnerId,
      full_name: 'Race Learner',
      email: learnerEmail,
      role: 'learner',
      restaurant_id: restId,
    });
  }, 30000);

  afterAll(async () => {
    if (!hasLocalSupabase()) return;
    // T-30: scoped by this run's token and re-resolved from the database, so it
    // still cleans up when beforeAll threw before restId/learnerId were set.
    const { errors } = await purgeFixtures(db, ts);
    if (errors.length > 0) console.error('[cert-race-conditions] teardown:', errors);
  });

  beforeEach(async () => {
    await deleteAllCerts();
  });

  // ── R1: exam-pass then activation ──────────────────────────────────────────

  it('R1 — exam pass then activation flips pending→active in order', async () => {
    const piId = `pi_r1_${Date.now()}`;
    const c1 = await insertCert({ certCode: generateCertCode(), status: 'pending' });
    const c2 = await insertCert({ certCode: generateCertCode(), status: 'pending' });

    await handleCertFeeSucceeded(serviceDb, piSucceeded(piId, 7000, restId), `evt_r1_${piId}`);
    expect((await getCert(c1)).status).toBe('active');
    expect((await getCert(c2)).status).toBe('active');
  });

  // ── R3: activation racing with refund ──────────────────────────────────────

  it('R3 — activation followed by refund ends in revoked (refund handler picks up active certs)', async () => {
    const piId = `pi_r3_${Date.now()}`;
    const c1 = await insertCert({ certCode: generateCertCode(), status: 'pending' });

    // Activation lands first (Postgres serializes via row locks even under
    // concurrent webhook delivery; this test checks the documented ordering).
    await handleCertFeeSucceeded(serviceDb, piSucceeded(piId, 3500, restId), `evt_r3a_${piId}`);
    expect((await getCert(c1)).status).toBe('active');

    // Refund arrives a few hundred ms later.
    await handleChargeRefunded(serviceDb, chargeRefunded(piId, 3500), `evt_r3b_${piId}`);
    const after = await getCert(c1);
    expect(after.status).toBe('revoked');
    expect(after.revocation_reason).toBe('refund');
  });

  // ── R5: cron expire then refund ────────────────────────────────────────────

  it('R5 — refund on a cert that just expired flips it to revoked (carve-out)', async () => {
    const piId = `pi_r5_${Date.now()}`;
    const past = new Date(Date.now() - 60_000).toISOString(); // 1 min ago
    const c1 = await insertCert({
      certCode: generateCertCode(),
      status: 'expired', // simulate cron just flipped it
      pi: piId,
      expiresAtIso: past,
    });

    await handleChargeRefunded(serviceDb, chargeRefunded(piId, 3500), `evt_r5_${piId}`);
    const after = await getCert(c1);
    expect(after.status, 'expired→revoked must succeed under refund trigger').toBe('revoked');
    expect(after.revocation_reason).toBe('refund');
  });

  // ── R6: dispute on already-expired cert ────────────────────────────────────

  it('R6 — dispute opens on an expired cert: cert stays expired + state-blocked event logged', async () => {
    const piId = `pi_r6_${Date.now()}`;
    const past = new Date(Date.now() - 30 * 86_400_000).toISOString();
    const c1 = await insertCert({
      certCode: generateCertCode(),
      status: 'expired',
      pi: piId,
      expiresAtIso: past,
    });

    await handleDisputeCreated(
      serviceDb,
      disputeCreated(piId, `dp_r6_${Date.now()}`),
      `evt_r6_${piId}`
    );
    const after = await getCert(c1);
    expect(after.status, 'dispute_created on expired must NOT transition (no carve-out)').toBe(
      'expired'
    );

    const blocked = await activityEventsByType('cert_state_transition_blocked');
    const mine = blocked.find((e) => e.payload.certificate_id === c1);
    expect(mine, 'state-blocked event must be logged for the audit trail').toBeDefined();
  });

  // ── R7: orphaned payment ───────────────────────────────────────────────────

  it('R7 — second cert-fee PI for same restaurant after pending pool drained → orphan event, no double-activation', async () => {
    const piA = `pi_r7a_${Date.now()}`;
    const piB = `pi_r7b_${Date.now()}`;
    const c1 = await insertCert({ certCode: generateCertCode(), status: 'pending' });

    // First PI activates the only pending cert.
    await handleCertFeeSucceeded(serviceDb, piSucceeded(piA, 3500, restId), `evt_r7a_${piA}`);
    expect((await getCert(c1)).status).toBe('active');

    // Second PI arrives — no pending certs to activate. R7 — orphan event.
    await handleCertFeeSucceeded(serviceDb, piSucceeded(piB, 3500, restId), `evt_r7b_${piB}`);
    const orphan = await activityEventsByType('cert_payment_orphaned');
    const mine = orphan.find((e) => e.payload.stripe_payment_intent_id === piB);
    expect(mine, 'orphaned-payment event must be written for piB').toBeDefined();

    // The originally-active cert is unchanged (no double-stamping).
    expect((await getCert(c1)).status).toBe('active');
  });
});
