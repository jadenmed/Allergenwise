/**
 * lib/learner/exam.ts
 * Pure scoring, cooldown, and lock-check functions for the exam domain.
 * No DB calls — takes plain data and returns computed results.
 * Tested by: tests/unit/exam-scoring.test.ts
 */

import type { ExamAttempt, ExamQuestionOption } from '@/lib/types/db';

// ─── Constants ────────────────────────────────────────────────────────────────

// Master Course Build Packet, Section 6: 85% passing score for the Final
// Certification Test. (Was 80 in the pilot scaffold; bumped to 85 per packet.)
export const PASS_THRESHOLD_PERCENT = 85;
export const COOLDOWN_HOURS = 24;
export const MAX_ATTEMPTS = 3;
export const GRACE_SECONDS = 30; // network grace for submit after timer expires

// ─── Scoring ─────────────────────────────────────────────────────────────────

export interface QuestionWithOptions {
  id: string;
  options: ExamQuestionOption[]; // {id, text, correct}
}

export interface ScoreResult {
  scorePercent: number; // 0–100, rounded
  correctCount: number;
  totalCount: number;
  passed: boolean;
}

/**
 * Computes the exam score given a map of questionId → chosen optionId and
 * the canonical questions with their correct answers.
 *
 * - Questions not answered by the learner count as wrong.
 * - If a question has no correct option marked (data error), skip it gracefully.
 */
export function scoreExam(
  questions: QuestionWithOptions[],
  answers: Record<string, string>
): ScoreResult {
  const total = questions.length;
  if (total === 0) return { scorePercent: 0, correctCount: 0, totalCount: 0, passed: false };

  let correct = 0;
  for (const q of questions) {
    const chosenId = answers[q.id];
    if (!chosenId) continue; // unanswered → wrong
    const correctOption = q.options.find((o) => o.correct);
    if (!correctOption) continue; // data error — skip
    if (chosenId === correctOption.id) correct++;
  }

  const scorePercent = Math.round((correct / total) * 100);
  return {
    scorePercent,
    correctCount: correct,
    totalCount: total,
    passed: scorePercent >= PASS_THRESHOLD_PERCENT,
  };
}

// ─── Time-limit / expiry ──────────────────────────────────────────────────────

/**
 * Returns true if the attempt has exceeded its time limit (plus grace period).
 * nowMs is injectable for testability.
 */
export function isAttemptExpired(
  attempt: Pick<ExamAttempt, 'started_at' | 'time_limit_seconds'>,
  nowMs: number = Date.now()
): boolean {
  const startMs = new Date(attempt.started_at).getTime();
  const timeLimitMs = (attempt.time_limit_seconds + GRACE_SECONDS) * 1000;
  return nowMs > startMs + timeLimitMs;
}

/**
 * Returns true if the attempt is still active (started, not submitted, not expired).
 */
export function isAttemptActive(
  attempt: Pick<ExamAttempt, 'started_at' | 'submitted_at' | 'time_limit_seconds'>,
  nowMs: number = Date.now()
): boolean {
  if (attempt.submitted_at != null) return false;
  return !isAttemptExpired(attempt, nowMs);
}

// ─── Cooldown ─────────────────────────────────────────────────────────────────

/**
 * Given all past attempts for a learner, returns:
 * - canAttempt: whether the learner may start a new attempt
 * - reason: human-readable reason when canAttempt=false
 * - retryAvailableAt: ISO string when the learner may retry (if applicable)
 * - attemptNumber: the number this new attempt would be (1-indexed)
 */
export interface CooldownResult {
  canAttempt: boolean;
  reason?: string;
  retryAvailableAt?: string;
  attemptNumber: number;
}

export function checkCooldown(
  pastAttempts: Pick<ExamAttempt, 'started_at' | 'submitted_at' | 'passed'>[],
  nowMs: number = Date.now()
): CooldownResult {
  // ── Submitted attempts, oldest first ──────────────────────────────────────
  // Ordered HERE rather than trusted from the caller. /api/exam/start queries
  // `.order('started_at', { ascending: false })` — NEWEST FIRST — while
  // /api/exam/submit passes no order at all, so "the last element" meant three
  // different things at three call sites. Reading the newest attempt
  // positionally therefore picked the OLDEST row in the start route: a learner
  // who failed 48 hours ago and again an hour ago had their cooldown measured
  // from the 48-hour-old failure and could retry immediately. Deciding the
  // period boundary below positionally would have inherited the identical
  // defect, so the order is established once, here, from the data.
  const submitted = pastAttempts
    .filter((a) => a.submitted_at != null)
    .slice()
    .sort((a, b) => new Date(a.submitted_at!).getTime() - new Date(b.submitted_at!).getTime());

  // ── The certification period (T-52) ───────────────────────────────────────
  // MAX_ATTEMPTS counts attempts in the CURRENT certification period, not over
  // a lifetime. The period begins at the learner's most recent PASS; attempts
  // before it belong to a completed cycle and must not count against the next.
  //
  // THE BUG THIS CLOSES
  //   Counting every attempt ever meant someone who failed twice and passed on
  //   the third try carried three submitted attempts forever. Two years later
  //   their certificate expires, they go to renew, and they are refused with
  //   "Maximum attempts reached" — permanently, with no in-product escape for
  //   them or anyone else. Their restaurant then fails checkEligibility
  //   condition 2 for good, which is the T-46 deadlock again: one employee who
  //   cannot renew blocks the whole listing. Revocation and disputes reach the
  //   same wall sooner — T-49 deliberately lets those learners retake, and
  //   lifetime counting silently cancelled that permission.
  //
  // WHY A PASS AND NOT A CERTIFICATE
  //   The obvious boundary is the most recent certificate's `issued_at`. It is
  //   wrong. app/api/cron/purge-stale-pending-certs HARD-DELETES pending
  //   certificates — an actual `.delete()`, not a status change — so a learner
  //   who passes at a restaurant that never pays the fee loses the certificate
  //   row entirely. A certificate-keyed boundary would find nothing for exactly
  //   those learners and lock them out forever, and that is the most common
  //   real instance of this bug rather than an edge case. `exam_attempts` is
  //   never purged. The pass is the durable record of a completed cycle.
  //
  //   It also keeps this function PURE. `passed` is already in the argument, so
  //   the boundary needs no new parameter, no default, and no database read.
  //
  // WHY NOT A ROLLING TIME WINDOW
  //   "Three attempts per certification" is explainable to a restaurant
  //   manager. "Three per rolling twelve months" is a rule nobody can predict
  //   the effect of, and it would still lock someone out mid-cycle.
  //
  // Strictly `=== true`: a submitted row with a null `passed` is a data
  // anomaly, not a pass, and reading it as one would hand out an unearned fresh
  // set of attempts.
  let lastPassIndex = -1;
  for (let i = submitted.length - 1; i >= 0; i--) {
    if (submitted[i].passed === true) {
      lastPassIndex = i;
      break;
    }
  }

  // A learner who has never passed has no boundary, so every attempt counts —
  // `slice(0)` returns the whole history. First-time certification is unchanged.
  const currentPeriod = submitted.slice(lastPassIndex + 1);

  // Period-scoped: the attempt after a pass is number 1 of a new cycle, not the
  // next number in a lifetime tally.
  const attemptNumber = currentPeriod.length + 1;

  // ≥3 submitted attempts IN THIS PERIOD → contact admin. The copy is unchanged
  // and is now true rather than permanent: an administrator really is the escape
  // hatch for someone who has exhausted a live cycle.
  if (currentPeriod.length >= MAX_ATTEMPTS) {
    return {
      canAttempt: false,
      reason: 'Maximum attempts reached. Please contact your administrator.',
      attemptNumber,
    };
  }

  // ── The 24-hour post-failure cooldown, unchanged ──────────────────────────
  // Every attempt in `currentPeriod` sits after the most recent pass, so none
  // of them is one — the old `lastPassed` test is structurally satisfied and no
  // longer needs asking. What changes is which attempts are COUNTED, never the
  // wait between them: a learner who just failed still waits 24 hours, measured
  // from that failure.
  const lastSubmitted = currentPeriod.at(-1);
  if (lastSubmitted) {
    const submittedAtMs = new Date(lastSubmitted.submitted_at!).getTime();
    const cooldownMs = COOLDOWN_HOURS * 60 * 60 * 1000;
    const retryAt = submittedAtMs + cooldownMs;
    if (nowMs < retryAt) {
      return {
        canAttempt: false,
        reason: `You must wait ${COOLDOWN_HOURS} hours after a failed attempt before retrying.`,
        retryAvailableAt: new Date(retryAt).toISOString(),
        attemptNumber,
      };
    }
  }

  return { canAttempt: true, attemptNumber };
}

// ─── Active-attempt guard ─────────────────────────────────────────────────────

/**
 * Returns the active (unsubmitted, not-expired) attempt from a list, or null.
 */
export function findActiveAttempt(
  attempts: Pick<ExamAttempt, 'id' | 'started_at' | 'submitted_at' | 'time_limit_seconds'>[],
  nowMs: number = Date.now()
): (typeof attempts)[number] | null {
  return attempts.find((a) => isAttemptActive(a, nowMs)) ?? null;
}

// ─── Cert code generation ─────────────────────────────────────────────────────
//
// Removed in Wave 4B (P0 #10.a). The previous `buildCertCode(year, sequence)`
// emitted sequential `AW-{year}-{NNNNNN}` codes that enabled customer-base
// enumeration via the public verify endpoint. Cert codes are now generated
// by `lib/learner/cert-code.ts:generateCertCode()` — random Crockford
// Base32 + ISO 7064 Mod 37,36 check digit. See
// audits/cert-code-redesign-plan.md for the design.
