/**
 * tests/unit/cert-topup-webhook.test.ts
 *
 * T-45a — what happens after a top-up is paid, and the thing that must NOT
 * happen.
 *
 * THE DECISION THIS PROTECTS
 * ──────────────────────────
 * `cert_fee` and `cert_topup` are the same Session, the same price and the same
 * promotion-code behaviour. They differ in exactly one way, after the money
 * lands:
 *
 *   cert_fee   → activate the pending certificates, THEN finalizeSubmission:
 *                insert a submission row and flip the restaurant to
 *                `pending_review`.
 *   cert_topup → activate the pending certificates and STOP.
 *
 * A restaurant paying a top-up is already LISTED. Routing it through `cert_fee`
 * would re-queue that live listing for review every time a new hire passed the
 * exam — a diner searching the directory would find it missing or flagged
 * because the restaurant did the right thing and trained somebody.
 *
 * The comped path is asserted here too: a 100%-off promotion code takes the
 * Session to `amount_total: 0` and `payment_status: 'no_payment_required'`, at
 * which point Stripe creates NO PaymentIntent. That must still settle — it is
 * the pilot path, and routing off payment_intent.succeeded would silently never
 * activate a comped restaurant's certificates.
 *
 * Activation itself is NOT re-tested here: `handleCertFeeSucceeded` is the same
 * function the submission path uses and is covered by the cert-fee suites. What
 * is tested is the routing decision, which is the part T-45a introduced.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const { mockConstructEvent, mockCertFeeSucceeded, mockFinalizeSubmission } = vi.hoisted(() => ({
  mockConstructEvent: vi.fn(),
  mockCertFeeSucceeded: vi.fn(),
  mockFinalizeSubmission: vi.fn(),
}));

vi.mock('@/lib/stripe', () => ({
  stripe: { webhooks: { constructEvent: mockConstructEvent } },
}));

vi.mock('@/lib/stripe/cert-event-handlers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/stripe/cert-event-handlers')>();
  return { ...actual, handleCertFeeSucceeded: mockCertFeeSucceeded };
});

vi.mock('@/lib/submissions/finalize', () => ({
  finalizeSubmission: mockFinalizeSubmission,
}));

vi.mock('@/lib/supabase/server', () => ({
  createServiceSupabase: vi.fn(() => ({ from: dbFrom })),
}));

vi.mock('@/lib/email/client', () => ({
  resend: { emails: { send: vi.fn().mockResolvedValue({ id: 'email-id' }) } },
  FROM_EMAIL: 'noreply@allergenwise.com',
}));

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const RESTAURANT_ID = '22222222-2222-4222-8222-222222222222';
const MANAGER_ID = '99999999-9999-4999-8999-999999999999';

/** Every table the webhook wrote to, so "no submission row" is checkable. */
let writes: Array<{ table: string; op: string }> = [];

function dbFrom(table: string) {
  const c: Record<string, unknown> = {};
  // `neq` is reached only on the failure path, where the webhook marks the
  // stripe_events row failed for anything not already completed.
  for (const m of ['eq', 'neq', 'in', 'is', 'gt', 'order', 'limit']) c[m] = vi.fn(() => c);

  for (const op of ['insert', 'update', 'upsert', 'delete']) {
    c[op] = vi.fn(() => {
      // The dedupe ledger is bookkeeping, not a domain write.
      if (table !== 'stripe_events') writes.push({ table, op });
      return c;
    });
  }

  // stripe_events insert → .select('id',{count}) resolving count 1 = first delivery.
  c.select = vi.fn(() =>
    Object.assign(Promise.resolve({ data: [{ id: 'x' }], error: null, count: 1 }), c)
  );
  c.maybeSingle = vi.fn(async () => ({ data: null, error: null }));
  c.single = vi.fn(async () => ({ data: null, error: null }));
  c.then = (onF: (v: unknown) => unknown) =>
    Promise.resolve({ data: [], error: null, count: 0 }).then(onF);
  return c;
}

function makeRequest() {
  return new NextRequest('http://localhost/api/stripe/webhook', {
    method: 'POST',
    headers: { 'stripe-signature': 'test-sig', 'content-type': 'application/json' },
    body: '{}',
  });
}

function session(overrides: Record<string, unknown> = {}) {
  return {
    id: 'cs_test_topup',
    object: 'checkout.session',
    amount_total: 3500,
    currency: 'usd',
    status: 'complete',
    payment_status: 'paid',
    payment_intent: 'pi_from_topup',
    metadata: {
      kind: 'cert_topup',
      restaurant_id: RESTAURANT_ID,
      certified_count: '1',
      fee_per_cert_cents: '3500',
      submitted_by: MANAGER_ID,
    },
    ...overrides,
  };
}

async function deliver(sessionObject: Record<string, unknown>) {
  mockConstructEvent.mockReturnValue({
    id: `evt_${String(sessionObject.id)}`,
    type: 'checkout.session.completed',
    data: { object: sessionObject },
  } as never);

  const { POST } = await import('@/app/api/stripe/webhook/route');
  return POST(makeRequest());
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  writes = [];
  process.env.STRIPE_WEBHOOK_SECRET = 'test_secret';

  mockCertFeeSucceeded.mockResolvedValue({ activatedCount: 1 });
  mockFinalizeSubmission.mockResolvedValue({ outcome: 'created', submissionId: 'sub-1' });
});

// ─── The routing decision ─────────────────────────────────────────────────────

describe('cert_topup activates the certificates and STOPS', () => {
  it('activates, and does NOT record a submission', async () => {
    const res = await deliver(session());

    expect(res.status).toBe(200);
    expect(mockCertFeeSucceeded, 'the money bought activation').toHaveBeenCalledTimes(1);
    expect(
      mockFinalizeSubmission,
      'a top-up must never insert a submission row'
    ).not.toHaveBeenCalled();
  });

  it('does NOT flip a live listing back to pending_review', async () => {
    await deliver(session());

    // The consequence a diner would see. finalizeSubmission is what performs
    // this update, so its absence is the guarantee — asserted on the writes
    // themselves so a future direct update here fails too.
    expect(
      writes.filter((w) => w.table === 'restaurants'),
      'the listing stays exactly as it is'
    ).toEqual([]);
    expect(writes.filter((w) => w.table === 'submissions')).toEqual([]);
  });

  it('stamps the PaymentIntent so a later refund can still find the certificates', async () => {
    await deliver(session());

    const [, payment] = mockCertFeeSucceeded.mock.calls[0];
    expect(payment.paymentId).toBe('pi_from_topup');
    expect(payment.amountCents).toBe(3500);
  });
});

// ─── The comped pilot: a 100%-off code takes it to $0 ─────────────────────────

describe('a 100%-off promotion code settles the top-up at $0', () => {
  it("activates on payment_status='no_payment_required' with no PaymentIntent", async () => {
    // Stripe: "Completed Checkout Sessions that are free won't have an
    // associated PaymentIntent" and "If the total amount is 0, Checkout doesn't
    // collect a payment method." This event is the ONLY one that fires.
    const res = await deliver(
      session({
        id: 'cs_test_comped',
        amount_total: 0,
        payment_status: 'no_payment_required',
        payment_intent: null,
      })
    );

    expect(res.status).toBe(200);
    expect(mockCertFeeSucceeded, 'a comped pilot must still get certified').toHaveBeenCalledTimes(
      1
    );

    const [, payment] = mockCertFeeSucceeded.mock.calls[0];
    expect(payment.amountCents, '0 is a real amount, not a missing one').toBe(0);
    // No PaymentIntent exists, so the Session id is the traceable link back to
    // Stripe. Nothing was charged, so nothing can be refunded or disputed.
    expect(payment.paymentId).toBe('cs_test_comped');

    expect(mockFinalizeSubmission).not.toHaveBeenCalled();
  });

  it('still does not re-open a review for the comped case', async () => {
    await deliver(
      session({ id: 'cs_comped_2', amount_total: 0, payment_status: 'no_payment_required' })
    );

    expect(writes.filter((w) => w.table === 'submissions')).toEqual([]);
    expect(writes.filter((w) => w.table === 'restaurants')).toEqual([]);
  });
});

// ─── Refusals ─────────────────────────────────────────────────────────────────

describe('a top-up that has not settled activates nothing', () => {
  it("payment_status='unpaid' defers to async_payment_succeeded", async () => {
    // A delayed-notification method (ACH) completes the Session before the money
    // arrives. Activating here would hand out certificates for money that may
    // never land.
    const res = await deliver(session({ id: 'cs_unpaid', payment_status: 'unpaid' }));

    expect(res.status).toBe(200);
    expect(mockCertFeeSucceeded).not.toHaveBeenCalled();
    expect(mockFinalizeSubmission).not.toHaveBeenCalled();
  });

  it('a Session with no restaurant_id is a loud failure, not a silent skip', async () => {
    // Money moved and nobody got certified. A 500 makes Stripe redeliver.
    const res = await deliver(session({ id: 'cs_no_rest', metadata: { kind: 'cert_topup' } }));

    expect(res.status).toBe(500);
    expect(mockCertFeeSucceeded).not.toHaveBeenCalled();
  });
});

// ─── The control: cert_fee is untouched ───────────────────────────────────────

describe('cert_fee still records the submission (T-41b not broken)', () => {
  it('activates AND finalizes, exactly as before', async () => {
    const res = await deliver(
      session({ id: 'cs_test_certfee', metadata: { ...session().metadata, kind: 'cert_fee' } })
    );

    expect(res.status).toBe(200);
    expect(mockCertFeeSucceeded).toHaveBeenCalledTimes(1);
    expect(mockFinalizeSubmission, 'the submission path is unchanged').toHaveBeenCalledTimes(1);

    const [args] = mockFinalizeSubmission.mock.calls[0];
    expect(args.restaurantId).toBe(RESTAURANT_ID);
    expect(args.submittedBy).toBe(MANAGER_ID);
    expect(args.checkoutSessionId).toBe('cs_test_certfee');
  });
});
