/**
 * tests/integration/stripe-cert-fee-checkout.test.ts
 *
 * T-41b — certification fees are paid at submission, through Stripe Checkout.
 * This file is the behavioural proof, driven through the real route handler
 * with real Stripe HMAC signatures.
 *
 * The things that must hold:
 *
 *   1. A COMPED ($0) session works end to end. Stripe reports
 *      payment_status='no_payment_required', not 'paid', and creates no
 *      PaymentIntent at all. Accepting only 'paid' would make every 100%-off
 *      pilot fail silently — which is the case the pilot depends on.
 *   2. fee_charged_cents is a literal 0 on that path. Zero is a real value,
 *      not a missing one: it must not be skipped, defaulted, or treated as
 *      absent.
 *   3. A PAID session activates certificates, stamps the PaymentIntent id (so
 *      a later refund/dispute can still find them), and creates exactly ONE
 *      submission row.
 *   4. Redelivery is a no-op — absorbed by stripe_events for the same event
 *      id, and by the UNIQUE index on submissions.stripe_checkout_session_id
 *      for a different event id carrying the same session.
 *   5. A second paid session while a submission is already open does NOT
 *      create a second listing; it logs submission_payment_orphaned so the
 *      extra charge is refundable by hand rather than invisible.
 *   6. An unsettled (delayed-notification) session does nothing until
 *      checkout.session.async_payment_succeeded arrives.
 *   7. Plan sessions still provision, unchanged.
 *
 * METADATA RULE: fixtures never hand-write a metadata literal — they call the
 * same lib/stripe/metadata.ts builders production uses, so a producer/consumer
 * key disagreement fails the test instead of passing it.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import Stripe from 'stripe';
import { buildCertFeeMetadata, buildPlanMetadata, toStripeMetadata } from '@/lib/stripe/metadata';

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

const TEST_WEBHOOK_SECRET = 'whsec_test_allergenwise_cert_fee_checkout';
const REST_ID = '33333333-3333-4333-8333-333333333333';
const MANAGER_ID = '44444444-4444-4444-8444-444444444444';
const CERT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CERT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

// ─── DB mock ──────────────────────────────────────────────────────────────────

interface CapturedInsert {
  table: string;
  row: Record<string, unknown>;
}
interface CapturedUpdate {
  table: string;
  values: Record<string, unknown>;
}

/**
 * @param opts.eventInsertCount      rows the stripe_events INSERT reports (0 = conflict)
 * @param opts.priorEventStatus      status of a pre-existing stripe_events row
 * @param opts.pendingCerts          certificates the pending read returns
 * @param opts.certsByPaymentId      certificates already stamped with the payment id
 * @param opts.submissionInsertError error the submissions INSERT returns. A 23505
 *   naming stripe_checkout_session_id models a redelivery; a 23505 naming the
 *   partial index models a second open submission.
 */
function makeDb(
  opts: {
    eventInsertCount?: number;
    priorEventStatus?: string | null;
    pendingCerts?: Array<Record<string, unknown>>;
    certsByPaymentId?: Array<Record<string, unknown>>;
    submissionInsertError?: { code?: string; message?: string; details?: string } | null;
  } = {}
) {
  const eventInsertCount = opts.eventInsertCount ?? 1;
  const priorEventStatus = opts.priorEventStatus ?? null;
  const pendingCerts = opts.pendingCerts ?? [];
  const certsByPaymentId = opts.certsByPaymentId ?? [];
  const submissionInsertError = opts.submissionInsertError ?? null;

  const inserts: CapturedInsert[] = [];
  const updates: CapturedUpdate[] = [];
  const fromCalls: string[] = [];

  const from = vi.fn((table: string) => {
    fromCalls.push(table);

    const insert = vi.fn((row: Record<string, unknown>) => {
      inserts.push({ table, row });

      const submissionResult = submissionInsertError
        ? { data: null, error: submissionInsertError }
        : { data: { id: 'new-submission-id' }, error: null };

      const selectChain = {
        // submissions: .insert(...).select('id').single()
        single: vi.fn().mockResolvedValue(submissionResult),
        // stripe_events: .insert(...).select('id', { count }) is awaited
        then: (onF: (v: unknown) => unknown) =>
          Promise.resolve({
            data: eventInsertCount === 0 ? [] : [{ id: 'row-id' }],
            error: null,
            count: eventInsertCount,
          }).then(onF),
      };

      return {
        select: vi.fn().mockReturnValue(selectChain),
        // activity_events / certificates: the insert itself is awaited
        then: (onF: (v: unknown) => unknown) =>
          Promise.resolve({ data: null, error: null }).then(onF),
      };
    });

    const update = vi.fn((values: Record<string, unknown>) => {
      updates.push({ table, values });
      const terminal = {
        neq: vi.fn().mockResolvedValue({ data: null, error: null }),
        eq: vi.fn().mockResolvedValue({ data: null, error: null }),
        then: (onF: (v: unknown) => unknown) =>
          Promise.resolve({ data: null, error: null }).then(onF),
      };
      return { eq: vi.fn().mockReturnValue(terminal) };
    });

    // ── select() ──────────────────────────────────────────────────────────
    // certificates is read two ways: .eq(restaurant_id).eq(status='pending')
    // and .eq(stripe_payment_intent_id). Track which filters were applied so
    // the right fixture comes back.
    const filters: Record<string, unknown> = {};

    const priorRow =
      table === 'stripe_events' && priorEventStatus ? { status: priorEventStatus } : null;
    const restaurantRow = table === 'restaurants' ? { name: 'Test Bistro' } : null;
    const profileRows =
      table === 'profiles'
        ? [{ id: MANAGER_ID, full_name: 'Ada Manager', email: 'ada@example.com' }]
        : [];

    const chain: Record<string, unknown> = {
      eq: vi.fn((col: string, val: unknown) => {
        filters[col] = val;
        return chain;
      }),
      in: vi.fn(() => chain),
      gt: vi.fn(() => chain),
      maybeSingle: vi.fn(async () => ({ data: priorRow ?? restaurantRow, error: null })),
      single: vi.fn(async () => ({ data: null, error: null })),
      limit: vi.fn(async () => ({ data: profileRows, error: null })),
      then: (onF: (v: unknown) => unknown) => {
        if (table !== 'certificates') {
          return Promise.resolve({ data: [], error: null }).then(onF);
        }
        const data =
          'stripe_payment_intent_id' in filters
            ? certsByPaymentId
            : filters.status === 'pending'
              ? pendingCerts
              : [];
        return Promise.resolve({ data, error: null }).then(onF);
      },
    };

    return { insert, update, select: vi.fn(() => chain) };
  });

  return { from, inserts, updates, fromCalls };
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function certFeeMetadata(overrides: { submittedBy?: string | null } = {}): Stripe.MetadataParam {
  return toStripeMetadata(
    buildCertFeeMetadata({
      restaurantId: REST_ID,
      certifiedCount: 2,
      feePerCertCents: 3500,
      submittedBy: overrides.submittedBy === undefined ? MANAGER_ID : overrides.submittedBy,
    })
  );
}

function pendingCert(id: string) {
  return {
    id,
    cert_code: `AW-${id.slice(0, 6)}`,
    status: 'pending',
    restaurant_id: REST_ID,
    profile_id: MANAGER_ID,
    stripe_payment_intent_id: null,
  };
}

/** A PAID cert-fee Checkout Session — card collected, PaymentIntent exists. */
function paidSession(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    object: 'checkout.session',
    amount_total: 7000, // 2 × $35.00
    currency: 'usd',
    status: 'complete',
    payment_status: 'paid',
    payment_intent: `pi_for_${id}`,
    customer: 'cus_test_paid',
    metadata: certFeeMetadata(),
    ...overrides,
  };
}

/**
 * A COMPED cert-fee Session: a 100%-off promotion code took the total to 0, so
 * Stripe collected no payment method and created no PaymentIntent.
 */
function compedSession(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    object: 'checkout.session',
    amount_total: 0,
    amount_subtotal: 7000,
    currency: 'usd',
    status: 'complete',
    payment_status: 'no_payment_required', // ← trap 1
    payment_intent: null, // ← nothing to key off but the Session
    customer: 'cus_test_comped',
    total_details: { amount_discount: 7000 },
    metadata: certFeeMetadata(),
    ...overrides,
  };
}

async function deliver(eventId: string, eventType: string, object: unknown) {
  const payload = JSON.stringify({ id: eventId, type: eventType, data: { object } });
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

const rowsIn = (inserts: CapturedInsert[], table: string) =>
  inserts.filter((i) => i.table === table);
const updatesIn = (updates: CapturedUpdate[], table: string) =>
  updates.filter((u) => u.table === table);

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('T-41b — checkout.session.completed pays the certification fees', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    process.env.STRIPE_WEBHOOK_SECRET = TEST_WEBHOOK_SECRET;
    process.env.APP_URL = 'https://app.example.test';
  });

  // ── Acceptance 1: the comped case the pilot depends on ─────────────────────

  it('TRAP 1: a $0 comped session activates certificates and opens the submission', async () => {
    const db = makeDb({ pendingCerts: [pendingCert(CERT_A), pendingCert(CERT_B)] });
    await useDb(db);

    const res = await deliver(
      'evt_cf_comped_001',
      'checkout.session.completed',
      compedSession('cs_cf_comped_001')
    );

    expect(res.status).toBe(200);

    const certUpdates = updatesIn(db.updates, 'certificates');
    expect(certUpdates, 'a comped restaurant must still get active certificates').toHaveLength(1);
    expect(certUpdates[0].values.status).toBe('active');

    const submissions = rowsIn(db.inserts, 'submissions');
    expect(submissions).toHaveLength(1);
    expect(submissions[0].row).toMatchObject({
      restaurant_id: REST_ID,
      submitted_by: MANAGER_ID,
      status: 'pending',
      stripe_checkout_session_id: 'cs_cf_comped_001',
    });

    const restaurantUpdates = updatesIn(db.updates, 'restaurants');
    expect(restaurantUpdates).toHaveLength(1);
    expect(restaurantUpdates[0].values.status).toBe('pending_review');
  });

  it('TRAP 2: fee_charged_cents is a literal 0, not skipped or defaulted', async () => {
    const db = makeDb({ pendingCerts: [pendingCert(CERT_A), pendingCert(CERT_B)] });
    await useDb(db);

    await deliver(
      'evt_cf_comped_002',
      'checkout.session.completed',
      compedSession('cs_cf_comped_002')
    );

    const values = updatesIn(db.updates, 'certificates')[0].values;
    expect(values.fee_charged_cents).toBe(0);
    expect(typeof values.fee_charged_cents).toBe('number');

    // And the submission records what was actually charged — zero.
    expect(rowsIn(db.inserts, 'submissions')[0].row.cert_fee_total_cents).toBe(0);
  });

  it('a comped session stamps the Session id on the certs — there is no PaymentIntent', async () => {
    const db = makeDb({ pendingCerts: [pendingCert(CERT_A)] });
    await useDb(db);

    await deliver(
      'evt_cf_comped_003',
      'checkout.session.completed',
      compedSession('cs_cf_comped_003')
    );

    expect(updatesIn(db.updates, 'certificates')[0].values.stripe_payment_intent_id).toBe(
      'cs_cf_comped_003'
    );
    // Nothing was charged, so the submission carries no PaymentIntent.
    expect(rowsIn(db.inserts, 'submissions')[0].row.stripe_payment_intent_id).toBeNull();
  });

  // ── Acceptance 2: paid, exactly once ───────────────────────────────────────

  it('a paid session activates certs, splits the fee, and creates ONE submission', async () => {
    const db = makeDb({ pendingCerts: [pendingCert(CERT_A), pendingCert(CERT_B)] });
    await useDb(db);

    const res = await deliver(
      'evt_cf_paid_001',
      'checkout.session.completed',
      paidSession('cs_cf_paid_001')
    );

    expect(res.status).toBe(200);

    const values = updatesIn(db.updates, 'certificates')[0].values;
    expect(values.status).toBe('active');
    expect(values.fee_charged_cents, '7000 / 2 certificates').toBe(3500);
    // The PaymentIntent, so charge.refunded and the dispute handlers — which
    // look certs up by stripe_payment_intent_id — still find these.
    expect(values.stripe_payment_intent_id).toBe('pi_for_cs_cf_paid_001');

    const submissions = rowsIn(db.inserts, 'submissions');
    expect(submissions).toHaveLength(1);
    expect(submissions[0].row).toMatchObject({
      cert_fee_total_cents: 7000,
      stripe_payment_intent_id: 'pi_for_cs_cf_paid_001',
      stripe_checkout_session_id: 'cs_cf_paid_001',
    });
  });

  it('TRAP 4: the PaymentIntent a paid cert-fee Checkout also fires changes nothing', async () => {
    // Session metadata does not propagate to the PaymentIntent and
    // /api/submissions/create deliberately does not stamp `kind` there, so the
    // PI arrives with kind='unknown' and the router ignores it.
    const db = makeDb({ pendingCerts: [pendingCert(CERT_A)] });
    await useDb(db);

    await deliver('evt_cf_paid_002', 'checkout.session.completed', paidSession('cs_cf_paid_002'));
    await deliver('evt_cf_paid_002_pi', 'payment_intent.succeeded', {
      id: 'pi_for_cs_cf_paid_002',
      object: 'payment_intent',
      amount: 7000,
      status: 'succeeded',
      invoice: null,
      last_payment_error: null,
      metadata: {}, // what Stripe actually delivers for this Session
    });

    expect(rowsIn(db.inserts, 'submissions'), 'exactly one submission').toHaveLength(1);
    expect(updatesIn(db.updates, 'certificates'), 'one activation UPDATE').toHaveLength(1);
  });

  // ── Acceptance: redelivery ─────────────────────────────────────────────────

  it('replaying the same event id writes nothing (stripe_events guard)', async () => {
    const db = makeDb({
      eventInsertCount: 0,
      priorEventStatus: 'completed',
      pendingCerts: [pendingCert(CERT_A)],
    });
    await useDb(db);

    const res = await deliver(
      'evt_cf_replay_001',
      'checkout.session.completed',
      paidSession('cs_cf_replay_001')
    );

    expect(res.status).toBe(200);
    expect((await res.json()) as { duplicate?: boolean }).toMatchObject({ duplicate: true });
    expect(rowsIn(db.inserts, 'submissions')).toHaveLength(0);
    expect(new Set(db.fromCalls)).toEqual(new Set(['stripe_events']));
  });

  it('TRAP 6: a NEW event id for the same session is absorbed by the UNIQUE index', async () => {
    // The shape stripe_events cannot catch. The certificates are already
    // active (0 pending) and carry the payment id, so the handler recognises a
    // replay rather than logging a false orphan, and the submission INSERT is
    // rejected by submissions_stripe_checkout_session_id_key.
    const db = makeDb({
      pendingCerts: [],
      certsByPaymentId: [{ ...pendingCert(CERT_A), status: 'active' }],
      submissionInsertError: {
        code: '23505',
        message:
          'duplicate key value violates unique constraint "submissions_stripe_checkout_session_id_key"',
      },
    });
    await useDb(db);

    const res = await deliver(
      'evt_cf_replay_002',
      'checkout.session.completed',
      paidSession('cs_cf_replay_001')
    );

    expect(res.status).toBe(200);
    // No second listing, no false "money received, nothing delivered" alarm.
    expect(updatesIn(db.updates, 'restaurants')).toHaveLength(0);
    expect(
      rowsIn(db.inserts, 'activity_events').filter((r) => r.row.type === 'cert_payment_orphaned')
    ).toHaveLength(0);
    expect(
      rowsIn(db.inserts, 'activity_events').filter(
        (r) => r.row.type === 'submission_payment_orphaned'
      )
    ).toHaveLength(0);
  });

  it('a DIFFERENT session paid while one is open is refused and logged for refund', async () => {
    // The partial unique index on (restaurant_id) WHERE open. The certificates
    // were bought and are activated; the second listing is not created, and
    // the orphan event names the money so it can be refunded by hand.
    const db = makeDb({
      pendingCerts: [pendingCert(CERT_B)],
      submissionInsertError: {
        code: '23505',
        message:
          'duplicate key value violates unique constraint "submissions_one_open_per_restaurant"',
      },
    });
    await useDb(db);

    const res = await deliver(
      'evt_cf_double',
      'checkout.session.completed',
      paidSession('cs_cf_double')
    );

    expect(res.status).toBe(200);
    expect(updatesIn(db.updates, 'restaurants'), 'status must not change').toHaveLength(0);

    const orphans = rowsIn(db.inserts, 'activity_events').filter(
      (r) => r.row.type === 'submission_payment_orphaned'
    );
    expect(orphans).toHaveLength(1);
    expect(orphans[0].row.payload).toMatchObject({
      stripe_checkout_session_id: 'cs_cf_double',
      amount_cents: 7000,
    });
  });

  // ── Guards ─────────────────────────────────────────────────────────────────

  it('does not act on an unsettled session, then does once it settles', async () => {
    const db = makeDb({ pendingCerts: [pendingCert(CERT_A)] });
    await useDb(db);

    const pendingRes = await deliver(
      'evt_cf_unpaid',
      'checkout.session.completed',
      paidSession('cs_cf_unpaid', { payment_status: 'unpaid' })
    );
    expect(pendingRes.status).toBe(200);
    expect(updatesIn(db.updates, 'certificates')).toHaveLength(0);
    expect(rowsIn(db.inserts, 'submissions')).toHaveLength(0);

    const settledRes = await deliver(
      'evt_cf_async_ok',
      'checkout.session.async_payment_succeeded',
      paidSession('cs_cf_unpaid')
    );
    expect(settledRes.status).toBe(200);
    expect(updatesIn(db.updates, 'certificates')).toHaveLength(1);
    expect(rowsIn(db.inserts, 'submissions')).toHaveLength(1);
  });

  it('rejects a cert-fee session whose metadata lost submitted_by', async () => {
    // submissions.submitted_by is NOT NULL and the webhook has no session to
    // read it from. A loud 500 (Stripe redelivers) beats a silent skip after
    // money moved.
    const db = makeDb({ pendingCerts: [pendingCert(CERT_A)] });
    await useDb(db);

    const res = await deliver(
      'evt_cf_bad_meta',
      'checkout.session.completed',
      paidSession('cs_cf_bad_meta', { metadata: certFeeMetadata({ submittedBy: null }) })
    );

    expect(res.status).toBe(500);
    expect(rowsIn(db.inserts, 'submissions')).toHaveLength(0);
    expect(updatesIn(db.updates, 'restaurants')).toHaveLength(0);
  });

  it('refuses to invent an amount when amount_total is missing', async () => {
    const db = makeDb({ pendingCerts: [pendingCert(CERT_A)] });
    await useDb(db);

    const res = await deliver(
      'evt_cf_no_amount',
      'checkout.session.completed',
      paidSession('cs_cf_no_amount', { amount_total: null })
    );

    expect(res.status).toBe(500);
    expect(rowsIn(db.inserts, 'submissions')).toHaveLength(0);
  });

  it('a cert-fee session with 0 pending certs and no prior payment is an orphan', async () => {
    const db = makeDb({ pendingCerts: [], certsByPaymentId: [] });
    await useDb(db);

    const res = await deliver(
      'evt_cf_orphan',
      'checkout.session.completed',
      paidSession('cs_cf_orphan')
    );

    expect(res.status).toBe(200);
    const orphans = rowsIn(db.inserts, 'activity_events').filter(
      (r) => r.row.type === 'cert_payment_orphaned'
    );
    expect(orphans).toHaveLength(1);
  });

  // ── The plan path is untouched ─────────────────────────────────────────────

  it('plan sessions still provision, unchanged', async () => {
    const db = makeDb();
    await useDb(db);

    const res = await deliver('evt_plan_still_ok', 'checkout.session.completed', {
      id: 'cs_plan_still_ok',
      object: 'checkout.session',
      amount_total: 9000,
      currency: 'usd',
      status: 'complete',
      payment_status: 'paid',
      payment_intent: 'pi_plan',
      metadata: toStripeMetadata(
        buildPlanMetadata({ restaurantId: REST_ID, adminId: MANAGER_ID, plan: 'quarterly' })
      ),
    });

    expect(res.status).toBe(200);
    const subs = rowsIn(db.inserts, 'subscriptions');
    expect(subs).toHaveLength(1);
    expect(subs[0].row.stripe_invoice_id).toBe('cs_plan_still_ok');
    expect(rowsIn(db.inserts, 'submissions')).toHaveLength(0);
  });

  it('a session of an unknown kind is ignored', async () => {
    const db = makeDb();
    await useDb(db);

    const res = await deliver('evt_unknown_kind', 'checkout.session.completed', {
      id: 'cs_unknown_kind',
      object: 'checkout.session',
      amount_total: 100,
      payment_status: 'paid',
      metadata: { kind: 'mystery', restaurant_id: REST_ID },
    });

    expect(res.status).toBe(200);
    expect(new Set(db.fromCalls)).toEqual(new Set(['stripe_events']));
  });
});
