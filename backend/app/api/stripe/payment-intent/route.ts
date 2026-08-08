/**
 * app/api/stripe/payment-intent/route.ts
 * Creates a Stripe PaymentIntent.
 *
 * POST /api/stripe/payment-intent
 * Auth: session cookie — must be authenticated admin
 * Body: { kind, amountCents, metadata, customerId }
 *
 * For 'plan': on-session Stripe Elements flow, setup_future_usage='off_session'.
 *             Returns { clientSecret, paymentIntentId }.
 * For 'cert_fee'|'submission': off-session against saved default PM.
 *             Returns { paymentIntentId, status }.
 *
 * Security: customerId is validated against the authenticated admin's restaurant
 * to prevent one admin charging another restaurant's payment method.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { stripe } from '@/lib/stripe';
import { createServerSupabase } from '@/lib/supabase/server';
import { requireRole } from '@/lib/auth/require-role';
import {
  PAYMENT_KINDS,
  STRIPE_METADATA_KEYS,
  buildRoutedPaymentMetadata,
  toStripeMetadata,
  type PaymentKind,
} from '@/lib/stripe/metadata';
import type Stripe from 'stripe';

export const runtime = 'nodejs';

// ─── Zod schema ───────────────────────────────────────────────────────────────

const PaymentIntentBodySchema = z.object({
  // Kind enum is derived from lib/stripe/metadata.ts so the accepted values and
  // the webhook's routing switch can never drift apart.
  kind: z.enum(PAYMENT_KINDS),
  amountCents: z.number().int().positive('amountCents must be a positive integer'),
  metadata: z.record(z.string()).default({}),
  customerId: z.string().min(1, 'customerId is required'),
});

type PaymentIntentBody = z.infer<typeof PaymentIntentBodySchema>;

// ─── Handler ──────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest): Promise<NextResponse> {
  // 1+2. Auth + role check — only admin can create PaymentIntents
  const auth = await requireRole({
    roles: ['manager'],
    profileClient: 'session',
    columns: 'role, restaurant_id',
    unauthorizedMessage: 'Unauthorized',
    forbiddenMessage: 'Forbidden: admin role required',
    onMissingProfile: { status: 403, message: 'Profile not found' },
    requireRestaurant: { status: 403, message: 'Admin has no associated restaurant' },
  });
  if (auth instanceof NextResponse) return auth;
  const profile = auth.profile as { role: string; restaurant_id: string };

  const supabase = await createServerSupabase();

  // 3. Parse + validate body
  let body: PaymentIntentBody;
  try {
    const raw = await req.json();
    body = PaymentIntentBodySchema.parse(raw);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid request', issues: err.issues }, { status: 400 });
    }
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { kind, amountCents, metadata, customerId } = body;

  // 4. Verify customerId belongs to this admin's restaurant
  //    Prevents admin from POSTing another restaurant's customerId
  const { data: restRow } = await supabase
    .from('restaurants')
    .select('stripe_customer_id')
    .eq('id', profile.restaurant_id)
    .single();

  const restaurant = restRow as { stripe_customer_id: string | null } | null;

  if (!restaurant || restaurant.stripe_customer_id !== customerId) {
    return NextResponse.json(
      { error: 'Customer ID does not match restaurant on file' },
      { status: 403 }
    );
  }

  // 5. Build enriched metadata with guaranteed kind + restaurant_id.
  //    buildRoutedPaymentMetadata applies the routing keys last, so a caller
  //    cannot override them via the passthrough `metadata` field.
  const enrichedMetadata = toStripeMetadata(
    buildRoutedPaymentMetadata({
      kind,
      restaurantId: profile.restaurant_id,
      extra: metadata,
    })
  );

  try {
    if (kind === 'plan') {
      return await createPlanPaymentIntent(customerId, amountCents, enrichedMetadata);
    } else {
      return await createOffSessionPaymentIntent(customerId, amountCents, enrichedMetadata, kind);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[PaymentIntent] Stripe error:', message);
    return NextResponse.json({ error: 'Stripe error', detail: message }, { status: 500 });
  }
}

// ─── Plan PaymentIntent (on-session, Stripe Elements) ────────────────────────

async function createPlanPaymentIntent(
  customerId: string,
  amountCents: number,
  metadata: Stripe.MetadataParam
): Promise<NextResponse> {
  const pi = await stripe.paymentIntents.create({
    amount: amountCents,
    currency: 'usd',
    customer: customerId,
    setup_future_usage: 'off_session', // Save card for future off-session cert fee charges
    automatic_payment_methods: { enabled: true },
    metadata,
    description: `AllergenWise plan payment — ${metadata[STRIPE_METADATA_KEYS.PLAN] ?? 'plan'}`,
  });

  if (!pi.client_secret) {
    throw new Error('PaymentIntent created but client_secret is null');
  }

  return NextResponse.json({
    clientSecret: pi.client_secret,
    paymentIntentId: pi.id,
  });
}

// ─── Off-session PaymentIntent (cert fees + submission fees) ─────────────────

async function createOffSessionPaymentIntent(
  customerId: string,
  amountCents: number,
  metadata: Stripe.MetadataParam,
  kind: Exclude<PaymentKind, 'plan'>
): Promise<NextResponse> {
  // Retrieve the customer's default payment method
  const customer = await stripe.customers.retrieve(customerId);

  if (customer.deleted) {
    return NextResponse.json({ error: 'Stripe customer account was deleted' }, { status: 402 });
  }

  const defaultPm = customer.invoice_settings?.default_payment_method;

  if (!defaultPm) {
    return NextResponse.json(
      {
        error: 'No default payment method on file.',
        detail: 'Please update billing information in your account settings.',
      },
      { status: 402 }
    );
  }

  const pmId = typeof defaultPm === 'string' ? defaultPm : defaultPm.id;

  // Create + immediately confirm off-session
  const pi = await stripe.paymentIntents.create({
    amount: amountCents,
    currency: 'usd',
    customer: customerId,
    payment_method: pmId,
    off_session: true,
    confirm: true,
    automatic_payment_methods: {
      enabled: true,
      allow_redirects: 'never', // Off-session must not redirect
    },
    metadata,
    description:
      kind === 'cert_fee'
        ? 'AllergenWise certification fee'
        : 'AllergenWise submission certification fee',
  });

  // If Stripe requires further action (e.g. 3DS), return 402 — admin must update PM
  if (pi.status === 'requires_action' || pi.status === 'requires_payment_method') {
    return NextResponse.json(
      {
        error: 'Payment requires additional authentication.',
        detail: 'Please update your payment method or contact support.',
        status: pi.status,
      },
      { status: 402 }
    );
  }

  return NextResponse.json({
    paymentIntentId: pi.id,
    status: pi.status,
  });
}
