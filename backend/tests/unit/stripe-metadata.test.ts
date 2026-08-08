/**
 * tests/unit/stripe-metadata.test.ts
 *
 * Contract tests for lib/stripe/metadata.ts — the single source of truth for
 * Stripe metadata keys.
 *
 * The bug these guard: lib/auth/signup.ts wrote `restaurantId`/`adminId`
 * (camelCase) while the webhook read `restaurant_id` (snake_case), so every
 * signup-originated Stripe event 500'd back to Stripe — no subscriptions row,
 * no WelcomeAdmin email. Nothing in the type system or the suite caught it,
 * because producer and consumer each wrote their own object literal.
 */

import { describe, it, expect } from 'vitest';
import {
  PAYMENT_KINDS,
  STRIPE_METADATA_KEYS,
  buildCertFeeMetadata,
  buildCustomerMetadata,
  buildPlanMetadata,
  buildRoutedPaymentMetadata,
  buildSubmissionMetadata,
  formatMissingKeys,
  isPaymentKind,
  isSubscriptionPlan,
  parseAdminId,
  parseCertifiedCount,
  parseCompCode,
  parseFeePerCertCents,
  parsePaymentKind,
  parsePlan,
  parsePlanPaymentMetadata,
  parseRestaurantId,
  parseSubmissionId,
  toStripeMetadata,
} from '@/lib/stripe/metadata';

const REST_ID = '11111111-1111-4111-8111-111111111111';
const ADMIN_ID = '22222222-2222-4222-8222-222222222222';
const SUBMISSION_ID = '33333333-3333-4333-8333-333333333333';

// ─── Wire format ──────────────────────────────────────────────────────────────

describe('STRIPE_METADATA_KEYS — wire format', () => {
  it('every key is snake_case (no camelCase can re-enter the contract)', () => {
    for (const key of Object.values(STRIPE_METADATA_KEYS)) {
      expect(key, `${key} is not snake_case`).toMatch(/^[a-z][a-z0-9]*(_[a-z0-9]+)*$/);
    }
  });

  it('pins the exact wire strings already present on live Stripe objects', () => {
    // Changing any of these strands PaymentIntents/Customers already created
    // in production. This test is the tripwire for that.
    //
    // ADDING a key strands nothing — objects created before it simply lack it,
    // and every parser treats an absent key as absent. So a new entry here is a
    // deliberate extension; a CHANGED string is the failure this guards.
    expect(STRIPE_METADATA_KEYS).toEqual({
      KIND: 'kind',
      RESTAURANT_ID: 'restaurant_id',
      ADMIN_ID: 'admin_id',
      PLAN: 'plan',
      SUBMISSION_ID: 'submission_id',
      CERTIFIED_COUNT: 'certified_count',
      FEE_PER_CERT_CENTS: 'fee_per_cert_cents',
      // T-41b: the submitting manager, carried on a cert-fee Checkout Session
      // because the webhook has no session and submissions.submitted_by is
      // NOT NULL.
      SUBMITTED_BY: 'submitted_by',
      COMP_CODE: 'comp_code',
    });
  });

  it('reserves comp_code so the coming 100%-off path needs no new key', () => {
    expect(STRIPE_METADATA_KEYS.COMP_CODE).toBe('comp_code');
  });
});

// ─── Guards ───────────────────────────────────────────────────────────────────

describe('type guards', () => {
  it('isPaymentKind accepts only the routed kinds', () => {
    for (const kind of PAYMENT_KINDS) expect(isPaymentKind(kind)).toBe(true);
    expect(isPaymentKind('mystery')).toBe(false);
    expect(isPaymentKind(undefined)).toBe(false);
    expect(isPaymentKind(null)).toBe(false);
  });

  it('isSubscriptionPlan accepts only quarterly/semiannual', () => {
    expect(isSubscriptionPlan('quarterly')).toBe(true);
    expect(isSubscriptionPlan('semiannual')).toBe(true);
    expect(isSubscriptionPlan('annual')).toBe(false);
    expect(isSubscriptionPlan('')).toBe(false);
  });
});

// ─── Builders → parsers round-trip ────────────────────────────────────────────

describe('buildPlanMetadata', () => {
  it('emits snake_case keys, not the camelCase the live bug wrote', () => {
    const meta = buildPlanMetadata({ restaurantId: REST_ID, adminId: ADMIN_ID, plan: 'quarterly' });

    expect(Object.keys(meta).sort()).toEqual(['admin_id', 'kind', 'plan', 'restaurant_id']);
    expect(meta).not.toHaveProperty('restaurantId');
    expect(meta).not.toHaveProperty('adminId');
  });

  it('round-trips through the parsers the webhook uses', () => {
    const meta = toStripeMetadata(
      buildPlanMetadata({ restaurantId: REST_ID, adminId: ADMIN_ID, plan: 'semiannual' })
    ) as Record<string, string>;

    expect(parsePaymentKind(meta)).toBe('plan');
    expect(parseRestaurantId(meta)).toBe(REST_ID);
    expect(parseAdminId(meta)).toBe(ADMIN_ID);
    expect(parsePlan(meta)).toBe('semiannual');
  });

  it('omits comp_code unless one is supplied, and carries it when it is', () => {
    const without = buildPlanMetadata({
      restaurantId: REST_ID,
      adminId: ADMIN_ID,
      plan: 'quarterly',
    });
    expect(without).not.toHaveProperty('comp_code');

    const with100Off = buildPlanMetadata({
      restaurantId: REST_ID,
      adminId: ADMIN_ID,
      plan: 'quarterly',
      compCode: 'PILOT100',
    });
    expect(parseCompCode(with100Off)).toBe('PILOT100');
  });
});

describe('buildCertFeeMetadata', () => {
  it('stringifies numerics and round-trips them back to numbers', () => {
    const meta = buildCertFeeMetadata({
      restaurantId: REST_ID,
      certifiedCount: 3,
      feePerCertCents: 3500,
      submissionId: SUBMISSION_ID,
    });

    expect(meta.certified_count).toBe('3');
    expect(meta.fee_per_cert_cents).toBe('3500');
    expect(parseCertifiedCount(meta)).toBe(3);
    expect(parseFeePerCertCents(meta)).toBe(3500);
    expect(parseSubmissionId(meta)).toBe(SUBMISSION_ID);
    expect(parsePaymentKind(meta)).toBe('cert_fee');
  });

  it('omits submission_id when the charge is not tied to a submission', () => {
    const meta = buildCertFeeMetadata({
      restaurantId: REST_ID,
      certifiedCount: 1,
      feePerCertCents: 3500,
    });
    expect(meta).not.toHaveProperty('submission_id');
    expect(parseSubmissionId(meta)).toBeNull();
  });
});

describe('buildSubmissionMetadata / buildCustomerMetadata', () => {
  it('submission metadata routes as kind=submission with both ids', () => {
    const meta = buildSubmissionMetadata({ restaurantId: REST_ID, submissionId: SUBMISSION_ID });
    expect(parsePaymentKind(meta)).toBe('submission');
    expect(parseRestaurantId(meta)).toBe(REST_ID);
    expect(parseSubmissionId(meta)).toBe(SUBMISSION_ID);
  });

  it('customer metadata carries the tenant link handleCustomerUpdated reads', () => {
    const meta = buildCustomerMetadata({ restaurantId: REST_ID, adminId: ADMIN_ID });
    expect(Object.keys(meta).sort()).toEqual(['admin_id', 'restaurant_id']);
    expect(parseRestaurantId(meta)).toBe(REST_ID);
    expect(parseAdminId(meta)).toBe(ADMIN_ID);
  });
});

describe('buildRoutedPaymentMetadata', () => {
  it('passes caller fields through', () => {
    const meta = buildRoutedPaymentMetadata({
      kind: 'plan',
      restaurantId: REST_ID,
      extra: { plan: 'quarterly' },
    }) as Record<string, string>;
    expect(parsePlan(meta)).toBe('quarterly');
  });

  it('a caller cannot override the routing keys', () => {
    const meta = buildRoutedPaymentMetadata({
      kind: 'cert_fee',
      restaurantId: REST_ID,
      // A hostile/buggy caller trying to charge another tenant or reroute
      extra: { kind: 'plan', restaurant_id: 'attacker-restaurant' },
    }) as Record<string, string>;

    expect(parsePaymentKind(meta)).toBe('cert_fee');
    expect(parseRestaurantId(meta)).toBe(REST_ID);
  });
});

// ─── Boundary conversion ──────────────────────────────────────────────────────

describe('toStripeMetadata', () => {
  it('drops undefined entries so the Stripe SDK never receives one', () => {
    const meta = toStripeMetadata(
      buildCertFeeMetadata({
        restaurantId: REST_ID,
        certifiedCount: 2,
        feePerCertCents: 3500,
        submissionId: null,
        compCode: null,
      })
    );

    expect(Object.values(meta).every((v) => typeof v === 'string')).toBe(true);
    expect(Object.keys(meta).sort()).toEqual([
      'certified_count',
      'fee_per_cert_cents',
      'kind',
      'restaurant_id',
    ]);
  });
});

// ─── Parsers ──────────────────────────────────────────────────────────────────

describe('parsers', () => {
  it('treat absent/blank/non-string values as missing rather than crashing', () => {
    expect(parseRestaurantId(undefined)).toBeNull();
    expect(parseRestaurantId(null)).toBeNull();
    expect(parseRestaurantId({})).toBeNull();
    expect(parseRestaurantId({ restaurant_id: '   ' })).toBeNull();
    expect(parseRestaurantId({ restaurant_id: `  ${REST_ID}  ` })).toBe(REST_ID);
  });

  it('parsePaymentKind returns "unknown" instead of throwing, so Stripe still gets a 200', () => {
    expect(parsePaymentKind({ kind: 'mystery' })).toBe('unknown');
    expect(parsePaymentKind({})).toBe('unknown');
  });

  it('parseCertifiedCount rejects non-integers', () => {
    expect(parseCertifiedCount({ certified_count: 'three' })).toBeNull();
    expect(parseCertifiedCount({ certified_count: '2' })).toBe(2);
  });
});

describe('parsePlanPaymentMetadata', () => {
  it('accepts what buildPlanMetadata produces', () => {
    const result = parsePlanPaymentMetadata(
      buildPlanMetadata({ restaurantId: REST_ID, adminId: ADMIN_ID, plan: 'quarterly' })
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.value).toEqual({
      restaurantId: REST_ID,
      plan: 'quarterly',
      adminId: ADMIN_ID,
      compCode: null,
    });
  });

  it('REGRESSION: rejects the camelCase shape signup used to write, naming the missing key', () => {
    // This is the literal metadata lib/auth/signup.ts produced before the fix.
    const legacyBuggyShape = {
      kind: 'plan',
      plan: 'quarterly',
      restaurantId: REST_ID,
      adminId: ADMIN_ID,
    };

    const result = parsePlanPaymentMetadata(legacyBuggyShape);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.missing).toEqual(['restaurant_id']);
    expect(formatMissingKeys(result.missing)).toBe('restaurant_id');
  });

  it('names every absent required key, not a generic message', () => {
    const result = parsePlanPaymentMetadata({ kind: 'plan' });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.missing).toEqual(['restaurant_id', 'plan']);
    expect(formatMissingKeys(result.missing)).toBe('restaurant_id, plan');
  });

  it('rejects an unrecognised plan value', () => {
    const result = parsePlanPaymentMetadata({
      kind: 'plan',
      plan: 'annual',
      restaurant_id: REST_ID,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.missing).toEqual(['plan']);
  });
});
