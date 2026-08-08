/**
 * lib/billing/cert-checkout.ts
 *
 * T-45a — the ONE cert-fee Checkout Session. Two callers, one shape.
 *
 * WHY THIS IS AN EXTRACTION AND NOT A NEW PATH
 * ────────────────────────────────────────────
 * This body used to live inline in app/api/submissions/create/route.ts (T-41b).
 * T-45a needs the identical Session for a restaurant that is already listed and
 * has hired since, and a second `stripe.checkout.sessions.create` call written
 * next to the first is how two payment paths come to disagree about price,
 * about promotion codes, or about which metadata the webhook can route on.
 *
 * So the route handler lost its inline block and both callers now come here:
 *
 *   app/api/submissions/create/route.ts  kind='cert_fee'    (T-41b, unchanged)
 *   app/api/admin/top-up/route.ts        kind='cert_topup'  (T-45a, new)
 *
 * The Session is what T-41b shipped, apart from `kind` and the return URLs.
 * In particular:
 *
 *   - `allow_promotion_codes: true`. This is the comp mechanism. A 100%-off
 *     code takes amount_total to 0, at which point Stripe collects no payment
 *     method and creates NO PaymentIntent — which is exactly why the webhook
 *     routes off checkout.session.completed rather than payment_intent.
 *
 *   - `quantity`, not a pre-multiplied `unit_amount`, so Stripe's own page reads
 *     "3 × $35.00" and a percentage promotion code discounts the whole line
 *     rather than a single seat.
 *
 *   - Metadata on the SESSION and nowhere else. Deliberately NOT also on
 *     payment_intent_data: a PAID Checkout fires both
 *     checkout.session.completed and payment_intent.succeeded, and stamping
 *     `kind` on the PaymentIntent too would run the activation handler a second
 *     time under a pi_… id — harmless for the certificates (the UPDATE is
 *     narrowed to status='pending') but the Session's UNIQUE index cannot
 *     collapse a submission row written under a different id.
 *
 * PRICE COMES FROM PENDING CERTIFICATE ROWS, ALWAYS
 * ─────────────────────────────────────────────────
 * `pendingCertCount` is a count of certificate ROWS awaiting payment — the set
 * lib/billing/cert-balance.ts calls billable, which lib/admin/eligibility.ts
 * now derives with that same predicate. Rows, not people, because rows are
 * exactly what the webhook's activation UPDATE (`WHERE status='pending'`) will
 * touch; pricing anything else charges for certificates that never activate.
 * An already-`active` certificate is never in that set, so no caller can ever
 * re-charge for staff who were paid for the first time round.
 *
 * Tested by: tests/unit/cert-topup-checkout.test.ts,
 *            tests/unit/submissions-create-checkout.test.ts
 */
import 'server-only';
import { stripe } from '@/lib/stripe';
import { CERT_FEE_CENTS } from '@/lib/billing/pricing';
import {
  buildCertFeeMetadata,
  toStripeMetadata,
  type CertCheckoutKind,
} from '@/lib/stripe/metadata';

// ─── Input ────────────────────────────────────────────────────────────────────

export interface CertCheckoutRestaurant {
  id: string;
  name: string;
  /**
   * Present when signup ran (lib/auth/signup.ts step 4). Reusing it keeps the
   * restaurant's Stripe history on one customer, and is what a dashboard-
   * attached forever discount would hang off.
   */
  stripe_customer_id: string | null;
}

export interface CertCheckoutParams {
  restaurant: CertCheckoutRestaurant;
  /** Certificate ROWS awaiting payment. MUST be > 0 — see the throw below. */
  pendingCertCount: number;
  /** profiles.id of the manager. Fills submissions.submitted_by (NOT NULL). */
  submittedBy: string;
  kind: CertCheckoutKind;
  successUrl: string;
  cancelUrl: string;
}

export interface CertCheckoutSession {
  checkoutUrl: string;
  checkoutSessionId: string;
  /**
   * LIST total before any promotion code. What Stripe actually charged is
   * `amount_total` on the completed Session, and that is what gets recorded.
   */
  certFeeTotalCents: number;
}

/** Thrown when Stripe accepted the request but returned no redirect URL. */
export class CertCheckoutError extends Error {}

// ─── The one Session ──────────────────────────────────────────────────────────

/**
 * Create the cert-fee Checkout Session.
 *
 * Throws `CertCheckoutError` when Stripe returns a Session without a `url`, and
 * lets a Stripe SDK error propagate untouched — both callers map those onto
 * their own HTTP responses, and swallowing either here would hand a manager a
 * dead redirect.
 *
 * A `pendingCertCount` of 0 is a CALLER BUG, not a $0 Session: Stripe rejects a
 * zero-quantity line item, and a restaurant that owes nothing must not be sent
 * to a checkout page at all. Both callers check the balance first and take a
 * different branch. Failing loudly here is what keeps that from silently
 * becoming a Session nobody can complete.
 */
export async function createCertCheckoutSession(
  params: CertCheckoutParams
): Promise<CertCheckoutSession> {
  const { restaurant, pendingCertCount, submittedBy, kind, successUrl, cancelUrl } = params;

  if (!Number.isInteger(pendingCertCount) || pendingCertCount <= 0) {
    throw new CertCheckoutError(
      `createCertCheckoutSession requires a positive integer pendingCertCount, got ${pendingCertCount}`
    );
  }

  const certFeeTotalCents = CERT_FEE_CENTS * pendingCertCount;

  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    ...(restaurant.stripe_customer_id ? { customer: restaurant.stripe_customer_id } : {}),
    allow_promotion_codes: true,
    line_items: [
      {
        quantity: pendingCertCount,
        price_data: {
          currency: 'usd',
          unit_amount: CERT_FEE_CENTS,
          product_data: {
            name: 'AllergenWise certification fee',
            description: `Certification for ${restaurant.name} — one fee per newly certified employee`,
          },
        },
      },
    ],
    metadata: toStripeMetadata(
      buildCertFeeMetadata({
        kind,
        restaurantId: restaurant.id,
        certifiedCount: pendingCertCount,
        feePerCertCents: CERT_FEE_CENTS,
        submittedBy,
      })
    ),
    payment_intent_data: {
      description: `AllergenWise certification fees — ${restaurant.name} — ${pendingCertCount} employee${pendingCertCount !== 1 ? 's' : ''} × $${(CERT_FEE_CENTS / 100).toFixed(2)}`,
    },
    success_url: successUrl,
    cancel_url: cancelUrl,
  });

  if (!session.url) {
    throw new CertCheckoutError(`Checkout Session created with no url: ${session.id}`);
  }

  return {
    checkoutUrl: session.url,
    checkoutSessionId: session.id,
    certFeeTotalCents,
  };
}
