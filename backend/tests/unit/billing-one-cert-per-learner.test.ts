/**
 * tests/unit/billing-one-cert-per-learner.test.ts
 *
 * T-49 — the money. One learner is $35, not $70.
 *
 * WHY THIS FILE EXISTS SEPARATELY FROM THE GUARD TESTS
 * ────────────────────────────────────────────────────
 * The other T-49 tests prove no second certificate ROW is created. That is the
 * mechanism. This one proves the consequence, which is what the bug actually
 * cost: /api/submissions/create prices its Checkout Session at
 * `CERT_FEE_CENTS × pendingCertCount` (route.ts:251), and `pendingCertCount`
 * counts certificate ROWS, not people (lib/admin/eligibility.ts:149).
 *
 * Counting rows is correct and must stay that way — rows are exactly the set
 * the cert-fee webhook's activation UPDATE (`WHERE status='pending'`) will
 * touch, so pricing anything else would charge for certificates that never
 * activate. Which means the only thing standing between one employee and a $70
 * invoice is that a second pending row cannot exist. That is what is asserted
 * here.
 *
 * Both halves run against ONE shared in-memory database, so the certificate the
 * issuer writes is the same row `checkEligibility` later prices. A test that
 * stubbed the two independently could agree with itself while the real system
 * double-charged.
 *
 * T-23 fixed the DISPLAY of this bug (percentages count distinct people, so a
 * duplicate no longer renders 200%). Nothing here touches that counting — this
 * is the source.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { issueCertificateForPassedExam } from '@/lib/learner/issue-certificate';
import { checkEligibility } from '@/lib/admin/eligibility';
import { CERT_FEE_CENTS } from '@/lib/billing/pricing';
import type { ServiceDb } from '@/lib/db/service';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/email/send', () => ({
  sendEmail: vi.fn().mockResolvedValue({ ok: true, id: 'mock-email' }),
}));

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const RESTAURANT_ID = '22222222-2222-4222-8222-222222222222';
const LEARNER_ID = '11111111-1111-4111-8111-111111111111';
const MANAGER_ID = '99999999-9999-4999-8999-999999999999';
const ATTEMPT_1 = '33333333-3333-4333-8333-333333333331';
const ATTEMPT_2 = '33333333-3333-4333-8333-333333333332';

const TWO_YEARS_OUT = new Date(Date.now() + 2 * 365 * 24 * 60 * 60 * 1000).toISOString();

type Row = Record<string, unknown>;

interface State {
  certificates: Row[];
  profiles: Row[];
  subscriptions: Row[];
  submissions: Row[];
  activity_events: Row[];
}

function freshState(): State {
  return {
    certificates: [],
    profiles: [
      {
        id: LEARNER_ID,
        role: 'learner',
        restaurant_id: RESTAURANT_ID,
        departed_at: null,
        email: 'learner@bistro.example',
        full_name: 'Jane Learner',
      },
      {
        id: MANAGER_ID,
        role: 'manager',
        restaurant_id: RESTAURANT_ID,
        departed_at: null,
        email: 'manager@bistro.example',
        full_name: 'Manager Person',
      },
    ],
    subscriptions: [
      { id: 'sub-1', restaurant_id: RESTAURANT_ID, status: 'active', ends_at: '2099-01-01' },
    ],
    submissions: [],
    activity_events: [],
  };
}

/**
 * A small in-memory PostgREST stand-in: enough of the builder for both
 * `issueCertificateForPassedExam` and `checkEligibility` to run against one
 * mutable set of rows. Filters are applied for real, so a query whose predicate
 * is wrong returns the wrong rows here too.
 */
function makeFakeDb(state: State): ServiceDb {
  let seq = 0;

  const from = (table: string) => {
    const predicates: Array<(r: Row) => boolean> = [];
    let limitN: number | null = null;
    let lastInserted: Row | null = null;

    const rows = () => {
      const all = (state[table as keyof State] ?? []) as Row[];
      const filtered = all.filter((r) => predicates.every((p) => p(r)));
      return limitN == null ? filtered : filtered.slice(0, limitN);
    };

    const b: Record<string, unknown> = {
      select: () => b,
      order: () => b,
      eq: (col: string, val: unknown) => {
        predicates.push((r) => r[col] === val);
        return b;
      },
      in: (col: string, vals: unknown[]) => {
        predicates.push((r) => vals.includes(r[col]));
        return b;
      },
      gt: (col: string, val: string) => {
        predicates.push((r) => String(r[col]) > val);
        return b;
      },
      gte: (col: string, val: string) => {
        predicates.push((r) => String(r[col]) >= val);
        return b;
      },
      is: (col: string, val: unknown) => {
        predicates.push((r) => (r[col] ?? null) === val);
        return b;
      },
      limit: (n: number) => {
        limitN = n;
        return b;
      },
      insert: (row: Row) => {
        seq += 1;
        const stored: Row = {
          id: `${table}-${seq}`,
          issued_at: new Date().toISOString(),
          ...row,
        };
        (state[table as keyof State] as Row[]).push(stored);
        lastInserted = stored;
        return b;
      },
      single: async () => ({ data: lastInserted ?? rows()[0] ?? null, error: null }),
      maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
      then: (onF: (v: unknown) => unknown) =>
        Promise.resolve({ data: rows(), error: null }).then(onF),
    };
    return b;
  };

  return { from } as unknown as ServiceDb;
}

const passExam = (db: ServiceDb, attemptId: string) =>
  issueCertificateForPassedExam({
    db,
    restaurantId: RESTAURANT_ID,
    actorId: LEARNER_ID,
    attemptId,
    scorePercent: 92,
    learnerName: 'Jane Learner',
    restaurantName: 'The Test Bistro',
  });

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('T-49 billing — one learner, one certificate fee', () => {
  it('passing the exam twice produces ONE pending certificate, priced at $35', async () => {
    const state = freshState();
    const db = makeFakeDb(state);

    // Exactly the sequence the old code allowed: pass, then pass again. Before
    // T-49 `checkCooldown` let this through (its wait applies only after a
    // FAILURE) and the issuer inserted unconditionally.
    const first = await passExam(db, ATTEMPT_1);
    const second = await passExam(db, ATTEMPT_2);

    expect(first.certCode, 'the first pass must still issue a certificate').toBeDefined();
    expect(second.blocked, 'the second pass must be refused').toBe(true);
    expect(state.certificates).toHaveLength(1);

    const eligibility = await checkEligibility({
      restaurantId: RESTAURANT_ID,
      supabaseServiceClient: db,
    });

    expect(eligibility.pendingCertCount).toBe(1);
    expect(eligibility.certifiedCount).toBe(1);
    expect(eligibility.eligible).toBe(true);

    // The line the manager actually pays. /api/submissions/create:251.
    const checkoutTotalCents = CERT_FEE_CENTS * eligibility.pendingCertCount;
    expect(checkoutTotalCents).toBe(3500);
  });

  it('the counterfactual: two pending rows for that same learner would bill $70', async () => {
    // Not a hypothetical — this is the state the database was in whenever a
    // learner passed twice, and it is what migration 0027's pre-flight reports.
    // Written down so the number the guard removes is explicit rather than
    // implied by an absence.
    const state = freshState();
    const db = makeFakeDb(state);

    state.certificates.push(
      {
        id: 'cert-a',
        cert_code: 'AW-T49AA-BBBB1-2',
        profile_id: LEARNER_ID,
        restaurant_id: RESTAURANT_ID,
        status: 'pending',
        expires_at: TWO_YEARS_OUT,
        issued_at: new Date().toISOString(),
      },
      {
        id: 'cert-b',
        cert_code: 'AW-T49AA-BBBB2-3',
        profile_id: LEARNER_ID,
        restaurant_id: RESTAURANT_ID,
        status: 'pending',
        expires_at: TWO_YEARS_OUT,
        issued_at: new Date().toISOString(),
      }
    );

    const eligibility = await checkEligibility({
      restaurantId: RESTAURANT_ID,
      supabaseServiceClient: db,
    });

    expect(eligibility.pendingCertCount).toBe(2);
    expect(CERT_FEE_CENTS * eligibility.pendingCertCount).toBe(7000);

    // T-23's counting is untouched by this fix: the DISPLAY figure counts
    // distinct people and still reads 1, which is precisely why the over-billing
    // was invisible on every dashboard.
    expect(eligibility.certifiedCount).toBe(1);
  });

  it('a genuine second employee is still billed — the guard is per learner, not per restaurant', async () => {
    // The control that stops "always charge $35" from passing this file.
    const state = freshState();
    const SECOND_LEARNER = '44444444-4444-4444-8444-444444444444';
    state.profiles.push({
      id: SECOND_LEARNER,
      role: 'learner',
      restaurant_id: RESTAURANT_ID,
      departed_at: null,
      email: 'second@bistro.example',
      full_name: 'Sam Learner',
    });

    const db = makeFakeDb(state);

    await passExam(db, ATTEMPT_1);
    await issueCertificateForPassedExam({
      db,
      restaurantId: RESTAURANT_ID,
      actorId: SECOND_LEARNER,
      attemptId: ATTEMPT_2,
      scorePercent: 88,
      learnerName: 'Sam Learner',
      restaurantName: 'The Test Bistro',
    });

    expect(state.certificates).toHaveLength(2);

    const eligibility = await checkEligibility({
      restaurantId: RESTAURANT_ID,
      supabaseServiceClient: db,
    });

    expect(eligibility.pendingCertCount).toBe(2);
    expect(CERT_FEE_CENTS * eligibility.pendingCertCount).toBe(7000);
  });
});
