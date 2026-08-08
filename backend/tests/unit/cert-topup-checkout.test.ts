/**
 * tests/unit/cert-topup-checkout.test.ts
 *
 * T-45a — /api/admin/top-up. The mechanism that collects the $35 nobody was
 * charged when a restaurant hired after it was listed.
 *
 * What is asserted:
 *   1. The Session is priced from PENDING certificates only. An already-active
 *      certificate was paid for at submission and is never re-charged.
 *   2. `allow_promotion_codes: true` — the comped-pilot path. A 100%-off code
 *      takes amount_total to 0, which is a real amount, not a missing one. The
 *      settlement half of that path is asserted in cert-topup-webhook.test.ts.
 *   3. `kind: 'cert_topup'`, never `cert_fee`. The restaurant is already LISTED;
 *      `cert_fee` would make the webhook insert a submission row and flip it to
 *      `pending_review`, pulling a live listing into review over a top-up.
 *   4. A balance that could not be read refuses to price anything — 503, no
 *      Session. A count we did not receive is not zero and is not a price.
 *   5. Nothing owed is a 409, not a $0 Session.
 *   6. The route writes NOTHING. Not to certificates, not to restaurants, not
 *      to submissions.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockGetUser, mockServerFrom, mockServiceFrom, mockSessionsCreate } = vi.hoisted(() => ({
  mockGetUser: vi.fn(),
  mockServerFrom: vi.fn(),
  mockServiceFrom: vi.fn(),
  mockSessionsCreate: vi.fn(),
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

vi.mock('@/lib/stripe', () => ({
  stripe: { checkout: { sessions: { create: mockSessionsCreate } } },
}));

vi.mock('server-only', () => ({}));

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const USER_ID = '11111111-1111-4111-8111-111111111111';
const RESTAURANT_ID = '22222222-2222-4222-8222-222222222222';

const FUTURE = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();
const ISSUED = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

interface CertRow {
  profile_id: string;
  status: string;
  expires_at: string | null;
  issued_at: string | null;
}

const learnerRow = (id: string, departed: string | null = null) => ({
  id,
  role: 'learner',
  departed_at: departed,
});

const certRow = (profileId: string, status: string, over: Partial<CertRow> = {}): CertRow => ({
  profile_id: profileId,
  status,
  expires_at: FUTURE,
  issued_at: ISSUED,
  ...over,
});

/** Every mutating call the route made, captured for assertion. MUST stay empty. */
const writes: Array<{ table: string; op: string; values: unknown }> = [];

interface Scenario {
  learners: ReturnType<typeof learnerRow>[];
  certs: CertRow[];
  learnerError?: { message: string };
  certError?: { message: string };
  restaurantMissing?: boolean;
}

function installDb(scenario: Scenario) {
  mockServiceFrom.mockImplementation((table: string) => {
    const c: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'in', 'is', 'gt', 'gte', 'order', 'limit']) {
      c[m] = vi.fn(() => c);
    }
    for (const op of ['insert', 'update', 'upsert', 'delete']) {
      c[op] = vi.fn((values: unknown) => {
        writes.push({ table, op, values });
        return c;
      });
    }

    if (table === 'profiles') {
      // requireRole reads the manager profile through .single()/.maybeSingle();
      // readCertSnapshot reads the learner roster by awaiting the builder.
      const profile = {
        data: { id: USER_ID, role: 'manager', restaurant_id: RESTAURANT_ID },
        error: null,
      };
      c.single = vi.fn(async () => profile);
      c.maybeSingle = vi.fn(async () => profile);
      c.then = (onF: (v: unknown) => unknown) =>
        Promise.resolve({
          data: scenario.learnerError ? null : scenario.learners,
          count: scenario.learnerError ? null : scenario.learners.length,
          error: scenario.learnerError ?? null,
        }).then(onF);
      return c;
    }

    if (table === 'certificates') {
      c.then = (onF: (v: unknown) => unknown) =>
        Promise.resolve({
          data: scenario.certError ? null : scenario.certs,
          count: scenario.certError ? null : scenario.certs.length,
          error: scenario.certError ?? null,
        }).then(onF);
      return c;
    }

    if (table === 'restaurants') {
      const row = scenario.restaurantMissing
        ? { data: null, error: null }
        : {
            data: { id: RESTAURANT_ID, name: 'Test Bistro', stripe_customer_id: 'cus_test_123' },
            error: null,
          };
      c.single = vi.fn(async () => row);
      c.maybeSingle = vi.fn(async () => row);
      c.then = (onF: (v: unknown) => unknown) => Promise.resolve(row).then(onF);
      return c;
    }

    c.single = vi.fn(async () => ({ data: null, error: null }));
    c.maybeSingle = vi.fn(async () => ({ data: null, error: null }));
    c.then = (onF: (v: unknown) => unknown) =>
      Promise.resolve({ data: [], count: 0, error: null }).then(onF);
    return c;
  });
}

/** The single argument handed to stripe.checkout.sessions.create. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function capturedSessionArgs(): any {
  expect(mockSessionsCreate, 'expected a Checkout Session to be created').toHaveBeenCalledTimes(1);
  return mockSessionsCreate.mock.calls[0][0];
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  writes.length = 0;

  process.env.APP_URL = 'https://app.example.test';

  mockGetUser.mockResolvedValue({ data: { user: { id: USER_ID } }, error: null });
  mockServerFrom.mockImplementation(() => ({
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single: vi.fn(async () => ({ data: null, error: null })),
    maybeSingle: vi.fn(async () => ({ data: null, error: null })),
  }));

  mockSessionsCreate.mockResolvedValue({
    id: 'cs_test_topup',
    url: 'https://checkout.stripe.com/c/pay/cs_test_topup',
  });
});

// ─── POST — the Session ───────────────────────────────────────────────────────

describe('POST /api/admin/top-up — priced from pending certificates only', () => {
  it('charges $35 for the one new hire, not for the staff already paid for', async () => {
    // Ten certified at submission, three hired since, one of whom has passed.
    installDb({
      learners: [
        ...Array.from({ length: 10 }, (_, i) => learnerRow(`old-${i}`)),
        learnerRow('hire-1'),
        learnerRow('hire-2'),
        learnerRow('hire-3'),
      ],
      certs: [
        ...Array.from({ length: 10 }, (_, i) => certRow(`old-${i}`, 'active')),
        certRow('hire-1', 'pending'),
      ],
    });

    const { POST } = await import('@/app/api/admin/top-up/route');
    const res = await POST();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.pendingCertCount).toBe(1);
    expect(body.certFeeTotalCents, '$35, not $385').toBe(3500);

    const args = capturedSessionArgs();
    expect(args.line_items[0].quantity, 'one seat').toBe(1);
    expect(args.line_items[0].price_data.unit_amount).toBe(3500);
  });

  it('bills a quantity, so a percentage promotion code discounts the whole line', async () => {
    installDb({
      learners: [learnerRow('a'), learnerRow('b'), learnerRow('c')],
      certs: [certRow('a', 'pending'), certRow('b', 'pending'), certRow('c', 'pending')],
    });

    const { POST } = await import('@/app/api/admin/top-up/route');
    const res = await POST();
    const body = await res.json();

    expect(body.pendingCertCount).toBe(3);
    expect(body.certFeeTotalCents).toBe(10500);

    const args = capturedSessionArgs();
    // Quantity × unit_amount, NOT a pre-multiplied unit_amount. Stripe's page
    // reads "3 × $35.00" and a percentage code discounts all three seats.
    expect(args.line_items[0].quantity).toBe(3);
    expect(args.line_items[0].price_data.unit_amount).toBe(3500);
  });

  it('enables promotion codes — the comped-pilot path to $0', async () => {
    installDb({ learners: [learnerRow('a')], certs: [certRow('a', 'pending')] });

    const { POST } = await import('@/app/api/admin/top-up/route');
    await POST();

    const args = capturedSessionArgs();
    expect(args.allow_promotion_codes, 'a 100%-off code must be applicable').toBe(true);
  });

  it("stamps kind='cert_topup', so the webhook does NOT re-open a review", async () => {
    installDb({ learners: [learnerRow('a')], certs: [certRow('a', 'pending')] });

    const { POST } = await import('@/app/api/admin/top-up/route');
    await POST();

    const args = capturedSessionArgs();
    expect(args.metadata.kind).toBe('cert_topup');
    expect(args.metadata.kind, 'cert_fee would drag a live listing into review').not.toBe(
      'cert_fee'
    );
    expect(args.metadata.restaurant_id).toBe(RESTAURANT_ID);
    // Metadata rides on the SESSION only. Stamping `kind` on the PaymentIntent
    // too would run the activation handler a second time under a pi_… id.
    expect(args.payment_intent_data?.kind).toBeUndefined();
    expect(args.payment_intent_data?.metadata).toBeUndefined();
  });

  it('does not bill for a DEPARTED employee who passed before leaving', async () => {
    installDb({
      learners: [learnerRow('stays'), learnerRow('quit', '2026-06-01T00:00:00.000Z')],
      certs: [certRow('stays', 'pending'), certRow('quit', 'pending')],
    });

    const { POST } = await import('@/app/api/admin/top-up/route');
    const res = await POST();
    const body = await res.json();

    expect(body.pendingCertCount, 'only the employee who still works here').toBe(1);
    expect(body.certFeeTotalCents).toBe(3500);
  });

  it('refuses to price anything when the balance could not be read', async () => {
    // A count we did not receive is not zero, and it is certainly not a price.
    installDb({ learners: [], certs: [], learnerError: { message: 'connection reset' } });

    const { POST } = await import('@/app/api/admin/top-up/route');
    const res = await POST();
    const body = await res.json();

    expect(res.status).toBe(503);
    expect(body.kind).toBe('unavailable');
    expect(
      mockSessionsCreate,
      'no Session may be priced from an unknown count'
    ).not.toHaveBeenCalled();
    expect(body.amountOwedCents, 'and no number is invented').toBeUndefined();
  });

  it('answers 409 when nothing is owed, rather than opening a $0 Session', async () => {
    installDb({
      learners: [learnerRow('a'), learnerRow('b')],
      certs: [certRow('a', 'active'), certRow('b', 'active')],
    });

    const { POST } = await import('@/app/api/admin/top-up/route');
    const res = await POST();
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.pendingCertCount).toBe(0);
    expect(body.amountOwedCents).toBe(0);
    expect(mockSessionsCreate).not.toHaveBeenCalled();
  });

  it('a Stripe failure is a 502 and leaves nothing changed', async () => {
    installDb({ learners: [learnerRow('a')], certs: [certRow('a', 'pending')] });
    mockSessionsCreate.mockRejectedValue(new Error('Stripe is down'));

    const { POST } = await import('@/app/api/admin/top-up/route');
    const res = await POST();

    expect(res.status).toBe(502);
    expect(writes).toEqual([]);
  });

  it('never caches a balance-bearing response', async () => {
    installDb({ learners: [learnerRow('a')], certs: [certRow('a', 'pending')] });

    const { POST } = await import('@/app/api/admin/top-up/route');
    const res = await POST();

    expect(res.headers.get('Cache-Control')).toContain('no-store');
  });
});

// ─── GET — the balance as data ────────────────────────────────────────────────

describe('GET /api/admin/top-up — the balance and the three counts', () => {
  it('reports what is owed, since when, and all three numbers', async () => {
    installDb({
      learners: [
        ...Array.from({ length: 10 }, (_, i) => learnerRow(`old-${i}`)),
        learnerRow('hire-1'),
        learnerRow('hire-2'),
        learnerRow('hire-3'),
      ],
      certs: [
        ...Array.from({ length: 10 }, (_, i) => certRow(`old-${i}`, 'active')),
        certRow('hire-1', 'pending'),
      ],
    });

    const { GET } = await import('@/app/api/admin/top-up/route');
    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.kind).toBe('known');

    // "10 of 13 staff certified · 3 new team members in training"
    expect(body.totalStaff).toBe(13);
    expect(body.certifiedCount).toBe(10);
    expect(body.inTrainingCount).toBe(3);
    expect(body.certifiedCount + body.inTrainingCount).toBe(body.totalStaff);

    expect(body.pendingCertCount).toBe(1);
    expect(body.amountOwedCents).toBe(3500);
    expect(body.feePerCertCents).toBe(3500);
    expect(body.owedSince).toBe(ISSUED);
  });

  it('a failed count is an absence — 503 and no number, never 0', async () => {
    installDb({ learners: [], certs: [], certError: { message: 'boom' } });

    const { GET } = await import('@/app/api/admin/top-up/route');
    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(503);
    expect(body.kind).toBe('unavailable');
    expect(body.certifiedCount, 'no laundered zero').toBeUndefined();
    expect(body.totalStaff).toBeUndefined();
    expect(body.inTrainingCount).toBeUndefined();
    expect(body.amountOwedCents).toBeUndefined();
  });

  it('a genuinely empty roster is zeros, not an absence', async () => {
    installDb({ learners: [], certs: [] });

    const { GET } = await import('@/app/api/admin/top-up/route');
    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.kind).toBe('known');
    expect(body.totalStaff).toBe(0);
    expect(body.certifiedCount).toBe(0);
    expect(body.inTrainingCount).toBe(0);
    expect(body.owedSince).toBeNull();
  });

  it('is never cached', async () => {
    installDb({ learners: [learnerRow('a')], certs: [] });

    const { GET } = await import('@/app/api/admin/top-up/route');
    const res = await GET();

    expect(res.headers.get('Cache-Control')).toContain('no-store');
  });
});

// ─── The credential is never touched ──────────────────────────────────────────

describe('the top-up route modifies no certificate', () => {
  it('creating a Checkout Session writes nothing at all', async () => {
    installDb({
      learners: [learnerRow('a'), learnerRow('b')],
      certs: [certRow('a', 'active'), certRow('b', 'pending')],
    });

    const { POST } = await import('@/app/api/admin/top-up/route');
    const res = await POST();

    expect(res.status).toBe(200);
    // Enforcement belongs on the LISTING, never on the credential. Activation
    // happens later, in the webhook, on proof of payment — never here.
    expect(writes, 'no insert, update, upsert or delete').toEqual([]);
  });

  it('reading the balance writes nothing either', async () => {
    installDb({
      learners: [learnerRow('a')],
      certs: [certRow('a', 'pending')],
    });

    const { GET } = await import('@/app/api/admin/top-up/route');
    await GET();

    expect(writes).toEqual([]);
  });
});
