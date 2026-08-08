/**
 * tests/unit/webhook-idempotency.test.ts
 * Verifies that the Stripe webhook idempotency logic processes events exactly once.
 *
 * Strategy: mock Stripe signature verification and Supabase service client.
 * Simulate duplicate event IDs by making the DB insert return count=0.
 * Assert that handler returns {received:true, duplicate:true} without
 * calling any downstream logic.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ─── Mocks declared at top level (Vitest hoists these) ────────────────────────

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
  WelcomeAdmin: () => null,
}));

vi.mock('@react-email/components', () => ({
  render: vi.fn().mockResolvedValue('<html/>'),
}));

// ─── Import mocked modules ────────────────────────────────────────────────────
// These imports are resolved AFTER vi.mock hoisting

import { stripe } from '@/lib/stripe';
import { createServiceSupabase } from '@/lib/supabase/server';

// ─── Types ────────────────────────────────────────────────────────────────────

type MockedFn = ReturnType<typeof vi.fn>;

interface FakeDbChain {
  from: MockedFn;
  insert: MockedFn;
  select: MockedFn;
  update: MockedFn;
  eq: MockedFn;
  maybeSingle: MockedFn;
  limit: MockedFn;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * @param selectResult the count/data envelope every awaited chain resolves to.
 * @param priorEvent   what `.select('status').eq('id',…).maybeSingle()` returns
 *   for an event id that already has a row. Since 0023 the route no longer
 *   treats "a row exists" as a duplicate — it re-reads the row and only skips
 *   when status='completed'. A fixture that cannot express that distinction
 *   cannot test idempotency at all.
 */
function makeChain(
  selectResult: { data: unknown[]; error: unknown; count: number },
  priorEvent: { status: string } | null = null
): FakeDbChain {
  const chain: FakeDbChain = {
    from: vi.fn(),
    insert: vi.fn(),
    select: vi.fn(),
    update: vi.fn(),
    eq: vi.fn(),
    maybeSingle: vi.fn().mockResolvedValue({ data: priorEvent, error: null }),
    limit: vi.fn().mockResolvedValue({ data: [], error: null }),
  };

  // Make every chain step return the chain itself so arbitrary
  // .select().eq().eq().maybeSingle() compositions work.
  // The terminator is `await chain` itself — we attach a `.then` so
  // awaiting the chain resolves to selectResult (the count/data envelope).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (chain as any).then = (onF: (v: unknown) => unknown) => Promise.resolve(selectResult).then(onF);
  chain.select.mockReturnValue(chain);
  chain.insert.mockReturnValue({ select: chain.select });
  chain.update.mockReturnValue({ eq: chain.eq });
  chain.eq.mockReturnValue(chain);
  chain.from.mockReturnValue(chain);

  return chain;
}

function makeRequest(body: string, sig = 'stripe-sig-test'): NextRequest {
  return new NextRequest('http://localhost/api/stripe/webhook', {
    method: 'POST',
    headers: {
      'stripe-signature': sig,
      'content-type': 'application/json',
    },
    body,
  });
}

function makeSucceededEvent(id: string, kind: string) {
  return {
    id,
    type: 'payment_intent.succeeded',
    data: {
      object: {
        id: `pi_${id}`,
        amount: 9000,
        status: 'succeeded',
        invoice: null,
        last_payment_error: null,
        metadata: {
          kind,
          restaurant_id: 'rest-abc-uuid',
          plan: kind === 'plan' ? 'quarterly' : undefined,
        },
      },
    },
  };
}

/**
 * A completed Checkout Session event. Since T-41a this — not
 * payment_intent.succeeded — is what provisions a plan, so it is the event the
 * "did the retry actually reprocess?" assertions have to use.
 */
function makeSessionEvent(id: string) {
  return {
    id,
    type: 'checkout.session.completed',
    data: {
      object: {
        id: `cs_${id}`,
        object: 'checkout.session',
        amount_total: 9000,
        currency: 'usd',
        status: 'complete',
        payment_status: 'paid',
        payment_intent: `pi_${id}`,
        metadata: {
          kind: 'plan',
          restaurant_id: 'rest-abc-uuid',
          plan: 'quarterly',
        },
      },
    },
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Stripe webhook idempotency', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.STRIPE_WEBHOOK_SECRET = 'test_secret';
  });

  it('processes a new event: count=1 → returns {received:true}', async () => {
    const chain = makeChain({ data: [{ id: 'evt_001' }], error: null, count: 1 });
    vi.mocked(createServiceSupabase).mockReturnValue(
      chain as unknown as ReturnType<typeof createServiceSupabase>
    );
    vi.mocked(stripe.webhooks.constructEvent).mockReturnValue(
      // Stripe.Event has many fields; double cast used for known-incomplete test fixtures.
      // Wave 2C — cert_fee path is covered end-to-end in
      // tests/integration/stripe-cert-events.test.ts; for the idempotency
      // unit test we exercise the plan path which has the simpler chain.
      // T-41a: that path is now checkout.session.completed.
      makeSessionEvent('evt_001') as unknown as ReturnType<typeof stripe.webhooks.constructEvent>
    );

    // Ensure subscriptions + activity queries resolve cleanly
    chain.maybeSingle.mockResolvedValue({ data: null, error: null });

    const { POST } = await import('@/app/api/stripe/webhook/route');
    const res = await POST(makeRequest('{}'));
    const body = (await res.json()) as { received: boolean; duplicate?: boolean };

    expect(res.status).toBe(200);
    expect(body.received).toBe(true);
    expect(body.duplicate).toBeUndefined();
  });

  it('skips duplicate: count=0 + prior row completed → {received:true, duplicate:true}', async () => {
    const chain = makeChain({ data: [], error: null, count: 0 }, { status: 'completed' });
    vi.mocked(createServiceSupabase).mockReturnValue(
      chain as unknown as ReturnType<typeof createServiceSupabase>
    );
    vi.mocked(stripe.webhooks.constructEvent).mockReturnValue(
      makeSucceededEvent('evt_dup', 'cert_fee') as unknown as ReturnType<
        typeof stripe.webhooks.constructEvent
      >
    );

    const { POST } = await import('@/app/api/stripe/webhook/route');
    const res = await POST(makeRequest('{}'));
    const body = (await res.json()) as { received: boolean; duplicate?: boolean };

    expect(res.status).toBe(200);
    expect(body.received).toBe(true);
    expect(body.duplicate).toBe(true);

    // Verify no downstream processing: stripe_events is the ONLY table touched.
    // (Two calls now — the insert, then the status re-read that distinguishes a
    // completed event from an unfinished one.)
    const fromCalls = chain.from.mock.calls.map((c: unknown[]) => c[0] as string);
    expect(new Set(fromCalls)).toEqual(new Set(['stripe_events']));
  });

  it('handles unique-violation (23505) on a completed event as duplicate', async () => {
    const chain = makeChain(
      {
        data: null as unknown as unknown[],
        error: { code: '23505', message: 'duplicate key' },
        count: 0,
      },
      { status: 'completed' }
    );
    vi.mocked(createServiceSupabase).mockReturnValue(
      chain as unknown as ReturnType<typeof createServiceSupabase>
    );
    vi.mocked(stripe.webhooks.constructEvent).mockReturnValue(
      makeSucceededEvent('evt_conflict', 'plan') as unknown as ReturnType<
        typeof stripe.webhooks.constructEvent
      >
    );

    const { POST } = await import('@/app/api/stripe/webhook/route');
    const res = await POST(makeRequest('{}'));
    const body = (await res.json()) as { received: boolean; duplicate?: boolean };

    expect(res.status).toBe(200);
    expect(body.received).toBe(true);
    expect(body.duplicate).toBe(true);
  });

  it('does NOT skip when the prior row never completed — the event is retryable', async () => {
    // The poison pill: an existing row used to be proof of "already handled".
    // Since 0023 only status='completed' means that; 'failed' means the previous
    // delivery died and Stripe's retry must be allowed through.
    const chain = makeChain({ data: [], error: null, count: 0 }, { status: 'failed' });
    vi.mocked(createServiceSupabase).mockReturnValue(
      chain as unknown as ReturnType<typeof createServiceSupabase>
    );
    vi.mocked(stripe.webhooks.constructEvent).mockReturnValue(
      makeSessionEvent('evt_unfinished') as unknown as ReturnType<
        typeof stripe.webhooks.constructEvent
      >
    );

    const { POST } = await import('@/app/api/stripe/webhook/route');
    const res = await POST(makeRequest('{}'));
    const body = (await res.json()) as { received: boolean; duplicate?: boolean };

    expect(res.status).toBe(200);
    expect(body.duplicate).toBeUndefined();

    // It actually reprocessed: downstream tables were touched this time.
    const fromCalls = chain.from.mock.calls.map((c: unknown[]) => c[0] as string);
    expect(fromCalls).toContain('subscriptions');
  });

  it('rejects request with missing stripe-signature header: 400', async () => {
    const req = new NextRequest('http://localhost/api/stripe/webhook', {
      method: 'POST',
      body: '{}',
    });

    const { POST } = await import('@/app/api/stripe/webhook/route');
    const res = await POST(req);

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('stripe-signature');
  });

  it('rejects request with invalid signature: 400', async () => {
    vi.mocked(stripe.webhooks.constructEvent).mockImplementation(() => {
      throw new Error('No signatures found matching the expected signature');
    });

    const { POST } = await import('@/app/api/stripe/webhook/route');
    const req = makeRequest('{}', 'bad-sig');
    const res = await POST(req);

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('Webhook signature invalid');
  });
});
