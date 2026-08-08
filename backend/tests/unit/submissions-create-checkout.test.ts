/**
 * tests/unit/submissions-create-checkout.test.ts
 *
 * T-41b — POST /api/submissions/create stops charging and starts a Checkout
 * Session. Replaces tests/unit/submissions-charge-cert-fees-call.test.ts,
 * whose subject (the x-internal-secret header on the server-to-server call to
 * the off-session charge route) described a code path that no longer existed.
 * T-48 then deleted that route outright, so this file is not merely the
 * current test of this behaviour — it is the only one.
 *
 * What must hold:
 *   1. The Session is priced from PENDING certificates — quantity, not a
 *      pre-multiplied unit_amount, so Stripe's page reads "3 × $35.00" and a
 *      percentage promotion code discounts every seat.
 *   2. `allow_promotion_codes: true`. Without it the comped pilot has no way
 *      to reach $0 and the whole design fails at the last step.
 *   3. Metadata comes from the lib/stripe/metadata.ts builders and carries
 *      `submitted_by` — the webhook has no session and no other source for
 *      submissions.submitted_by, which is NOT NULL.
 *   4. The restaurant is NOT moved to pending_review, and no submission row is
 *      written. Both belong to the webhook. This is the abandonment guarantee:
 *      a manager who closes Stripe's page leaves nothing behind.
 *   5. Zero pending certificates → no Session at all, submission recorded
 *      outright. That is the resubmission-does-not-re-charge case.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ─── Hoisted spies ────────────────────────────────────────────────────────────

const {
  mockGetUser,
  mockServerFrom,
  mockServiceFrom,
  mockCheckEligibility,
  mockSessionsCreate,
  mockFinalizeSubmission,
} = vi.hoisted(() => ({
  mockGetUser: vi.fn(),
  mockServerFrom: vi.fn(),
  mockServiceFrom: vi.fn(),
  mockCheckEligibility: vi.fn(),
  mockSessionsCreate: vi.fn(),
  mockFinalizeSubmission: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabase: vi.fn(async () => ({
    auth: { getUser: mockGetUser },
    from: mockServerFrom,
  })),
}));

vi.mock('@/lib/db/service', () => ({
  createServiceDb: vi.fn(() => ({ from: mockServiceFrom })),
}));

vi.mock('@/lib/admin/eligibility', () => ({
  checkEligibility: mockCheckEligibility,
}));

vi.mock('@/lib/stripe', () => ({
  stripe: { checkout: { sessions: { create: mockSessionsCreate } } },
}));

vi.mock('@/lib/submissions/finalize', () => ({
  finalizeSubmission: mockFinalizeSubmission,
}));

vi.mock('server-only', () => ({}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

const USER_ID = '11111111-1111-4111-8111-111111111111';
const RESTAURANT_ID = '22222222-2222-4222-8222-222222222222';
const NEW_SUBMISSION_ID = '55555555-5555-4555-8555-555555555555';

/** Every table write this route makes, captured for assertion. */
const updates: Array<{ table: string; values: Record<string, unknown> }> = [];
const inserts: Array<{ table: string; values: Record<string, unknown> }> = [];

function chain(table: string, result: unknown) {
  const c: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'in', 'order', 'limit']) c[m] = vi.fn(() => c);
  c.update = vi.fn((values: Record<string, unknown>) => {
    updates.push({ table, values });
    return c;
  });
  c.insert = vi.fn((values: Record<string, unknown>) => {
    inserts.push({ table, values });
    return c;
  });
  c.single = vi.fn(async () => result);
  c.maybeSingle = vi.fn(async () => result);
  c.then = (onFulfilled: (v: unknown) => unknown) => Promise.resolve(result).then(onFulfilled);
  return c;
}

function makeRequest() {
  return new NextRequest('http://localhost:3000/api/submissions/create', {
    method: 'POST',
    body: JSON.stringify({
      cuisine: 'american',
      allergenSpecialties: ['gluten_free_menu'],
      heroPhotoStoragePath: 'restaurant-photos/test/hero.jpg',
      about: 'Pilot test',
    }),
  });
}

/** The single argument handed to stripe.checkout.sessions.create. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function capturedSessionArgs(): any {
  expect(mockSessionsCreate, 'expected a Checkout Session to be created').toHaveBeenCalledTimes(1);
  return mockSessionsCreate.mock.calls[0][0];
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('POST /api/submissions/create — starts a Stripe Checkout Session', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    updates.length = 0;
    inserts.length = 0;

    process.env.APP_URL = 'https://app.example.test';

    mockGetUser.mockResolvedValue({ data: { user: { id: USER_ID } }, error: null });
    mockServerFrom.mockImplementation((t: string) => chain(t, { data: null, error: null }));

    mockServiceFrom.mockImplementation((table: string) => {
      if (table === 'profiles') {
        return chain(table, {
          data: {
            id: USER_ID,
            role: 'manager',
            restaurant_id: RESTAURANT_ID,
            email: 'manager@example.com',
            full_name: 'Test Manager',
          },
          error: null,
        });
      }
      if (table === 'restaurants') {
        return chain(table, {
          data: {
            id: RESTAURANT_ID,
            name: 'Test Bistro',
            status: 'unlisted',
            stripe_customer_id: 'cus_test_123',
          },
          error: null,
        });
      }
      return chain(table, { data: null, error: null });
    });

    // 3 learners passed, all 3 certificates still awaiting payment.
    mockCheckEligibility.mockResolvedValue({
      eligible: true,
      reasons: [],
      certifiedCount: 3,
      totalLearners: 3,
      pendingCertCount: 3,
    });

    mockSessionsCreate.mockResolvedValue({
      id: 'cs_test_created',
      url: 'https://checkout.stripe.com/c/pay/cs_test_created',
    });

    mockFinalizeSubmission.mockResolvedValue({
      outcome: 'created',
      submissionId: NEW_SUBMISSION_ID,
    });
  });

  it('returns a Checkout URL instead of charging a card', async () => {
    const { POST } = await import('@/app/api/submissions/create/route');
    const res = await POST(makeRequest());

    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.checkoutUrl).toBe('https://checkout.stripe.com/c/pay/cs_test_created');
    expect(body.checkoutSessionId).toBe('cs_test_created');
    expect(body.pendingCertCount).toBe(3);
    expect(body.certFeeTotalCents, '3 × $35.00').toBe(10500);
  });

  it('prices a QUANTITY of pending certificates at the unit fee', async () => {
    const { POST } = await import('@/app/api/submissions/create/route');
    await POST(makeRequest());

    const args = capturedSessionArgs();
    expect(args.line_items).toHaveLength(1);
    // Quantity × unit price, NOT one line at 10500 — so Stripe's page reads
    // "3 × $35.00" and a percentage code discounts all three.
    expect(args.line_items[0].quantity).toBe(3);
    expect(args.line_items[0].price_data.unit_amount).toBe(3500);
    expect(args.line_items[0].price_data.currency).toBe('usd');
    expect(args.mode).toBe('payment');
  });

  it('enables promotion codes — the entire comp mechanism', async () => {
    const { POST } = await import('@/app/api/submissions/create/route');
    await POST(makeRequest());

    expect(capturedSessionArgs().allow_promotion_codes).toBe(true);
  });

  it('stamps routing metadata on the SESSION, including submitted_by', async () => {
    const { POST } = await import('@/app/api/submissions/create/route');
    await POST(makeRequest());

    const args = capturedSessionArgs();
    expect(args.metadata).toMatchObject({
      kind: 'cert_fee',
      restaurant_id: RESTAURANT_ID,
      certified_count: '3',
      fee_per_cert_cents: '3500',
      // Without this the webhook cannot fill submissions.submitted_by (NOT NULL).
      submitted_by: USER_ID,
    });

    // NOT on payment_intent_data: a paid Checkout fires both
    // checkout.session.completed and payment_intent.succeeded, and the PI path
    // would write a submission under a pi_… id the Session's UNIQUE index
    // cannot collapse.
    expect(args.payment_intent_data?.metadata).toBeUndefined();
  });

  it('sends the browser back to a page that polls, and to the form on cancel', async () => {
    const { POST } = await import('@/app/api/submissions/create/route');
    await POST(makeRequest());

    const args = capturedSessionArgs();
    expect(args.success_url).toBe(
      'https://app.example.test/admin/submit/complete?session_id={CHECKOUT_SESSION_ID}'
    );
    expect(args.cancel_url).toBe('https://app.example.test/admin/submit?canceled=1');
  });

  it('reuses the restaurant’s Stripe customer', async () => {
    const { POST } = await import('@/app/api/submissions/create/route');
    await POST(makeRequest());

    expect(capturedSessionArgs().customer).toBe('cus_test_123');
  });

  it('ABANDONMENT: saves the profile fields but does not touch status or submissions', async () => {
    const { POST } = await import('@/app/api/submissions/create/route');
    await POST(makeRequest());

    const restaurantUpdates = updates.filter((u) => u.table === 'restaurants');
    expect(restaurantUpdates).toHaveLength(1);
    expect(restaurantUpdates[0].values).toMatchObject({
      cuisine: 'american',
      allergen_specialties: ['gluten_free_menu'],
      hero_photo_url: 'restaurant-photos/test/hero.jpg',
      about: 'Pilot test',
    });
    // The whole point: nothing is submitted until the fee is paid.
    expect(restaurantUpdates[0].values).not.toHaveProperty('status');
    expect(inserts.filter((i) => i.table === 'submissions')).toHaveLength(0);
    expect(mockFinalizeSubmission).not.toHaveBeenCalled();
  });

  it('a comped restaurant with no saved card still gets a Session', async () => {
    // The old off-session charge returned "No default payment method on file."
    // for exactly this restaurant. Checkout collects one, or needs none at $0.
    mockServiceFrom.mockImplementation((table: string) => {
      if (table === 'profiles') {
        return chain(table, {
          data: { id: USER_ID, role: 'manager', restaurant_id: RESTAURANT_ID },
          error: null,
        });
      }
      if (table === 'restaurants') {
        return chain(table, {
          data: {
            id: RESTAURANT_ID,
            name: 'Comped Bistro',
            status: 'unlisted',
            stripe_customer_id: null,
          },
          error: null,
        });
      }
      return chain(table, { data: null, error: null });
    });

    const { POST } = await import('@/app/api/submissions/create/route');
    const res = await POST(makeRequest());

    expect(res.status).toBe(200);
    expect(capturedSessionArgs().customer).toBeUndefined();
  });

  it('RESUBMISSION: zero pending certificates → no Session, recorded outright', async () => {
    mockCheckEligibility.mockResolvedValue({
      eligible: true,
      reasons: [],
      certifiedCount: 4,
      totalLearners: 4,
      pendingCertCount: 0,
    });

    const { POST } = await import('@/app/api/submissions/create/route');
    const res = await POST(makeRequest());

    expect(res.status).toBe(201);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.submissionId).toBe(NEW_SUBMISSION_ID);
    expect(body.certFeeTotalCents, 'nobody new to certify, nothing to charge').toBe(0);

    expect(mockSessionsCreate, 'must not open a $0 Checkout for nothing').not.toHaveBeenCalled();
    expect(mockFinalizeSubmission).toHaveBeenCalledTimes(1);
    expect(mockFinalizeSubmission.mock.calls[0][0]).toMatchObject({
      restaurantId: RESTAURANT_ID,
      submittedBy: USER_ID,
      checkoutSessionId: null,
      certFeeTotalCents: 0,
      // Nothing was activated because nothing was pending. This is NOT the
      // restaurant's staff count — finalizeSubmission reads that live (T-47).
      activatedCount: 0,
    });
  });

  it('an ineligible restaurant gets 422 and no Session', async () => {
    mockCheckEligibility.mockResolvedValue({
      eligible: false,
      reasons: ['2 of 3 employee(s) have not passed the exam.'],
      certifiedCount: 1,
      totalLearners: 3,
      pendingCertCount: 1,
    });

    const { POST } = await import('@/app/api/submissions/create/route');
    const res = await POST(makeRequest());

    expect(res.status).toBe(422);
    expect(mockSessionsCreate).not.toHaveBeenCalled();
    expect(updates.filter((u) => u.table === 'restaurants')).toHaveLength(0);
  });

  it('a Stripe failure is a 502 and leaves nothing submitted', async () => {
    mockSessionsCreate.mockRejectedValue(new Error('Stripe is down'));

    const { POST } = await import('@/app/api/submissions/create/route');
    const res = await POST(makeRequest());

    expect(res.status).toBe(502);
    expect(inserts.filter((i) => i.table === 'submissions')).toHaveLength(0);
    const restaurantUpdates = updates.filter((u) => u.table === 'restaurants');
    expect(restaurantUpdates.every((u) => !('status' in u.values))).toBe(true);
  });
});
