/**
 * lib/directory/cert-stat.ts
 *
 * Single source of truth for turning the two public certification counts into a
 * renderable state. Every public surface that displays "N of M staff certified"
 * or a percentage MUST derive it here — never inline a `totalEmployees > 0 ? …`
 * ternary at a render site.
 *
 * Why this exists
 * ---------------
 * Both `/api/directory/[slug]` and `/api/search` can hand a page a certification
 * numerator and denominator that are zero, or absent entirely. The previous
 * inline ternary fell back to `100` when the denominator was 0, so a restaurant
 * with no learners, a restaurant whose staff are all `role='manager'`, and a
 * restaurant whose staff-count query had *errored* all rendered
 * "100% of staff certified" on an unauthenticated page.
 *
 * The contract
 * ------------
 * `null` means "we did not receive a number" — a failed or missing count.
 * `0`    means "the database told us zero".
 *
 * These are never collapsed. A count of zero can only ever be produced by the
 * database returning zero, and a `null` can only ever be produced by no number
 * arriving. No caller may apply `?? 0` to a count on its way here; that is the
 * exact laundering this module exists to prevent.
 *
 * Percentage is only ever computed when the denominator is a positive number.
 * There is no fallback percentage. Absence of data is a state, not a value.
 */

export type CertStat =
  /** Denominator is a positive number — a percentage is meaningful. */
  | { kind: 'known'; certified: number; total: number; percent: number }
  /**
   * Both counts arrived, but the denominator is 0 — no learner-role staff are
   * enrolled (a brand-new listing, or a restaurant whose staff are all
   * `role='manager'`). A percentage is undefined, not 100.
   */
  | { kind: 'no-denominator'; certified: number }
  /** At least one count did not arrive. We know nothing; we claim nothing. */
  | { kind: 'unavailable' };

/**
 * Derive the renderable certification state from the two public counts.
 *
 * @param certifiedCount Active certificates, or `null` if the count failed.
 * @param totalEmployees Learner-role profiles, or `null` if the count failed.
 */
export function deriveCertStat(
  certifiedCount: number | null | undefined,
  totalEmployees: number | null | undefined
): CertStat {
  // Anything that is not a finite number means "no number arrived". This
  // deliberately catches null, undefined and NaN — all of which mean we cannot
  // make a claim, and none of which may be silently read as zero.
  if (!Number.isFinite(certifiedCount) || !Number.isFinite(totalEmployees)) {
    return { kind: 'unavailable' };
  }

  const certified = Math.max(0, certifiedCount as number);
  const total = Math.max(0, totalEmployees as number);

  if (total <= 0) {
    return { kind: 'no-denominator', certified };
  }

  // Clamped to 100 — a guard that should now be UNREACHABLE, deliberately kept.
  //
  // It used to be load-bearing: `certifiedCount` counted certificate rows while
  // `totalEmployees` counted learner profiles, so one learner holding two
  // active certificates pushed the ratio above 1 and the clamp was the only
  // thing keeping the value inside the [0, 100] contract that
  // `aria-valuemin`/`aria-valuemax` and the bar width depend on. It also HID
  // that defect: 2 learners with 4 certificates read "100% — all staff
  // certified" when only one of the two might be certified at all.
  //
  // T-23 fixed it at the source. Every producer now counts distinct CURRENT
  // LEARNERS holding an active certificate, intersected against the very
  // learners the denominator counts, so the numerator cannot exceed it:
  //   app/api/directory/[slug]/route.ts    countDistinctCertifiedLearners
  //   app/api/search/route.ts              countDistinctCertifiedLearners
  //   lib/directory/search.ts              COUNT(DISTINCT ch.id) FILTER (…)
  //   app/api/admin/dashboard-stats        certifiedLearnerIdSet (its own %)
  //
  // The clamp stays because this function is the render boundary and cannot
  // verify its inputs — a future caller could hand it an unrelated pair. If it
  // ever fires again a producer has regressed; it is a backstop, not the fix.
  const percent = Math.min(100, Math.round((certified / total) * 100));

  return { kind: 'known', certified, total, percent };
}

/**
 * True when at least one of the counts failed to arrive — i.e. the response is
 * degraded and must not be cached or prerendered. Callers use this to opt a
 * render out of the Data Cache and the Full Route Cache.
 */
export function isCertStatDegraded(
  certifiedCount: number | null | undefined,
  totalEmployees: number | null | undefined
): boolean {
  return deriveCertStat(certifiedCount, totalEmployees).kind === 'unavailable';
}
