/**
 * lib/billing/pricing.ts
 *
 * Single source of truth for the cert-fee price.
 *
 * Why this lives here, not co-located with the charge route:
 *   - exam/submit no longer hardcodes the fee at issuance time (Wave 2C
 *     creates the cert in `pending` with `fee_charged_cents=NULL` — the
 *     webhook stamps the actual amount at activation).
 *   - app/api/submissions/create imports this constant as the Checkout line
 *     item's `unit_amount`, multiplied by a QUANTITY of pending certificates
 *     (T-41b). It was previously also imported by the off-session charge route,
 *     which T-48 deleted; submissions/create is now the only importer.
 *   - The webhook handler uses the constant only for sanity-checking; the
 *     authoritative amount is what Stripe reports as `amount_total` on the
 *     Checkout Session, which is what a promotion code actually discounted.
 *
 * Future: read from a Stripe price object indexed by env. The submission row
 * records what was charged (cert_fee_total_cents) even if this constant
 * later changes; existing certs lock in their issued price via
 * fee_charged_cents at activation.
 */

export const CERT_FEE_CENTS = 3500; // $35.00 per certified employee
