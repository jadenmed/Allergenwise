/**
 * lib/admin/eligibility.ts
 * Pure eligibility-check function for restaurant submission.
 * Reads DB truth — never trusts client-passed data.
 *
 * Eligibility conditions (ALL must be true):
 *   1. At least 1 CURRENT learner exists for the restaurant.
 *   2. Every CURRENT learner has PASSED THE EXAM — a certificate in `pending`
 *      or `active`, i.e. not revoked, not expired, not disputed.
 *   3. Restaurant has an active subscription (ends_at >= today).
 *   4. No submission in pending|in_review|info_requested status.
 *
 * Why condition 2 counts `pending` (T-41b, closes T-05)
 * ─────────────────────────────────────────────────────
 * It used to demand `status='active'`, and the ONLY code that sets a
 * certificate active is the cert-fee webhook handler — which fired after a
 * charge that `/api/submissions/create` only made once this check had already
 * passed. Nothing could ever get through: certs waited on a payment that
 * waited on the certs.
 *
 * Payment now follows this check by seconds rather than preceding it — the
 * route creates a Checkout Session priced from the pending certs, and the
 * `checkout.session.completed` handler activates them. So the practical bar is
 * unchanged (every learner has passed), but it is expressed in terms of the
 * exam result rather than the payment that follows it.
 *
 * Public visibility is NOT affected: every public surface keys off
 * `status='active'` in its own query, not off this function.
 *
 * "Current" means `profiles.departed_at is null` (T-46a). A learner the manager
 * has removed from the roster stops counting toward condition 1 and stops
 * blocking condition 2 — that is the bug this filter exists to close. Their
 * certificate is untouched and stays valid until it expires on its own
 * schedule; see lib/staff/membership.ts for the one definition of membership.
 *
 * Tested by: tests/unit/eligibility-pending-certs.test.ts
 *            tests/unit/departed-staff-counts.test.ts
 */
import 'server-only';
import type { ServiceDb } from '@/lib/db/service';
import { LEARNER_ROLE, onlyCurrentStaff } from '@/lib/staff/membership';
import {
  CERT_BALANCE_CERT_COLUMNS,
  billablePendingCerts,
  type BillableCertRow,
} from '@/lib/billing/cert-balance';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface EligibilityResult {
  eligible: boolean;
  reasons: string[]; // empty when eligible
  certifiedCount: number; // number of learners who have passed the exam
  totalLearners: number;
  /**
   * Certificates still awaiting payment. This — not `certifiedCount` — is what
   * the Checkout Session is priced from, so a resubmission never re-charges
   * staff whose certificate is already `active`. Counts certificate ROWS, not
   * learners, because that is exactly the set the webhook's activation UPDATE
   * (`WHERE status='pending'`) will touch.
   */
  pendingCertCount: number;
}

export interface EligibilityInput {
  restaurantId: string;
  supabaseServiceClient: ServiceDb;
}

// ─── Main function ────────────────────────────────────────────────────────────

export async function checkEligibility(input: EligibilityInput): Promise<EligibilityResult> {
  const { restaurantId, supabaseServiceClient: db } = input;
  const reasons: string[] = [];
  const now = new Date().toISOString();

  // ── Fetch all four independent reads concurrently ────────────────────────
  // All four queries depend only on restaurantId; none consumes another's
  // output. Supabase builders resolve {data,error} (never throw), so errors
  // are checked below in the SAME order as the original sequential code to
  // preserve exact throw precedence.
  const [
    { data: learners, error: learnersError },
    { data: validCerts, error: certsError },
    { data: activeSubs, error: subsError },
    { data: openSubmissions, error: subError },
  ] = await Promise.all([
    // T-46a — CURRENT staff only. Before this filter, one employee who was
    // hired, never finished the course and quit blocked their restaurant from
    // ever submitting: condition 2 demanded a certificate from every
    // learner-role row and there was no way to take anyone off the roster.
    onlyCurrentStaff(
      db.from('profiles').select('id').eq('restaurant_id', restaurantId).eq('role', LEARNER_ROLE)
    ),
    // T-41b — "passed the exam" means status IN ('pending','active'), which
    // excludes expired/revoked/disputed. `pending` is a cert whose fee has not
    // been paid yet; the payment is the very next step, not a prerequisite.
    // The expires_at > now clause is belt-and-suspenders against late
    // expire-certs cron runs and applies to both states.
    // T-45a — the select list comes from lib/billing/cert-balance.ts so the
    // shared billable predicate always has the columns it judges on. Hand-typing
    // it here is how a missing `expires_at` would silently drop every pending
    // certificate out of the price (the fail-closed direction, but still wrong).
    db
      .from('certificates')
      .select(CERT_BALANCE_CERT_COLUMNS)
      .eq('restaurant_id', restaurantId)
      .in('status', ['pending', 'active'])
      .gt('expires_at', now),
    db
      .from('subscriptions')
      .select('id, ends_at, status')
      .eq('restaurant_id', restaurantId)
      .eq('status', 'active')
      .gte('ends_at', now.split('T')[0]) // date comparison; ends_at is a date column
      .limit(1),
    db
      .from('submissions')
      .select('id, status')
      .eq('restaurant_id', restaurantId)
      .in('status', ['pending', 'in_review', 'info_requested'])
      .limit(1),
  ]);

  // ── 1. Learner profiles ──────────────────────────────────────────────────
  if (learnersError) {
    throw new Error(`Failed to fetch learner profiles: ${learnersError.message}`);
  }

  const totalLearners = learners?.length ?? 0;

  if (totalLearners === 0) {
    reasons.push(
      'No learners have been added to this restaurant. Invite at least one employee before submitting.'
    );
  }

  // ── 2. Certificates from a passed exam (pending or active) ───────────────
  if (certsError) {
    throw new Error(`Failed to fetch certificates: ${certsError.message}`);
  }

  // T-46a — a departed learner's certificate stays valid and downloadable, but
  // it is no longer this restaurant's to count or to be billed for. The
  // certificates query is restaurant-scoped (it cannot filter on a column of
  // `profiles`), so the membership filter is applied here against the set of
  // current learners the query above already returned. This is what keeps a
  // departed learner's PENDING certificate out of `pendingCertCount`, and so
  // out of the $35 × pending Checkout line in /api/submissions/create.
  // Explicitly `Set<string>`: `learners` arrives from PostgREST typed as `any`,
  // so an inferred `Set<unknown>` would silently satisfy `.has()` while failing
  // to satisfy the shared billable predicate's `ReadonlySet<string>`.
  const currentLearnerIds = new Set<string>((learners ?? []).map((l: { id: string }) => l.id));

  const certRows = (validCerts ?? []) as BillableCertRow[];

  const qualifyingCerts = certRows.filter((c) => currentLearnerIds.has(c.profile_id));

  const certifiedProfileIds = new Set(qualifyingCerts.map((c) => c.profile_id));
  const certifiedCount = certifiedProfileIds.size;

  // T-45a — the billable set has ONE definition, in lib/billing/cert-balance.ts,
  // and both things that charge for it now read that one. This used to be an
  // inline `.filter(c => c.status === 'pending')` here, and /api/admin/top-up
  // would have needed its own copy: two filters, two chances to disagree about
  // what a restaurant owes. The predicate is unchanged — a pending certificate,
  // not yet expired, held by a current learner — it simply lives in one place.
  const pendingCertCount = billablePendingCerts(certRows, currentLearnerIds).length;

  // Check every learner has passed the exam
  if (totalLearners > 0) {
    const uncertifiedLearners = (learners ?? []).filter(
      (l: { id: string }) => !certifiedProfileIds.has(l.id)
    );

    if (uncertifiedLearners.length > 0) {
      reasons.push(
        `${uncertifiedLearners.length} of ${totalLearners} employee(s) have not passed the exam. All staff must complete training and pass the exam before submitting.`
      );
    }
  }

  // ── 3. Active subscription ───────────────────────────────────────────────
  if (subsError) {
    throw new Error(`Failed to fetch subscriptions: ${subsError.message}`);
  }

  if (!activeSubs || activeSubs.length === 0) {
    reasons.push('No active subscription found. Please renew your plan before submitting.');
  }

  // ── 4. Existing open submission ──────────────────────────────────────────
  if (subError) {
    throw new Error(`Failed to fetch submissions: ${subError.message}`);
  }

  if (openSubmissions && openSubmissions.length > 0) {
    const existingStatus = (openSubmissions[0] as { id: string; status: string }).status;
    reasons.push(
      `A submission is already ${existingStatus.replace('_', ' ')}. You cannot submit again until the current review is resolved.`
    );
  }

  return {
    eligible: reasons.length === 0,
    reasons,
    certifiedCount,
    totalLearners,
    pendingCertCount,
  };
}
