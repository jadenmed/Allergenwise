/**
 * tests/integration/stripe-cert-events.test.ts
 *
 * Wave 2C — Stripe cert-lifecycle event handlers exercised against the real
 * local Supabase. Each test seeds restaurant + learner + cert(s) in known
 * state, fires the handler with a synthetic Stripe object, and asserts the
 * resulting cert state and the activity_events tail.
 *
 * Covers (per cert-payment-state-design.md (c)):
 *   - payment_intent.succeeded (kind=cert_fee) — N pending → active
 *   - payment_intent.succeeded (kind=cert_fee) — 0 pending → orphan event
 *   - charge.refunded — active|disputed|expired → revoked (R5/R6)
 *   - charge.dispute.created — active → disputed
 *   - charge.dispute.closed (won) → disputed → active
 *   - charge.dispute.closed (warning_closed) → disputed → active
 *   - charge.dispute.closed (lost) → disputed → revoked
 *   - charge.dispute.funds_withdrawn / funds_reinstated — log only
 *   - payment_intent.canceled (kind=cert_fee) — log only
 *   - customer.subscription.deleted — no cert touched
 *
 * No mocks. Same standard as Wave 2A's RLS tests.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { purgeFixtures, purgeOrphanEvents } from '../helpers/fixture-cleanup';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import type Stripe from 'stripe';
import {
  handleCertFeeSucceeded,
  handleCertFeeCanceled,
  handleCertFeeFailed,
  handleChargeRefunded,
  type CertFeePaymentInput,
  handleDisputeCreated,
  handleDisputeClosed,
  handleDisputeFundsWithdrawn,
  handleDisputeFundsReinstated,
  handleSubscriptionDeleted,
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

const ts = `wave3-evt-${Date.now()}`;
const restId = '33333333-3333-3333-3333-' + Date.now().toString().padStart(12, '0').slice(-12);
const learnerEmail = `${ts}-learner@example.test`;
const learnerPassword = 'EvtPassword!1234';
let learnerId: string;
let serviceDb: ServiceDb;
let db: SupabaseClient;

// ─── Synthetic Stripe payloads ───────────────────────────────────────────────

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

function piCanceled(piId: string, restaurantId: string): Stripe.PaymentIntent {
  return {
    id: piId,
    object: 'payment_intent',
    amount: 7000,
    status: 'canceled',
    metadata: { kind: 'cert_fee', restaurant_id: restaurantId },
  } as unknown as Stripe.PaymentIntent;
}

function piFailed(piId: string, restaurantId: string): Stripe.PaymentIntent {
  return {
    id: piId,
    object: 'payment_intent',
    amount: 7000,
    status: 'requires_payment_method',
    metadata: { kind: 'cert_fee', restaurant_id: restaurantId },
    last_payment_error: { code: 'card_declined', message: 'Your card was declined.' },
  } as unknown as Stripe.PaymentIntent;
}

function chargeRefunded(piId: string, amountRefundedCents: number): Stripe.Charge {
  return {
    id: `ch_${ts}_${piId}`,
    object: 'charge',
    payment_intent: piId,
    amount: 7000,
    amount_refunded: amountRefundedCents,
    refunded: amountRefundedCents >= 7000,
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

function disputeClosed(
  piId: string,
  dispId: string,
  status: 'won' | 'lost' | 'warning_closed'
): Stripe.Dispute {
  return {
    id: dispId,
    object: 'dispute',
    payment_intent: piId,
    amount: 7000,
    status,
    reason: 'fraudulent',
  } as unknown as Stripe.Dispute;
}

// ─── Seed helpers ────────────────────────────────────────────────────────────

async function insertCert(opts: {
  certCode: string;
  status: string;
  pi?: string | null;
  expiresAtIso?: string;
  revocationReason?: string;
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
  if (opts.pi !== undefined) row.stripe_payment_intent_id = opts.pi;
  if (opts.revocationReason) row.revocation_reason = opts.revocationReason;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (db as any).from('certificates').insert(row).select('id').single();
  if (error) throw new Error(`insertCert ${opts.certCode}: ${error.message}`);
  return (data as { id: string }).id;
}

async function getCertById(id: string) {
  const { data, error } = await db
    .from('certificates')
    .select(
      'id, status, stripe_payment_intent_id, fee_charged_cents, revocation_reason, dispute_id'
    )
    .eq('id', id)
    .single();
  if (error) throw new Error(`getCert: ${error.message}`);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return data as any;
}

async function activityEventsForCert(certId: string) {
  const { data, error } = await db
    .from('activity_events')
    .select('type, payload, created_at')
    .filter('payload->>certificate_id', 'eq', certId)
    .order('created_at');
  if (error) throw new Error(`activity events: ${error.message}`);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data ?? []) as Array<{ type: string; payload: any; created_at: string }>;
}

async function activityEventsByType(type: string) {
  const { data, error } = await db
    .from('activity_events')
    .select('type, payload, created_at')
    .eq('type', type)
    .order('created_at', { ascending: false })
    .limit(20);
  if (error) throw new Error(`activity events by type: ${error.message}`);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data ?? []) as Array<{ type: string; payload: any; created_at: string }>;
}

async function deleteAllCerts() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (db as any).from('certificates').delete().eq('restaurant_id', restId);
}

// ─── Fixture lifecycle ───────────────────────────────────────────────────────

describe.skipIf(!hasLocalSupabase())('Stripe cert event handlers — real DB', () => {
  beforeAll(async () => {
    db = makeServiceClient();
    serviceDb = db as unknown as ServiceDb;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (db as any).from('restaurants').insert({
      id: restId,
      slug: `${ts}-${restId.slice(0, 8)}`,
      name: `Evt Test Restaurant`,
      status: 'unlisted',
    });

    const { data: authData, error: authErr } = await db.auth.admin.createUser({
      email: learnerEmail,
      password: learnerPassword,
      email_confirm: true,
    });
    if (authErr || !authData.user) throw new Error(`auth: ${authErr?.message}`);
    learnerId = authData.user.id;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (db as any).from('profiles').upsert({
      id: learnerId,
      full_name: 'Evt Learner',
      email: learnerEmail,
      role: 'learner',
      restaurant_id: restId,
    });
  }, 30000);

  afterAll(async () => {
    if (!hasLocalSupabase()) return;
    // T-30: scoped by this run's token and re-resolved from the database. Also
    // reaches the activity_events and stripe_events rows the handlers under test
    // write themselves — neither was removed before.
    //
    // The orphan sweep runs first: three tests exercise the "no matching cert or
    // subscription" path, where the handler logs with restaurant_id AND actor_id
    // NULL. Those rows are invisible to the tenant-graph purge, and the run-1
    // measurement caught three of them leaking per run.
    const orphan = await purgeOrphanEvents(db, [ts]);
    const { errors } = await purgeFixtures(db, ts);
    const all = [...orphan.errors, ...errors];
    if (all.length > 0) console.error('[stripe-cert-events] teardown:', all);
  });

  beforeEach(async () => {
    await deleteAllCerts();
  });

  // ── handleCertFeeSucceeded ─────────────────────────────────────────────────

  it('cert_fee succeeded with N pending certs → all flipped to active, fee split, cert_activated written', async () => {
    const piId = `pi_succ_${Date.now()}`;
    const c1 = await insertCert({ certCode: generateCertCode(), status: 'pending' });
    const c2 = await insertCert({ certCode: generateCertCode(), status: 'pending' });
    const c3 = await insertCert({ certCode: generateCertCode(), status: 'pending' });

    await handleCertFeeSucceeded(serviceDb, piSucceeded(piId, 10500, restId), `evt_${piId}`);

    for (const cid of [c1, c2, c3]) {
      const row = await getCertById(cid);
      expect(row.status).toBe('active');
      expect(row.stripe_payment_intent_id).toBe(piId);
      expect(row.fee_charged_cents).toBe(3500); // 10500/3
    }

    const activated = await activityEventsByType('cert_activated');
    const myCerts = activated.filter((e) => [c1, c2, c3].includes(e.payload.certificate_id));
    expect(myCerts.length).toBe(3);
  });

  it('cert_fee succeeded with 0 pending certs → cert_payment_orphaned, no cert touched', async () => {
    const piId = `pi_orphan_${Date.now()}`;
    // Pre-existing active cert NOT in pending — should not be affected.
    const c1 = await insertCert({ certCode: generateCertCode(), status: 'active' });

    await handleCertFeeSucceeded(serviceDb, piSucceeded(piId, 3500, restId), `evt_${piId}`);

    const row = await getCertById(c1);
    expect(row.status).toBe('active'); // untouched

    const orphan = await activityEventsByType('cert_payment_orphaned');
    const mine = orphan.find((e) => e.payload.stripe_payment_intent_id === piId);
    expect(mine, 'orphaned-payment event must be written').toBeDefined();
  });

  it('cert_fee succeeded replay → idempotent (second call activates 0)', async () => {
    const piId = `pi_replay_${Date.now()}`;
    const c1 = await insertCert({ certCode: generateCertCode(), status: 'pending' });

    await handleCertFeeSucceeded(serviceDb, piSucceeded(piId, 3500, restId), `evt_${piId}`);
    expect((await getCertById(c1)).status).toBe('active');

    // Replay — handler queries pending certs (now 0) → orphan log
    await handleCertFeeSucceeded(serviceDb, piSucceeded(piId, 3500, restId), `evt_${piId}_replay`);
    expect((await getCertById(c1)).status).toBe('active'); // unchanged
  });

  // ── handleChargeRefunded ───────────────────────────────────────────────────

  it('charge.refunded with 3 active certs paying same PI → all to revoked with reason=refund', async () => {
    const piId = `pi_refund_${Date.now()}`;
    const c1 = await insertCert({ certCode: generateCertCode(), status: 'active', pi: piId });
    const c2 = await insertCert({ certCode: generateCertCode(), status: 'active', pi: piId });
    const c3 = await insertCert({ certCode: generateCertCode(), status: 'active', pi: piId });

    await handleChargeRefunded(serviceDb, chargeRefunded(piId, 10500), `evt_rf_${piId}`);

    for (const cid of [c1, c2, c3]) {
      const row = await getCertById(cid);
      expect(row.status).toBe('revoked');
      expect(row.revocation_reason).toBe('refund');
    }
  });

  it('charge.refunded on already-revoked PI → idempotent no-op', async () => {
    const piId = `pi_refund_idem_${Date.now()}`;
    const c1 = await insertCert({
      certCode: generateCertCode(),
      status: 'revoked',
      pi: piId,
      revocationReason: 'admin',
    });

    await handleChargeRefunded(serviceDb, chargeRefunded(piId, 3500), `evt_rfi_${piId}`);

    const row = await getCertById(c1);
    expect(row.status).toBe('revoked');
    expect(row.revocation_reason).toBe('admin'); // unchanged
  });

  it('charge.refunded on EXPIRED cert → revoked (R5 carve-out)', async () => {
    const piId = `pi_r5_${Date.now()}`;
    const c1 = await insertCert({
      certCode: generateCertCode(),
      status: 'expired',
      pi: piId,
      expiresAtIso: new Date(Date.now() - 5 * 86_400_000).toISOString(),
    });

    await handleChargeRefunded(serviceDb, chargeRefunded(piId, 3500), `evt_r5_${piId}`);

    const row = await getCertById(c1);
    expect(row.status).toBe('revoked');
    expect(row.revocation_reason).toBe('refund');
  });

  // ── handleDisputeCreated ───────────────────────────────────────────────────

  it('charge.dispute.created on active certs → disputed with dispute_id stamped', async () => {
    const piId = `pi_disp_${Date.now()}`;
    const dispId = `dp_${Date.now()}`;
    const c1 = await insertCert({ certCode: generateCertCode(), status: 'active', pi: piId });
    const c2 = await insertCert({ certCode: generateCertCode(), status: 'active', pi: piId });

    await handleDisputeCreated(serviceDb, disputeCreated(piId, dispId), `evt_dc_${piId}`);

    for (const cid of [c1, c2]) {
      const row = await getCertById(cid);
      expect(row.status).toBe('disputed');
      expect(row.dispute_id).toBe(dispId);
    }
  });

  it('charge.dispute.created on already-expired cert → stays expired (R6)', async () => {
    const piId = `pi_disp_r6_${Date.now()}`;
    const dispId = `dp_r6_${Date.now()}`;
    const c1 = await insertCert({
      certCode: generateCertCode(),
      status: 'expired',
      pi: piId,
      expiresAtIso: new Date(Date.now() - 30 * 86_400_000).toISOString(),
    });

    await handleDisputeCreated(serviceDb, disputeCreated(piId, dispId), `evt_dr6_${piId}`);

    const row = await getCertById(c1);
    expect(row.status).toBe('expired');

    // cert_state_transition_blocked logged
    const blocked = await activityEventsByType('cert_state_transition_blocked');
    const mine = blocked.find((e) => e.payload.certificate_id === c1);
    expect(mine).toBeDefined();
  });

  // ── handleDisputeClosed ────────────────────────────────────────────────────

  it('dispute.closed (won) → disputed → active, cert_dispute_resolved logged', async () => {
    const piId = `pi_won_${Date.now()}`;
    const dispId = `dp_won_${Date.now()}`;
    const c1 = await insertCert({ certCode: generateCertCode(), status: 'disputed', pi: piId });

    await handleDisputeClosed(serviceDb, disputeClosed(piId, dispId, 'won'), `evt_w_${piId}`);

    const row = await getCertById(c1);
    expect(row.status).toBe('active');
  });

  it('dispute.closed (warning_closed) → disputed → active', async () => {
    const piId = `pi_wc_${Date.now()}`;
    const dispId = `dp_wc_${Date.now()}`;
    const c1 = await insertCert({ certCode: generateCertCode(), status: 'disputed', pi: piId });

    await handleDisputeClosed(
      serviceDb,
      disputeClosed(piId, dispId, 'warning_closed'),
      `evt_wc_${piId}`
    );

    const row = await getCertById(c1);
    expect(row.status).toBe('active');
  });

  it('dispute.closed (lost) → disputed → revoked with reason=dispute_lost', async () => {
    const piId = `pi_lost_${Date.now()}`;
    const dispId = `dp_lost_${Date.now()}`;
    const c1 = await insertCert({ certCode: generateCertCode(), status: 'disputed', pi: piId });

    await handleDisputeClosed(serviceDb, disputeClosed(piId, dispId, 'lost'), `evt_l_${piId}`);

    const row = await getCertById(c1);
    expect(row.status).toBe('revoked');
    expect(row.revocation_reason).toBe('dispute_lost');
  });

  it('dispute.closed (lost) on EXPIRED cert → revoked (R6 carve-out, dispute_lost)', async () => {
    const piId = `pi_r6lost_${Date.now()}`;
    const dispId = `dp_r6lost_${Date.now()}`;
    const c1 = await insertCert({
      certCode: generateCertCode(),
      status: 'expired',
      pi: piId,
      expiresAtIso: new Date(Date.now() - 5 * 86_400_000).toISOString(),
    });

    await handleDisputeClosed(serviceDb, disputeClosed(piId, dispId, 'lost'), `evt_r6l_${piId}`);

    const row = await getCertById(c1);
    expect(row.status).toBe('revoked');
    expect(row.revocation_reason).toBe('dispute_lost');
  });

  // ── Log-only events ────────────────────────────────────────────────────────

  it('payment_intent.canceled (kind=cert_fee) → cert_payment_canceled, no cert touched', async () => {
    const piId = `pi_can_${Date.now()}`;
    const c1 = await insertCert({ certCode: generateCertCode(), status: 'pending' });

    await handleCertFeeCanceled(serviceDb, piCanceled(piId, restId), `evt_pc_${piId}`);

    const row = await getCertById(c1);
    expect(row.status).toBe('pending'); // untouched

    const events = await activityEventsByType('cert_payment_canceled');
    const mine = events.find((e) => e.payload.stripe_payment_intent_id === piId);
    expect(mine).toBeDefined();
  });

  it('payment_intent.payment_failed (kind=cert_fee) → cert_payment_failed', async () => {
    const piId = `pi_fail_${Date.now()}`;
    await handleCertFeeFailed(serviceDb, piFailed(piId, restId), `evt_pf_${piId}`);

    const events = await activityEventsByType('cert_payment_failed');
    const mine = events.find((e) => e.payload.stripe_payment_intent_id === piId);
    expect(mine).toBeDefined();
    expect(mine!.payload.failure_code).toBe('card_declined');
  });

  it('charge.dispute.funds_withdrawn → log only, no cert touched', async () => {
    // T-30: `ts`, not Date.now() — this handler logs with restaurant_id NULL, so
    // the run token in the id is the only thing that makes the event attributable.
    const piId = `pi_fw_${ts}`;
    const dispId = `dp_fw_${ts}`;
    const c1 = await insertCert({ certCode: generateCertCode(), status: 'disputed', pi: piId });

    await handleDisputeFundsWithdrawn(serviceDb, disputeCreated(piId, dispId), `evt_fw_${piId}`);

    const row = await getCertById(c1);
    expect(row.status).toBe('disputed');

    const events = await activityEventsByType('cert_dispute_funds_withdrawn');
    const mine = events.find((e) => e.payload.dispute_id === dispId);
    expect(mine).toBeDefined();
  });

  it('charge.dispute.funds_reinstated → log only, no cert touched', async () => {
    // T-30: `ts`, not Date.now() — see the funds_withdrawn case above.
    const piId = `pi_fr_${ts}`;
    const dispId = `dp_fr_${ts}`;
    const c1 = await insertCert({ certCode: generateCertCode(), status: 'disputed', pi: piId });

    await handleDisputeFundsReinstated(serviceDb, disputeCreated(piId, dispId), `evt_fr_${piId}`);

    const row = await getCertById(c1);
    expect(row.status).toBe('disputed');

    const events = await activityEventsByType('cert_dispute_funds_reinstated');
    const mine = events.find((e) => e.payload.dispute_id === dispId);
    expect(mine).toBeDefined();
  });

  it('customer.subscription.deleted → no cert touched, log-only', async () => {
    const c1 = await insertCert({ certCode: generateCertCode(), status: 'active' });

    // T-30: `ts`, not Date.now() — this logs with restaurant_id NULL too.
    const sub = { id: `sub_${ts}` } as unknown as Stripe.Subscription;
    await handleSubscriptionDeleted(serviceDb, sub, `evt_sd_${ts}`);

    const row = await getCertById(c1);
    expect(row.status).toBe('active'); // untouched
  });
});
