/**
 * tests/unit/auto-checks.test.ts
 *
 * Tests for lib/reviewer/auto-checks.ts — computeAutoChecks().
 * Each of the four checks is tested in isolation (failing independently while
 * the others pass). No real DB — supabase is fully mocked.
 *
 * Mock design: The supabase query chains need to be awaitable directly
 * (e.g., `await supabase.from('profiles').select('id').eq(...)`) and also
 * support `.single()` and `.maybeSingle()` terminator calls.
 *
 * The `computeAutoChecks` function makes DB calls in this order:
 *   1. profiles (list, direct await)
 *   2. certificates (list, direct await)
 *   3. exam_attempts (list, direct await) — only when allCertified=true
 *   4. subscriptions (maybeSingle)
 *   5. submissions (single)
 *   6. submissions for count (head query, direct await with count)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mock supabase/server ─────────────────────────────────────────────────────

const mockFrom = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
  createServiceSupabase: () => ({
    from: mockFrom,
  }),
}));

// ─── Import after mocks ───────────────────────────────────────────────────────

import { computeAutoChecks } from '@/lib/reviewer/auto-checks';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const SUBMISSION_ID = '00000000-0000-0000-0000-000000000001';
const RESTAURANT_ID = '00000000-0000-0000-0000-000000000002';
const PROFILE_ID_1 = '00000000-0000-0000-0000-000000000010';
const CERT_ID_1 = '00000000-0000-0000-0000-000000000020';
const ATTEMPT_ID_1 = '00000000-0000-0000-0000-000000000030';
const FAR_FUTURE = '2099-01-01T00:00:00Z';

// ─── Awaitable chain factory ──────────────────────────────────────────────────

/**
 * Creates a chain object that is:
 * - Awaitable directly (resolves to { data, error, count })
 * - Has .select, .eq, .neq, .in, .gt filter methods (all return `this`)
 * - Has .single() and .maybeSingle() terminators (resolve to { data, error })
 *
 * This mirrors how @supabase/postgrest-js query builders work.
 */
function makeChain(result: {
  data?: unknown;
  error?: { message: string } | null;
  count?: number | null;
}) {
  const resolved = {
    data: result.data !== undefined ? result.data : null,
    error: result.error !== undefined ? result.error : null,
    count: result.count !== undefined ? result.count : null,
  };

  const chain: Record<string, unknown> = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    neq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    gt: vi.fn().mockReturnThis(),
    // T-46a — carries the membership filter, .is('departed_at', null).
    is: vi.fn().mockReturnThis(),
    // Terminators
    single: vi.fn().mockResolvedValue({ data: resolved.data, error: resolved.error }),
    maybeSingle: vi.fn().mockResolvedValue({ data: resolved.data, error: resolved.error }),
    // Direct await support: make the chain itself thenable
    then: (onfulfilled: (v: unknown) => unknown, onrejected?: (e: unknown) => unknown) =>
      Promise.resolve(resolved).then(onfulfilled, onrejected),
  };

  // Ensure filter methods return `this`
  for (const method of ['select', 'eq', 'neq', 'in', 'gt', 'is']) {
    (chain[method] as ReturnType<typeof vi.fn>).mockReturnValue(chain);
  }

  return chain;
}

/**
 * Sets up mockFrom to return chains in sequence (one per from() call).
 */
function setupSequence(
  sequence: Array<{
    data?: unknown;
    error?: { message: string } | null;
    count?: number | null;
  }>
) {
  let index = 0;
  mockFrom.mockImplementation(() => {
    const cfg = sequence[index] ?? { data: null };
    index++;
    return makeChain(cfg);
  });
}

// ─── All-pass baseline ────────────────────────────────────────────────────────

describe('computeAutoChecks — all checks pass', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns all true when every condition is met', async () => {
    setupSequence([
      // 1. profiles
      { data: [{ id: PROFILE_ID_1 }] },
      // 2. certificates
      {
        data: [
          {
            id: CERT_ID_1,
            profile_id: PROFILE_ID_1,
            exam_attempt_id: ATTEMPT_ID_1,
            expires_at: FAR_FUTURE,
            revoked: false,
          },
        ],
      },
      // 3. exam_attempts
      { data: [{ id: ATTEMPT_ID_1, score_percent: 95, passed: true }] },
      // 4. subscriptions (maybeSingle)
      { data: { id: 'sub-1', status: 'active', ends_at: FAR_FUTURE } },
      // 5. submissions (single)
      {
        data: {
          id: SUBMISSION_ID,
          cert_fee_total_cents: 3500,
          stripe_payment_intent_id: 'pi_abc',
        },
      },
      // 6. submissions count (head)
      { data: null, count: 0 },
    ]);

    const result = await computeAutoChecks({
      submissionId: SUBMISSION_ID,
      restaurantId: RESTAURANT_ID,
    });

    expect(result).toEqual({
      allCertified: true,
      allScoresPass: true,
      paymentValid: true,
      noPriorRejection: true,
    });
  });
});

// ─── allCertified fails ───────────────────────────────────────────────────────

describe('computeAutoChecks — allCertified fails', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns allCertified=false when one learner has no cert', async () => {
    const PROFILE_ID_2 = '00000000-0000-0000-0000-000000000011';
    setupSequence([
      // 1. profiles: two learners
      { data: [{ id: PROFILE_ID_1 }, { id: PROFILE_ID_2 }] },
      // 2. certificates: only one cert (PROFILE_ID_2 has none)
      {
        data: [
          {
            id: CERT_ID_1,
            profile_id: PROFILE_ID_1,
            exam_attempt_id: ATTEMPT_ID_1,
            expires_at: FAR_FUTURE,
            revoked: false,
          },
        ],
      },
      // NOTE: exam_attempts query is SKIPPED when allCertified=false (code guards with `if (allCertified)`).
      // 3. subscriptions (maybeSingle)
      { data: { id: 'sub-1', status: 'active', ends_at: FAR_FUTURE } },
      // 4. submissions (single)
      {
        data: { id: SUBMISSION_ID, cert_fee_total_cents: 3500, stripe_payment_intent_id: 'pi_abc' },
      },
      // 5. count
      { data: null, count: 0 },
    ]);

    const result = await computeAutoChecks({
      submissionId: SUBMISSION_ID,
      restaurantId: RESTAURANT_ID,
    });

    expect(result.allCertified).toBe(false);
    expect(result.allScoresPass).toBe(false);
    expect(result.paymentValid).toBe(true);
    expect(result.noPriorRejection).toBe(true);
  });

  it('returns all false when no learner profiles exist', async () => {
    // When profiles is empty, computeAutoChecks returns early.
    setupSequence([
      { data: [] }, // 1. profiles: empty
    ]);

    const result = await computeAutoChecks({
      submissionId: SUBMISSION_ID,
      restaurantId: RESTAURANT_ID,
    });

    expect(result).toEqual({
      allCertified: false,
      allScoresPass: false,
      paymentValid: false,
      noPriorRejection: false,
    });
  });

  it('returns allCertified=false when cert list is empty (all certs revoked/expired)', async () => {
    setupSequence([
      // 1. profiles: one learner
      { data: [{ id: PROFILE_ID_1 }] },
      // 2. certificates: empty (revoked/expired certs were filtered by the query)
      { data: [] },
      // 3. exam_attempts: not reached (no certs means allCertified=false, allScoresPass=false)
      { data: [] },
      // 4. subscriptions
      { data: { id: 'sub-1', status: 'active', ends_at: FAR_FUTURE } },
      // 5. submissions
      { data: { id: SUBMISSION_ID, cert_fee_total_cents: 0, stripe_payment_intent_id: null } },
      // 6. count
      { data: null, count: 0 },
    ]);

    const result = await computeAutoChecks({
      submissionId: SUBMISSION_ID,
      restaurantId: RESTAURANT_ID,
    });

    expect(result.allCertified).toBe(false);
    expect(result.allScoresPass).toBe(false);
  });
});

// ─── allScoresPass fails ──────────────────────────────────────────────────────

describe('computeAutoChecks — allScoresPass fails', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns allScoresPass=false when exam score < 80', async () => {
    setupSequence([
      { data: [{ id: PROFILE_ID_1 }] },
      {
        data: [
          {
            id: CERT_ID_1,
            profile_id: PROFILE_ID_1,
            exam_attempt_id: ATTEMPT_ID_1,
            expires_at: FAR_FUTURE,
            revoked: false,
          },
        ],
      },
      // score=72 → fails
      { data: [{ id: ATTEMPT_ID_1, score_percent: 72, passed: false }] },
      { data: { id: 'sub-1', status: 'active', ends_at: FAR_FUTURE } },
      {
        data: { id: SUBMISSION_ID, cert_fee_total_cents: 3500, stripe_payment_intent_id: 'pi_abc' },
      },
      { data: null, count: 0 },
    ]);

    const result = await computeAutoChecks({
      submissionId: SUBMISSION_ID,
      restaurantId: RESTAURANT_ID,
    });

    expect(result.allCertified).toBe(true);
    expect(result.allScoresPass).toBe(false);
  });

  it('returns allScoresPass=false when cert has no exam_attempt_id', async () => {
    setupSequence([
      { data: [{ id: PROFILE_ID_1 }] },
      {
        data: [
          {
            id: CERT_ID_1,
            profile_id: PROFILE_ID_1,
            exam_attempt_id: null, // no attempt linked
            expires_at: FAR_FUTURE,
            revoked: false,
          },
        ],
      },
      // No attempt IDs → code skips the exam_attempts query (attemptIds.length=0)
      // and sets allScoresPass=false directly.
      // Subscriptions still queried:
      { data: { id: 'sub-1', status: 'active', ends_at: FAR_FUTURE } },
      {
        data: { id: SUBMISSION_ID, cert_fee_total_cents: 3500, stripe_payment_intent_id: 'pi_abc' },
      },
      { data: null, count: 0 },
    ]);

    const result = await computeAutoChecks({
      submissionId: SUBMISSION_ID,
      restaurantId: RESTAURANT_ID,
    });

    expect(result.allCertified).toBe(true);
    expect(result.allScoresPass).toBe(false);
  });

  it('returns allScoresPass=false when score=79 (below threshold)', async () => {
    setupSequence([
      { data: [{ id: PROFILE_ID_1 }] },
      {
        data: [
          {
            id: CERT_ID_1,
            profile_id: PROFILE_ID_1,
            exam_attempt_id: ATTEMPT_ID_1,
            expires_at: FAR_FUTURE,
            revoked: false,
          },
        ],
      },
      { data: [{ id: ATTEMPT_ID_1, score_percent: 79, passed: true }] },
      { data: { id: 'sub-1', status: 'active', ends_at: FAR_FUTURE } },
      {
        data: { id: SUBMISSION_ID, cert_fee_total_cents: 3500, stripe_payment_intent_id: 'pi_abc' },
      },
      { data: null, count: 0 },
    ]);

    const result = await computeAutoChecks({
      submissionId: SUBMISSION_ID,
      restaurantId: RESTAURANT_ID,
    });

    expect(result.allScoresPass).toBe(false);
  });

  it('returns allScoresPass=true when score=80 (exact boundary)', async () => {
    setupSequence([
      { data: [{ id: PROFILE_ID_1 }] },
      {
        data: [
          {
            id: CERT_ID_1,
            profile_id: PROFILE_ID_1,
            exam_attempt_id: ATTEMPT_ID_1,
            expires_at: FAR_FUTURE,
            revoked: false,
          },
        ],
      },
      { data: [{ id: ATTEMPT_ID_1, score_percent: 80, passed: true }] },
      { data: { id: 'sub-1', status: 'active', ends_at: FAR_FUTURE } },
      {
        data: { id: SUBMISSION_ID, cert_fee_total_cents: 3500, stripe_payment_intent_id: 'pi_abc' },
      },
      { data: null, count: 0 },
    ]);

    const result = await computeAutoChecks({
      submissionId: SUBMISSION_ID,
      restaurantId: RESTAURANT_ID,
    });

    expect(result.allScoresPass).toBe(true);
  });
});

// ─── paymentValid fails ───────────────────────────────────────────────────────

describe('computeAutoChecks — paymentValid fails', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns paymentValid=false when no active subscription', async () => {
    setupSequence([
      { data: [{ id: PROFILE_ID_1 }] },
      {
        data: [
          {
            id: CERT_ID_1,
            profile_id: PROFILE_ID_1,
            exam_attempt_id: ATTEMPT_ID_1,
            expires_at: FAR_FUTURE,
            revoked: false,
          },
        ],
      },
      { data: [{ id: ATTEMPT_ID_1, score_percent: 90, passed: true }] },
      // No active subscription
      { data: null },
      {
        data: { id: SUBMISSION_ID, cert_fee_total_cents: 3500, stripe_payment_intent_id: 'pi_abc' },
      },
      { data: null, count: 0 },
    ]);

    const result = await computeAutoChecks({
      submissionId: SUBMISSION_ID,
      restaurantId: RESTAURANT_ID,
    });

    expect(result.paymentValid).toBe(false);
    expect(result.allCertified).toBe(true);
  });

  it('returns paymentValid=false when cert_fee > 0 but no payment_intent', async () => {
    setupSequence([
      { data: [{ id: PROFILE_ID_1 }] },
      {
        data: [
          {
            id: CERT_ID_1,
            profile_id: PROFILE_ID_1,
            exam_attempt_id: ATTEMPT_ID_1,
            expires_at: FAR_FUTURE,
            revoked: false,
          },
        ],
      },
      { data: [{ id: ATTEMPT_ID_1, score_percent: 90, passed: true }] },
      { data: { id: 'sub-1', status: 'active', ends_at: FAR_FUTURE } },
      // fee charged but no stripe PI
      { data: { id: SUBMISSION_ID, cert_fee_total_cents: 3500, stripe_payment_intent_id: null } },
      { data: null, count: 0 },
    ]);

    const result = await computeAutoChecks({
      submissionId: SUBMISSION_ID,
      restaurantId: RESTAURANT_ID,
    });

    expect(result.paymentValid).toBe(false);
  });

  it('returns paymentValid=true when cert_fee=0 (free) with active subscription', async () => {
    setupSequence([
      { data: [{ id: PROFILE_ID_1 }] },
      {
        data: [
          {
            id: CERT_ID_1,
            profile_id: PROFILE_ID_1,
            exam_attempt_id: ATTEMPT_ID_1,
            expires_at: FAR_FUTURE,
            revoked: false,
          },
        ],
      },
      { data: [{ id: ATTEMPT_ID_1, score_percent: 90, passed: true }] },
      { data: { id: 'sub-1', status: 'active', ends_at: FAR_FUTURE } },
      // cert_fee=0 → free → feeOk=true
      { data: { id: SUBMISSION_ID, cert_fee_total_cents: 0, stripe_payment_intent_id: null } },
      { data: null, count: 0 },
    ]);

    const result = await computeAutoChecks({
      submissionId: SUBMISSION_ID,
      restaurantId: RESTAURANT_ID,
    });

    expect(result.paymentValid).toBe(true);
  });
});

// ─── noPriorRejection fails ───────────────────────────────────────────────────

describe('computeAutoChecks — noPriorRejection fails', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns noPriorRejection=false when a prior rejected submission exists', async () => {
    setupSequence([
      { data: [{ id: PROFILE_ID_1 }] },
      {
        data: [
          {
            id: CERT_ID_1,
            profile_id: PROFILE_ID_1,
            exam_attempt_id: ATTEMPT_ID_1,
            expires_at: FAR_FUTURE,
            revoked: false,
          },
        ],
      },
      { data: [{ id: ATTEMPT_ID_1, score_percent: 90, passed: true }] },
      { data: { id: 'sub-1', status: 'active', ends_at: FAR_FUTURE } },
      {
        data: { id: SUBMISSION_ID, cert_fee_total_cents: 3500, stripe_payment_intent_id: 'pi_abc' },
      },
      // Prior rejection count = 2
      { data: null, count: 2 },
    ]);

    const result = await computeAutoChecks({
      submissionId: SUBMISSION_ID,
      restaurantId: RESTAURANT_ID,
    });

    expect(result.noPriorRejection).toBe(false);
    expect(result.allCertified).toBe(true);
    expect(result.allScoresPass).toBe(true);
    expect(result.paymentValid).toBe(true);
  });

  it('returns noPriorRejection=true when prior rejection count = 0', async () => {
    setupSequence([
      { data: [{ id: PROFILE_ID_1 }] },
      {
        data: [
          {
            id: CERT_ID_1,
            profile_id: PROFILE_ID_1,
            exam_attempt_id: ATTEMPT_ID_1,
            expires_at: FAR_FUTURE,
            revoked: false,
          },
        ],
      },
      { data: [{ id: ATTEMPT_ID_1, score_percent: 95, passed: true }] },
      { data: { id: 'sub-1', status: 'active', ends_at: FAR_FUTURE } },
      {
        data: { id: SUBMISSION_ID, cert_fee_total_cents: 3500, stripe_payment_intent_id: 'pi_abc' },
      },
      { data: null, count: 0 },
    ]);

    const result = await computeAutoChecks({
      submissionId: SUBMISSION_ID,
      restaurantId: RESTAURANT_ID,
    });

    expect(result.noPriorRejection).toBe(true);
  });
});

// ─── Error propagation ────────────────────────────────────────────────────────

describe('computeAutoChecks — error propagation', () => {
  beforeEach(() => vi.clearAllMocks());

  it('throws when profiles query fails', async () => {
    setupSequence([{ data: null, error: { message: 'DB down' } }]);

    await expect(
      computeAutoChecks({ submissionId: SUBMISSION_ID, restaurantId: RESTAURANT_ID })
    ).rejects.toThrow('auto-checks profiles: DB down');
  });

  it('throws when certificates query fails', async () => {
    setupSequence([
      { data: [{ id: PROFILE_ID_1 }] },
      { data: null, error: { message: 'certs table error' } },
    ]);

    await expect(
      computeAutoChecks({ submissionId: SUBMISSION_ID, restaurantId: RESTAURANT_ID })
    ).rejects.toThrow('auto-checks certificates: certs table error');
  });
});
