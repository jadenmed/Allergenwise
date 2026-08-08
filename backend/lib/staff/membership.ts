/**
 * lib/staff/membership.ts
 *
 * THE single definition of "current staff at a restaurant".
 *
 * Membership is `profiles.departed_at is null` and nothing else. There is no
 * status column, no active flag, and `restaurant_id` deliberately stays
 * populated after someone leaves (certificates.restaurant_id references it, and
 * "certified while at X" is a fact worth keeping). See
 * db/migrations/0026_profiles_departed_at.sql.
 *
 * WHY THIS MODULE EXISTS AT ALL
 * ─────────────────────────────
 * Eight places in the app count or list learner profiles, and every one of them
 * must exclude departed staff:
 *
 *   lib/admin/eligibility.ts                       — blocks the directory submission
 *   app/api/admin/roster/route.ts                  — the manager's roster
 *   app/api/admin/dashboard-stats/route.ts         — the manager's dashboard
 *   app/api/directory/[slug]/route.ts              — PUBLIC denominator
 *   app/api/search/route.ts                        — PUBLIC denominator (filtered in TS)
 *   app/api/reviewer/queue/[submissionId]/route.ts — what the reviewer approves
 *   app/api/cron/weekly-admin-digest/route.ts      — the weekly email
 *   lib/reviewer/auto-checks.ts                    — the automated approval checks
 *
 * Writing `.is('departed_at', null)` inline in eight files is how eight files
 * drift apart — the T-18 / T-23 defect class. One import, one predicate, one
 * place to change it.
 *
 * TRAP: `departed_at` MUST be in the SELECT list
 * ─────────────────────────────────────────────
 * `isCurrentStaff` judges rows already in memory (the joined-rows case in
 * /api/search). If a query forgets to select `departed_at` the property is
 * `undefined`, not `null`, and the row is treated as NOT current — the count
 * collapses toward zero rather than silently counting departed staff. That is
 * the safer of the two failure modes but it is still wrong, so select strings
 * are built from DEPARTED_AT_COLUMN below and asserted by
 * tests/unit/staff-membership.test.ts rather than hand-typed.
 */

import { isPubliclyActiveCert } from '@/lib/learner/cert-state';

/** The one column name. Build select strings from this, never from a literal. */
export const DEPARTED_AT_COLUMN = 'departed_at' as const;

/** The minimum a row needs before `isCurrentStaff` can judge it. */
export interface StaffMembershipRow {
  departed_at: string | null;
}

/** A row that also carries the role, for the learner-scoped counts. */
export interface StaffRoleRow extends StaffMembershipRow {
  role: string;
}

/** The role every one of the eight call sites counts. */
export const LEARNER_ROLE = 'learner' as const;

/**
 * Restricts a PostgREST query to current staff.
 *
 * Chain it exactly where the `.eq('role', 'learner')` already sits:
 *
 *   onlyCurrentStaff(
 *     db.from('profiles').select('id').eq('restaurant_id', id).eq('role', 'learner')
 *   )
 *
 * Returns the builder so it composes in either direction.
 */
export function onlyCurrentStaff<T>(query: T): T {
  // The builder is `any` at every call site (lib/db/service.ts types `from()`
  // as any to work around PostgREST v12 inference); the cast keeps this helper
  // usable from the typed client too.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (query as any).is(DEPARTED_AT_COLUMN, null) as T;
}

/**
 * In-memory form of the same predicate, for rows that arrived through a join
 * and are filtered in TypeScript rather than SQL (/api/search).
 *
 * Strict `=== null`: a row whose `departed_at` was never selected is NOT
 * treated as current. See the TRAP note above.
 */
export function isCurrentStaff(row: StaffMembershipRow): boolean {
  return row.departed_at === null;
}

/** `isCurrentStaff` plus the learner-role check the public denominators apply. */
export function isCurrentLearner(row: StaffRoleRow): boolean {
  return row.role === LEARNER_ROLE && isCurrentStaff(row);
}

// ─── The NUMERATOR (T-23) ─────────────────────────────────────────────────────
//
// Everything above defines the denominator: who counts as staff. This half
// defines the numerator that sits over it, and it lives here for one reason —
// the two must be counted in the same unit or the ratio is meaningless.
//
// THE BUG THIS CLOSES
//   Every public and admin surface displayed "certified / total staff", where
//   the numerator counted certificate ROWS and the denominator counted distinct
//   learner PROFILES. Nothing in the schema stops one learner holding two
//   certificates — 0001_init.sql uniques cert_code, not (profile_id, status) —
//   and the exam machinery minted them: checkCooldown (lib/learner/exam.ts)
//   applies its 24h wait only after a FAILED attempt, so a learner who passed
//   could immediately sit the exam again, and issueCertificateForPassedExam
//   inserted unconditionally on every pass. Two learners with two certificates
//   each rendered 200%.
//
//   T-49 has since closed that source: a learner holding a pending or unexpired
//   active certificate is refused a second one, at /api/exam/start, at
//   /api/exam/submit, and inside issueCertificateForPassedExam itself. The
//   SCHEMA is unchanged — still no unique index, deliberately, because one
//   would break the cert-fee webhook's single-statement activation UPDATE (see
//   supabase/migrations/0027_duplicate_cert_preflight.sql). So duplicates remain
//   possible in principle, historical ones survive until resolved by hand, and
//   everything below stays exactly as load-bearing as it was. Counting people
//   rather than rows is not made redundant by T-49: it is what kept the figure
//   honest while the source was broken, and it is what closes the SECOND route
//   past 100% — a departed learner's still-valid certificate counting against a
//   denominator that has already dropped them, which needs no duplicates at all.
//
//   deriveCertStat clamps to [0,100], which kept the ARIA contract valid and
//   hid the defect: the same restaurant then read "100% certified" when only
//   one of the two learners might be certified at all. The clamp stays as a
//   guard. These helpers are what make it unreachable.
//
// THE UNIT IS A PERSON
//   `countDistinctCertifiedLearners` answers "how many CURRENT LEARNERS hold at
//   least one publicly-active certificate". Not how many certificates exist.
//   Ten certificates held by one learner are one certified learner.
//
// Used by /api/directory/[slug], /api/admin/dashboard-stats and /api/search.
// The fourth site, lib/directory/search.ts, is raw SQL and cannot call these —
// it expresses the identical thing as COUNT(DISTINCT <holder>.id) FILTER
// (WHERE c.status = 'active') over a join carrying this same membership
// predicate. tests/integration/search-count-parity.test.ts pins the two paths
// to the same number against a real database.

/** A staff row that can also be identified — what the id-set builder needs. */
export interface StaffIdentityRow extends StaffRoleRow {
  id: string;
}

/** A certificate row reduced to what deciding "who is certified" requires. */
export interface CertHolderRow {
  profile_id: string;
  /**
   * REQUIRED even when the query already filtered `.eq('status','active')`.
   * Selecting it costs nothing and means the predicate is applied by the module
   * that owns it rather than trusted from a filter written at the call site —
   * the same reason `departed_at` is re-checked in memory in /api/search.
   */
  status: string | null;
}

/**
 * The set of profile ids that are current learners, from rows already in memory.
 *
 * Returns ids rather than a count because the numerator has to be intersected
 * against exactly this set: a certificate counts only if a CURRENT learner
 * holds it. `.size` is the denominator, so both numbers come from one predicate
 * applied once.
 *
 * TRAP (inherited from `isCurrentStaff`): `departed_at` and `role` must both be
 * in the SELECT list. A row missing either is judged NOT a current learner, so
 * the count collapses toward zero rather than silently including departed
 * staff. Build select strings from DEPARTED_AT_COLUMN and LEARNER_ROLE.
 */
export function currentLearnerIdSet(rows: ReadonlyArray<StaffIdentityRow>): Set<string> {
  const ids = new Set<string>();
  for (const row of rows) {
    if (isCurrentLearner(row)) ids.add(row.id);
  }
  return ids;
}

/**
 * WHICH current learners hold at least one publicly-active certificate.
 *
 * Two filters, both load-bearing:
 *   1. The certificate must be publicly active (isPubliclyActiveCert — the one
 *      definition, in lib/learner/cert-state.ts).
 *   2. Its holder must be in `currentLearnerIds`. This is what stops a departed
 *      learner's still-valid certificate — which nothing revokes on departure,
 *      by design (0026) — from counting in a numerator whose denominator has
 *      already dropped them. That mismatch is a second, independent route past
 *      100% and it needs no duplicate certificates to happen.
 *
 * The returned set is a SUBSET of `currentLearnerIds`, which is the property
 * that makes the clamp in deriveCertStat unreachable. The set — not just its
 * size — is returned because /api/admin/dashboard-stats needs the membership
 * itself to compute "in progress" (accepted the invite, not yet certified).
 */
export function certifiedLearnerIdSet(
  certs: ReadonlyArray<CertHolderRow>,
  currentLearnerIds: ReadonlySet<string>
): Set<string> {
  const certified = new Set<string>();
  for (const cert of certs) {
    if (!isPubliclyActiveCert(cert.status)) continue;
    if (!currentLearnerIds.has(cert.profile_id)) continue;
    certified.add(cert.profile_id);
  }
  return certified;
}

/**
 * How many distinct current learners hold at least one publicly-active
 * certificate — the public numerator. Ten certificates held by one learner
 * are 1.
 */
export function countDistinctCertifiedLearners(
  certs: ReadonlyArray<CertHolderRow>,
  currentLearnerIds: ReadonlySet<string>
): number {
  return certifiedLearnerIdSet(certs, currentLearnerIds).size;
}

// ─── The PARTITION (T-45a) ────────────────────────────────────────────────────
//
// "10 of 13 staff certified · 3 new team members in training".
//
// The third number lives here, with the other two, for the reason the numerator
// does: it must come from the SAME predicate or the three disagree. It is not a
// new definition — it is the complement of the certified set within the very
// current-learner set the denominator counts, which is why the sum identity
// below is structural rather than arithmetic.

export interface StaffCounts {
  /** Current learner-role staff. The denominator. */
  total: number;
  /** Distinct current learners holding a publicly-active certificate. */
  certified: number;
  /**
   * Current learners not yet certified.
   *
   * Includes a learner who has not passed the exam AND a learner who has passed
   * but whose certificate is still `pending` payment — both are honestly
   * not-yet-certified, and the pending case is exactly the unpaid new hire that
   * T-45a exists to surface.
   *
   * It is NEVER frozen while a restaurant is inside its top-up grace period. A
   * grace period governs consequences — when the fee is charged, whether the
   * listing is pulled — and never a displayed number. Freezing it would be the
   * T-18 defect: a page claiming a fully-certified roster while untrained people
   * work the floor. See lib/billing/grace-period.ts.
   */
  inTraining: number;
}

/**
 * The three public numbers, from one pair of row sets and one predicate.
 *
 * `certified + inTraining === total` holds by construction: `certifiedIds` is a
 * subset of `currentLearnerIds` (certifiedLearnerIdSet intersects against it),
 * and `inTraining` counts precisely the members of `currentLearnerIds` that are
 * not in it. A departed employee appears in none of the three because they were
 * never in `currentLearnerIds` to begin with (T-46a).
 *
 * TRAP (inherited): `departed_at` and `role` must both be in the SELECT list, or
 * every row is judged not-current and all three numbers collapse toward zero.
 */
export function deriveStaffCounts(
  learnerRows: ReadonlyArray<StaffIdentityRow>,
  certRows: ReadonlyArray<CertHolderRow>
): StaffCounts {
  const currentLearnerIds = currentLearnerIdSet(learnerRows);
  const certifiedIds = certifiedLearnerIdSet(certRows, currentLearnerIds);

  let inTraining = 0;
  for (const id of currentLearnerIds) {
    if (!certifiedIds.has(id)) inTraining += 1;
  }

  return {
    total: currentLearnerIds.size,
    certified: certifiedIds.size,
    inTraining,
  };
}
