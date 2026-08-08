/**
 * lib/stripe/metadata.ts
 *
 * Single source of truth for every key AllergenWise writes into Stripe object
 * metadata, and the only sanctioned way to read one back.
 *
 * Why this module exists
 * ──────────────────────
 * Stripe metadata is an untyped `Record<string, string>` on the wire. Producer
 * and consumer live in different files, so a key typo is invisible to the
 * compiler and only surfaces in production as a webhook 500. That is exactly
 * what happened: `lib/auth/signup.ts` wrote `restaurantId` while
 * `app/api/stripe/webhook/route.ts` read `restaurant_id`, so every
 * signup-originated `payment_intent.succeeded` threw
 * "Missing restaurant_id or plan" — no subscriptions row, no WelcomeAdmin.
 *
 * The contract
 * ────────────
 *   - Wire format is snake_case. This matches the majority of existing code
 *     and, critically, every Stripe object already created in production —
 *     migrating the wire format would strand those objects.
 *   - Producers NEVER write a metadata object literal. They call a `build*`
 *     helper, whose typed input makes a missing field a compile error and a
 *     misspelled field an excess-property error.
 *   - Consumers NEVER index `pi.metadata` by string. They call a `parse*`
 *     helper, which returns a narrowed type (or null / a typed failure).
 *
 * Comp / coupon forward-compat
 * ────────────────────────────
 * A 100%-off comp code that skips PaymentIntent creation entirely is coming.
 * `STRIPE_METADATA_KEYS.COMP_CODE` is already reserved and every builder takes
 * an optional `compCode`, so the comped path only has to thread an identifier
 * through — no new key, no consumer rewrite. `parseCompCode` reads it back on
 * whatever object carries it (Customer metadata survives even when no
 * PaymentIntent is ever created, which is the comped case).
 *
 * Consumed by: app/api/stripe/webhook/route.ts, lib/stripe/cert-event-handlers.ts
 * Produced by: lib/auth/signup.ts, app/api/submissions/create/route.ts,
 *              app/api/stripe/payment-intent/route.ts
 * Tested by:   tests/unit/stripe-metadata.test.ts,
 *              tests/integration/stripe-webhook.test.ts
 */

import type Stripe from 'stripe';
import type { SubscriptionPlan } from '@/lib/types/db';

// ─── Wire keys ────────────────────────────────────────────────────────────────

/**
 * The complete set of metadata keys AllergenWise reads or writes.
 * Values are the literal snake_case strings that go over the wire.
 */
export const STRIPE_METADATA_KEYS = {
  /** Routing discriminant — see PAYMENT_KINDS. */
  KIND: 'kind',
  /** restaurants.id — the tenant every downstream write is scoped to. */
  RESTAURANT_ID: 'restaurant_id',
  /** profiles.id of the signing-up manager. */
  ADMIN_ID: 'admin_id',
  /** subscriptions.plan — 'quarterly' | 'semiannual'. */
  PLAN: 'plan',
  /** submissions.id, for kind='submission' (and optionally on cert fees). */
  SUBMISSION_ID: 'submission_id',
  /** Number of certificates a cert-fee charge covers. */
  CERTIFIED_COUNT: 'certified_count',
  /** Per-certificate fee in cents at charge time. */
  FEE_PER_CERT_CENTS: 'fee_per_cert_cents',
  /**
   * profiles.id of the manager who started a cert-fee Checkout Session (T-41b).
   *
   * The submission row is inserted by the webhook, which has no session and
   * therefore no other way to fill `submissions.submitted_by` (NOT NULL, FK to
   * profiles). Carrying it on the Session is what lets the route handler stop
   * writing the row itself.
   */
  SUBMITTED_BY: 'submitted_by',
  /** Reserved: comp / coupon identifier for the 100%-off path. */
  COMP_CODE: 'comp_code',
} as const;

export type StripeMetadataKey = (typeof STRIPE_METADATA_KEYS)[keyof typeof STRIPE_METADATA_KEYS];

const K = STRIPE_METADATA_KEYS;

// ─── Payment kinds ────────────────────────────────────────────────────────────

/**
 * `cert_topup` (T-45a) is the SAME Session shape and the SAME price as
 * `cert_fee` — both are built by lib/billing/cert-checkout.ts — and it exists
 * only to tell the webhook what to do AFTER the money lands.
 *
 *   cert_fee   → activate the pending certs, then finalizeSubmission: insert a
 *                submission row and flip the restaurant to `pending_review`.
 *   cert_topup → activate the pending certs and STOP.
 *
 * The restaurant paying a top-up is already LISTED. Routing it through
 * `cert_fee` would drag a live listing back into review every time a new hire
 * passed the exam, so the discriminant rides on the Session rather than being
 * inferred downstream from restaurant status, which a race could read either
 * way.
 */
export const PAYMENT_KINDS = ['plan', 'cert_fee', 'cert_topup', 'submission'] as const;

/** The two kinds lib/billing/cert-checkout.ts can stamp on a Session. */
export const CERT_CHECKOUT_KINDS = ['cert_fee', 'cert_topup'] as const;

export type CertCheckoutKind = (typeof CERT_CHECKOUT_KINDS)[number];

export function isCertCheckoutKind(value: unknown): value is CertCheckoutKind {
  return typeof value === 'string' && (CERT_CHECKOUT_KINDS as readonly string[]).includes(value);
}

export type PaymentKind = (typeof PAYMENT_KINDS)[number];

export function isPaymentKind(value: unknown): value is PaymentKind {
  return typeof value === 'string' && (PAYMENT_KINDS as readonly string[]).includes(value);
}

const SUBSCRIPTION_PLANS: readonly SubscriptionPlan[] = ['quarterly', 'semiannual'];

export function isSubscriptionPlan(value: unknown): value is SubscriptionPlan {
  return typeof value === 'string' && (SUBSCRIPTION_PLANS as readonly string[]).includes(value);
}

// ─── Metadata shapes ──────────────────────────────────────────────────────────
//
// Declared as type aliases (not interfaces) so TypeScript grants them an
// implicit index signature. Optional keys are `string | undefined`;
// `toStripeMetadata` is the single boundary that drops undefined entries before
// the object is handed to the Stripe SDK.

/** PaymentIntent metadata for a plan purchase (signup / renewal). */
export type PlanPaymentMetadata = {
  [K.KIND]: 'plan';
  [K.PLAN]: SubscriptionPlan;
  [K.RESTAURANT_ID]: string;
  [K.ADMIN_ID]: string;
  [K.COMP_CODE]?: string;
};

/**
 * Metadata for a certificate-fee payment.
 *
 * The only producer is now the T-41b Checkout Session created at submission —
 * T-48 deleted the off-session PaymentIntent route that was the other one.
 *
 * `submitted_by` stays OPTIONAL even though the sole live producer always
 * writes it, because the webhook's PaymentIntent router still accepts the old
 * shape for a charge that was in flight when that route was deleted, and that
 * shape never carried it (it inserted no submission row). Tightening this to
 * required would make those events a compile-time lie rather than a runtime
 * one; the required-ness that matters is enforced where it is read, in
 * `parseCertFeeCheckoutMetadata`.
 */
export type CertFeePaymentMetadata = {
  /**
   * `cert_fee` at submission, `cert_topup` for staff certified after the
   * listing already exists (T-45a). Every other field is identical — the two
   * differ only in what the webhook does once the money has landed.
   */
  [K.KIND]: CertCheckoutKind;
  [K.RESTAURANT_ID]: string;
  [K.CERTIFIED_COUNT]: string;
  [K.FEE_PER_CERT_CENTS]: string;
  [K.SUBMITTED_BY]?: string;
  [K.SUBMISSION_ID]?: string;
  [K.COMP_CODE]?: string;
};

/** PaymentIntent metadata for a submission fee. */
export type SubmissionPaymentMetadata = {
  [K.KIND]: 'submission';
  [K.RESTAURANT_ID]: string;
  [K.SUBMISSION_ID]: string;
  [K.COMP_CODE]?: string;
};

/**
 * Customer metadata. Written once at signup; the only tenant link that
 * survives when no PaymentIntent is ever created (the coming comped path).
 */
export type CustomerMetadata = {
  [K.RESTAURANT_ID]: string;
  [K.ADMIN_ID]: string;
  [K.COMP_CODE]?: string;
};

/**
 * Metadata for the generic /api/stripe/payment-intent route, which merges
 * caller-supplied passthrough fields under guaranteed routing keys.
 */
export type RoutedPaymentMetadata = {
  [key: string]: string | undefined;
  [K.KIND]: PaymentKind;
  [K.RESTAURANT_ID]: string;
};

/** Any metadata object this module produces. */
export type AllergenWiseStripeMetadata =
  | PlanPaymentMetadata
  | CertFeePaymentMetadata
  | SubmissionPaymentMetadata
  | CustomerMetadata
  | RoutedPaymentMetadata;

/** What a consumer receives from Stripe — always possibly absent. */
export type StripeMetadataSource = Stripe.Metadata | null | undefined;

// ─── Boundary conversion ──────────────────────────────────────────────────────

/**
 * Drop undefined entries and widen to the shape the Stripe SDK accepts.
 * This is the one place a typed metadata object loses its type — call it at the
 * `stripe.*.create({ metadata })` boundary and nowhere else.
 */
export function toStripeMetadata(meta: AllergenWiseStripeMetadata): Stripe.MetadataParam {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(meta)) {
    if (typeof value === 'string') out[key] = value;
  }
  return out;
}

// ─── Builders ─────────────────────────────────────────────────────────────────

export interface PlanMetadataInput {
  restaurantId: string;
  adminId: string;
  plan: SubscriptionPlan;
  /** Reserved for the coming 100%-off comp path. */
  compCode?: string | null;
}

/**
 * PaymentIntent metadata for a plan purchase.
 * Omitting `restaurantId`, `adminId`, or `plan` is a compile error — which is
 * the entire point: this is the pair that silently disagreed in production.
 */
export function buildPlanMetadata(input: PlanMetadataInput): PlanPaymentMetadata {
  const meta: PlanPaymentMetadata = {
    [K.KIND]: 'plan',
    [K.PLAN]: input.plan,
    [K.RESTAURANT_ID]: input.restaurantId,
    [K.ADMIN_ID]: input.adminId,
  };
  if (input.compCode) meta[K.COMP_CODE] = input.compCode;
  return meta;
}

export interface CertFeeMetadataInput {
  restaurantId: string;
  certifiedCount: number;
  feePerCertCents: number;
  /**
   * profiles.id of the submitting manager. Required for the T-41b Checkout
   * shape, because the webhook has no other source for
   * `submissions.submitted_by`. Omitted by the off-session PaymentIntent path,
   * which does not create a submission.
   */
  submittedBy?: string | null;
  submissionId?: string | null;
  compCode?: string | null;
  /**
   * Defaults to `cert_fee`, so every pre-T-45a caller is unchanged. Pass
   * `cert_topup` for the post-listing balance — see PAYMENT_KINDS above.
   */
  kind?: CertCheckoutKind;
}

/** Metadata for a certificate-fee PaymentIntent or Checkout Session. */
export function buildCertFeeMetadata(input: CertFeeMetadataInput): CertFeePaymentMetadata {
  const meta: CertFeePaymentMetadata = {
    [K.KIND]: input.kind ?? 'cert_fee',
    [K.RESTAURANT_ID]: input.restaurantId,
    [K.CERTIFIED_COUNT]: String(input.certifiedCount),
    [K.FEE_PER_CERT_CENTS]: String(input.feePerCertCents),
  };
  if (input.submittedBy) meta[K.SUBMITTED_BY] = input.submittedBy;
  if (input.submissionId) meta[K.SUBMISSION_ID] = input.submissionId;
  if (input.compCode) meta[K.COMP_CODE] = input.compCode;
  return meta;
}

export interface SubmissionMetadataInput {
  restaurantId: string;
  submissionId: string;
  compCode?: string | null;
}

/** PaymentIntent metadata for a submission fee. */
export function buildSubmissionMetadata(input: SubmissionMetadataInput): SubmissionPaymentMetadata {
  const meta: SubmissionPaymentMetadata = {
    [K.KIND]: 'submission',
    [K.RESTAURANT_ID]: input.restaurantId,
    [K.SUBMISSION_ID]: input.submissionId,
  };
  if (input.compCode) meta[K.COMP_CODE] = input.compCode;
  return meta;
}

export interface CustomerMetadataInput {
  restaurantId: string;
  adminId: string;
  compCode?: string | null;
}

/** Customer metadata written at signup; read back by `customer.updated`. */
export function buildCustomerMetadata(input: CustomerMetadataInput): CustomerMetadata {
  const meta: CustomerMetadata = {
    [K.RESTAURANT_ID]: input.restaurantId,
    [K.ADMIN_ID]: input.adminId,
  };
  if (input.compCode) meta[K.COMP_CODE] = input.compCode;
  return meta;
}

export interface RoutedPaymentMetadataInput {
  kind: PaymentKind;
  restaurantId: string;
  /**
   * Caller-supplied passthrough fields. The guaranteed routing keys are applied
   * last, so a caller can never override `kind` or `restaurant_id`.
   */
  extra?: Record<string, string>;
}

/**
 * Metadata for the generic PaymentIntent route, which accepts arbitrary caller
 * fields but must guarantee the two keys the webhook routes on.
 */
export function buildRoutedPaymentMetadata(
  input: RoutedPaymentMetadataInput
): RoutedPaymentMetadata {
  return {
    ...(input.extra ?? {}),
    [K.KIND]: input.kind,
    [K.RESTAURANT_ID]: input.restaurantId,
  };
}

// ─── Parsers ──────────────────────────────────────────────────────────────────

function readKey(meta: StripeMetadataSource, key: StripeMetadataKey): string | null {
  const raw = meta?.[key];
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Routing discriminant. Returns 'unknown' rather than throwing — the webhook
 * must still answer Stripe with a 200 for kinds it does not handle.
 */
export function parsePaymentKind(meta: StripeMetadataSource): PaymentKind | 'unknown' {
  const value = readKey(meta, K.KIND);
  return isPaymentKind(value) ? value : 'unknown';
}

export function parseRestaurantId(meta: StripeMetadataSource): string | null {
  return readKey(meta, K.RESTAURANT_ID);
}

export function parseAdminId(meta: StripeMetadataSource): string | null {
  return readKey(meta, K.ADMIN_ID);
}

export function parsePlan(meta: StripeMetadataSource): SubscriptionPlan | null {
  const value = readKey(meta, K.PLAN);
  return isSubscriptionPlan(value) ? value : null;
}

export function parseSubmissionId(meta: StripeMetadataSource): string | null {
  return readKey(meta, K.SUBMISSION_ID);
}

/** profiles.id of the manager whose submission a cert-fee Checkout pays for. */
export function parseSubmittedBy(meta: StripeMetadataSource): string | null {
  return readKey(meta, K.SUBMITTED_BY);
}

export function parseCertifiedCount(meta: StripeMetadataSource): number | null {
  const value = readKey(meta, K.CERTIFIED_COUNT);
  if (value === null) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) ? parsed : null;
}

export function parseFeePerCertCents(meta: StripeMetadataSource): number | null {
  const value = readKey(meta, K.FEE_PER_CERT_CENTS);
  if (value === null) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) ? parsed : null;
}

/** Reserved for the coming 100%-off comp path. */
export function parseCompCode(meta: StripeMetadataSource): string | null {
  return readKey(meta, K.COMP_CODE);
}

// ─── Composite parse for the plan path ────────────────────────────────────────

export interface PlanPaymentFields {
  restaurantId: string;
  plan: SubscriptionPlan;
  /** Absent on plan PaymentIntents created before admin_id was written. */
  adminId: string | null;
  compCode: string | null;
}

export type MetadataParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; missing: StripeMetadataKey[] };

/**
 * Parse the fields the plan-payment handler needs, reporting exactly which
 * required keys were absent instead of a generic "missing metadata".
 */
export function parsePlanPaymentMetadata(
  meta: StripeMetadataSource
): MetadataParseResult<PlanPaymentFields> {
  const restaurantId = parseRestaurantId(meta);
  const plan = parsePlan(meta);

  const missing: StripeMetadataKey[] = [];
  if (restaurantId === null) missing.push(K.RESTAURANT_ID);
  if (plan === null) missing.push(K.PLAN);
  if (missing.length > 0 || restaurantId === null || plan === null) {
    return { ok: false, missing };
  }

  return {
    ok: true,
    value: {
      restaurantId,
      plan,
      adminId: parseAdminId(meta),
      compCode: parseCompCode(meta),
    },
  };
}

// ─── Composite parse for the cert-fee Checkout path ───────────────────────────

export interface CertFeeCheckoutFields {
  restaurantId: string;
  /** profiles.id — fills submissions.submitted_by, which is NOT NULL. */
  submittedBy: string;
  /** Certificates the Session was priced for. Absent on hand-made Sessions. */
  certifiedCount: number | null;
  /** Per-cert list price at Session-creation time, before any promotion code. */
  feePerCertCents: number | null;
}

/**
 * Parse the fields the cert-fee Checkout handler needs, reporting exactly which
 * required keys were absent — same contract as `parsePlanPaymentMetadata`.
 *
 * `certified_count` and `fee_per_cert_cents` are deliberately NOT required:
 * they are provenance, not inputs. The amount actually charged comes from the
 * Session's `amount_total` and the certificates actually activated come from a
 * live `status='pending'` read, so a Session created by hand in the Stripe
 * dashboard with only the two required keys still works.
 */
export function parseCertFeeCheckoutMetadata(
  meta: StripeMetadataSource
): MetadataParseResult<CertFeeCheckoutFields> {
  const restaurantId = parseRestaurantId(meta);
  const submittedBy = parseSubmittedBy(meta);

  const missing: StripeMetadataKey[] = [];
  if (restaurantId === null) missing.push(K.RESTAURANT_ID);
  if (submittedBy === null) missing.push(K.SUBMITTED_BY);
  if (restaurantId === null || submittedBy === null) {
    return { ok: false, missing };
  }

  return {
    ok: true,
    value: {
      restaurantId,
      submittedBy,
      certifiedCount: parseCertifiedCount(meta),
      feePerCertCents: parseFeePerCertCents(meta),
    },
  };
}

/** Render missing keys for a log line / thrown message. */
export function formatMissingKeys(missing: readonly StripeMetadataKey[]): string {
  return missing.join(', ');
}
