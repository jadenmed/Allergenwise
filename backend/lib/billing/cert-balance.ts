/**
 * lib/billing/cert-balance.ts
 *
 * T-45a — what a restaurant owes for staff certified after it was listed, and
 * the three numbers the public surfaces display.
 *
 * THE PROBLEM
 * ───────────
 * Payment is attached to SUBMISSION. A restaurant submits, pays for the staff it
 * has, and gets listed. Two months later it hires someone; that person passes
 * the exam, their certificate lands `pending` — and nothing triggers a payment,
 * because the submission already happened. Two consequences, and the second is
 * the one that matters:
 *
 *   1. $35 is owed with no mechanism to collect it.
 *   2. The public listing keeps asserting a fully-certified roster that is no
 *      longer true, to a diner with a life-threatening allergy who may be served
 *      by the new hire.
 *
 * THE COUNTS ARE READ FROM THE DATABASE ON EVERY READ. ALWAYS.
 * ───────────────────────────────────────────────────────────
 * Never frozen, never cached, never defaulted. The grace period in
 * lib/billing/grace-period.ts governs CONSEQUENCES — when the fee is charged,
 * whether submissions are blocked, whether the listing is pulled. It has no
 * influence whatsoever on the numbers computed here, and nothing in this file
 * imports it. Freezing the displayed count during a grace window would be the
 * T-18 defect again.
 *
 * When a count cannot be read, this module reports ABSENCE — `kind:
 * 'unavailable'` — and never a number. There is deliberately no `?? 0` anywhere
 * below: that fallback is what let a failed query render as full certification.
 * Same discriminator and same truncation guard as
 * app/api/directory/[slug]/route.ts.
 *
 * ONE DEFINITION OF CURRENT STAFF, ONE OF THE NUMERATOR, ONE OF THE PRICED SET
 * ───────────────────────────────────────────────────────────────────────────
 * Three tasks landed on these counts and none of them is undone here:
 *
 *   T-23  the numerator counts distinct LEARNERS, not certificate rows —
 *         `countDistinctCertifiedLearners` / `certifiedLearnerIdSet`.
 *   T-46a every count excludes departed staff — `lib/staff/membership.ts`.
 *   T-49  a learner can no longer hold two `pending` certificates.
 *
 * This file adds no fourth definition. Membership and the certified numerator
 * are imported from lib/staff/membership.ts; the publicly-active predicate from
 * lib/learner/cert-state.ts, through those helpers. What it DOES add is one
 * definition of the BILLABLE set (`isBillablePendingCert`), which
 * lib/admin/eligibility.ts now imports instead of re-deriving — so the number
 * the top-up charges and the number /api/submissions/create charges cannot
 * drift apart.
 *
 * IT NEVER WRITES. Not to `certificates`, not to anything. Enforcement belongs
 * on the listing, never on the credential: revoking a paid certificate over a
 * billing dispute would tell a diner that a trained employee is untrained.
 *
 * Tested by: tests/unit/cert-balance.test.ts
 */
import 'server-only';
import type { ServiceDb } from '@/lib/db/service';
import { CERT_FEE_CENTS } from '@/lib/billing/pricing';
import {
  DEPARTED_AT_COLUMN,
  LEARNER_ROLE,
  currentLearnerIdSet,
  deriveStaffCounts,
  onlyCurrentStaff,
  type CertHolderRow,
  type StaffCounts,
  type StaffIdentityRow,
} from '@/lib/staff/membership';

// ─── Row shapes ───────────────────────────────────────────────────────────────

/**
 * A certificate reduced to what pricing and counting need.
 *
 * Extends `CertHolderRow` (profile_id + status) so the same row satisfies the
 * T-23 numerator helpers without a second select or a cast.
 */
export interface BillableCertRow extends CertHolderRow {
  /** NOT NULL in 0001_init. Nullable here because a select could omit it. */
  expires_at: string | null;
  /** `timestamptz default now()` — when the exam was passed. */
  issued_at: string | null;
}

/** The select list every read in this module builds from. Never hand-typed. */
export const CERT_BALANCE_CERT_COLUMNS = 'profile_id, status, expires_at, issued_at';

/** The learner select list, built from the membership module's column names. */
export const CERT_BALANCE_LEARNER_COLUMNS = `id, role, ${DEPARTED_AT_COLUMN}`;

// ─── The billable set (one definition, shared with eligibility) ───────────────

/**
 * Is this certificate one the restaurant currently owes a fee for?
 *
 * Three conditions, all load-bearing:
 *
 *   1. `status === 'pending'` — the fee has not been paid. Certificate ROWS are
 *      the unit here, NOT distinct learners, and that is deliberate: rows are
 *      exactly the set the cert-fee webhook's activation UPDATE
 *      (`WHERE status='pending'`) will touch, so pricing anything else would
 *      charge for certificates that never activate. T-49 is what makes counting
 *      rows safe — one learner can no longer hold two pending certificates —
 *      but it did not change the unit, and this must not either.
 *
 *   2. `expires_at > now` — mirrors the `.gt('expires_at', now)` that
 *      lib/admin/eligibility.ts already applies in SQL. Re-applied here in TS so
 *      the predicate has ONE definition rather than a SQL copy and a TS copy
 *      that drift, which is the T-23 lesson.
 *
 *   3. The holder is a CURRENT learner (T-46a). A departed employee's pending
 *      certificate is not this restaurant's to be billed for. Their credential
 *      is untouched and stays valid on its own schedule.
 *
 * FAIL POLARITY: a missing or unparseable `expires_at` is NOT billable.
 * The column is NOT NULL so this is unreachable in practice, but the direction
 * matters — SQL's `.gt()` also excludes NULL, so this agrees with the query it
 * mirrors, and it errs away from over-billing. Double-charging a restaurant is
 * the harm a retry cannot undo.
 */
export function isBillablePendingCert(
  cert: BillableCertRow,
  currentLearnerIds: ReadonlySet<string>,
  nowMs: number = Date.now()
): boolean {
  if (cert.status !== 'pending') return false;
  if (!currentLearnerIds.has(cert.profile_id)) return false;

  if (cert.expires_at == null) return false;
  const expiresMs = new Date(cert.expires_at).getTime();
  if (Number.isNaN(expiresMs)) return false;

  return expiresMs > nowMs;
}

/** Every certificate row the restaurant currently owes a fee for. */
export function billablePendingCerts<T extends BillableCertRow>(
  certs: ReadonlyArray<T>,
  currentLearnerIds: ReadonlySet<string>,
  nowMs: number = Date.now()
): T[] {
  return certs.filter((c) => isBillablePendingCert(c, currentLearnerIds, nowMs));
}

// ─── The three displayed numbers ──────────────────────────────────────────────

/**
 * The three displayed numbers are NOT defined here.
 *
 * `deriveStaffCounts` lives in lib/staff/membership.ts, beside the denominator
 * and numerator it is built from — "in training" is the complement of the
 * certified set within the current-learner set, so a copy of it in this file
 * would be a fourth definition of who counts as staff, which is precisely what
 * T-23 and T-46a exist to prevent. Re-exported so a consumer that needs both a
 * balance and the counts has one import.
 */
export { deriveStaffCounts };
export type { StaffCounts };

// ─── The balance ──────────────────────────────────────────────────────────────

export interface CertBalance {
  /** Certificate ROWS awaiting payment — what the Checkout is priced from. */
  pendingCertCount: number;
  /** `CERT_FEE_CENTS × pendingCertCount`. The list price, before any promo. */
  amountOwedCents: number;
  /**
   * `issued_at` of the OLDEST unpaid certificate — when the debt started, which
   * is where T-45b's grace clock runs from. `null` when nothing is owed.
   */
  owedSince: string | null;
}

/** What is owed, priced from the billable pending certificates. Pure. */
export function deriveCertBalance(
  learnerRows: ReadonlyArray<StaffIdentityRow>,
  certRows: ReadonlyArray<BillableCertRow>,
  nowMs: number = Date.now()
): CertBalance {
  const currentLearnerIds = currentLearnerIdSet(learnerRows);
  const billable = billablePendingCerts(certRows, currentLearnerIds, nowMs);

  let owedSince: string | null = null;
  for (const cert of billable) {
    if (cert.issued_at == null) continue;
    if (owedSince === null || cert.issued_at < owedSince) owedSince = cert.issued_at;
  }

  return {
    pendingCertCount: billable.length,
    amountOwedCents: CERT_FEE_CENTS * billable.length,
    owedSince,
  };
}

// ─── The snapshot: counts + balance from one read ─────────────────────────────

export type CertSnapshot =
  | ({ kind: 'known' } & StaffCounts & CertBalance)
  /**
   * At least one count did not arrive, or arrived truncated. We know nothing, so
   * we claim nothing. NEVER collapsed to zero — see the file header.
   */
  | { kind: 'unavailable'; reason: string };

/**
 * Read the restaurant's staff and certificates and derive every number T-45a
 * needs, in one place, from one membership predicate.
 *
 * TWO INDEPENDENT FAILURE MODES, both reported as absence:
 *
 *   - The query errored. Obvious.
 *   - The body was TRUNCATED. PostgREST caps a response body at
 *     supabase/config.toml `max_rows` while still reporting the true total in
 *     Content-Range, so `rows.length !== count` means we hold only part of the
 *     data. Any intersection computed from a partial set is an undercount
 *     presented as fact — which for this module means under-billing a
 *     restaurant AND overstating how many of its staff are certified. Same
 *     guard as app/api/directory/[slug]/route.ts:236-238.
 *
 * Never throws for a query failure: the caller renders an absence rather than
 * handling an exception, which is the shape every consumer of these counts
 * already expects.
 */
export async function readCertSnapshot(
  db: ServiceDb,
  restaurantId: string,
  nowMs: number = Date.now()
): Promise<CertSnapshot> {
  const [
    { data: learnerRowsRaw, count: learnerCount, error: learnerError },
    { data: certRowsRaw, count: certCount, error: certError },
  ] = await Promise.all([
    // T-46a — CURRENT staff only, via the one membership helper.
    // `role` and `departed_at` are in the select so the predicate is applied by
    // the module that owns it rather than inferred from the filters. See the
    // TRAP note in lib/staff/membership.ts: a row missing either is judged NOT
    // current, so a forgotten column collapses the count toward zero rather
    // than silently counting departed staff.
    onlyCurrentStaff(
      db
        .from('profiles')
        .select(CERT_BALANCE_LEARNER_COLUMNS, { count: 'exact' })
        .eq('restaurant_id', restaurantId)
        .eq('role', LEARNER_ROLE)
    ),
    // Every certificate that could bear on either number: `active` feeds the
    // certified numerator, `pending` feeds the balance. Filtering to one status
    // here would need a second query for the other, and two queries microseconds
    // apart can disagree — which is exactly the drift this module removes.
    db
      .from('certificates')
      .select(CERT_BALANCE_CERT_COLUMNS, { count: 'exact' })
      .eq('restaurant_id', restaurantId)
      .in('status', ['pending', 'active']),
  ]);

  if (learnerError) {
    console.error('[cert-balance] learner read failed for', restaurantId, ':', learnerError);
    return { kind: 'unavailable', reason: 'learner-read-failed' };
  }
  if (certError) {
    console.error('[cert-balance] certificate read failed for', restaurantId, ':', certError);
    return { kind: 'unavailable', reason: 'certificate-read-failed' };
  }

  const learnerRows = (learnerRowsRaw ?? null) as StaffIdentityRow[] | null;
  const certRows = (certRowsRaw ?? null) as BillableCertRow[] | null;

  if (learnerRows === null || learnerCount == null || learnerCount !== learnerRows.length) {
    console.error('[cert-balance] learner rows truncated or absent for', restaurantId, {
      rows: learnerRows?.length ?? null,
      count: learnerCount,
    });
    return { kind: 'unavailable', reason: 'learner-rows-truncated' };
  }
  if (certRows === null || certCount == null || certCount !== certRows.length) {
    console.error('[cert-balance] certificate rows truncated or absent for', restaurantId, {
      rows: certRows?.length ?? null,
      count: certCount,
    });
    return { kind: 'unavailable', reason: 'certificate-rows-truncated' };
  }

  return {
    kind: 'known',
    ...deriveStaffCounts(learnerRows, certRows),
    ...deriveCertBalance(learnerRows, certRows, nowMs),
  };
}
