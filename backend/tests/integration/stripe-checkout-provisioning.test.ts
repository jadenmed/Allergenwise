/**
 * tests/integration/stripe-checkout-provisioning.test.ts
 *
 * T-41a — provisioning moved from payment_intent.succeeded to
 * checkout.session.completed. This file is the behavioural proof, driven
 * through the real route handler with real Stripe HMAC signatures.
 *
 * The four things that must hold:
 *
 *   1. A $0 session provisions. Stripe: "Completed Checkout Sessions that are
 *      free won't have an associated PaymentIntent." A comped signup therefore
 *      fires NOTHING on the PaymentIntent path, and amount_cents must be
 *      stored as a literal 0 — a comped subscription is worth zero, it is not
 *      a subscription with a missing price.
 *
 *   2. A paid session provisions exactly ONCE. A paid Checkout fires BOTH
 *      checkout.session.completed AND payment_intent.succeeded. The two paths
 *      would write different ids (cs_… vs pi_…), which the UNIQUE index on
 *      subscriptions.stripe_invoice_id cannot dedupe — so the PaymentIntent
 *      path must not provision at all.
 *
 *   3. Redelivery is a no-op. Two shapes are covered: the same event id
 *      replayed (caught by stripe_events), and a DIFFERENT event id carrying
 *      the same session (caught only by the UNIQUE index, which is the guard
 *      that survives concurrency).
 *
 *   4. cert_fee / submission still route off payment_intent.succeeded.
 *
 * METADATA RULE: fixtures never hand-write a metadata literal — they call the
 * same lib/stripe/metadata.ts builders production uses, so a producer/consumer
 * key disagreement fails the test instead of passing it.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import Stripe from 'stripe';
import {
  buildCertFeeMetadata,
  buildPlanMetadata,
  buildSubmissionMetadata,
  toStripeMetadata,
} from '@/lib/stripe/metadata';

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('@/lib/supabase/server', () => ({
  createServiceSupabase: vi.fn(),
}));

vi.mock('@/lib/stripe', () => ({
  stripe: new Stripe('sk_test_fake', { apiVersion: '2025-02-24.acacia' }),
}));

vi.mock('@/lib/email/send', () => ({
  sendEmail: vi.fn().mockResolvedValue({ ok: true }),
}));

vi.mock('@/lib/email/client', () => ({
  resend: { emails: { send: vi.fn().mockResolvedValue({ id: 'email-id' }) } },
  FROM_EMAIL: 'noreply@allergenwise.com',
}));

vi.mock('@react-email/components', () => ({
  render: vi.fn().mockResolvedValue('<html/>'),
}));

// ─── Constants ────────────────────────────────────────────────────────────────

const TEST_WEBHOOK_SECRET = 'whsec_test_allergenwise_checkout_provisioning';
const REST_ID = '33333333-3333-4333-8333-333333333333';
const ADMIN_ID = '44444444-4444-4444-8444-444444444444';

// ─── DB mock ──────────────────────────────────────────────────────────────────

interface CapturedInsert {
  table: string;
  row: Record<string, unknown>;
}

/**
 * @param opts.eventInsertCount        rows the stripe_events INSERT reports (0 = conflict)
 * @param opts.priorEventStatus        status of a pre-existing stripe_events row
 * @param opts.subscriptionInsertError error the subscriptions INSERT returns
 *   ({code:'23505'} models the UNIQUE index rejecting a second row for the
 *   same Checkout Session — the real concurrency guard).
 */
function makeDb(
  opts: {
    eventInsertCount?: number;
    priorEventStatus?: string | null;
    subscriptionInsertError?: { code?: string; message: string } | null;
  } = {}
) {
  const eventInsertCount = opts.eventInsertCount ?? 1;
  const priorEventStatus = opts.priorEventStatus ?? null;
  const subscriptionInsertError = opts.subscriptionInsertError ?? null;

  const inserts: CapturedInsert[] = [];
  const updates: Array<{ table: string; values: Record<string, unknown> }> = [];
  const fromCalls: string[] = [];

  const from = vi.fn((table: string) => {
    fromCalls.push(table);

    const insertResult =
      table === 'subscriptions' && subscriptionInsertError
        ? { data: null, error: subscriptionInsertError }
        : { data: null, error: null };

    const insert = vi.fn((row: Record<string, unknown>) => {
      inserts.push({ table, row });
      return {
        // stripe_events: .insert(...).select('id', { count }) is awaited
        select: vi.fn().mockResolvedValue({
          data: eventInsertCount === 0 ? [] : [{ id: 'row-id' }],
          error: null,
          count: eventInsertCount,
        }),
        // subscriptions / activity_events: the insert itself is awaited
        then: (onF: (v: unknown) => unknown) => Promise.resolve(insertResult).then(onF),
      };
    });

    const update = vi.fn((values: Record<string, unknown>) => {
      updates.push({ table, values });
      const eqResult = {
        // stripe_events failure marking chains .eq(...).neq(...)
        neq: vi.fn().mockResolvedValue({ data: null, error: null }),
        then: (onF: (v: unknown) => unknown) =>
          Promise.resolve({ data: null, error: null }).then(onF),
      };
      return { eq: vi.fn().mockReturnValue(eqResult) };
    });

    // stripe_events status re-read; every other table is "not found".
    const priorRow =
      table === 'stripe_events' && priorEventStatus ? { status: priorEventStatus } : null;

    // profiles lookup for the WelcomeAdmin email
    const profileRows =
      table === 'profiles'
        ? [{ id: ADMIN_ID, full_name: 'Ada Admin', email: 'ada.admin@example.com' }]
        : [];
    const restaurantRow = table === 'restaurants' ? { name: 'Test Bistro' } : null;

    const chain = {
      eq: vi.fn((): typeof chain => chain),
      maybeSingle: vi.fn().mockResolvedValue({ data: priorRow ?? restaurantRow, error: null }),
      single: vi.fn().mockResolvedValue({ data: null, error: null }),
      limit: vi.fn().mockResolvedValue({ data: profileRows, error: null }),
    };

    return { insert, update, select: vi.fn(() => chain) };
  });

  return { from, inserts, updates, fromCalls };
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function planMetadata(): Stripe.MetadataParam {
  return toStripeMetadata(
    buildPlanMetadata({ restaurantId: REST_ID, adminId: ADMIN_ID, plan: 'quarterly' })
  );
}

/** A PAID Checkout Session — card collected, PaymentIntent exists. */
function paidSession(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    object: 'checkout.session',
    amount_total: 9000,
    currency: 'usd',
    status: 'complete',
    payment_status: 'paid',
    payment_intent: `pi_for_${id}`,
    customer: 'cus_test_paid',
    metadata: planMetadata(),
    ...overrides,
  };
}

/**
 * A COMPED Checkout Session: a 100%-off promotion code took the total to 0, so
 * Stripe collected no payment method and created no PaymentIntent.
 */
function compedSession(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    object: 'checkout.session',
    amount_total: 0,
    amount_subtotal: 9000,
    currency: 'usd',
    status: 'complete',
    payment_status: 'no_payment_required',
    payment_intent: null, // ← the whole reason this task exists
    customer: 'cus_test_comped',
    total_details: { amount_discount: 9000 },
    metadata: planMetadata(),
    ...overrides,
  };
}

/** The PaymentIntent a PAID Checkout also produces. */
function pairedPaymentIntent(sessionId: string, metadata: Stripe.MetadataParam) {
  return {
    id: `pi_for_${sessionId}`,
    object: 'payment_intent',
    amount: 9000,
    status: 'succeeded',
    invoice: null,
    last_payment_error: null,
    metadata,
  };
}

function buildPayload(eventId: string, eventType: string, object: unknown): string {
  return JSON.stringify({ id: eventId, type: eventType, data: { object } });
}

async function deliver(eventId: string, eventType: string, object: unknown) {
  const payload = buildPayload(eventId, eventType, object);
  const sig = Stripe.webhooks.generateTestHeaderString({
    payload,
    secret: TEST_WEBHOOK_SECRET,
  });

  const { POST } = await import('@/app/api/stripe/webhook/route');
  return POST(
    new NextRequest('http://localhost/api/stripe/webhook', {
      method: 'POST',
      headers: { 'stripe-signature': sig, 'content-type': 'application/json' },
      body: payload,
    })
  );
}

async function useDb(db: { from: ReturnType<typeof vi.fn> }) {
  const { createServiceSupabase } = await import('@/lib/supabase/server');
  vi.mocked(createServiceSupabase).mockReturnValue(
    db as unknown as ReturnType<typeof createServiceSupabase>
  );
}

const subscriptionRows = (inserts: CapturedInsert[]) =>
  inserts.filter((i) => i.table === 'subscriptions');

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('T-41a — checkout.session.completed provisions a plan', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    process.env.STRIPE_WEBHOOK_SECRET = TEST_WEBHOOK_SECRET;
  });

  // ── Acceptance 1: the comped case the whole task exists for ────────────────

  it('a $0 comped session provisions, with amount_cents stored as 0', async () => {
    const db = makeDb();
    await useDb(db);

    const res = await deliver(
      'evt_comped_001',
      'checkout.session.completed',
      compedSession('cs_comped_001')
    );

    expect(res.status).toBe(200);

    const rows = subscriptionRows(db.inserts);
    expect(rows, 'a comped signup must still provision').toHaveLength(1);
    expect(rows[0].row).toMatchObject({
      restaurant_id: REST_ID,
      plan: 'quarterly',
      status: 'active',
      stripe_invoice_id: 'cs_comped_001',
    });
    // Explicitly 0 — not undefined, not the list price, not skipped.
    expect(rows[0].row.amount_cents).toBe(0);
    expect(typeof rows[0].row.amount_cents).toBe('number');
  });

  it('the comped path still stamps the term and the activity event', async () => {
    const db = makeDb();
    await useDb(db);

    await deliver('evt_comped_002', 'checkout.session.completed', compedSession('cs_comped_002'));

    const sub = subscriptionRows(db.inserts)[0].row as Record<string, string>;
    expect(sub.starts_at).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(sub.ends_at).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // quarterly = +3 months
    const months =
      (new Date(sub.ends_at).getFullYear() - new Date(sub.starts_at).getFullYear()) * 12 +
      (new Date(sub.ends_at).getMonth() - new Date(sub.starts_at).getMonth());
    expect(months).toBe(3);

    const activity = db.inserts.find((i) => i.table === 'activity_events');
    expect(activity?.row).toMatchObject({
      type: 'subscription_created',
      restaurant_id: REST_ID,
    });
    expect((activity?.row.payload as Record<string, unknown>).amount_cents).toBe(0);
  });

  // ── Acceptance 2: paid provisions exactly once ─────────────────────────────

  it('a paid session provisions exactly one subscription', async () => {
    const db = makeDb();
    await useDb(db);

    const res = await deliver(
      'evt_paid_001',
      'checkout.session.completed',
      paidSession('cs_paid_001')
    );

    expect(res.status).toBe(200);
    const rows = subscriptionRows(db.inserts);
    expect(rows).toHaveLength(1);
    expect(rows[0].row).toMatchObject({
      amount_cents: 9000,
      stripe_invoice_id: 'cs_paid_001',
    });
  });

  it('TRAP 1: the PaymentIntent a paid Checkout also fires provisions nothing', async () => {
    // Both events, in the order Stripe sends them, against ONE database.
    const db = makeDb();
    await useDb(db);

    await deliver('evt_paid_002', 'checkout.session.completed', paidSession('cs_paid_002'));
    // Worst case: the PaymentIntent carries the plan metadata too.
    await deliver(
      'evt_paid_002_pi',
      'payment_intent.succeeded',
      pairedPaymentIntent('cs_paid_002', planMetadata())
    );

    const rows = subscriptionRows(db.inserts);
    expect(rows, 'the PaymentIntent path must not provision a second time').toHaveLength(1);
    expect(rows[0].row.stripe_invoice_id).toBe('cs_paid_002');
    // And no pi_… row could ever have been written.
    expect(rows.some((r) => String(r.row.stripe_invoice_id).startsWith('pi_'))).toBe(false);
  });

  // ── Acceptance 3: redelivery is a no-op ────────────────────────────────────

  it('replaying the same event id inserts nothing (stripe_events guard)', async () => {
    // count=0 → the stripe_events row already exists; status 'completed' → the
    // earlier delivery ran to the end, so this really is a duplicate.
    const db = makeDb({ eventInsertCount: 0, priorEventStatus: 'completed' });
    await useDb(db);

    const res = await deliver(
      'evt_replay_001',
      'checkout.session.completed',
      paidSession('cs_replay_001')
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as { received: boolean; duplicate: boolean };
    expect(body.duplicate).toBe(true);
    expect(subscriptionRows(db.inserts)).toHaveLength(0);
    expect(new Set(db.fromCalls)).toEqual(new Set(['stripe_events']));
  });

  it('a NEW event id for an already-provisioned session is absorbed by the UNIQUE index', async () => {
    // This is the shape stripe_events cannot catch: a different event id (or a
    // concurrent delivery that also saw 'pending'). The DB rejects the second
    // insert with 23505 and the handler must stop there — no duplicate activity
    // event, no second WelcomeAdmin.
    const db = makeDb({
      subscriptionInsertError: { code: '23505', message: 'duplicate key value' },
    });
    await useDb(db);

    const res = await deliver(
      'evt_replay_002',
      'checkout.session.completed',
      paidSession('cs_replay_001')
    );

    expect(res.status).toBe(200);
    expect(db.inserts.filter((i) => i.table === 'activity_events')).toHaveLength(0);

    const { sendEmail } = await import('@/lib/email/send');
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('a non-23505 subscriptions error is retryable: 500 + event left un-completed', async () => {
    const db = makeDb({
      subscriptionInsertError: { code: '08006', message: 'connection failure' },
    });
    await useDb(db);

    const res = await deliver(
      'evt_db_down',
      'checkout.session.completed',
      paidSession('cs_db_down')
    );

    expect(res.status).toBe(500);
    const marked = db.updates.filter((u) => u.table === 'stripe_events');
    expect(marked.some((u) => u.values.status === 'failed')).toBe(true);
    expect(marked.some((u) => u.values.status === 'completed')).toBe(false);
  });

  // ── Guards around what does and does not provision ─────────────────────────

  it('refuses to invent a price when amount_total is missing', async () => {
    const db = makeDb();
    await useDb(db);

    const res = await deliver(
      'evt_no_amount',
      'checkout.session.completed',
      paidSession('cs_no_amount', { amount_total: null })
    );

    // 500 → Stripe redelivers. Storing a guessed amount on a billing row is
    // worse than a retry.
    expect(res.status).toBe(500);
    expect(subscriptionRows(db.inserts)).toHaveLength(0);
  });

  it('does not provision an unpaid (delayed-notification) session', async () => {
    const db = makeDb();
    await useDb(db);

    const res = await deliver(
      'evt_unpaid',
      'checkout.session.completed',
      paidSession('cs_unpaid', { payment_status: 'unpaid' })
    );

    expect(res.status).toBe(200);
    expect(subscriptionRows(db.inserts)).toHaveLength(0);
  });

  it('provisions that unpaid session once it settles (async_payment_succeeded)', async () => {
    const db = makeDb();
    await useDb(db);

    const res = await deliver(
      'evt_async_ok',
      'checkout.session.async_payment_succeeded',
      paidSession('cs_unpaid')
    );

    expect(res.status).toBe(200);
    const rows = subscriptionRows(db.inserts);
    expect(rows).toHaveLength(1);
    expect(rows[0].row.stripe_invoice_id).toBe('cs_unpaid');
  });

  it('ignores a completed session whose kind Checkout does not handle', async () => {
    // `submission` is a routed kind (the PaymentIntent path handles it) that
    // Checkout deliberately does not, so it is the right stand-in for "not a
    // plan" now. It used to be a cert_fee session — T-41b made that kind a
    // handled Checkout path, covered by
    // tests/integration/stripe-cert-fee-checkout.test.ts, so reusing it here
    // would exercise the cert-fee handler rather than the plan router's guard.
    const db = makeDb();
    await useDb(db);

    const res = await deliver(
      'evt_not_plan',
      'checkout.session.completed',
      paidSession('cs_not_plan', {
        metadata: toStripeMetadata(
          buildSubmissionMetadata({
            restaurantId: REST_ID,
            submissionId: '55555555-5555-4555-8555-555555555555',
          })
        ),
      })
    );

    expect(res.status).toBe(200);
    expect(subscriptionRows(db.inserts)).toHaveLength(0);
    // Nothing but the dedupe table is touched.
    expect(new Set(db.fromCalls)).toEqual(new Set(['stripe_events']));
  });

  it('rejects a plan session whose metadata lost its tenant key', async () => {
    const db = makeDb();
    await useDb(db);

    const res = await deliver(
      'evt_bad_meta',
      'checkout.session.completed',
      paidSession('cs_bad_meta', { metadata: { kind: 'plan', plan: 'quarterly' } })
    );

    // Loud 500, not a silent skip: the money moved and nobody got provisioned.
    expect(res.status).toBe(500);
    expect(subscriptionRows(db.inserts)).toHaveLength(0);
  });

  // ── Acceptance 4: the PaymentIntent router still serves its own kinds ──────

  it('payment_intent.succeeded still routes submission unchanged', async () => {
    const db = makeDb();
    await useDb(db);

    const res = await deliver('evt_submission', 'payment_intent.succeeded', {
      id: 'pi_submission',
      amount: 3500,
      status: 'succeeded',
      invoice: null,
      last_payment_error: null,
      metadata: {
        kind: 'submission',
        restaurant_id: REST_ID,
        submission_id: '55555555-5555-4555-8555-555555555555',
      },
    });

    expect(res.status).toBe(200);
    expect(db.fromCalls).toContain('submissions');
    expect(subscriptionRows(db.inserts)).toHaveLength(0);
  });

  it('payment_intent.succeeded still routes cert_fee unchanged', async () => {
    const db = makeDb();
    await useDb(db);

    const res = await deliver('evt_cert_fee', 'payment_intent.succeeded', {
      id: 'pi_cert_fee',
      amount: 7000,
      status: 'succeeded',
      invoice: null,
      last_payment_error: null,
      metadata: toStripeMetadata(
        buildCertFeeMetadata({ restaurantId: REST_ID, certifiedCount: 2, feePerCertCents: 3500 })
      ),
    });

    expect(res.status).toBe(200);
    expect(db.fromCalls).toContain('certificates');
    expect(subscriptionRows(db.inserts)).toHaveLength(0);
  });
});
