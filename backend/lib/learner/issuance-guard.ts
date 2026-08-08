/**
 * lib/learner/issuance-guard.ts
 *
 * T-49 — the single DB read behind "may this learner be issued a certificate?".
 *
 * THE BUG THIS CLOSES
 * ───────────────────
 * `checkCooldown` (lib/learner/exam.ts) gates on two things: three submitted
 * attempts, and 24h after a FAILURE. Its cooldown branch is `if (!lastPassed)`,
 * so a learner who PASSED skipped it entirely and fell through to
 * `canAttempt: true`. `/api/exam/submit` then issued a certificate
 * unconditionally. Pass twice, hold two certificates.
 *
 * That was a live over-billing bug, not a cosmetic one: the Checkout Session in
 * `/api/submissions/create` is priced `CERT_FEE_CENTS × pendingCertCount`, and
 * `pendingCertCount` counts certificate ROWS (lib/admin/eligibility.ts) —
 * correctly, because rows are exactly what the webhook's activation UPDATE
 * touches. Two pending rows for one person is $70 to certify one person.
 *
 * WHY A GUARD AND NOT A UNIQUE INDEX
 * ──────────────────────────────────
 * A partial unique index was considered and rejected. Two reasons, both
 * verified against the code rather than assumed:
 *
 *   1. `unique (profile_id) where status='active'` breaks the cert-fee
 *      webhook. It activates a restaurant's pending certificates in ONE
 *      statement (`UPDATE … WHERE status='pending'`), and that single-statement
 *      shape is precisely what makes Stripe redelivery idempotent (T-41b,
 *      T-48). A 23505 anywhere in it fails the WHOLE statement, so nobody at a
 *      restaurant that has already paid gets activated — and Stripe retries
 *      into the same wall forever.
 *   2. Including `pending` in such an index routes the failure into the
 *      collision-retry loop in lib/learner/issue-certificate.ts, which reads
 *      EVERY 23505 as a cert-code collision. It would burn its retry budget and
 *      write a false `cert_issuance_retry_exhausted` — an ops signal meaning
 *      "the entropy source is broken", pointing at a bug that is nothing of the
 *      kind.
 *
 * Migration 0027 therefore ships the pre-flight REPORT with no index attached,
 * and the webhook's activation UPDATE is not touched.
 *
 * Tested by: tests/unit/duplicate-cert-guard.test.ts
 */
import 'server-only';
import type { ServiceDb } from '@/lib/db/service';
import {
  ISSUANCE_BLOCKING_STATUSES,
  findIssuanceBlockingCert,
  type CertStatus,
} from '@/lib/learner/cert-state';

// ─── Shared refusal copy ──────────────────────────────────────────────────────

/**
 * One message for both refusal sites, so /api/exam/start and /api/exam/submit
 * cannot drift into telling the learner two different stories. Deliberately
 * says nothing about billing — the learner is not the one being charged.
 */
export const ALREADY_CERTIFIED_MESSAGE =
  'You already hold a current AllergenWise certificate. You can retake the exam once it expires.';

// ─── Returned shape ───────────────────────────────────────────────────────────

export interface BlockingCert {
  id: string;
  cert_code: string;
  status: CertStatus;
  expires_at: string;
}

// ─── findBlockingCertForLearner ───────────────────────────────────────────────

/**
 * Returns the certificate that forbids issuing this learner another one, or
 * null when they are free to sit the exam.
 *
 * The status filter runs in SQL (cheap, and covered by
 * `certificates_profile_status_issued_at_idx`) but the DECISION runs in JS
 * through `findIssuanceBlockingCert`, so the `expires_at > now` half of the
 * predicate has exactly one definition rather than a SQL copy and a TS copy
 * that drift apart. This is the T-23 lesson applied: four hand-written
 * `status = 'active'` comparisons are how four counts came to disagree.
 *
 * THROWS on a query error rather than returning null. Fail-closed: a read
 * failure here must not be indistinguishable from "no blocking certificate", or
 * a transient database blip mints a duplicate certificate and a second $35 line
 * on a real invoice.
 */
export async function findBlockingCertForLearner(
  db: ServiceDb,
  profileId: string,
  nowMs: number = Date.now()
): Promise<BlockingCert | null> {
  const { data, error } = await db
    .from('certificates')
    .select('id, cert_code, status, expires_at')
    .eq('profile_id', profileId)
    .in('status', ISSUANCE_BLOCKING_STATUSES as ReadonlyArray<string>)
    .order('issued_at', { ascending: false });

  if (error) {
    throw new Error(`findBlockingCertForLearner failed: ${error.message}`);
  }

  return findIssuanceBlockingCert((data ?? []) as BlockingCert[], nowMs);
}
