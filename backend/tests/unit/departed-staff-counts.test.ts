/**
 * tests/unit/departed-staff-counts.test.ts
 *
 * T-46a — THE HEADLINE. The bug that was breaking something live.
 *
 * lib/admin/eligibility.ts condition 2 demands a certificate from every
 * learner-role profile at the restaurant. Before this task there was no
 * membership state on `profiles`, so a single employee who was hired, never
 * finished the course and quit blocked that restaurant from EVER submitting for
 * a directory listing. The only removal path in the product was
 * account_delete_user — GDPR erasure, which hard-deletes the certificates and
 * exam attempts the restaurant paid for. There was nothing else to reach for.
 *
 * The first describe block below is that exact situation, before and after.
 *
 * The second is the money. `pendingCertCount` is what /api/submissions/create
 * multiplies by CERT_FEE_CENTS ($35) to price the Checkout Session. A departed
 * learner's pending certificate must not appear in it — the restaurant is not
 * paying $35 to certify someone who has left.
 */

import { describe, it, expect } from 'vitest';
import { checkEligibility } from '@/lib/admin/eligibility';
import { CERT_FEE_CENTS } from '@/lib/billing/pricing';
import type { ServiceDb } from '@/lib/db/service';

const REST_ID = '22222222-2222-4222-8222-222222222222';
const STAYER = '33333333-3333-4333-8333-333333333333';
const QUITTER = '44444444-4444-4444-8444-444444444444';

const DEPARTED_AT = '2026-08-02T14:30:00.000Z';

// ─── Stub client ──────────────────────────────────────────────────────────────

interface ProfileRow {
  id: string;
  departed_at: string | null;
}

interface CertRow {
  profile_id: string;
  status: string;
  expires_at?: string;
  issued_at?: string;
}

/**
 * T-45a — see the identical note in tests/unit/eligibility-pending-certs.ts.
 * `expires_at` is NOT NULL (0001_init) and these `certs` fixtures model rows
 * the query returns AFTER `.gt('expires_at', now)`, so they have already passed
 * it. The shared billable predicate re-checks expiry in JS, so a row missing
 * the column is judged not-billable — defaulting it here is what keeps these
 * fixtures asserting what they say they assert. The T-46a membership assertions
 * are untouched: `departed_at` still comes from each fixture.
 */
const FIXTURE_EXPIRES_AT = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();
const FIXTURE_ISSUED_AT = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

/** What the profiles query actually asked for, so the filter can be asserted. */
interface CapturedProfileQuery {
  isFilters: Array<[string, unknown]>;
  eqFilters: Array<[string, unknown]>;
}

/**
 * Models the real database: the profiles query applies its filters for real,
 * while the certificates query does not filter on membership at all
 * (certificates have no departed_at — they belong to a person, not to a
 * membership). So every cert row comes back and it is checkEligibility's job to
 * drop the ones whose owner has left.
 */
function makeDb(fixture: { profiles: ProfileRow[]; certs: CertRow[] }): {
  db: ServiceDb;
  profileQuery: CapturedProfileQuery;
} {
  const profileQuery: CapturedProfileQuery = { isFilters: [], eqFilters: [] };

  const from = (table: string) => {
    let rows: unknown[];
    switch (table) {
      case 'profiles':
        rows = fixture.profiles;
        break;
      case 'certificates':
        rows = fixture.certs.map((c) => ({
          expires_at: FIXTURE_EXPIRES_AT,
          issued_at: FIXTURE_ISSUED_AT,
          ...c,
        }));
        break;
      case 'subscriptions':
        rows = [{ id: 'sub-1', ends_at: '2099-01-01', status: 'active' }];
        break;
      default:
        rows = [];
    }

    const chain: Record<string, unknown> = {};
    for (const method of ['select', 'in', 'gt', 'gte', 'limit']) {
      chain[method] = () => chain;
    }
    chain.eq = (column: string, value: unknown) => {
      if (table === 'profiles') profileQuery.eqFilters.push([column, value]);
      return chain;
    };
    chain.is = (column: string, value: unknown) => {
      if (table === 'profiles') {
        profileQuery.isFilters.push([column, value]);
        // Applied for real — that is the whole point of the test.
        rows = (rows as ProfileRow[]).filter((r) => r.departed_at === value);
      }
      return chain;
    };
    chain.then = (onF: (v: unknown) => unknown) =>
      Promise.resolve({ data: rows, error: null }).then(onF);
    return chain;
  };

  return { db: { from } as unknown as ServiceDb, profileQuery };
}

// ─── The headline ─────────────────────────────────────────────────────────────

describe('THE LIVE BUG: one employee who quit blocked the restaurant forever', () => {
  /** One certified employee who stayed; the other never passed and left. */
  const certs: CertRow[] = [{ profile_id: STAYER, status: 'active' }];

  it('BEFORE: the restaurant is ineligible, and nothing in the product can clear it', async () => {
    const { db } = makeDb({
      profiles: [
        { id: STAYER, departed_at: null },
        { id: QUITTER, departed_at: null },
      ],
      certs,
    });

    const result = await checkEligibility({ restaurantId: REST_ID, supabaseServiceClient: db });

    expect(result.eligible).toBe(false);
    expect(result.reasons).toHaveLength(1);
    expect(result.reasons[0]).toContain('1 of 2');
    expect(result.reasons[0]).toContain('passed the exam');
    expect(result.totalLearners).toBe(2);
  });

  it('AFTER: mark the quitter departed and the restaurant becomes eligible', async () => {
    const { db } = makeDb({
      profiles: [
        { id: STAYER, departed_at: null },
        { id: QUITTER, departed_at: DEPARTED_AT }, // the only change
      ],
      certs,
    });

    const result = await checkEligibility({ restaurantId: REST_ID, supabaseServiceClient: db });

    expect(result.reasons, 'nothing may block a restaurant whose current staff all passed').toEqual(
      []
    );
    expect(result.eligible).toBe(true);
    expect(result.totalLearners, 'the quitter is not staff any more').toBe(1);
    expect(result.certifiedCount).toBe(1);
  });

  it('asks the DATABASE for current staff — it does not filter after the fact', async () => {
    // The shape assertion. Fetching every profile and filtering in TypeScript
    // would give the same answer here and a different one at scale, and it
    // would mean a departed person's row was read at all.
    const { db, profileQuery } = makeDb({
      profiles: [{ id: STAYER, departed_at: null }],
      certs,
    });

    await checkEligibility({ restaurantId: REST_ID, supabaseServiceClient: db });

    expect(profileQuery.isFilters).toContainEqual(['departed_at', null]);
    expect(profileQuery.eqFilters).toContainEqual(['role', 'learner']);
    expect(profileQuery.eqFilters).toContainEqual(['restaurant_id', REST_ID]);
  });

  it('a restaurant whose ONLY learner departed is ineligible for the right reason', async () => {
    // Not "someone has not passed" — there is nobody. Condition 1, not 2.
    const { db } = makeDb({
      profiles: [{ id: QUITTER, departed_at: DEPARTED_AT }],
      certs: [],
    });

    const result = await checkEligibility({ restaurantId: REST_ID, supabaseServiceClient: db });

    expect(result.eligible).toBe(false);
    expect(result.totalLearners).toBe(0);
    expect(result.reasons.join(' ')).toContain('No learners have been added');
  });
});

// ─── The money ────────────────────────────────────────────────────────────────

describe('the $35 cert fee is not charged for a departed learner', () => {
  it("a departed learner's PENDING certificate is not in pendingCertCount", async () => {
    // Both passed the exam, so both hold a pending certificate awaiting the
    // fee. One has since left. The restaurant owes $35, not $70.
    const { db } = makeDb({
      profiles: [
        { id: STAYER, departed_at: null },
        { id: QUITTER, departed_at: DEPARTED_AT },
      ],
      certs: [
        { profile_id: STAYER, status: 'pending' },
        { profile_id: QUITTER, status: 'pending' },
      ],
    });

    const result = await checkEligibility({ restaurantId: REST_ID, supabaseServiceClient: db });

    expect(result.eligible).toBe(true);
    expect(result.pendingCertCount, 'only the employee who still works here').toBe(1);
    expect(CERT_FEE_CENTS * result.pendingCertCount).toBe(3500);
  });

  it('every pending certificate belonging to departed staff drops out', async () => {
    const { db } = makeDb({
      profiles: [
        { id: STAYER, departed_at: null },
        { id: QUITTER, departed_at: DEPARTED_AT },
      ],
      certs: [
        // A re-issue: one learner can hold more than one pending row, and the
        // webhook activates all of them, so all of them are priced — but only
        // while that learner is still staff.
        { profile_id: QUITTER, status: 'pending' },
        { profile_id: QUITTER, status: 'pending' },
        { profile_id: STAYER, status: 'active' }, // already paid for
      ],
    });

    const result = await checkEligibility({ restaurantId: REST_ID, supabaseServiceClient: db });

    expect(result.pendingCertCount, 'nothing left to charge for').toBe(0);
    expect(CERT_FEE_CENTS * result.pendingCertCount).toBe(0);
  });

  it('still charges for a current learner — the filter is not a blanket zero', async () => {
    const { db } = makeDb({
      profiles: [{ id: STAYER, departed_at: null }],
      certs: [{ profile_id: STAYER, status: 'pending' }],
    });

    const result = await checkEligibility({ restaurantId: REST_ID, supabaseServiceClient: db });

    expect(result.pendingCertCount).toBe(1);
    expect(CERT_FEE_CENTS * result.pendingCertCount).toBe(3500);
  });

  it('certifiedCount also excludes departed staff', async () => {
    const { db } = makeDb({
      profiles: [
        { id: STAYER, departed_at: null },
        { id: QUITTER, departed_at: DEPARTED_AT },
      ],
      certs: [
        { profile_id: STAYER, status: 'active' },
        { profile_id: QUITTER, status: 'active' },
      ],
    });

    const result = await checkEligibility({ restaurantId: REST_ID, supabaseServiceClient: db });

    expect(result.certifiedCount).toBe(1);
    expect(result.totalLearners).toBe(1);
  });
});
