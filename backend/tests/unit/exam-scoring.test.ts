/**
 * tests/unit/exam-scoring.test.ts
 * Tests for lib/learner/exam.ts — scoring, cooldown, lock, expiry logic.
 *
 * Coverage:
 * - scoreExam: 0%, 80% (pass threshold), 100%, partial answers, missing answers, empty questions
 * - isAttemptExpired: not expired, just expired, grace period boundary
 * - checkCooldown: first attempt, after pass, after fail in cooldown, after cooldown elapsed, max-attempts
 * - findActiveAttempt: none, submitted, expired, active
 *
 * Cert-code generation moved to lib/learner/cert-code.ts in Wave 4B
 * (P0 #10.a). Coverage for the new format lives in cert-code.test.ts.
 */
import { describe, it, expect } from 'vitest';
import {
  scoreExam,
  isAttemptExpired,
  isAttemptActive,
  checkCooldown,
  findActiveAttempt,
  PASS_THRESHOLD_PERCENT,
  COOLDOWN_HOURS,
  MAX_ATTEMPTS,
  GRACE_SECONDS,
} from '@/lib/learner/exam';
import type { ExamQuestionOption } from '@/lib/types/db';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeQuestion(
  id: string,
  correctOptionId: string
): {
  id: string;
  options: ExamQuestionOption[];
} {
  return {
    id,
    options: [
      { id: `${id}-a`, text: 'Option A', correct: correctOptionId === `${id}-a` },
      { id: `${id}-b`, text: 'Option B', correct: correctOptionId === `${id}-b` },
      { id: `${id}-c`, text: 'Option C', correct: correctOptionId === `${id}-c` },
    ],
  };
}

/** Build N questions where correctOptionId = qId + '-a' */
function makeQuestions(n: number): { id: string; options: ExamQuestionOption[] }[] {
  return Array.from({ length: n }, (_, i) => makeQuestion(`q${i + 1}`, `q${i + 1}-a`));
}

/** Correct answers map: all questions answered correctly */
function allCorrectAnswers(questions: { id: string }[]): Record<string, string> {
  return Object.fromEntries(questions.map((q) => [q.id, `${q.id}-a`]));
}

/** Wrong answers map: all questions answered with option 'b' (incorrect) */
function allWrongAnswers(questions: { id: string }[]): Record<string, string> {
  return Object.fromEntries(questions.map((q) => [q.id, `${q.id}-b`]));
}

/** Returns an ISO string N seconds from now */
function msAgo(ms: number): string {
  return new Date(Date.now() - ms).toISOString();
}

function msFromNow(ms: number): string {
  return new Date(Date.now() + ms).toISOString();
}

// ─── scoreExam ────────────────────────────────────────────────────────────────

describe('scoreExam', () => {
  it('100% correct: score 100, passed=true', () => {
    const qs = makeQuestions(25);
    const result = scoreExam(qs, allCorrectAnswers(qs));
    expect(result.correctCount).toBe(25);
    expect(result.scorePercent).toBe(100);
    expect(result.passed).toBe(true);
  });

  it('0% correct: score 0, passed=false', () => {
    const qs = makeQuestions(25);
    const result = scoreExam(qs, allWrongAnswers(qs));
    expect(result.correctCount).toBe(0);
    expect(result.scorePercent).toBe(0);
    expect(result.passed).toBe(false);
  });

  it('80% correct (20/25): passed=false (below the 85% threshold)', () => {
    const qs = makeQuestions(25);
    const answers = { ...allCorrectAnswers(qs.slice(0, 20)), ...allWrongAnswers(qs.slice(20)) };
    const result = scoreExam(qs, answers);
    expect(result.correctCount).toBe(20);
    expect(result.scorePercent).toBe(80);
    expect(result.passed).toBe(false);
  });

  it('84% correct (21/25): passed=false (just below threshold)', () => {
    const qs = makeQuestions(25);
    const answers = { ...allCorrectAnswers(qs.slice(0, 21)), ...allWrongAnswers(qs.slice(21)) };
    const result = scoreExam(qs, answers);
    expect(result.correctCount).toBe(21);
    expect(result.scorePercent).toBe(84);
    expect(result.passed).toBe(false);
  });

  it('88% correct (22/25): passed=true (at/above the 85% threshold)', () => {
    const qs = makeQuestions(25);
    const answers = { ...allCorrectAnswers(qs.slice(0, 22)), ...allWrongAnswers(qs.slice(22)) };
    const result = scoreExam(qs, answers);
    expect(result.correctCount).toBe(22);
    expect(result.scorePercent).toBe(88);
    expect(result.passed).toBe(true);
  });

  it('79% (19/24 + 1 total wrong — 19/25 rounds to 76): passed=false', () => {
    const qs = makeQuestions(25);
    const answers = { ...allCorrectAnswers(qs.slice(0, 19)), ...allWrongAnswers(qs.slice(19)) };
    const result = scoreExam(qs, answers);
    expect(result.correctCount).toBe(19);
    expect(result.scorePercent).toBe(76); // Math.round(19/25*100) = 76
    expect(result.passed).toBe(false);
  });

  it('partial answers (only 10 answered, all correct): 10/25 = 40%', () => {
    const qs = makeQuestions(25);
    // Only answer first 10
    const answers = allCorrectAnswers(qs.slice(0, 10));
    const result = scoreExam(qs, answers);
    expect(result.correctCount).toBe(10);
    expect(result.totalCount).toBe(25);
    // scorePercent uses qs.length (25) as denominator
    expect(result.scorePercent).toBe(40);
    expect(result.passed).toBe(false);
  });

  it('missing answers (none answered): 0%', () => {
    const qs = makeQuestions(25);
    const result = scoreExam(qs, {});
    expect(result.correctCount).toBe(0);
    expect(result.scorePercent).toBe(0);
    expect(result.passed).toBe(false);
  });

  it('empty questions list: 0%, passed=false', () => {
    const result = scoreExam([], {});
    expect(result.scorePercent).toBe(0);
    expect(result.passed).toBe(false);
  });

  it('question with no correct option (data error): skipped gracefully', () => {
    const qs: { id: string; options: ExamQuestionOption[] }[] = [
      {
        id: 'q-broken',
        options: [
          { id: 'a', text: 'A', correct: false },
          { id: 'b', text: 'B', correct: false },
        ],
      },
      ...makeQuestions(24),
    ];
    const answers: Record<string, string> = {
      'q-broken': 'a', // answered but no correct option
      ...allCorrectAnswers(qs.slice(1)),
    };
    const result = scoreExam(qs, answers);
    // Only the 24 well-formed questions contribute; correct = 24, total = 25
    expect(result.correctCount).toBe(24);
    expect(result.scorePercent).toBe(96); // Math.round(24/25*100)
  });

  it('extra answer keys not in questions: ignored', () => {
    const qs = makeQuestions(25);
    const answers = {
      ...allCorrectAnswers(qs),
      'injected-extra-id': 'some-option',
    };
    const result = scoreExam(qs, answers);
    expect(result.correctCount).toBe(25);
    expect(result.scorePercent).toBe(100);
  });

  it('scorePercent is always rounded integer 0-100', () => {
    const qs = makeQuestions(25);
    // 1/25 = 4%
    const answers = { [qs[0].id]: `${qs[0].id}-a` };
    const result = scoreExam(qs, answers);
    expect(Number.isInteger(result.scorePercent)).toBe(true);
    expect(result.scorePercent).toBeGreaterThanOrEqual(0);
    expect(result.scorePercent).toBeLessThanOrEqual(100);
  });
});

// ─── isAttemptExpired ────────────────────────────────────────────────────────

describe('isAttemptExpired', () => {
  const TIME_LIMIT = 1800; // 30 min

  it('fresh attempt (just started): not expired', () => {
    const attempt = { started_at: new Date().toISOString(), time_limit_seconds: TIME_LIMIT };
    expect(isAttemptExpired(attempt)).toBe(false);
  });

  it('attempt 29m 59s old: not expired (within limit)', () => {
    const startedAt = msAgo((TIME_LIMIT - 1) * 1000);
    expect(isAttemptExpired({ started_at: startedAt, time_limit_seconds: TIME_LIMIT })).toBe(false);
  });

  it('attempt exactly at time limit: not expired (still in grace window)', () => {
    const startedAt = msAgo(TIME_LIMIT * 1000);
    expect(isAttemptExpired({ started_at: startedAt, time_limit_seconds: TIME_LIMIT })).toBe(false);
  });

  it('attempt at time limit + grace - 1s: not expired (still within grace)', () => {
    const startedAt = msAgo((TIME_LIMIT + GRACE_SECONDS - 1) * 1000);
    expect(isAttemptExpired({ started_at: startedAt, time_limit_seconds: TIME_LIMIT })).toBe(false);
  });

  it('attempt at time limit + grace + 1s: expired', () => {
    const startedAt = msAgo((TIME_LIMIT + GRACE_SECONDS + 1) * 1000);
    expect(isAttemptExpired({ started_at: startedAt, time_limit_seconds: TIME_LIMIT })).toBe(true);
  });

  it('attempt started 2 hours ago: expired', () => {
    const startedAt = msAgo(2 * 60 * 60 * 1000);
    expect(isAttemptExpired({ started_at: startedAt, time_limit_seconds: TIME_LIMIT })).toBe(true);
  });

  it('injectable nowMs: future now makes fresh attempt expired', () => {
    const startedAt = new Date().toISOString();
    const futureNow = Date.now() + (TIME_LIMIT + GRACE_SECONDS + 60) * 1000;
    expect(
      isAttemptExpired({ started_at: startedAt, time_limit_seconds: TIME_LIMIT }, futureNow)
    ).toBe(true);
  });
});

// ─── isAttemptActive ────────────────────────────────────────────────────────

describe('isAttemptActive', () => {
  const TIME_LIMIT = 1800;

  it('fresh attempt, not submitted: active', () => {
    expect(
      isAttemptActive({
        started_at: new Date().toISOString(),
        submitted_at: null,
        time_limit_seconds: TIME_LIMIT,
      })
    ).toBe(true);
  });

  it('submitted attempt: not active', () => {
    expect(
      isAttemptActive({
        started_at: msAgo(60_000),
        submitted_at: new Date().toISOString(),
        time_limit_seconds: TIME_LIMIT,
      })
    ).toBe(false);
  });

  it('expired + not submitted: not active', () => {
    expect(
      isAttemptActive({
        started_at: msAgo((TIME_LIMIT + GRACE_SECONDS + 60) * 1000),
        submitted_at: null,
        time_limit_seconds: TIME_LIMIT,
      })
    ).toBe(false);
  });
});

// ─── checkCooldown ────────────────────────────────────────────────────────────

describe('checkCooldown', () => {
  const COOLDOWN_MS = COOLDOWN_HOURS * 60 * 60 * 1000;

  it('no past attempts: canAttempt=true, attemptNumber=1', () => {
    const result = checkCooldown([]);
    expect(result.canAttempt).toBe(true);
    expect(result.attemptNumber).toBe(1);
    expect(result.retryAvailableAt).toBeUndefined();
  });

  it('one passed attempt: canAttempt=true (already passed — allow retake for practice)', () => {
    const result = checkCooldown([
      {
        started_at: msAgo(COOLDOWN_MS + 1000),
        submitted_at: msAgo(1000),
        passed: true,
      },
    ]);
    expect(result.canAttempt).toBe(true);
    // T-52 — was 2 under lifetime numbering. A pass CLOSES a certification
    // period, so the next attempt is number 1 of a new one rather than the next
    // entry in a tally that never resets. That reset is the whole fix: the
    // lifetime tally is what refused renewal to anyone who ever failed twice.
    // See tests/unit/exam-attempt-period.test.ts.
    expect(result.attemptNumber).toBe(1);
  });

  it('one failed attempt within cooldown: canAttempt=false', () => {
    const result = checkCooldown([
      {
        started_at: msAgo(10_000),
        submitted_at: msAgo(5_000),
        passed: false,
      },
    ]);
    expect(result.canAttempt).toBe(false);
    expect(result.retryAvailableAt).toBeDefined();
  });

  it('one failed attempt after cooldown elapsed: canAttempt=true', () => {
    const result = checkCooldown([
      {
        started_at: msAgo(COOLDOWN_MS + 10_000),
        submitted_at: msAgo(COOLDOWN_MS + 1_000), // submitted 25h+ ago
        passed: false,
      },
    ]);
    expect(result.canAttempt).toBe(true);
    expect(result.attemptNumber).toBe(2);
  });

  it('two failed attempts, second within cooldown: canAttempt=false', () => {
    const result = checkCooldown([
      {
        started_at: msAgo(COOLDOWN_MS + 10_000),
        submitted_at: msAgo(COOLDOWN_MS + 1_000),
        passed: false,
      },
      {
        started_at: msAgo(10_000),
        submitted_at: msAgo(5_000),
        passed: false,
      },
    ]);
    expect(result.canAttempt).toBe(false);
    expect(result.attemptNumber).toBe(3);
  });

  it(`${MAX_ATTEMPTS} failed attempts: canAttempt=false, reason includes "contact"`, () => {
    const pastAttempts = Array.from({ length: MAX_ATTEMPTS }, () => ({
      started_at: msAgo(COOLDOWN_MS + 10_000),
      submitted_at: msAgo(COOLDOWN_MS + 1_000),
      passed: false,
    }));
    const result = checkCooldown(pastAttempts);
    expect(result.canAttempt).toBe(false);
    expect(result.reason).toMatch(/contact/i);
  });

  it('retryAvailableAt is roughly now + COOLDOWN_HOURS', () => {
    const submittedAt = new Date().toISOString();
    const result = checkCooldown([
      {
        started_at: msAgo(5_000),
        submitted_at: submittedAt,
        passed: false,
      },
    ]);
    expect(result.retryAvailableAt).toBeDefined();
    const retryMs = new Date(result.retryAvailableAt!).getTime();
    const expectedMs = new Date(submittedAt).getTime() + COOLDOWN_MS;
    expect(Math.abs(retryMs - expectedMs)).toBeLessThan(1000);
  });

  it('injectable nowMs: future now makes cooldown elapsed', () => {
    const result = checkCooldown(
      [
        {
          started_at: msAgo(5_000),
          submitted_at: msAgo(1_000),
          passed: false,
        },
      ],
      Date.now() + COOLDOWN_MS + 60_000 // inject now as "tomorrow"
    );
    expect(result.canAttempt).toBe(true);
  });
});

// ─── findActiveAttempt ────────────────────────────────────────────────────────

describe('findActiveAttempt', () => {
  const TIME_LIMIT = 1800;

  it('empty list: returns null', () => {
    expect(findActiveAttempt([])).toBeNull();
  });

  it('all submitted: returns null', () => {
    const attempts = [
      {
        id: 'a1',
        started_at: msAgo(60_000),
        submitted_at: msAgo(30_000),
        time_limit_seconds: TIME_LIMIT,
      },
    ];
    expect(findActiveAttempt(attempts)).toBeNull();
  });

  it('expired attempt, not submitted: returns null', () => {
    const attempts = [
      {
        id: 'a1',
        started_at: msAgo((TIME_LIMIT + GRACE_SECONDS + 60) * 1000),
        submitted_at: null,
        time_limit_seconds: TIME_LIMIT,
      },
    ];
    expect(findActiveAttempt(attempts)).toBeNull();
  });

  it('fresh attempt, not submitted: returns that attempt', () => {
    const attempts = [
      {
        id: 'a1',
        started_at: new Date().toISOString(),
        submitted_at: null,
        time_limit_seconds: TIME_LIMIT,
      },
    ];
    expect(findActiveAttempt(attempts)?.id).toBe('a1');
  });

  it('mix of submitted + one active: returns the active one', () => {
    const attempts = [
      {
        id: 'old',
        started_at: msAgo(COOLDOWN_HOURS * 3_600_000 + 1000),
        submitted_at: msAgo(1000),
        time_limit_seconds: TIME_LIMIT,
      },
      {
        id: 'active',
        started_at: new Date().toISOString(),
        submitted_at: null,
        time_limit_seconds: TIME_LIMIT,
      },
    ];
    expect(findActiveAttempt(attempts)?.id).toBe('active');
  });
});

// ─── Exported constants ───────────────────────────────────────────────────────
//
// (buildCertCode tests were removed in Wave 4B P0 #10.a — the function
// was deleted. New cert-code coverage lives in tests/unit/cert-code.test.ts.)

describe('exported constants', () => {
  it('constants are exported with expected values', () => {
    expect(PASS_THRESHOLD_PERCENT).toBe(85);
    expect(COOLDOWN_HOURS).toBe(24);
    expect(MAX_ATTEMPTS).toBe(3);
    expect(GRACE_SECONDS).toBe(30);
  });
});
