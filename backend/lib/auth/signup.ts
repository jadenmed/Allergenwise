/**
 * lib/auth/signup.ts
 * Pure orchestration helper for restaurant signup.
 * Implements a manual compensating-transaction rollback: each successful step
 * is recorded; on any failure, recorded steps are undone in reverse order.
 *
 * Called by: app/api/auth/signup/route.ts
 * Tested by:  tests/unit/signup.test.ts
 */
import 'server-only';
import { createServiceSupabase } from '@/lib/supabase/server';
import { stripe } from '@/lib/stripe';
import { resolveAppUrl } from '@/lib/app-url';
import { buildCustomerMetadata, buildPlanMetadata, toStripeMetadata } from '@/lib/stripe/metadata';
import type { SubscriptionPlan } from '@/lib/types/db';

// ─── Amount map ───────────────────────────────────────────────────────────────

export const PLAN_AMOUNT_CENTS: Record<SubscriptionPlan, number> = {
  quarterly: 9000, // $90
  semiannual: 12000, // $120
};

/** Human label for the Checkout line item — what the restaurant sees on Stripe's page. */
const PLAN_LABEL: Record<SubscriptionPlan, string> = {
  quarterly: 'Quarterly',
  semiannual: 'Semiannual',
};

// ─── Input / output types ─────────────────────────────────────────────────────

export interface SignupInput {
  restaurant: {
    name: string;
    address: string;
    city: string;
    state: string;
    zip: string;
    phone: string;
    cuisine: string;
  };
  admin: {
    fullName: string;
    email: string;
    password: string;
  };
  plan: SubscriptionPlan;
}

export type SignupResult =
  | {
      // The only success path (T-41a): the caller redirects the browser to
      // `checkoutUrl`. There is no clientSecret any more — Stripe hosts the
      // payment page, and provisioning happens on checkout.session.completed,
      // not here. T-03 removed the free-mode variant that used to sit
      // alongside this one: a comped restaurant now goes through this same
      // Checkout Session and reaches $0 with a 100%-off promotion code, so
      // there is nothing left for a bypass to do.
      ok: true;
      checkoutUrl: string;
      checkoutSessionId: string;
      customerId: string;
      restaurantId: string;
    }
  | { ok: false; error: string; code?: string };

// ─── DB query types ───────────────────────────────────────────────────────────
// Supabase v2 with PostgREST v12 header doesn't infer column types for our
// hand-written Database type. We cast .from() to this escapehatch type so
// .insert()/.update()/.delete() accept our object shapes without `never` errors.

type AnyPostgrestQuery = {
  insert(values: Record<string, unknown>): {
    select(cols: string): {
      single(): Promise<{ data: { id: string } | null; error: { message: string } | null }>;
    };
  };
  select(cols: string): {
    eq(
      col: string,
      val: string
    ): {
      maybeSingle(): Promise<{ data: { id: string } | null; error: unknown }>;
    };
  };
  update(values: Record<string, unknown>): {
    eq(col: string, val: string): Promise<{ data: null; error: { message: string } | null }>;
  };
  delete(): {
    eq(col: string, val: string): Promise<{ data: null; error: unknown }>;
  };
};

type ProfileQuery = {
  insert(
    values: Record<string, unknown>
  ): Promise<{ data: null; error: { message: string } | null }>;
  delete(): {
    eq(col: string, val: string): Promise<{ data: null; error: unknown }>;
  };
};

// ─── Slug helper ──────────────────────────────────────────────────────────────

function generateBaseSlug(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 60);
}

async function uniqueSlug(
  name: string,
  db: ReturnType<typeof createServiceSupabase>
): Promise<string> {
  const base = generateBaseSlug(name);
  let candidate = base;
  let suffix = 2;
  const restTable = db.from('restaurants') as unknown as AnyPostgrestQuery;

  while (true) {
    const { data } = await restTable.select('id').eq('slug', candidate).maybeSingle();
    if (!data) return candidate;
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
}

// ─── Rollback registry ────────────────────────────────────────────────────────

type Rollback = () => Promise<void>;

// ─── Main orchestration ───────────────────────────────────────────────────────

export async function performSignup(input: SignupInput): Promise<SignupResult> {
  const db = createServiceSupabase();
  const rollbacks: Rollback[] = [];

  let authUserId: string | undefined;
  let restaurantId: string | undefined;
  let stripeCustomerId: string | undefined;

  try {
    // ── Step 1: Create Supabase Auth user ─────────────────────────────────────
    const { data: authData, error: authError } = await db.auth.admin.createUser({
      email: input.admin.email,
      password: input.admin.password,
      email_confirm: true, // admin signs up with password — confirm immediately
      user_metadata: { full_name: input.admin.fullName },
    });

    if (authError || !authData.user) {
      const msg = authError?.message ?? '';
      if (
        msg.toLowerCase().includes('already registered') ||
        msg.toLowerCase().includes('already exists')
      ) {
        return {
          ok: false,
          error: 'An account with this email already exists.',
          code: 'EMAIL_EXISTS',
        };
      }
      return { ok: false, error: msg || 'Failed to create account.', code: 'AUTH_ERROR' };
    }

    authUserId = authData.user.id;
    rollbacks.push(async () => {
      await db.auth.admin.deleteUser(authUserId!);
    });

    // ── Step 2: Insert restaurant (status='unlisted') ─────────────────────────
    const slug = await uniqueSlug(input.restaurant.name, db);
    const restTable = db.from('restaurants') as unknown as AnyPostgrestQuery;

    const restaurantInsert = await restTable
      .insert({
        slug,
        name: input.restaurant.name,
        address: input.restaurant.address,
        city: input.restaurant.city,
        state: input.restaurant.state,
        zip: input.restaurant.zip,
        phone: input.restaurant.phone,
        cuisine: input.restaurant.cuisine,
        status: 'unlisted',
      })
      .select('id')
      .single();

    if (restaurantInsert.error || !restaurantInsert.data) {
      // Rollback auth.users before returning
      for (const rb of rollbacks.reverse()) {
        await rb().catch(() => {});
      }
      return {
        ok: false,
        error: restaurantInsert.error?.message ?? 'Failed to create restaurant.',
        code: 'RESTAURANT_ERROR',
      };
    }

    restaurantId = restaurantInsert.data.id;
    rollbacks.push(async () => {
      const t = db.from('restaurants') as unknown as AnyPostgrestQuery;
      await t.delete().eq('id', restaurantId!);
    });

    // ── Step 3: Insert admin profile ──────────────────────────────────────────
    const profTable = db.from('profiles') as unknown as ProfileQuery;

    const profileInsert = await profTable.insert({
      id: authUserId,
      full_name: input.admin.fullName,
      email: input.admin.email,
      role: 'manager',
      restaurant_id: restaurantId,
    });

    if (profileInsert.error) {
      // Rollback restaurant + auth.users before returning
      for (const rb of [...rollbacks].reverse()) {
        await rb().catch(() => {});
      }
      return {
        ok: false,
        error: profileInsert.error.message ?? 'Failed to create profile.',
        code: 'PROFILE_ERROR',
      };
    }

    rollbacks.push(async () => {
      const t = db.from('profiles') as unknown as ProfileQuery;
      await t.delete().eq('id', authUserId!);
    });

    // Resolve the return-URL base BEFORE creating anything at Stripe. In a
    // deployment with no base URL configured this throws, and throwing here
    // means the compensating rollback below unwinds the account without ever
    // having created a Customer — rather than sending a restaurant that has
    // already paid back to http://localhost:3000. See lib/app-url.ts.
    const appUrl = resolveAppUrl();

    // ── Step 4: Create Stripe Customer ────────────────────────────────────────
    // Idempotency key scoped to authUserId prevents duplicate customers on retry.
    const customer = await stripe.customers.create(
      {
        email: input.admin.email,
        name: input.restaurant.name,
        // Keys come from lib/stripe/metadata.ts — the webhook's
        // handleCustomerUpdated parses this same shape back out.
        metadata: toStripeMetadata(buildCustomerMetadata({ restaurantId, adminId: authUserId })),
      },
      { idempotencyKey: `signup-customer-${authUserId}` }
    );

    stripeCustomerId = customer.id;

    // Persist Stripe customer ID on restaurant row
    const restTableForUpdate = db.from('restaurants') as unknown as AnyPostgrestQuery;
    await restTableForUpdate
      .update({ stripe_customer_id: stripeCustomerId })
      .eq('id', restaurantId);

    rollbacks.push(async () => {
      await stripe.customers.del(stripeCustomerId!).catch(() => {
        // Best-effort rollback; Stripe Dashboard can handle orphans
      });
    });

    // ── Step 5: Create Checkout Session ───────────────────────────────────────
    // T-41a: a PaymentIntent cannot express a 100%-off pilot. Stripe does not
    // create a PaymentIntent for a $0 Checkout Session at all, so provisioning
    // moved to checkout.session.completed and this step creates the Session.
    const amountCents = PLAN_AMOUNT_CENTS[input.plan];

    const checkoutSession = await stripe.checkout.sessions.create(
      {
        mode: 'payment',
        customer: stripeCustomerId,
        // The comp mechanism: the restaurant enters a promotion code on
        // Stripe's page. A 100%-off code takes amount_total to 0, at which
        // point Stripe collects no payment method and creates no
        // PaymentIntent — which is exactly why provisioning cannot live on
        // payment_intent.succeeded any more.
        allow_promotion_codes: true,
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: 'usd',
              unit_amount: amountCents,
              product_data: {
                name: `AllergenWise ${PLAN_LABEL[input.plan]} plan`,
                description: `Allergen training and certification for ${input.restaurant.name}`,
              },
            },
          },
        ],
        // ── METADATA GOES ON THE SESSION AND NOWHERE ELSE ────────────────────
        // Keys come from lib/stripe/metadata.ts (T-01). The webhook's plan
        // handler parses this exact shape off checkout.session.completed.
        //
        // DO NOT also put this under `payment_intent_data.metadata` below. A
        // PAID Checkout fires BOTH checkout.session.completed AND
        // payment_intent.succeeded; stamping `kind: 'plan'` onto the
        // PaymentIntent too would make the PI router provision a second time,
        // and the two paths write different ids (cs_… vs pi_…) so the UNIQUE
        // index on subscriptions.stripe_invoice_id cannot dedupe them. One
        // paying restaurant, two subscriptions. Session metadata deliberately
        // does NOT propagate to the PaymentIntent — keep it that way.
        metadata: toStripeMetadata(
          buildPlanMetadata({
            restaurantId,
            adminId: authUserId,
            plan: input.plan,
          })
        ),
        payment_intent_data: {
          // Save the card against the Customer. The off-session cert-fee
          // charge this originally existed for was deleted in T-48, but the
          // reason survives in a different shape: submissions/create passes
          // this same `customer` to Stripe Checkout, so a manager paying
          // certification fees is offered the card they already gave us
          // instead of retyping it. At $0 Stripe collects no payment method
          // and creates no PaymentIntent, so this is simply absent —
          // expected, not a failure.
          setup_future_usage: 'off_session',
          description: `AllergenWise ${input.plan} plan — ${input.restaurant.name}`,
          receipt_email: input.admin.email,
        },
        // The browser comes back here immediately; the webhook arrives
        // separately. /signup/complete must not assume the subscription row
        // exists yet — it polls for it.
        success_url: `${appUrl}/signup/complete?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${appUrl}/signup?canceled=1`,
      },
      { idempotencyKey: `signup-checkout-${authUserId}-${input.plan}` }
    );

    if (!checkoutSession.url) {
      return { ok: false, error: 'Failed to initialize payment.', code: 'STRIPE_ERROR' };
    }

    // Note: subscriptions row is NOT created here. It is created by the Stripe
    // webhook handler on checkout.session.completed (T-41a moved it off
    // payment_intent.succeeded, which never fires for a comped $0 signup).

    return {
      ok: true,
      checkoutUrl: checkoutSession.url,
      checkoutSessionId: checkoutSession.id,
      customerId: stripeCustomerId,
      restaurantId: restaurantId,
    };
  } catch (err: unknown) {
    // Compensating rollback: undo successful steps in reverse order
    for (const rollback of rollbacks.reverse()) {
      try {
        await rollback();
      } catch (rbErr) {
        console.error('[signup rollback] step failed:', rbErr);
      }
    }

    const message = err instanceof Error ? err.message : 'Unexpected signup error.';
    return { ok: false, error: message, code: 'UNEXPECTED_ERROR' };
  }
}
