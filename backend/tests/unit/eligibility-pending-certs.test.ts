/**
 * tests/unit/eligibility-pending-certs.test.ts
 *
 * T-41b / T-05 — the deadlock, and its removal.
 *
 * The bug this file exists to keep dead: `checkEligibility` demanded
 * `certificates.status = 'active'`, and the ONLY code that sets a certificate
 * active was the cert-fee webhook, which fired after a charge that
 * /api/submissions/create only made once eligibility had already passed.
 * Certificates waited on a payment that waited on the certificates. No
 * restaurant could ever submit.
 *
 * What is asserted here:
 *   1. A restaurant whose learners hold only PENDING certificates is eligible.
 *      That is the deadlock, gone.
 *   2. `pendingCertCount` counts pending certificate ROWS — it is what the
 *      Checkout Session is priced from, so a resubmission cannot re-charge
 *      staff who are already `active`.
 *   3. A learner with no qualifying certificate still blocks.
 *   4. The certificates query filters on exactly ['pending','active'] — the
 *      shape assertion, so a future edit that drops back to
 *      .eq('status','active') fails here rather than silently reinstating the
 *      deadlock, and one that drops the filter entirely (letting revoked staff
 *      count) fails too.
 */

import { describe, it, expect } from 'vitest';
import { checkEligibility } from '@/lib/admin/eligibility';
import type { ServiceDb } from '@/lib/db/service';

const REST_ID = '22222222-2222-4222-8222-222222222222';
const LEARNER_A = '33333333-3333-4333-8333-333333333333';
const LEARNER_B = '44444444-4444-4444-8444-444444444444';

// ─── Stub client ──────────────────────────────────────────────────────────────

interface CertRow {
  profile_id: string;
  status: string;
  expires_at?: string;
  issued_at?: string;
}

/**
 * T-45a — `certificates.expires_at` is NOT NULL (0001_init) and `issued_at`
 * defaults to now(). The `certs` fixtures below model rows the query returns
 * AFTER its own filters, so every one of them has by definition already passed
 * `.gt('expires_at', now)`.
 *
 * They omit the columns, and the shared billable predicate in
 * lib/billing/cert-balance.ts re-checks expiry in JS — the house pattern of
 * filtering in SQL and DECIDING in JS so the predicate has one definition
 * rather than a SQL copy and a TS copy that drift (see
 * lib/learner/issuance-guard.ts). A row with no `expires_at` is judged
 * not-billable, which would make these fixtures assert the wrong thing.
 *
 * Defaulted in one place rather than at every literal. A test that wants an
 * EXPIRED certificate still sets `expires_at` explicitly and overrides this.
 */
const FIXTURE_EXPIRES_AT = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();
const FIXTURE_ISSUED_AT = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

interface DbFixture {
  learners: Array<{ id: string }>;
  /** Rows the certificates query would return AFTER its own filters. */
  certs: CertRow[];
  hasActiveSubscription?: boolean;
  openSubmissionStatus?: string | null;
}

/** What the certificates query actually asked for, so the filter can be asserted. */
interface CapturedCertQuery {
  statuses: string[] | null;
  eqStatus: string | null;
  gtExpiresAt: boolean;
}

function makeDb(fixture: DbFixture): { db: ServiceDb; certQuery: CapturedCertQuery } {
  const certQuery: CapturedCertQuery = { statuses: null, eqStatus: null, gtExpiresAt: false };

  const from = (table: string) => {
    // Every builder below is a thenable resolving to {data,error}, which is
    // what lib/admin/eligibility.ts awaits via Promise.all.
    const resolveWith = (data: unknown) => {
      const chain: Record<string, unknown> = {};
      // `is` carries the T-46a membership filter (.is('departed_at', null)).
      const passthrough = ['select', 'eq', 'in', 'gt', 'gte', 'limit', 'is'];
      for (const m of passthrough) {
        chain[m] = (...args: unknown[]) => {
          if (table === 'certificates') {
            if (m === 'in' && args[0] === 'status') certQuery.statuses = args[1] as string[];
            if (m === 'eq' && args[0] === 'status') certQuery.eqStatus = args[1] as string;
            if (m === 'gt' && args[0] === 'expires_at') certQuery.gtExpiresAt = true;
          }
          return chain;
        };
      }
      chain.then = (onF: (v: unknown) => unknown) =>
        Promise.resolve({ data, error: null }).then(onF);
      return chain;
    };

    switch (table) {
      case 'profiles':
        return resolveWith(fixture.learners);
      case 'certificates':
        return resolveWith(
          fixture.certs.map((c) => ({
            expires_at: FIXTURE_EXPIRES_AT,
            issued_at: FIXTURE_ISSUED_AT,
            ...c,
          }))
        );
      case 'subscriptions':
        return resolveWith(
          fixture.hasActiveSubscription === false ? [] : [{ id: 'sub-1', ends_at: '2099-01-01' }]
        );
      case 'submissions':
        return resolveWith(
          fixture.openSubmissionStatus
            ? [{ id: 'sub-open', status: fixture.openSubmissionStatus }]
            : []
        );
      default:
        return resolveWith([]);
    }
  };

  return { db: { from } as unknown as ServiceDb, certQuery };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('checkEligibility — condition 2 counts a passed exam, not a paid fee', () => {
  it('THE DEADLOCK: every learner holding only a PENDING certificate is eligible', async () => {
    const { db } = makeDb({
      learners: [{ id: LEARNER_A }, { id: LEARNER_B }],
      certs: [
        { profile_id: LEARNER_A, status: 'pending' },
        { profile_id: LEARNER_B, status: 'pending' },
      ],
    });

    const result = await checkEligibility({ restaurantId: REST_ID, supabaseServiceClient: db });

    expect(result.reasons, 'no reason may block a fully-passed restaurant').toEqual([]);
    expect(result.eligible).toBe(true);
    expect(result.certifiedCount).toBe(2);
    expect(result.totalLearners).toBe(2);
  });

  it('prices from PENDING rows only, so active staff are not re-charged', async () => {
    const { db } = makeDb({
      learners: [{ id: LEARNER_A }, { id: LEARNER_B }],
      certs: [
        { profile_id: LEARNER_A, status: 'active' }, // paid last time round
        { profile_id: LEARNER_B, status: 'pending' }, // the only new one
      ],
    });

    const result = await checkEligibility({ restaurantId: REST_ID, supabaseServiceClient: db });

    expect(result.eligible).toBe(true);
    expect(result.certifiedCount, 'both have passed').toBe(2);
    expect(result.pendingCertCount, 'only the new hire is billable').toBe(1);
  });

  it('a resubmission with everyone already active owes nothing', async () => {
    const { db } = makeDb({
      learners: [{ id: LEARNER_A }, { id: LEARNER_B }],
      certs: [
        { profile_id: LEARNER_A, status: 'active' },
        { profile_id: LEARNER_B, status: 'active' },
      ],
    });

    const result = await checkEligibility({ restaurantId: REST_ID, supabaseServiceClient: db });

    expect(result.eligible).toBe(true);
    expect(result.pendingCertCount).toBe(0);
  });

  it('counts pending certificate ROWS, not learners', async () => {
    // One learner can hold more than one pending row (a re-issue). The webhook
    // activates all of them, so the price must cover all of them.
    const { db } = makeDb({
      learners: [{ id: LEARNER_A }],
      certs: [
        { profile_id: LEARNER_A, status: 'pending' },
        { profile_id: LEARNER_A, status: 'pending' },
      ],
    });

    const result = await checkEligibility({ restaurantId: REST_ID, supabaseServiceClient: db });

    expect(result.certifiedCount, 'one learner').toBe(1);
    expect(result.pendingCertCount, 'two certificates to activate').toBe(2);
  });

  it('a learner with no qualifying certificate still blocks, naming the exam', async () => {
    // The query already excludes revoked/expired/disputed, so such a learner
    // simply has no row — which is exactly how it must read here.
    const { db } = makeDb({
      learners: [{ id: LEARNER_A }, { id: LEARNER_B }],
      certs: [{ profile_id: LEARNER_A, status: 'pending' }],
    });

    const result = await checkEligibility({ restaurantId: REST_ID, supabaseServiceClient: db });

    expect(result.eligible).toBe(false);
    expect(result.reasons).toHaveLength(1);
    expect(result.reasons[0]).toContain('1 of 2');
    expect(result.reasons[0]).toContain('passed the exam');
    expect(result.certifiedCount).toBe(1);
    expect(result.pendingCertCount).toBe(1);
  });

  it('asks the database for pending OR active — and nothing wider', async () => {
    // The shape assertion. A revert to .eq('status','active') reinstates the
    // deadlock silently; dropping the filter entirely would let revoked staff
    // count toward a listing. Both fail here.
    const { db, certQuery } = makeDb({
      learners: [{ id: LEARNER_A }],
      certs: [{ profile_id: LEARNER_A, status: 'pending' }],
    });

    await checkEligibility({ restaurantId: REST_ID, supabaseServiceClient: db });

    expect(certQuery.statuses).toEqual(['pending', 'active']);
    expect(certQuery.eqStatus, 'must NOT narrow to a single status').toBeNull();
    expect(certQuery.gtExpiresAt, 'expired certificates must still be excluded').toBe(true);
  });

  it('still requires an active subscription', async () => {
    const { db } = makeDb({
      learners: [{ id: LEARNER_A }],
      certs: [{ profile_id: LEARNER_A, status: 'pending' }],
      hasActiveSubscription: false,
    });

    const result = await checkEligibility({ restaurantId: REST_ID, supabaseServiceClient: db });

    expect(result.eligible).toBe(false);
    expect(result.reasons.join(' ')).toContain('subscription');
  });

  it('still refuses a second submission while one is open', async () => {
    const { db } = makeDb({
      learners: [{ id: LEARNER_A }],
      certs: [{ profile_id: LEARNER_A, status: 'pending' }],
      openSubmissionStatus: 'in_review',
    });

    const result = await checkEligibility({ restaurantId: REST_ID, supabaseServiceClient: db });

    expect(result.eligible).toBe(false);
    expect(result.reasons.join(' ')).toContain('in review');
  });

  it('still requires at least one learner', async () => {
    const { db } = makeDb({ learners: [], certs: [] });

    const result = await checkEligibility({ restaurantId: REST_ID, supabaseServiceClient: db });

    expect(result.eligible).toBe(false);
    expect(result.totalLearners).toBe(0);
    expect(result.pendingCertCount).toBe(0);
  });
});
