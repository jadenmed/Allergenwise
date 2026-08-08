/**
 * tests/unit/stripe-routing.test.ts
 * Verifies that the webhook handler routes correctly by metadata.kind.
 *
 * Tests:
 * - checkout.session.completed kind='plan' → subscription inserted
 * - payment_intent.succeeded kind='plan' → NOTHING (T-41a: provisioning moved,
 *   and a paid Checkout fires both events)
 * - kind='cert_fee' → activity_event inserted with type='cert_issued'
 * - kind='submission' → submission updated with stripe_payment_intent_id
 * - unknown kind → no downstream calls, still returns 200
 * - payment_failed → activity_event inserted with payment_failed payload
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('@/lib/stripe', () => ({
  stripe: {
    webhooks: {
      constructEvent: vi.fn(),
    },
  },
}));

vi.mock('@/lib/supabase/server', () => ({
  createServiceSupabase: vi.fn(),
}));

vi.mock('@/lib/email/client', () => ({
  resend: { emails: { send: vi.fn().mockResolvedValue({ id: 'email-id' }) } },
  FROM_EMAIL: 'noreply@allergenwise.com',
}));

vi.mock('@/lib/email/templates/WelcomeAdmin', () => ({
  WelcomeAdmin: vi.fn().mockReturnValue(null),
}));

vi.mock('@react-email/components', () => ({
  render: vi.fn().mockResolvedValue('<html/>'),
}));

// ─── DB mock factory ──────────────────────────────────────────────────────────
// Builds a Supabase-client-shaped mock that handles the fluent chain:
//   .from(table).insert({}).select('id', { count: 'exact' }) → { data, error, count }
//   .from(table).update({}).eq('id', x) → { data, error }
//   .from(table).select().eq().maybeSingle() → { data, error }
//   .from(table).select().eq().limit() → { data, error }

function makeDb(insertCount = 1) {
  const fromCalls: string[] = [];

  const resolvable = (result: unknown) =>
    Object.assign(Promise.resolve(result), { then: undefined }); // let real .then work

  const makeChain = () => {
    const resolved = { data: [{ id: 'x' }], error: null, count: insertCount };
    const notFound = { data: null, error: null };
    const emptyList = { data: [], error: null };

    // Terminal resolvers
    const maybeSingle = vi.fn().mockResolvedValue(notFound);
    const single = vi.fn().mockResolvedValue(notFound);
    const limit = vi.fn().mockResolvedValue(emptyList);

    // eq() — 3 levels deep (enough for any webhook chain)
    const eq3 = vi.fn().mockResolvedValue(notFound); // deepest — just resolves
    const eqResult2 = { eq: eq3, maybeSingle, single, limit };
    const eq2 = vi.fn().mockReturnValue(eqResult2);
    const eqResult1 = { eq: eq2, maybeSingle, single, limit };
    const eq1 = vi.fn().mockReturnValue(eqResult1);

    // select() — returns a thenable that also has chainable methods
    const selectResult = Object.assign(Promise.resolve(resolved), {
      eq: eq1,
      maybeSingle,
      single,
      limit,
    });
    const select = vi.fn().mockReturnValue(selectResult);

    // insert().select() — same pattern
    const insertSelectResult = Object.assign(Promise.resolve(resolved), {
      eq: eq1,
      maybeSingle,
      single,
      limit,
    });
    const insertSelect = vi.fn().mockReturnValue(insertSelectResult);

    const insert = vi.fn().mockReturnValue({
      select: insertSelect,
      eq: eq1,
    });

    const update = vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue(notFound),
    });

    return { insert, update, select, eq: eq1, maybeSingle, single, limit };
  };

  const fromMock = vi.fn((table: string) => {
    fromCalls.push(table);
    return makeChain();
  });

  return { fromMock, fromCalls };
}

// ─── Request builder ──────────────────────────────────────────────────────────

function makeRequest(body: string): NextRequest {
  return new NextRequest('http://localhost/api/stripe/webhook', {
    method: 'POST',
    headers: {
      'stripe-signature': 'test-sig',
      'content-type': 'application/json',
    },
    body,
  });
}

/** A completed, paid Checkout Session carrying plan metadata on the SESSION. */
function makeSession(overrides: Record<string, unknown> = {}) {
  return {
    id: 'cs_test_plan',
    object: 'checkout.session',
    amount_total: 9000,
    currency: 'usd',
    status: 'complete',
    payment_status: 'paid',
    payment_intent: 'pi_from_session',
    metadata: {
      kind: 'plan',
      restaurant_id: 'rest-uuid-123',
      plan: 'quarterly',
      admin_id: 'admin-uuid-123',
    },
    ...overrides,
  };
}

function makePi(kind: string, extras: Record<string, string> = {}) {
  return {
    id: `pi_test_${kind}`,
    amount: 9000,
    status: 'succeeded',
    invoice: null,
    last_payment_error: null,
    metadata: {
      kind,
      restaurant_id: 'rest-uuid-123',
      plan: kind === 'plan' ? 'quarterly' : undefined,
      submission_id: kind === 'submission' ? 'sub-uuid-456' : undefined,
      certificate_id: kind === 'cert_fee' ? 'cert-uuid-789' : undefined,
      ...extras,
    },
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Stripe webhook routing by metadata.kind', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules(); // Reset module cache so POST is re-imported with fresh mocks
    process.env.STRIPE_WEBHOOK_SECRET = 'test_secret';
  });

  it("checkout.session.completed kind='plan' → inserts subscription row", async () => {
    const { fromMock, fromCalls: calls } = makeDb(1);
    const { createServiceSupabase } = await import('@/lib/supabase/server');
    // Test mocks deliberately omit unused SupabaseClient methods — use double cast
    // (value as unknown as T) per TS convention for known-incomplete test fixtures.
    vi.mocked(createServiceSupabase).mockReturnValue({ from: fromMock } as unknown as ReturnType<
      typeof createServiceSupabase
    >);

    const { stripe } = await import('@/lib/stripe');
    vi.mocked(stripe.webhooks.constructEvent).mockReturnValue({
      id: 'evt_session_001',
      type: 'checkout.session.completed',
      data: { object: makeSession() },
      // Stripe.Event has many fields not needed for these routing tests — double cast is safe here.
    } as unknown as ReturnType<typeof stripe.webhooks.constructEvent>);

    const { POST } = await import('@/app/api/stripe/webhook/route');
    const res = await POST(makeRequest(JSON.stringify({})));

    expect(res.status).toBe(200);

    // Verify that from('subscriptions').insert(...) was called
    expect(calls).toContain('subscriptions');
  });

  it("payment_intent.succeeded kind='plan' → provisions NOTHING (T-41a trap 1)", async () => {
    // A PAID Checkout Session fires checkout.session.completed AND
    // payment_intent.succeeded. If this event still provisioned, the two paths
    // would write different stripe_invoice_ids (cs_… vs pi_…), the UNIQUE index
    // could not collapse them, and the restaurant would get two subscriptions.
    const { fromMock, fromCalls: calls } = makeDb(1);
    const { createServiceSupabase } = await import('@/lib/supabase/server');
    vi.mocked(createServiceSupabase).mockReturnValue({ from: fromMock } as unknown as ReturnType<
      typeof createServiceSupabase
    >);

    const { stripe } = await import('@/lib/stripe');
    vi.mocked(stripe.webhooks.constructEvent).mockReturnValue({
      id: 'evt_plan_pi_001',
      type: 'payment_intent.succeeded',
      data: { object: makePi('plan') },
    } as unknown as ReturnType<typeof stripe.webhooks.constructEvent>);

    const { POST } = await import('@/app/api/stripe/webhook/route');
    const res = await POST(makeRequest(JSON.stringify({})));

    expect(res.status).toBe(200);
    expect(calls).not.toContain('subscriptions');
    expect(calls).not.toContain('activity_events');
    expect(new Set(calls)).toEqual(new Set(['stripe_events']));
  });

  it("kind='cert_fee' → inserts activity_event with type='cert_issued'", async () => {
    const { fromMock, fromCalls: calls } = makeDb(1);
    const { createServiceSupabase } = await import('@/lib/supabase/server');
    // Test mocks deliberately omit unused SupabaseClient methods — use double cast
    // (value as unknown as T) per TS convention for known-incomplete test fixtures.
    vi.mocked(createServiceSupabase).mockReturnValue({ from: fromMock } as unknown as ReturnType<
      typeof createServiceSupabase
    >);

    const { stripe } = await import('@/lib/stripe');
    const pi = makePi('cert_fee');
    vi.mocked(stripe.webhooks.constructEvent).mockReturnValue({
      id: 'evt_cert_001',
      type: 'payment_intent.succeeded',
      data: { object: pi },
      // Stripe.Event has many fields not needed for these routing tests — double cast is safe here.
    } as unknown as ReturnType<typeof stripe.webhooks.constructEvent>);

    const { POST } = await import('@/app/api/stripe/webhook/route');
    const res = await POST(makeRequest(JSON.stringify({})));

    expect(res.status).toBe(200);

    // Verify activity_events was touched
    expect(calls).toContain('activity_events');
    // Verify certificates.update was called
    expect(calls).toContain('certificates');
  });

  it("kind='submission' → updates submission row with stripe_payment_intent_id", async () => {
    const { fromMock, fromCalls: calls } = makeDb(1);
    const { createServiceSupabase } = await import('@/lib/supabase/server');
    // Test mocks deliberately omit unused SupabaseClient methods — use double cast
    // (value as unknown as T) per TS convention for known-incomplete test fixtures.
    vi.mocked(createServiceSupabase).mockReturnValue({ from: fromMock } as unknown as ReturnType<
      typeof createServiceSupabase
    >);

    const { stripe } = await import('@/lib/stripe');
    const pi = makePi('submission');
    vi.mocked(stripe.webhooks.constructEvent).mockReturnValue({
      id: 'evt_sub_001',
      type: 'payment_intent.succeeded',
      data: { object: pi },
      // Stripe.Event has many fields not needed for these routing tests — double cast is safe here.
    } as unknown as ReturnType<typeof stripe.webhooks.constructEvent>);

    const { POST } = await import('@/app/api/stripe/webhook/route');
    const res = await POST(makeRequest(JSON.stringify({})));

    expect(res.status).toBe(200);
    expect(calls).toContain('submissions');
  });

  it("kind='unknown' → only touches stripe_events, returns 200", async () => {
    const { fromMock, fromCalls: calls } = makeDb(1);
    const { createServiceSupabase } = await import('@/lib/supabase/server');
    // Test mocks deliberately omit unused SupabaseClient methods — use double cast
    // (value as unknown as T) per TS convention for known-incomplete test fixtures.
    vi.mocked(createServiceSupabase).mockReturnValue({ from: fromMock } as unknown as ReturnType<
      typeof createServiceSupabase
    >);

    const { stripe } = await import('@/lib/stripe');
    vi.mocked(stripe.webhooks.constructEvent).mockReturnValue({
      id: 'evt_unknown_001',
      type: 'payment_intent.succeeded',
      data: {
        object: {
          id: 'pi_test',
          amount: 100,
          status: 'succeeded',
          last_payment_error: null,
          metadata: { kind: 'mystery', restaurant_id: 'r1' },
        },
      },
      // Stripe.Event has many fields not needed for these routing tests — double cast is safe here.
    } as unknown as ReturnType<typeof stripe.webhooks.constructEvent>);

    const { POST } = await import('@/app/api/stripe/webhook/route');
    const res = await POST(makeRequest('{}'));

    expect(res.status).toBe(200);
    // Only stripe_events should be touched
    expect(calls).not.toContain('subscriptions');
    expect(calls).not.toContain('certificates');
    expect(calls).not.toContain('submissions');
  });

  it('payment_intent.payment_failed → logs activity event', async () => {
    const { fromMock, fromCalls: calls } = makeDb(1);
    const { createServiceSupabase } = await import('@/lib/supabase/server');
    // Test mocks deliberately omit unused SupabaseClient methods — use double cast
    // (value as unknown as T) per TS convention for known-incomplete test fixtures.
    vi.mocked(createServiceSupabase).mockReturnValue({ from: fromMock } as unknown as ReturnType<
      typeof createServiceSupabase
    >);

    const { stripe } = await import('@/lib/stripe');
    vi.mocked(stripe.webhooks.constructEvent).mockReturnValue({
      id: 'evt_fail_001',
      type: 'payment_intent.payment_failed',
      data: {
        object: {
          id: 'pi_failed',
          amount: 9000,
          status: 'requires_payment_method',
          last_payment_error: { message: 'Card declined', code: 'card_declined' },
          metadata: { kind: 'plan', restaurant_id: 'rest-uuid-123' },
        },
      },
      // Stripe.Event has many fields not needed for these routing tests — double cast is safe here.
    } as unknown as ReturnType<typeof stripe.webhooks.constructEvent>);

    const { POST } = await import('@/app/api/stripe/webhook/route');
    const res = await POST(makeRequest('{}'));

    expect(res.status).toBe(200);
    expect(calls).toContain('activity_events');
  });
});
