/**
 * tests/unit/signup.test.ts
 *
 * Tests for lib/auth/signup.ts — signup orchestration + rollback.
 * All external dependencies (Supabase, Stripe) are mocked.
 *
 * Test coverage:
 * - Happy path: returns checkoutUrl, checkoutSessionId, customerId, restaurantId
 * - Checkout Session shape: amount, allow_promotion_codes, setup_future_usage
 * - Trap 1 (T-41a): plan metadata is on the Session and NOT on payment_intent_data
 * - Rollback on auth.users failure: no cleanup needed (nothing created yet)
 * - Rollback on restaurants failure: auth.users deleted
 * - Rollback on profiles failure: auth.users + restaurant deleted
 * - Rollback on Stripe customer failure: auth.users + restaurant + profile deleted
 * - Rollback on Checkout Session failure: auth.users + restaurant + profile + customer deleted
 * - EMAIL_EXISTS: returns 409-grade error, no orphans
 * - Idempotency key used on Stripe calls
 * - T-03: the coming-soon gate has no vote on whether Stripe is called
 */
import { describe, it, expect, vi, beforeEach, type MockedFunction } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { performSignup, PLAN_AMOUNT_CENTS } from '@/lib/auth/signup';

// ─── Module mocks ─────────────────────────────────────────────────────────────

vi.mock('@/lib/supabase/server', () => ({
  createServiceSupabase: vi.fn(),
}));

vi.mock('@/lib/stripe', () => ({
  stripe: {
    customers: {
      create: vi.fn(),
      del: vi.fn(),
    },
    checkout: {
      sessions: {
        create: vi.fn(),
      },
    },
  },
}));

// We need to import after mocking
import { createServiceSupabase } from '@/lib/supabase/server';
import { stripe } from '@/lib/stripe';

const mockCreateServiceSupabase = createServiceSupabase as MockedFunction<
  typeof createServiceSupabase
>;
const mockStripe = stripe as unknown as {
  customers: {
    create: MockedFunction<typeof stripe.customers.create>;
    del: MockedFunction<typeof stripe.customers.del>;
  };
  checkout: { sessions: { create: MockedFunction<typeof stripe.checkout.sessions.create> } };
};

/** Resolve the Checkout Session create mock with a minimal, realistic Session. */
function mockSessionCreate(
  id = 'cs_test_123',
  url = 'https://checkout.stripe.com/c/pay/cs_test_123'
) {
  mockStripe.checkout.sessions.create.mockResolvedValue({ id, url } as Awaited<
    ReturnType<typeof stripe.checkout.sessions.create>
  >);
}

/** The params object performSignup handed stripe.checkout.sessions.create. */
function sessionParams(): Record<string, unknown> {
  return mockStripe.checkout.sessions.create.mock.calls[0][0] as unknown as Record<string, unknown>;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const validInput = {
  restaurant: {
    name: 'Test Bistro',
    address: '123 Main St',
    city: 'San Diego',
    state: 'CA',
    zip: '92101',
    phone: '619-555-0100',
    cuisine: 'american',
  },
  admin: {
    fullName: 'Jane Admin',
    email: 'jane@testbistro.com',
    password: 'SecurePass123!',
  },
  plan: 'quarterly' as const,
};

/** Build a chainable Supabase mock. */
function buildDbMock(
  overrides: {
    createUser?: Awaited<
      ReturnType<ReturnType<typeof createServiceSupabase>['auth']['admin']['createUser']>
    >;
    restaurantInsert?: { data: { id: string } | null; error: { message: string } | null };
    profileInsert?: { data: null; error: { message: string } | null };
    restaurantUpdate?: { data: null; error: null };
    restaurantSelect?: { data: { id: string } | null; error: null };
    deleteUser?: Awaited<
      ReturnType<ReturnType<typeof createServiceSupabase>['auth']['admin']['deleteUser']>
    >;
  } = {}
) {
  const deleteRestaurant = vi.fn().mockResolvedValue({ data: null, error: null });
  const deleteProfile = vi.fn().mockResolvedValue({ data: null, error: null });

  // Default happy-path values
  const createUserResult = overrides.createUser ?? {
    data: { user: { id: 'user-123' } },
    error: null,
  };

  const restaurantInsertResult = overrides.restaurantInsert ?? {
    data: { id: 'rest-456' },
    error: null,
  };

  const profileInsertResult = overrides.profileInsert ?? {
    data: null,
    error: null,
  };

  const restaurantUpdateResult = overrides.restaurantUpdate ?? {
    data: null,
    error: null,
  };

  // Slug uniqueness check — return null (no collision)
  const restaurantSlugSelect = {
    data: null,
    error: null,
  };

  const deleteUserResult = overrides.deleteUser ?? {
    data: { user: {} },
    error: null,
  };

  const dbMock = {
    auth: {
      admin: {
        createUser: vi.fn().mockResolvedValue(createUserResult),
        deleteUser: vi.fn().mockResolvedValue(deleteUserResult),
      },
    },
    from: vi.fn().mockImplementation((table: string) => {
      if (table === 'restaurants') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue(restaurantSlugSelect),
            }),
          }),
          insert: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue(restaurantInsertResult),
            }),
          }),
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue(restaurantUpdateResult),
          }),
          delete: vi.fn().mockReturnValue({
            eq: deleteRestaurant,
          }),
        };
      }
      if (table === 'profiles') {
        return {
          insert: vi.fn().mockResolvedValue(profileInsertResult),
          delete: vi.fn().mockReturnValue({
            eq: deleteProfile,
          }),
        };
      }
      return {};
    }),
    _deleteRestaurant: deleteRestaurant,
    _deleteProfile: deleteProfile,
  };

  return dbMock;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('performSignup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Happy path ───────────────────────────────────────────────────────────────

  it('happy path: returns checkoutUrl, checkoutSessionId, customerId, restaurantId', async () => {
    const db = buildDbMock();
    mockCreateServiceSupabase.mockReturnValue(
      db as unknown as ReturnType<typeof createServiceSupabase>
    );

    mockStripe.customers.create.mockResolvedValue({ id: 'cus_abc123' } as Awaited<
      ReturnType<typeof stripe.customers.create>
    >);
    mockSessionCreate('cs_test_xyz789', 'https://checkout.stripe.com/c/pay/cs_test_xyz789');

    const result = await performSignup(validInput);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('Expected ok');

    expect(result.checkoutUrl).toBe('https://checkout.stripe.com/c/pay/cs_test_xyz789');
    expect(result.checkoutSessionId).toBe('cs_test_xyz789');
    expect(result.customerId).toBe('cus_abc123');
    expect(result.restaurantId).toBe('rest-456');
  });

  // ── The gate has no vote here (T-03) ─────────────────────────────────────────
  // What survives tests/unit/signup-free-mode.test.ts. That file existed to
  // prove MVP_FREE_MODE=true skipped Stripe; the bypass is deleted, so the
  // property worth keeping is the inverse — no value of the coming-soon flag
  // can stop a signup from creating a Customer and a Checkout Session. A
  // comped restaurant reaches $0 through a 100%-off promotion code on
  // Stripe's own page, which is why the bypass had nothing left to do.

  it.each([
    ['unset (gate on — the default)', undefined],
    ['false (gate off)', 'false'],
    ['true (gate explicitly on)', 'true'],
  ] as const)(
    'COMING_SOON %s: Stripe Customer + Checkout Session are still created',
    async (_label, value) => {
      const original = process.env.COMING_SOON;
      if (value === undefined) delete process.env.COMING_SOON;
      else process.env.COMING_SOON = value;

      try {
        const db = buildDbMock();
        mockCreateServiceSupabase.mockReturnValue(
          db as unknown as ReturnType<typeof createServiceSupabase>
        );
        mockStripe.customers.create.mockResolvedValue({ id: 'cus_gate' } as Awaited<
          ReturnType<typeof stripe.customers.create>
        >);
        mockSessionCreate('cs_gate', 'https://checkout.stripe.com/c/pay/cs_gate');

        const result = await performSignup(validInput);

        expect(result.ok).toBe(true);
        if (!result.ok) throw new Error('Expected ok');
        expect(result.checkoutUrl).toBe('https://checkout.stripe.com/c/pay/cs_gate');
        expect(mockStripe.customers.create).toHaveBeenCalled();
        expect(mockStripe.checkout.sessions.create).toHaveBeenCalled();
      } finally {
        if (original === undefined) delete process.env.COMING_SOON;
        else process.env.COMING_SOON = original;
      }
    }
  );

  it('lib/auth/signup.ts does not reference the coming-soon flag', () => {
    // Structural half: the cases above would still pass if a flag check were
    // reintroduced in a branch these fixtures never take.
    const src = readFileSync(resolve(__dirname, '..', '..', 'lib/auth/signup.ts'), 'utf8');
    expect(src).not.toMatch(/isComingSoonEnabled|COMING_SOON|@\/lib\/coming-soon/);
  });

  it('returns STRIPE_ERROR when the Session has no url to redirect to', async () => {
    const db = buildDbMock();
    mockCreateServiceSupabase.mockReturnValue(
      db as unknown as ReturnType<typeof createServiceSupabase>
    );
    mockStripe.customers.create.mockResolvedValue({ id: 'cus_abc' } as Awaited<
      ReturnType<typeof stripe.customers.create>
    >);
    mockStripe.checkout.sessions.create.mockResolvedValue({
      id: 'cs_no_url',
      url: null,
    } as unknown as Awaited<ReturnType<typeof stripe.checkout.sessions.create>>);

    const result = await performSignup(validInput);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('Expected error');
    expect(result.code).toBe('STRIPE_ERROR');
  });

  it('uses correct amount for quarterly plan', async () => {
    const db = buildDbMock();
    mockCreateServiceSupabase.mockReturnValue(
      db as unknown as ReturnType<typeof createServiceSupabase>
    );
    mockStripe.customers.create.mockResolvedValue({ id: 'cus_abc' } as Awaited<
      ReturnType<typeof stripe.customers.create>
    >);
    mockSessionCreate('cs_q');

    await performSignup({ ...validInput, plan: 'quarterly' });

    const lineItems = sessionParams().line_items as Array<{
      quantity: number;
      price_data: { unit_amount: number; currency: string };
    }>;
    expect(lineItems).toHaveLength(1);
    expect(lineItems[0].quantity).toBe(1);
    expect(lineItems[0].price_data.unit_amount).toBe(9000);
    expect(lineItems[0].price_data.currency).toBe('usd');
  });

  it('uses correct amount for semiannual plan', async () => {
    const db = buildDbMock();
    mockCreateServiceSupabase.mockReturnValue(
      db as unknown as ReturnType<typeof createServiceSupabase>
    );
    mockStripe.customers.create.mockResolvedValue({ id: 'cus_abc' } as Awaited<
      ReturnType<typeof stripe.customers.create>
    >);
    mockSessionCreate('cs_s');

    await performSignup({ ...validInput, plan: 'semiannual' });

    const lineItems = sessionParams().line_items as Array<{
      price_data: { unit_amount: number };
    }>;
    expect(lineItems[0].price_data.unit_amount).toBe(12000);
  });

  it('sets setup_future_usage=off_session via payment_intent_data', async () => {
    // Without this the paying restaurant has no saved card. T-48 deleted the
    // off-session charge this was originally for; the card still matters
    // because submissions/create hands the same Customer to Stripe Checkout,
    // so the cert-fee payment offers a card already on file.
    const db = buildDbMock();
    mockCreateServiceSupabase.mockReturnValue(
      db as unknown as ReturnType<typeof createServiceSupabase>
    );
    mockStripe.customers.create.mockResolvedValue({ id: 'cus_abc' } as Awaited<
      ReturnType<typeof stripe.customers.create>
    >);
    mockSessionCreate();

    await performSignup(validInput);

    const params = sessionParams();
    expect(params.payment_intent_data).toMatchObject({ setup_future_usage: 'off_session' });
    expect(params.mode).toBe('payment');
    expect(params.customer).toBe('cus_abc');
  });

  it('builds success_url / cancel_url from the resolved base URL', async () => {
    // T-41a review: success_url is where a PAYING restaurant's browser goes the
    // instant the charge succeeds. The trailing slash matters — a double slash
    // in the path is a 404 for the customer who just paid.
    const previous = process.env.APP_URL;
    process.env.APP_URL = 'https://allergenwise.com/';
    try {
      const db = buildDbMock();
      mockCreateServiceSupabase.mockReturnValue(
        db as unknown as ReturnType<typeof createServiceSupabase>
      );
      mockStripe.customers.create.mockResolvedValue({ id: 'cus_abc' } as Awaited<
        ReturnType<typeof stripe.customers.create>
      >);
      mockSessionCreate();

      await performSignup(validInput);

      const params = sessionParams();
      expect(params.success_url).toBe(
        'https://allergenwise.com/signup/complete?session_id={CHECKOUT_SESSION_ID}'
      );
      expect(params.cancel_url).toBe('https://allergenwise.com/signup?canceled=1');
      expect(params.success_url).not.toContain('.com//');
      expect(params.success_url).not.toContain('localhost');
    } finally {
      if (previous === undefined) delete process.env.APP_URL;
      else process.env.APP_URL = previous;
    }
  });

  it('rolls the whole signup back when no base URL is configured in production', async () => {
    // The loud failure the resolver exists for: better a signup that errors
    // than a paying restaurant redirected to their own machine. Nothing may be
    // left behind — including a Stripe Customer, which is why the resolve
    // happens before Step 4.
    const previousNodeEnv = process.env.NODE_ENV;
    const previousAppUrl = process.env.APP_URL;
    const previousPublicUrl = process.env.NEXT_PUBLIC_APP_URL;
    const previousVercelUrl = process.env.VERCEL_URL;
    // NODE_ENV is readonly in @types/node; the cast is the standard test escape.
    (process.env as Record<string, string | undefined>).NODE_ENV = 'production';
    delete process.env.APP_URL;
    delete process.env.NEXT_PUBLIC_APP_URL;
    delete process.env.VERCEL_URL;
    try {
      const db = buildDbMock();
      mockCreateServiceSupabase.mockReturnValue(
        db as unknown as ReturnType<typeof createServiceSupabase>
      );

      const result = await performSignup(validInput);

      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('Expected failure');
      expect(result.error).toMatch(/No application base URL is configured/);

      // No Stripe objects created, and the account rolled back.
      expect(mockStripe.customers.create).not.toHaveBeenCalled();
      expect(mockStripe.checkout.sessions.create).not.toHaveBeenCalled();
      expect(db.auth.admin.deleteUser).toHaveBeenCalledWith('user-123');
      expect(db._deleteRestaurant).toHaveBeenCalledWith('id', 'rest-456');
      expect(db._deleteProfile).toHaveBeenCalledWith('id', 'user-123');
    } finally {
      (process.env as Record<string, string | undefined>).NODE_ENV = previousNodeEnv;
      if (previousAppUrl !== undefined) process.env.APP_URL = previousAppUrl;
      if (previousPublicUrl !== undefined) process.env.NEXT_PUBLIC_APP_URL = previousPublicUrl;
      if (previousVercelUrl !== undefined) process.env.VERCEL_URL = previousVercelUrl;
    }
  });

  it('enables promotion codes so a 100%-off comp can be applied on Stripe’s page', async () => {
    const db = buildDbMock();
    mockCreateServiceSupabase.mockReturnValue(
      db as unknown as ReturnType<typeof createServiceSupabase>
    );
    mockStripe.customers.create.mockResolvedValue({ id: 'cus_abc' } as Awaited<
      ReturnType<typeof stripe.customers.create>
    >);
    mockSessionCreate();

    await performSignup(validInput);

    expect(sessionParams().allow_promotion_codes).toBe(true);
  });

  it('TRAP 1: plan metadata is on the Session and NOT on payment_intent_data', async () => {
    // A PAID Checkout fires BOTH checkout.session.completed and
    // payment_intent.succeeded. Session metadata does not propagate to the
    // PaymentIntent — but payment_intent_data would. Putting the plan metadata
    // there makes the PI router's `kind==='plan'` fire too, and the two paths
    // write different stripe_invoice_ids (cs_… vs pi_…) so the UNIQUE index
    // cannot dedupe them: one payment, two subscriptions.
    const db = buildDbMock();
    mockCreateServiceSupabase.mockReturnValue(
      db as unknown as ReturnType<typeof createServiceSupabase>
    );
    mockStripe.customers.create.mockResolvedValue({ id: 'cus_abc' } as Awaited<
      ReturnType<typeof stripe.customers.create>
    >);
    mockSessionCreate();

    await performSignup(validInput);

    const params = sessionParams();

    expect(params.metadata).toMatchObject({
      kind: 'plan',
      plan: 'quarterly',
      restaurant_id: 'rest-456',
      admin_id: 'user-123',
    });

    const pid = params.payment_intent_data as Record<string, unknown>;
    expect(pid).toBeDefined();
    expect(pid.metadata).toBeUndefined();
    // Nothing nested under payment_intent_data may carry the routing key.
    expect(JSON.stringify(pid)).not.toContain('"kind"');
  });

  it('includes idempotency keys on Stripe calls', async () => {
    const db = buildDbMock();
    mockCreateServiceSupabase.mockReturnValue(
      db as unknown as ReturnType<typeof createServiceSupabase>
    );
    mockStripe.customers.create.mockResolvedValue({ id: 'cus_abc' } as Awaited<
      ReturnType<typeof stripe.customers.create>
    >);
    mockSessionCreate();

    await performSignup(validInput);

    expect(mockStripe.customers.create).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        idempotencyKey: expect.stringContaining('signup-customer-user-123'),
      })
    );
    expect(mockStripe.checkout.sessions.create).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        idempotencyKey: expect.stringContaining('signup-checkout-user-123'),
      })
    );
  });

  // ── EMAIL_EXISTS ──────────────────────────────────────────────────────────────

  it('returns EMAIL_EXISTS code when email already registered', async () => {
    const db = buildDbMock({
      createUser: {
        data: { user: null },
        error: { message: 'User already registered' } as Error,
      } as Awaited<
        ReturnType<ReturnType<typeof createServiceSupabase>['auth']['admin']['createUser']>
      >,
    });
    mockCreateServiceSupabase.mockReturnValue(
      db as unknown as ReturnType<typeof createServiceSupabase>
    );

    const result = await performSignup(validInput);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('Expected error');
    expect(result.code).toBe('EMAIL_EXISTS');
  });

  // ── Rollback: auth.users failure ──────────────────────────────────────────────

  it('rollback on auth failure: no Stripe calls made', async () => {
    const db = buildDbMock({
      createUser: {
        data: { user: null },
        error: { message: 'Auth service unavailable' } as Error,
      } as Awaited<
        ReturnType<ReturnType<typeof createServiceSupabase>['auth']['admin']['createUser']>
      >,
    });
    mockCreateServiceSupabase.mockReturnValue(
      db as unknown as ReturnType<typeof createServiceSupabase>
    );

    await performSignup(validInput);

    expect(mockStripe.customers.create).not.toHaveBeenCalled();
    expect(mockStripe.checkout.sessions.create).not.toHaveBeenCalled();
  });

  // ── Rollback: restaurant insert failure ────────────────────────────────────────

  it('rollback on restaurant insert failure: auth.users deleted', async () => {
    const db = buildDbMock({
      restaurantInsert: { data: null, error: { message: 'restaurants insert error' } },
    });
    mockCreateServiceSupabase.mockReturnValue(
      db as unknown as ReturnType<typeof createServiceSupabase>
    );

    const result = await performSignup(validInput);

    expect(result.ok).toBe(false);
    expect(db.auth.admin.deleteUser).toHaveBeenCalledWith('user-123');
    expect(mockStripe.customers.create).not.toHaveBeenCalled();
  });

  // ── Rollback: profile insert failure ──────────────────────────────────────────

  it('rollback on profile insert failure: auth.users + restaurant deleted', async () => {
    const db = buildDbMock({
      profileInsert: { data: null, error: { message: 'profile insert error' } },
    });
    mockCreateServiceSupabase.mockReturnValue(
      db as unknown as ReturnType<typeof createServiceSupabase>
    );

    const result = await performSignup(validInput);

    expect(result.ok).toBe(false);
    expect(db.auth.admin.deleteUser).toHaveBeenCalledWith('user-123');
    // _deleteRestaurant is the .eq() fn: called with ('id', restaurantId)
    expect(db._deleteRestaurant).toHaveBeenCalledWith('id', 'rest-456');
    expect(mockStripe.customers.create).not.toHaveBeenCalled();
  });

  // ── Rollback: Stripe customer failure ────────────────────────────────────────

  it('rollback on Stripe customer failure: auth.users + restaurant + profile deleted', async () => {
    const db = buildDbMock();
    mockCreateServiceSupabase.mockReturnValue(
      db as unknown as ReturnType<typeof createServiceSupabase>
    );
    mockStripe.customers.create.mockRejectedValue(new Error('Stripe network error'));

    const result = await performSignup(validInput);

    expect(result.ok).toBe(false);
    expect(db.auth.admin.deleteUser).toHaveBeenCalledWith('user-123');
    expect(db._deleteRestaurant).toHaveBeenCalledWith('id', 'rest-456');
    expect(db._deleteProfile).toHaveBeenCalledWith('id', 'user-123');
    expect(mockStripe.checkout.sessions.create).not.toHaveBeenCalled();
  });

  // ── Rollback: Checkout Session failure ───────────────────────────────────────

  it('rollback on Checkout Session failure: customer deleted + all rows deleted', async () => {
    const db = buildDbMock();
    mockCreateServiceSupabase.mockReturnValue(
      db as unknown as ReturnType<typeof createServiceSupabase>
    );
    mockStripe.customers.create.mockResolvedValue({ id: 'cus_leaked' } as Awaited<
      ReturnType<typeof stripe.customers.create>
    >);
    mockStripe.checkout.sessions.create.mockRejectedValue(
      new Error('Checkout Session creation failed')
    );
    mockStripe.customers.del.mockResolvedValue({ deleted: true } as Awaited<
      ReturnType<typeof stripe.customers.del>
    >);

    const result = await performSignup(validInput);

    expect(result.ok).toBe(false);
    expect(mockStripe.customers.del).toHaveBeenCalledWith('cus_leaked');
    expect(db.auth.admin.deleteUser).toHaveBeenCalledWith('user-123');
    expect(db._deleteRestaurant).toHaveBeenCalledWith('id', 'rest-456');
    expect(db._deleteProfile).toHaveBeenCalledWith('id', 'user-123');
  });

  // ── PLAN_AMOUNT_CENTS sanity ──────────────────────────────────────────────────

  it('PLAN_AMOUNT_CENTS values are correct', () => {
    expect(PLAN_AMOUNT_CENTS.quarterly).toBe(9000);
    expect(PLAN_AMOUNT_CENTS.semiannual).toBe(12000);
  });
});
