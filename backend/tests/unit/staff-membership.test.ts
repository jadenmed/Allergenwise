/**
 * tests/unit/staff-membership.test.ts
 *
 * T-46a — the ONE definition of "current staff", and the guard that keeps it
 * one definition.
 *
 * The predicate itself is four lines and hard to get wrong. What is easy to get
 * wrong is the thing this task exists to prevent: eight call sites each growing
 * their own copy of `.is('departed_at', null)` until one of them is edited and
 * the others are not. That is the T-18 / T-23 defect class. So the second half
 * of this file reads the eight files off disk and asserts they still reach the
 * predicate through the shared module — a test that fails the moment someone
 * inlines the filter.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  DEPARTED_AT_COLUMN,
  LEARNER_ROLE,
  certifiedLearnerIdSet,
  countDistinctCertifiedLearners,
  currentLearnerIdSet,
  deriveStaffCounts,
  isCurrentLearner,
  isCurrentStaff,
  onlyCurrentStaff,
  type CertHolderRow,
  type StaffIdentityRow,
} from '@/lib/staff/membership';

const DEPARTED_AT = '2026-08-02T14:30:00.000Z';

// ─── The predicate ────────────────────────────────────────────────────────────

describe('isCurrentStaff', () => {
  it('null means current staff', () => {
    expect(isCurrentStaff({ departed_at: null })).toBe(true);
  });

  it('any timestamp means departed', () => {
    expect(isCurrentStaff({ departed_at: DEPARTED_AT })).toBe(false);
  });

  it('the epoch is still a departure — it is not falsy-checked', () => {
    // A `!row.departed_at` implementation would call this person current.
    expect(isCurrentStaff({ departed_at: '1970-01-01T00:00:00.000Z' })).toBe(false);
  });

  it('an empty string is a departure too, for the same reason', () => {
    expect(isCurrentStaff({ departed_at: '' })).toBe(false);
  });

  it('a row missing the column is NOT treated as current', () => {
    // The fail-closed half of the TRAP documented in lib/staff/membership.ts:
    // if a query forgot to select departed_at, the count collapses toward zero
    // rather than silently counting people who have left.
    expect(isCurrentStaff({} as { departed_at: string | null })).toBe(false);
  });
});

describe('isCurrentLearner', () => {
  it('is true only for a current learner', () => {
    expect(isCurrentLearner({ role: LEARNER_ROLE, departed_at: null })).toBe(true);
  });

  it('excludes a departed learner — the public denominator case', () => {
    expect(isCurrentLearner({ role: LEARNER_ROLE, departed_at: DEPARTED_AT })).toBe(false);
  });

  it('excludes a manager, departed or not', () => {
    expect(isCurrentLearner({ role: 'manager', departed_at: null })).toBe(false);
    expect(isCurrentLearner({ role: 'manager', departed_at: DEPARTED_AT })).toBe(false);
  });
});

// ─── The query filter ─────────────────────────────────────────────────────────

describe('onlyCurrentStaff', () => {
  it("applies .is('departed_at', null) and returns the builder", () => {
    const calls: Array<[string, unknown]> = [];
    const builder = {
      is(column: string, value: unknown) {
        calls.push([column, value]);
        return this;
      },
    };

    const returned = onlyCurrentStaff(builder);

    expect(calls).toEqual([['departed_at', null]]);
    expect(returned).toBe(builder);
  });

  it('uses IS NULL, never = NULL', () => {
    // `.eq('departed_at', null)` compiles to `departed_at=eq.null`, which is
    // `= NULL` in SQL — never true, so the roster would come back empty.
    const calls: string[] = [];
    const builder = {
      is(column: string, value: unknown) {
        calls.push(`is:${column}=${String(value)}`);
        return this;
      },
      eq(column: string, value: unknown) {
        calls.push(`eq:${column}=${String(value)}`);
        return this;
      },
    };

    onlyCurrentStaff(builder);

    expect(calls).toEqual(['is:departed_at=null']);
  });
});

// ─── The numerator (T-23) ─────────────────────────────────────────────────────

const ALICE = 'aaaaaaaa-1111-4111-8111-111111111111';
const BOB = 'bbbbbbbb-2222-4222-8222-222222222222';
const CAROL = 'cccccccc-3333-4333-8333-333333333333';

const current = (id: string) => ({ id, role: LEARNER_ROLE, departed_at: null });
const departed = (id: string) => ({ id, role: LEARNER_ROLE, departed_at: DEPARTED_AT });
const active = (profile_id: string) => ({ profile_id, status: 'active' });

describe('currentLearnerIdSet', () => {
  it('is the denominator: the ids of current learners', () => {
    const ids = currentLearnerIdSet([current(ALICE), current(BOB)]);
    expect([...ids].sort()).toEqual([ALICE, BOB].sort());
    expect(ids.size).toBe(2);
  });

  it('drops departed learners and managers', () => {
    const ids = currentLearnerIdSet([
      current(ALICE),
      departed(BOB),
      { id: CAROL, role: 'manager', departed_at: null },
    ]);
    expect([...ids]).toEqual([ALICE]);
  });

  it('drops a row whose departed_at was never selected', () => {
    // Fail-closed, same as isCurrentStaff: undefined is not null.
    const ids = currentLearnerIdSet([
      { id: ALICE, role: LEARNER_ROLE } as unknown as ReturnType<typeof current>,
    ]);
    expect(ids.size).toBe(0);
  });

  it('is empty for no rows', () => {
    expect(currentLearnerIdSet([]).size).toBe(0);
  });
});

describe('countDistinctCertifiedLearners', () => {
  it('THE HEADLINE — one learner with two active certificates counts once', () => {
    const learners = currentLearnerIdSet([current(ALICE)]);
    expect(countDistinctCertifiedLearners([active(ALICE), active(ALICE)], learners)).toBe(1);
  });

  it('two learners with two certificates each is 2, not 4', () => {
    const learners = currentLearnerIdSet([current(ALICE), current(BOB)]);
    const certs = [active(ALICE), active(ALICE), active(BOB), active(BOB)];
    expect(countDistinctCertifiedLearners(certs, learners)).toBe(2);
  });

  it('counts the active one when a learner holds a mix of states', () => {
    const learners = currentLearnerIdSet([current(ALICE)]);
    const certs = [
      { profile_id: ALICE, status: 'expired' },
      { profile_id: ALICE, status: 'active' },
      { profile_id: ALICE, status: 'revoked' },
    ];
    expect(countDistinctCertifiedLearners(certs, learners)).toBe(1);
  });

  it('counts nobody when no certificate is publicly active', () => {
    const learners = currentLearnerIdSet([current(ALICE), current(BOB)]);
    const certs = [
      { profile_id: ALICE, status: 'pending' },
      { profile_id: ALICE, status: 'expired' },
      { profile_id: BOB, status: 'revoked' },
      { profile_id: BOB, status: 'disputed' },
    ];
    expect(countDistinctCertifiedLearners(certs, learners)).toBe(0);
  });

  it('a disputed certificate does not count — publicly it reads as revoked', () => {
    const learners = currentLearnerIdSet([current(ALICE)]);
    expect(countDistinctCertifiedLearners([{ profile_id: ALICE, status: 'disputed' }], learners)) //
      .toBe(0);
  });

  it('an unrecognised or absent status is not publicly active', () => {
    const learners = currentLearnerIdSet([current(ALICE)]);
    expect(countDistinctCertifiedLearners([{ profile_id: ALICE, status: 'ACTIVE' }], learners)) //
      .toBe(0);
    expect(countDistinctCertifiedLearners([{ profile_id: ALICE, status: null }], learners)).toBe(0);
  });

  it("excludes a departed learner's still-valid certificate", () => {
    // Certificates carry no membership of their own and are deliberately left
    // untouched on departure (0026). Without this intersection the numerator
    // keeps counting someone the denominator has already dropped — a route past
    // 100% that needs no duplicate certificates at all.
    const learners = currentLearnerIdSet([current(ALICE), departed(BOB)]);
    expect(learners.size, 'denominator').toBe(1);
    expect(countDistinctCertifiedLearners([active(ALICE), active(BOB)], learners)).toBe(1);
  });

  it("excludes a certificate held by someone who is not this restaurant's staff", () => {
    const learners = currentLearnerIdSet([current(ALICE)]);
    expect(countDistinctCertifiedLearners([active(CAROL)], learners)).toBe(0);
  });

  it('is 0 for no certificates and 0 for no learners', () => {
    expect(countDistinctCertifiedLearners([], currentLearnerIdSet([current(ALICE)]))).toBe(0);
    expect(countDistinctCertifiedLearners([active(ALICE)], currentLearnerIdSet([]))).toBe(0);
  });

  it('NEVER exceeds the denominator — the property that makes the clamp dead', () => {
    // deriveCertStat clamps to [0,100]. That clamp is only unreachable if this
    // holds for every input, so assert the invariant itself rather than one
    // example of it: the result is the size of a subset of currentLearnerIds.
    const roster = [current(ALICE), current(BOB), departed(CAROL)];
    const learners = currentLearnerIdSet(roster);

    const pathological = [
      active(ALICE),
      active(ALICE),
      active(ALICE),
      active(BOB),
      active(BOB),
      active(CAROL),
      active(CAROL),
      active('dddddddd-4444-4444-8444-444444444444'),
    ];

    const certified = countDistinctCertifiedLearners(pathological, learners);
    expect(certified).toBe(2);
    expect(certified).toBeLessThanOrEqual(learners.size);
    expect(Math.round((certified / learners.size) * 100)).toBeLessThanOrEqual(100);
  });
});

describe('certifiedLearnerIdSet', () => {
  it('returns WHO is certified, not just how many', () => {
    // /api/admin/dashboard-stats needs the membership itself to derive
    // "in progress" = accepted the invite AND not in this set.
    const learners = currentLearnerIdSet([current(ALICE), current(BOB)]);
    const set = certifiedLearnerIdSet([active(ALICE), active(ALICE)], learners);

    expect([...set]).toEqual([ALICE]);
    expect(set.has(BOB)).toBe(false);
  });

  it('agrees with countDistinctCertifiedLearners by construction', () => {
    const learners = currentLearnerIdSet([current(ALICE), current(BOB)]);
    const certs = [active(ALICE), active(BOB), active(BOB)];

    expect(certifiedLearnerIdSet(certs, learners).size).toBe(
      countDistinctCertifiedLearners(certs, learners)
    );
  });

  it('is always a subset of the current learners', () => {
    const learners = currentLearnerIdSet([current(ALICE)]);
    const set = certifiedLearnerIdSet([active(ALICE), active(BOB), active(CAROL)], learners);

    for (const id of set) {
      expect(learners.has(id)).toBe(true);
    }
  });
});

// ─── One definition, eight call sites ─────────────────────────────────────────

/**
 * The eight places that count or list learner profiles. Every one must reach
 * the predicate through lib/staff/membership.ts.
 */
const CALL_SITES = [
  'lib/admin/eligibility.ts',
  'app/api/admin/roster/route.ts',
  'app/api/admin/dashboard-stats/route.ts',
  'app/api/directory/[slug]/route.ts',
  'app/api/search/route.ts',
  'app/api/reviewer/queue/[submissionId]/route.ts',
  'app/api/cron/weekly-admin-digest/route.ts',
  'lib/reviewer/auto-checks.ts',
] as const;

function source(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), relativePath), 'utf8');
}

/**
 * `source` with JSDoc blocks and whole-line `//` comments removed.
 *
 * The "does not hand-roll it" assertions below search for the shapes the defect
 * wore, and those shapes are quoted verbatim in the comments that explain why
 * they were removed. Matching prose would make documenting a fix fail the test
 * for it. Trailing comments are left alone so `https://` in a string survives.
 */
function code(relativePath: string): string {
  return source(relativePath)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '');
}

describe('the membership filter is defined once', () => {
  it.each(CALL_SITES)('%s imports the shared helper', (file) => {
    expect(source(file)).toContain("from '@/lib/staff/membership'");
  });

  it.each(CALL_SITES)('%s does not hand-roll the column name', (file) => {
    // A literal 'departed_at' at a call site is a second definition, and a
    // second definition is what drifts. Only lib/staff/membership.ts and the
    // template-literal join in /api/search (which interpolates the exported
    // constant) are allowed to mention the column.
    const text = source(file).replace('${DEPARTED_AT_COLUMN}', '');
    expect(text).not.toContain("'departed_at'");
    expect(text).not.toContain('"departed_at"');
  });
});

/**
 * T-23 — the four sites that publish a certification NUMERATOR. Three are
 * TypeScript and must reach the count through this module; the fourth is raw
 * SQL and is asserted separately below because it cannot import anything.
 */
const NUMERATOR_SITES = [
  'app/api/directory/[slug]/route.ts',
  'app/api/search/route.ts',
  'app/api/admin/dashboard-stats/route.ts',
] as const;

describe('the numerator is defined once', () => {
  it.each(NUMERATOR_SITES)('%s counts through the shared helper', (file) => {
    const text = source(file);
    // T-45a added `deriveStaffCounts`, which returns the certified count and the
    // in-training count together. It is NOT a fourth definition: it is defined
    // in lib/staff/membership.ts in terms of certifiedLearnerIdSet, which the
    // next test pins. Accepting it here keeps this guard meaning "reaches the
    // count through the shared module" rather than "names one specific export".
    expect(text).toMatch(/countDistinctCertifiedLearners|certifiedLearnerIdSet|deriveStaffCounts/);
  });

  it('deriveStaffCounts is itself built from the shared numerator', () => {
    // The hop the test above now permits. If someone reimplements the certified
    // count inside deriveStaffCounts, the numerator has two definitions again
    // and every site that goes through it inherits the drift silently.
    const text = code('lib/staff/membership.ts');
    const body = text.slice(text.indexOf('export function deriveStaffCounts'));

    expect(body).toContain('certifiedLearnerIdSet(');
    expect(body).toContain('currentLearnerIdSet(');
  });

  it('in-training is the complement of certified, not a second count', () => {
    // The property the display depends on: certified + inTraining === total.
    // Asserted on real inputs rather than trusted from the implementation, per
    // the T-45a instruction to assert the identity rather than assume it.
    const learners: StaffIdentityRow[] = [
      { id: 'a', role: 'learner', departed_at: null },
      { id: 'b', role: 'learner', departed_at: null },
      { id: 'c', role: 'learner', departed_at: null },
      { id: 'gone', role: 'learner', departed_at: '2026-01-01T00:00:00.000Z' },
      { id: 'boss', role: 'manager', departed_at: null },
    ];
    const certs: CertHolderRow[] = [
      { profile_id: 'a', status: 'active' },
      { profile_id: 'a', status: 'active' }, // duplicate: still one person
      { profile_id: 'b', status: 'pending' }, // passed, unpaid — in training
      { profile_id: 'gone', status: 'active' }, // departed: counts nowhere
    ];

    const counts = deriveStaffCounts(learners, certs);

    expect(counts.total).toBe(3);
    expect(counts.certified).toBe(1);
    expect(counts.inTraining).toBe(2);
    expect(counts.certified + counts.inTraining).toBe(counts.total);
  });

  it.each(NUMERATOR_SITES)('%s does not count certificate rows by hand', (file) => {
    // The three shapes the defect wore: `.length` on a certificate array, a
    // `.filter()` on cert status counted by length, and an inline status
    // compare. Comments are stripped first — each of these is quoted in the
    // comment that explains its removal.
    const text = code(file);
    expect(text).not.toMatch(/certRows\s*\?\?\s*\[\]\s*\)\s*\.length/);
    expect(text).not.toMatch(/certs\.filter\([^)]*\)\.length/);
    expect(text).not.toMatch(/status\s*===\s*'active'/);
  });

  it('the SQL site counts holders, not certificates', () => {
    // lib/directory/search.ts cannot import the helper, so its equivalence is
    // pinned by text here and by behaviour in
    // tests/integration/search-count-parity.test.ts.
    const sql = source('lib/directory/search.ts');

    expect(sql).toContain("COUNT(DISTINCT ch.id) FILTER (WHERE c.status = 'active')");
    expect(sql, 'counting distinct CERTIFICATES is the defect').not.toContain(
      'COUNT(DISTINCT c.id)'
    );
    // The holder join carries the same membership predicate as the TS path.
    expect(sql).toContain('ch.id = c.profile_id');
    expect(sql).toContain('ch.restaurant_id = r.id');
    expect(sql).toContain("ch.role = 'learner'");
    expect(sql).toContain('ch.departed_at IS NULL');
    // And the denominator filters departed staff, which it did not before.
    expect(sql).toContain("p.role = 'learner' AND p.departed_at IS NULL");
  });
});

describe('the search join selects the column it filters on', () => {
  it('builds the profiles join from DEPARTED_AT_COLUMN', () => {
    // /api/search is the one site that filters in TypeScript rather than SQL,
    // so its rows arrive already fetched. If `departed_at` is not in the join's
    // select list the property is undefined, isCurrentStaff returns false, and
    // the PUBLIC denominator collapses toward zero. No query error is raised —
    // this assertion is the only thing that would catch it.
    const text = source('app/api/search/route.ts');
    expect(text).toContain('profiles!left(id, role, ${DEPARTED_AT_COLUMN})');
    expect(DEPARTED_AT_COLUMN).toBe('departed_at');
  });
});
