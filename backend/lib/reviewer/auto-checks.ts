/**
 * lib/reviewer/auto-checks.ts
 *
 * Recomputes the four auto-check signals for a submission entirely from live DB data.
 * Called by the reviewer detail endpoint; result is NEVER cached.
 *
 * auto-checks:
 *   allCertified       — every active learner profile in the restaurant has a
 *                        non-revoked, non-expired certificate.
 *   allScoresPass      — every cert's linked exam_attempt.score_percent >= 80.
 *   paymentValid       — the restaurant has an active subscription AND the submission's
 *                        cert fee has been paid (stripe_payment_intent_id on submission
 *                        is non-null and cert_fee_total_cents > 0), OR
 *                        cert_fee_total_cents = 0 (free / no fee charged).
 *   noPriorRejection   — no other submissions row for this restaurant has
 *                        status='rejected'.
 *
 * Note: All supabase queries use explicit local types because the Database interface
 * in lib/types/db.ts omits the `Relationships` arrays required for @supabase/supabase-js
 * v2 generics to infer column subsets. Explicit casts keep the code strongly typed
 * without touching the read-only db.ts file.
 */

import { createServiceSupabase } from '@/lib/supabase/server';
import { LEARNER_ROLE, onlyCurrentStaff } from '@/lib/staff/membership';

export interface AutoChecks {
  allCertified: boolean;
  allScoresPass: boolean;
  paymentValid: boolean;
  noPriorRejection: boolean;
}

export interface AutoChecksInput {
  submissionId: string;
  restaurantId: string;
}

// ─── Local row shapes (explicit — bypasses Supabase generic inference) ─────────

interface ProfileRow {
  id: string;
}

interface CertRow {
  id: string;
  profile_id: string;
  exam_attempt_id: string | null;
  expires_at: string;
  status: string;
}

interface ExamAttemptRow {
  id: string;
  score_percent: number | null;
  passed: boolean | null;
}

interface SubscriptionRow {
  id: string;
  status: string;
  ends_at: string;
}

interface SubmissionRow {
  id: string;
  cert_fee_total_cents: number | null;
  stripe_payment_intent_id: string | null;
}

// ─── Query helper with explicit cast ─────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabase = any;

/**
 * Recomputes all four auto-checks for the given submission.
 * Uses a service-role client so RLS does not interfere with cross-table reads.
 */
export async function computeAutoChecks({
  submissionId,
  restaurantId,
}: AutoChecksInput): Promise<AutoChecks> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = createServiceSupabase() as AnySupabase;

  // ── 1. Load all CURRENT learner profiles for this restaurant ──────────────
  // T-46a — allCertified and allScoresPass mean "every one of these people",
  // so the set has to be the people who actually work here. A departed
  // employee who never passed would otherwise fail the check forever.
  const { data: profilesRaw, error: profilesErr } = await onlyCurrentStaff(
    supabase
      .from('profiles')
      .select('id')
      .eq('restaurant_id', restaurantId)
      .eq('role', LEARNER_ROLE)
  );

  if (profilesErr) throw new Error(`auto-checks profiles: ${profilesErr.message}`);

  const profiles = (profilesRaw ?? []) as ProfileRow[];
  const profileIds = profiles.map((p) => p.id);

  // Edge case: restaurant has no learners → all checks fail (can't be certified).
  if (profileIds.length === 0) {
    return {
      allCertified: false,
      allScoresPass: false,
      paymentValid: false,
      noPriorRejection: false,
    };
  }

  // ── 2. Load publicly-active certificates for these profiles (Wave 2C) ──────
  const now = new Date().toISOString();
  const { data: certsRaw, error: certsErr } = await supabase
    .from('certificates')
    .select('id, profile_id, exam_attempt_id, expires_at, status')
    .in('profile_id', profileIds)
    .eq('status', 'active')
    .gt('expires_at', now);

  if (certsErr) throw new Error(`auto-checks certificates: ${certsErr.message}`);

  const certs = (certsRaw ?? []) as CertRow[];

  // Keep only the most recent valid cert per profile.
  const certsByProfile = new Map<string, CertRow>();
  for (const cert of certs) {
    const existing = certsByProfile.get(cert.profile_id);
    if (!existing || cert.expires_at > existing.expires_at) {
      certsByProfile.set(cert.profile_id, cert);
    }
  }

  // allCertified: every learner has a valid cert.
  const allCertified = profileIds.every((id) => certsByProfile.has(id));

  // ── 3. Verify each cert came from a passed exam (score >= 80) ─────────────
  let allScoresPass = false;

  if (allCertified) {
    const attemptIds = [...certsByProfile.values()]
      .map((c) => c.exam_attempt_id)
      .filter((id): id is string => id !== null);

    if (attemptIds.length === 0) {
      // Certs without linked attempts can't be verified → fail.
      allScoresPass = false;
    } else {
      const { data: attemptsRaw, error: attemptsErr } = await supabase
        .from('exam_attempts')
        .select('id, score_percent, passed')
        .in('id', attemptIds);

      if (attemptsErr) throw new Error(`auto-checks exam_attempts: ${attemptsErr.message}`);

      const attempts = (attemptsRaw ?? []) as ExamAttemptRow[];
      const attemptMap = new Map(attempts.map((a) => [a.id, a]));

      // Every cert's linked attempt must have passed=true AND score_percent >= 80.
      allScoresPass = [...certsByProfile.values()].every((cert) => {
        if (!cert.exam_attempt_id) return false;
        const attempt = attemptMap.get(cert.exam_attempt_id);
        if (!attempt) return false;
        return attempt.passed === true && (attempt.score_percent ?? 0) >= 80;
      });
    }
  }

  // ── 4-5. Payment validity + prior-rejection — three independent reads ──────
  // subscriptions (by restaurantId), submission (by submissionId), and the
  // prior-rejection count are mutually independent and independent of the
  // profiles→certs→attempts chain above. They run concurrently; errors are
  // checked in the ORIGINAL order (subErr → submissionErr → rejErr) to preserve
  // throw precedence.
  //   Payment-valid conditions (both must be true):
  //     a) Restaurant has an active subscription (status='active', ends_at future).
  //     b) submission cert_fee_total_cents > 0 with a non-null
  //        stripe_payment_intent_id, OR cert_fee_total_cents = 0 (free / no fee).
  //   A prior rejection is any OTHER submission for this restaurant with status='rejected'.
  const [
    { data: subRaw, error: subErr },
    { data: submissionRaw, error: submissionErr },
    { count: rejectedCount, error: rejErr },
  ] = await Promise.all([
    supabase
      .from('subscriptions')
      .select('id, status, ends_at')
      .eq('restaurant_id', restaurantId)
      .eq('status', 'active')
      .gt('ends_at', now)
      .maybeSingle(),
    supabase
      .from('submissions')
      .select('id, cert_fee_total_cents, stripe_payment_intent_id')
      .eq('id', submissionId)
      .single(),
    supabase
      .from('submissions')
      .select('id', { count: 'exact', head: true })
      .eq('restaurant_id', restaurantId)
      .eq('status', 'rejected')
      .neq('id', submissionId),
  ]);

  if (subErr) throw new Error(`auto-checks subscriptions: ${subErr.message}`);
  const sub = subRaw as SubscriptionRow | null;

  if (submissionErr) throw new Error(`auto-checks submission: ${submissionErr.message}`);
  const submission = submissionRaw as SubmissionRow;

  const subscriptionActive = sub !== null;
  const certFeeCents = submission.cert_fee_total_cents;
  const feeOk =
    certFeeCents === 0 ||
    (certFeeCents !== null && certFeeCents > 0 && submission.stripe_payment_intent_id !== null);

  const paymentValid = subscriptionActive && feeOk;

  if (rejErr) throw new Error(`auto-checks prior rejections: ${rejErr.message}`);

  const noPriorRejection = (rejectedCount ?? 0) === 0;

  return {
    allCertified,
    allScoresPass,
    paymentValid,
    noPriorRejection,
  };
}
