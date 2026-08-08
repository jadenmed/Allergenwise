/**
 * tests/integration/stripe-webhook.test.ts
 *
 * End-to-end test for Stripe webhook handler behavior.
 * Uses real Stripe signature generation + the actual route handler in-process.
 *
 * Per CLAUDE.md non-negotiable #4:
 *   "Every external integration verified end-to-end with a test"
 *
 * Per non-negotiable #2:
 *   "Stripe webhook handlers verify signature AND dedupe on event_id"
 *
 * What this test proves:
 * 1. Signature verification: a correctly-signed event is processed.
 * 2. Signature rejection: a tampered event returns 400.
 * 3. Idempotency: replaying the same event_id is a no-op (duplicate=true).
 * 4. checkout.session.completed for kind='plan' creates a subscription row.
 * 5. Metadata produced by lib/auth/signup.ts is understood by the webhook.
 *
 * T-41a: plan provisioning moved off payment_intent.succeeded and onto
 * checkout.session.completed, because a comped $0 Checkout Session produces no
 * PaymentIntent at all.
 *
 * METADATA RULE FOR THIS FILE
 * ───────────────────────────
 * Fixtures NEVER hand-write a metadata literal. Every fake Stripe object is
 * built with the same `lib/stripe/metadata.ts` builders production uses, so a
 * producer/consumer key disagreement fails the test instead of passing it.
 * This file previously hand-wrote `{ kind: 'plan', restaurant_id: … }` in four
 * places, which is precisely why a live camelCase/snake_case mismatch in
 * lib/auth/signup.ts survived a green suite.
 *
 * Note: Stripe `stripe.webhooks.generateTestHeaderString` is available in
 * stripe@^7+. It produces a real HMAC-SHA256 signature using the provided secret.
 * We use a test-only secret — no real Stripe keys required.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import Stripe from 'stripe';
import { buildCertFeeMetadata, buildPlanMetadata, toStripeMetadata } from '@/lib/stripe/metadata';

// ─── Mocks ────────────────────────────────────────────────────────────────────

// We mock the DB client so we can intercept and inspect DB calls.
vi.mock('@/lib/supabase/server', () => ({
  createServiceSupabase: vi.fn(),
}));

vi.mock('@/lib/stripe', () => ({
  stripe: new Stripe('sk_test_fake', { apiVersion: '2025-02-24.acacia' }),
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

vi.mock('@/lib/email/send', () => ({
  sendEmail: vi.fn().mockResolvedValue({ ok: true }),
}));

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * A known fake webhook secret used ONLY in tests.
 * Must match the secret we pass to generateTestHeaderString below.
 */
const TEST_WEBHOOK_SECRET = 'whsec_test_allergenwise_integration_test_secret_value';

const REST_ID = '11111111-1111-4111-8111-111111111111';
const ADMIN_ID = '22222222-2222-4222-8222-222222222222';

// ─── DB mock factory ──────────────────────────────────────────────────────────

/**
 * @param insertCount        rows the stripe_events INSERT reports (0 = conflict).
 * @param priorEventStatus   what the follow-up `select('status')…maybeSingle()`
 *   on stripe_events returns. Since migration 0023 a pre-existing row is only a
 *   duplicate when its status is 'completed'; 'pending'/'failed' means an
 *   earlier delivery never finished and this one must run. Pass 'completed' to
 *   model a genuinely-already-handled event.
 */
function makeMockDb(
  insertCount = 1,
  priorEventStatus: string | null = null
): {
  fromCalls: string[];
  insertedData: Record<string, unknown[]>;
  fromFn: ReturnType<typeof vi.fn>;
} {
  const fromCalls: string[] = [];
  const insertedData: Record<string, unknown[]> = {};

  const makeSelfChain = (tableName: string): unknown => {
    const insertFn = vi.fn((data: unknown) => {
      if (!insertedData[tableName]) insertedData[tableName] = [];
      insertedData[tableName].push(data);
      return {
        select: vi.fn().mockResolvedValue({
          data: [{ id: 'row-id', ...((typeof data === 'object' && data) ?? {}) }],
          error: null,
          count: insertCount,
        }),
      };
    });

    const updateFn = vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ data: null, error: null }),
    });

    // The stripe_events status re-read is the only maybeSingle the route makes
    // on that table; every other table keeps the old not-found behavior.
    const priorRow =
      tableName === 'stripe_events' && priorEventStatus ? { status: priorEventStatus } : null;

    // Use a function declaration (not const) so self-reference works
    const eqChain = {
      maybeSingle: vi.fn().mockResolvedValue({ data: priorRow, error: null }),
      limit: vi.fn().mockResolvedValue({ data: [], error: null }),
      single: vi.fn().mockResolvedValue({ data: null, error: null }),
    };
    const eqFn: ReturnType<typeof vi.fn> = vi
      .fn()
      .mockReturnValue({ ...eqChain, eq: (...args: unknown[]) => eqFn(...args) });

    return {
      insert: insertFn,
      update: updateFn,
      select: vi.fn().mockReturnValue({
        eq: eqFn,
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        limit: vi.fn().mockResolvedValue({ data: [], error: null }),
      }),
      eq: eqFn,
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      limit: vi.fn().mockResolvedValue({ data: [], error: null }),
    };
  };

  const fromFn = vi.fn((tableName: string) => {
    fromCalls.push(tableName);
    return makeSelfChain(tableName);
  });

  return { fromCalls, insertedData, fromFn };
}

// ─── Payload builder ──────────────────────────────────────────────────────────

function buildPayload(eventId: string, eventType: string, piData: Record<string, unknown>): string {
  return JSON.stringify({
    id: eventId,
    type: eventType,
    data: { object: piData },
  });
}

/**
 * A succeeded PaymentIntent fixture. `metadata` is required and must come from
 * a production builder — there is deliberately no default, so a future fixture
 * cannot quietly hand-write one.
 */
function succeededPi(
  id: string,
  metadata: Stripe.MetadataParam,
  amount = 9000
): Record<string, unknown> {
  return {
    id,
    amount,
    status: 'succeeded',
    invoice: null,
    last_payment_error: null,
    metadata,
  };
}

/**
 * A completed Checkout Session fixture. `metadata` is required and must come
 * from a production builder — same rule as succeededPi above.
 */
function completedSession(
  id: string,
  metadata: Stripe.MetadataParam,
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    id,
    object: 'checkout.session',
    amount_total: 9000,
    currency: 'usd',
    status: 'complete',
    payment_status: 'paid',
    payment_intent: `pi_for_${id}`,
    customer: 'cus_test',
    metadata,
    ...overrides,
  };
}

/** Plan metadata built exactly the way lib/auth/signup.ts builds it. */
function planMetadata(restaurantId = REST_ID): Stripe.MetadataParam {
  return toStripeMetadata(
    buildPlanMetadata({ restaurantId, adminId: ADMIN_ID, plan: 'quarterly' })
  );
}

/**
 * Cert-fee metadata in the PaymentIntent shape — no `submitted_by`, because the
 * off-session charge route that produced it never inserted a submission row.
 * T-48 deleted that route; this fixture stays because the PaymentIntent
 * router's `case 'cert_fee'` still accepts the shape for an in-flight charge,
 * and the test below uses it to exercise event deduplication.
 */
function certFeeMetadata(restaurantId = REST_ID): Stripe.MetadataParam {
  return toStripeMetadata(
    buildCertFeeMetadata({ restaurantId, certifiedCount: 2, feePerCertCents: 3500 })
  );
}

function signPayload(payload: string, secret: string): string {
  // Generate real Stripe-format signature header using the test secret.
  // stripe.webhooks.generateTestHeaderString takes an options object: { payload, secret }
  return Stripe.webhooks.generateTestHeaderString({ payload, secret });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Stripe webhook — signature verification + idempotency (integration)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    process.env.STRIPE_WEBHOOK_SECRET = TEST_WEBHOOK_SECRET;
  });

  it('processes a correctly-signed event (signature verifies)', async () => {
    const { createServiceSupabase } = await import('@/lib/supabase/server');
    const { fromCalls, fromFn } = makeMockDb(1);
    vi.mocked(createServiceSupabase).mockReturnValue({ from: fromFn } as unknown as ReturnType<
      typeof createServiceSupabase
    >);

    const payload = buildPayload(
      'evt_integration_001',
      'checkout.session.completed',
      completedSession('cs_test_plan', planMetadata())
    );

    const sigHeader = signPayload(payload, TEST_WEBHOOK_SECRET);

    const { POST } = await import('@/app/api/stripe/webhook/route');
    const res = await POST(
      new NextRequest('http://localhost/api/stripe/webhook', {
        method: 'POST',
        headers: {
          'stripe-signature': sigHeader,
          'content-type': 'application/json',
        },
        body: payload,
      })
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as { received: boolean };
    expect(body.received).toBe(true);

    // Stripe event was recorded in the idempotency table
    expect(fromCalls).toContain('stripe_events');
    // Subscription was created (kind='plan')
    expect(fromCalls).toContain('subscriptions');
  });

  it('rejects a tampered event body (signature mismatch → 400)', async () => {
    const { createServiceSupabase } = await import('@/lib/supabase/server');
    const { fromFn } = makeMockDb(1);
    vi.mocked(createServiceSupabase).mockReturnValue({ from: fromFn } as unknown as ReturnType<
      typeof createServiceSupabase
    >);

    const payload = buildPayload(
      'evt_tampered',
      'payment_intent.succeeded',
      succeededPi('pi_test', planMetadata())
    );

    // Sign with the correct secret but then tamper with the body
    const validSig = signPayload(payload, TEST_WEBHOOK_SECRET);
    const tamperedBody = payload + 'TAMPERED';

    const { POST } = await import('@/app/api/stripe/webhook/route');
    const res = await POST(
      new NextRequest('http://localhost/api/stripe/webhook', {
        method: 'POST',
        headers: {
          'stripe-signature': validSig,
          'content-type': 'application/json',
        },
        body: tamperedBody,
      })
    );

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('Webhook signature invalid');
  });

  it('idempotency: replaying the same event_id is a no-op (duplicate=true)', async () => {
    const { createServiceSupabase } = await import('@/lib/supabase/server');
    // count=0 simulates the stripe_events INSERT returning 0 rows (the event was
    // already recorded), and status='completed' says that earlier delivery ran
    // to the end — which is what makes this replay a true duplicate. A row with
    // any other status is a half-finished delivery and MUST be reprocessed; see
    // tests/integration/stripe-webhook-retry.test.ts.
    const { fromCalls, fromFn } = makeMockDb(0, 'completed');
    vi.mocked(createServiceSupabase).mockReturnValue({ from: fromFn } as unknown as ReturnType<
      typeof createServiceSupabase
    >);

    const payload = buildPayload(
      'evt_duplicate_001',
      'payment_intent.succeeded',
      succeededPi('pi_dup', certFeeMetadata())
    );
    const sigHeader = signPayload(payload, TEST_WEBHOOK_SECRET);

    const { POST } = await import('@/app/api/stripe/webhook/route');
    const res = await POST(
      new NextRequest('http://localhost/api/stripe/webhook', {
        method: 'POST',
        headers: { 'stripe-signature': sigHeader, 'content-type': 'application/json' },
        body: payload,
      })
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as { received: boolean; duplicate: boolean };
    expect(body.received).toBe(true);
    expect(body.duplicate).toBe(true);

    // CRITICAL: only stripe_events was touched — no downstream processing.
    // (Two calls: the conflicting insert, then the status re-read.)
    expect(new Set(fromCalls)).toEqual(new Set(['stripe_events']));
  });

  it('checkout.session.completed kind=plan → subscription row inserted', async () => {
    const { createServiceSupabase } = await import('@/lib/supabase/server');
    const { fromCalls, insertedData, fromFn } = makeMockDb(1);
    vi.mocked(createServiceSupabase).mockReturnValue({ from: fromFn } as unknown as ReturnType<
      typeof createServiceSupabase
    >);

    const payload = buildPayload(
      'evt_plan_002',
      'checkout.session.completed',
      completedSession('cs_plan_002', planMetadata())
    );
    const sigHeader = signPayload(payload, TEST_WEBHOOK_SECRET);

    const { POST } = await import('@/app/api/stripe/webhook/route');
    await POST(
      new NextRequest('http://localhost/api/stripe/webhook', {
        method: 'POST',
        headers: { 'stripe-signature': sigHeader, 'content-type': 'application/json' },
        body: payload,
      })
    );

    // Subscription must have been inserted, scoped to the restaurant the
    // builder stamped — proving the consumer read the producer's tenant key.
    expect(fromCalls).toContain('subscriptions');
    expect(insertedData.subscriptions?.[0]).toMatchObject({
      restaurant_id: REST_ID,
      plan: 'quarterly',
      amount_cents: 9000,
      stripe_invoice_id: 'cs_plan_002',
    });
  });
});

// ─── signup → webhook contract ────────────────────────────────────────────────
//
// The regression this guards: lib/auth/signup.ts is the ONLY producer of
// plan-payment metadata in the live signup flow, and the webhook is its only
// consumer. The tests above build fixtures with the shared builders, which
// catches drift in the module. This test closes the last gap — it does not
// call a builder at all. It runs the real performSignup, captures the metadata
// it actually stamps on the Checkout Session, and replays that exact object
// through the real webhook handler. If signup ever stops using the shared
// builders, this fails.

const SIGNUP_ADMIN_EMAIL = 'ada.admin@example.com';
const SIGNUP_RESTAURANT_NAME = 'Test Bistro';

interface CapturedInsert {
  table: string;
  row: Record<string, unknown>;
}

/**
 * One Supabase service-client fake that satisfies BOTH performSignup's writes
 * and the webhook handler's reads/writes, so a single test can span the two.
 * Select results are keyed by the requested columns because `restaurants` is
 * read twice with different column lists and different expected shapes.
 */
function makeSignupWebhookDb() {
  const inserts: CapturedInsert[] = [];
  const fromCalls: string[] = [];

  const selectResult = (table: string, cols: string): { data: unknown; error: null } => {
    if (table === 'restaurants' && cols.includes('name')) {
      return { data: { name: SIGNUP_RESTAURANT_NAME }, error: null };
    }
    if (table === 'profiles' && cols.includes('full_name')) {
      return {
        data: [{ id: ADMIN_ID, full_name: 'Ada Admin', email: SIGNUP_ADMIN_EMAIL }],
        error: null,
      };
    }
    // restaurants slug-uniqueness probe + subscriptions duplicate probe: not found
    return { data: null, error: null };
  };

  const from = vi.fn((table: string) => {
    fromCalls.push(table);

    const makeSelect = (cols: string) => {
      const result = selectResult(table, cols);
      const isList = Array.isArray(result.data);
      const chain = {
        eq: vi.fn(() => chain),
        maybeSingle: vi.fn().mockResolvedValue(isList ? { data: null, error: null } : result),
        single: vi
          .fn()
          .mockResolvedValue(
            table === 'restaurants' ? { data: { id: REST_ID }, error: null } : result
          ),
        limit: vi.fn().mockResolvedValue(isList ? result : { data: [], error: null }),
      };
      return chain;
    };

    return {
      insert: vi.fn((row: Record<string, unknown>) => {
        inserts.push({ table, row });
        return {
          select: vi.fn(() => ({
            // stripe_events dedupe insert awaits .select() directly (count envelope)
            then: (onF: (v: unknown) => unknown) =>
              Promise.resolve({ data: [{ id: 'row-id' }], error: null, count: 1 }).then(onF),
            // restaurants insert awaits .select('id').single()
            single: vi.fn().mockResolvedValue({ data: { id: REST_ID }, error: null }),
          })),
          // profiles / subscriptions / activity_events await the insert directly
          then: (onF: (v: unknown) => unknown) =>
            Promise.resolve({ data: null, error: null }).then(onF),
        };
      }),
      update: vi.fn(() => ({
        eq: vi.fn().mockResolvedValue({ data: null, error: null }),
      })),
      select: vi.fn((cols: string) => makeSelect(cols)),
      delete: vi.fn(() => ({ eq: vi.fn().mockResolvedValue({ data: null, error: null }) })),
    };
  });

  const auth = {
    admin: {
      createUser: vi.fn().mockResolvedValue({ data: { user: { id: ADMIN_ID } }, error: null }),
      deleteUser: vi.fn().mockResolvedValue({ data: null, error: null }),
    },
  };

  return { from, auth, inserts, fromCalls };
}

describe('signup → webhook: plan metadata contract (integration)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    process.env.STRIPE_WEBHOOK_SECRET = TEST_WEBHOOK_SECRET;
  });

  it('metadata written by performSignup is understood by the webhook: subscription row + WelcomeAdmin', async () => {
    const { createServiceSupabase } = await import('@/lib/supabase/server');
    const db = makeSignupWebhookDb();
    vi.mocked(createServiceSupabase).mockReturnValue(
      db as unknown as ReturnType<typeof createServiceSupabase>
    );

    // Spy on the SAME stripe instance the route + signup both import.
    // webhooks.constructEvent stays real, so signature verification is genuine.
    const { stripe } = await import('@/lib/stripe');
    const customerCreate = vi.spyOn(stripe.customers, 'create').mockResolvedValue({
      id: 'cus_signup_contract',
    } as unknown as Awaited<ReturnType<typeof stripe.customers.create>>);
    const sessionCreate = vi.spyOn(stripe.checkout.sessions, 'create').mockResolvedValue({
      id: 'cs_signup_contract',
      url: 'https://checkout.stripe.com/c/pay/cs_signup_contract',
    } as unknown as Awaited<ReturnType<typeof stripe.checkout.sessions.create>>);

    // ── Producer: run the real signup orchestration ──────────────────────────
    const { performSignup } = await import('@/lib/auth/signup');
    const signupResult = await performSignup({
      restaurant: {
        name: SIGNUP_RESTAURANT_NAME,
        address: '123 Main St',
        city: 'San Diego',
        state: 'CA',
        zip: '92101',
        phone: '619-555-0100',
        cuisine: 'italian',
      },
      admin: { fullName: 'Ada Admin', email: SIGNUP_ADMIN_EMAIL, password: 'sup3rSecret!pw' },
      plan: 'quarterly',
    });

    expect(signupResult.ok).toBe(true);
    expect(sessionCreate).toHaveBeenCalledTimes(1);

    // The Customer carries the same tenant link — this is what
    // handleCustomerUpdated reads, and it is the only link that survives on the
    // coming comped path where no PaymentIntent is ever created.
    const customerParams = customerCreate.mock.calls[0][0] as {
      metadata: Record<string, string>;
    };
    expect(customerParams.metadata).toMatchObject({
      restaurant_id: REST_ID,
      admin_id: ADMIN_ID,
    });

    // The exact metadata object signup handed Stripe — never hand-written here.
    const sessionParams = sessionCreate.mock.calls[0][0] as {
      metadata: Record<string, string>;
      payment_intent_data?: Record<string, unknown>;
    };
    const signupMetadata = sessionParams.metadata;

    // TRAP 1 at the producer: the routing metadata must NOT ride along on
    // payment_intent_data, or the PaymentIntent a PAID Checkout also produces
    // would provision a second subscription under a pi_… invoice id.
    expect(sessionParams.payment_intent_data?.metadata).toBeUndefined();

    // ── Consumer: replay it through the real webhook handler ─────────────────
    const payload = buildPayload(
      'evt_signup_contract_001',
      'checkout.session.completed',
      completedSession('cs_signup_contract', signupMetadata)
    );
    const sigHeader = signPayload(payload, TEST_WEBHOOK_SECRET);

    const { POST } = await import('@/app/api/stripe/webhook/route');
    const res = await POST(
      new NextRequest('http://localhost/api/stripe/webhook', {
        method: 'POST',
        headers: { 'stripe-signature': sigHeader, 'content-type': 'application/json' },
        body: payload,
      })
    );

    // Stripe must get a 200 — a 500 here means Stripe retries and provisioning stalls
    expect(res.status).toBe(200);

    // A subscriptions row must exist for the restaurant signup created
    const subInsert = db.inserts.find((i) => i.table === 'subscriptions');
    expect(subInsert, 'no subscriptions row was inserted').toBeDefined();
    expect(subInsert!.row).toMatchObject({
      restaurant_id: REST_ID,
      plan: 'quarterly',
      status: 'active',
      stripe_invoice_id: 'cs_signup_contract',
    });

    // WelcomeAdmin must be sent (fire-and-forget → wait for the microtask chain)
    const { sendEmail } = await import('@/lib/email/send');
    await vi.waitFor(() => expect(sendEmail).toHaveBeenCalled());
    expect(sendEmail).toHaveBeenCalledWith(
      'WelcomeAdmin',
      SIGNUP_ADMIN_EMAIL,
      expect.objectContaining({ restaurantName: SIGNUP_RESTAURANT_NAME, plan: 'quarterly' })
    );
  });
});
