/**
 * tests/unit/exam-state-machine.test.ts
 *
 * Covers every exam attempt state transition (valid + invalid).
 * Tests are pure — no DB, no network, only lib/learner/exam.ts helpers.
 *
 * Exam attempt state machine:
 *   in_progress → submitted   (learner submits answers)           ✓ valid
 *   in_progress → timed_out   (cron exam-timeout-sweep)           ✓ valid
 *   submitted   → submitted   (replay: already submitted)         ✗ invalid
 *   timed_out   → submitted   (client submits after timeout)      ✗ invalid (guard)
 *
 * State is represented as:
 *   in_progress: submitted_at IS NULL AND not expired
 *   timed_out:   submitted_at IS NULL AND started_at + time_limit + grace < now
 *   submitted:   submitted_at IS NOT NULL
 */

import { describe, it, expect } from 'vitest';
import {
  isAttemptExpired,
  isAttemptActive,
  findActiveAttempt,
  scoreExam,
  checkCooldown,
  GRACE_SECONDS,
  PASS_THRESHOLD_PERCENT,
  COOLDOWN_HOURS,
  MAX_ATTEMPTS,
} from '@/lib/learner/exam';
import type { ExamAttempt } from '@/lib/types/db';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const NOW_MS = new Date('2026-04-30T12:00:00Z').getTime();
const TIME_LIMIT_S = 1800; // 30 minutes

/** A minimal ExamAttempt fixture factory */
function makeAttempt(
  overrides: Partial<{
    id: string;
    profile_id: string;
    started_at: string;
    submitted_at: string | null;
    time_limit_seconds: number;
    score_percent: number | null;
    passed: boolean | null;
    answers: Record<string, string> | null;
    updated_at: string;
  }> = {}
): Pick<
  ExamAttempt,
  'id' | 'started_at' | 'submitted_at' | 'time_limit_seconds' | 'passed' | 'score_percent'
> {
  return {
    id: 'attempt-uuid',
    started_at: new Date(NOW_MS - 10 * 60 * 1000).toISOString(), // started 10 min ago
    submitted_at: null,
    time_limit_seconds: TIME_LIMIT_S,
    score_percent: null,
    passed: null,
    ...overrides,
  };
}

// ─── isAttemptExpired ─────────────────────────────────────────────────────────

describe('isAttemptExpired', () => {
  it('returns false for an attempt started 10 min ago (30 min limit)', () => {
    const attempt = makeAttempt();
    expect(isAttemptExpired(attempt, NOW_MS)).toBe(false);
  });

  it('returns false at exactly the time limit (grace not yet elapsed)', () => {
    // Started at exactly TIME_LIMIT_S seconds ago — grace period still covers it
    const attempt = makeAttempt({
      started_at: new Date(NOW_MS - TIME_LIMIT_S * 1000).toISOString(),
    });
    expect(isAttemptExpired(attempt, NOW_MS)).toBe(false);
  });

  it('returns true after time limit + grace period', () => {
    const attempt = makeAttempt({
      started_at: new Date(NOW_MS - (TIME_LIMIT_S + GRACE_SECONDS + 1) * 1000).toISOString(),
    });
    expect(isAttemptExpired(attempt, NOW_MS)).toBe(true);
  });

  it('returns true for an attempt started exactly at grace boundary + 1ms', () => {
    const elapsedMs = (TIME_LIMIT_S + GRACE_SECONDS) * 1000 + 1;
    const attempt = makeAttempt({
      started_at: new Date(NOW_MS - elapsedMs).toISOString(),
    });
    expect(isAttemptExpired(attempt, NOW_MS)).toBe(true);
  });
});

// ─── isAttemptActive ──────────────────────────────────────────────────────────

describe('isAttemptActive — in_progress state', () => {
  it('returns true for an unsubmitted, non-expired attempt (in_progress)', () => {
    const attempt = makeAttempt();
    expect(isAttemptActive(attempt, NOW_MS)).toBe(true);
  });

  it('returns false for an already-submitted attempt', () => {
    const attempt = makeAttempt({ submitted_at: new Date(NOW_MS - 5000).toISOString() });
    expect(isAttemptActive(attempt, NOW_MS)).toBe(false);
  });

  it('returns false for a timed-out attempt (submitted_at still null, but expired)', () => {
    const attempt = makeAttempt({
      started_at: new Date(NOW_MS - (TIME_LIMIT_S + GRACE_SECONDS + 60) * 1000).toISOString(),
    });
    // submitted_at is null but expired → timed_out state
    expect(attempt.submitted_at).toBeNull();
    expect(isAttemptActive(attempt, NOW_MS)).toBe(false);
  });
});

// ─── in_progress → submitted (happy path) ────────────────────────────────────

describe('in_progress → submitted (valid transition)', () => {
  it('scoreExam correctly computes a passing score', () => {
    const questions = [
      {
        id: 'q1',
        options: [
          { id: 'o1', text: 'A', correct: true },
          { id: 'o2', text: 'B', correct: false },
        ],
      },
      {
        id: 'q2',
        options: [
          { id: 'o3', text: 'C', correct: false },
          { id: 'o4', text: 'D', correct: true },
        ],
      },
      {
        id: 'q3',
        options: [
          { id: 'o5', text: 'E', correct: true },
          { id: 'o6', text: 'F', correct: false },
        ],
      },
      {
        id: 'q4',
        options: [
          { id: 'o7', text: 'G', correct: false },
          { id: 'o8', text: 'H', correct: true },
        ],
      },
      {
        id: 'q5',
        options: [
          { id: 'o9', text: 'I', correct: true },
          { id: 'o10', text: 'J', correct: false },
        ],
      },
    ];

    // 5 out of 5 correct = 100% → PASS (threshold is 85% per packet §6;
    // 4/5 = 80% would now fail, so the passing case answers all correctly).
    const answers = { q1: 'o1', q2: 'o4', q3: 'o5', q4: 'o8', q5: 'o9' };
    const result = scoreExam(questions, answers);
    expect(result.correctCount).toBe(5);
    expect(result.scorePercent).toBe(100);
    expect(result.passed).toBe(true);
  });

  it('scoreExam correctly computes a failing score', () => {
    const questions = [
      { id: 'q1', options: [{ id: 'o1', text: 'A', correct: true }] },
      { id: 'q2', options: [{ id: 'o2', text: 'B', correct: true }] },
      { id: 'q3', options: [{ id: 'o3', text: 'C', correct: true }] },
      { id: 'q4', options: [{ id: 'o4', text: 'D', correct: true }] },
      { id: 'q5', options: [{ id: 'o5', text: 'E', correct: true }] },
    ];

    // 0 out of 5 = 0% → FAIL
    const answers = { q1: 'wrong', q2: 'wrong', q3: 'wrong', q4: 'wrong', q5: 'wrong' };
    const result = scoreExam(questions, answers);
    expect(result.correctCount).toBe(0);
    expect(result.scorePercent).toBe(0);
    expect(result.passed).toBe(false);
  });

  it(`scoreExam: ${PASS_THRESHOLD_PERCENT}% is the exact pass threshold`, () => {
    expect(PASS_THRESHOLD_PERCENT).toBe(85);
    const questions = Array.from({ length: 100 }, (_, i) => ({
      id: `q${i}`,
      options: [{ id: `o${i}`, text: 'X', correct: true }],
    }));
    // 84% should fail (just below threshold)
    const failAnswers: Record<string, string> = {};
    for (let i = 0; i < 84; i++) failAnswers[`q${i}`] = `o${i}`;
    const failResult = scoreExam(questions, failAnswers);
    expect(failResult.scorePercent).toBe(84);
    expect(failResult.passed).toBe(false);
    // 85% should pass (exact threshold)
    const passAnswers: Record<string, string> = {};
    for (let i = 0; i < 85; i++) passAnswers[`q${i}`] = `o${i}`;
    const passResult = scoreExam(questions, passAnswers);
    expect(passResult.scorePercent).toBe(85);
    expect(passResult.passed).toBe(true);
  });
});

// ─── in_progress → timed_out (cron sweep) ────────────────────────────────────

describe('in_progress → timed_out (cron exam-timeout-sweep)', () => {
  it('cron correctly identifies expired attempts as timed-out', () => {
    const timedOut = makeAttempt({
      started_at: new Date(NOW_MS - (TIME_LIMIT_S + GRACE_SECONDS + 5) * 1000).toISOString(),
      submitted_at: null,
    });
    // submitted_at is null but expired → timed_out
    expect(timedOut.submitted_at).toBeNull();
    expect(isAttemptExpired(timedOut, NOW_MS)).toBe(true);
  });

  it('cron does not sweep attempts still within grace window', () => {
    const inGrace = makeAttempt({
      started_at: new Date(NOW_MS - (TIME_LIMIT_S + GRACE_SECONDS - 5) * 1000).toISOString(),
    });
    expect(isAttemptExpired(inGrace, NOW_MS)).toBe(false);
  });
});

// ─── submitted → submitted (INVALID — replay guard) ──────────────────────────

describe('submitted → submitted (INVALID: replay guard)', () => {
  it('already-submitted attempt is not active (cannot re-submit)', () => {
    const submitted = makeAttempt({
      submitted_at: new Date(NOW_MS - 5 * 60 * 1000).toISOString(),
      score_percent: 85,
      passed: true,
    });
    // Guard: isAttemptActive returns false → route handler returns 409
    expect(isAttemptActive(submitted, NOW_MS)).toBe(false);
  });

  it('findActiveAttempt returns null for a list of already-submitted attempts', () => {
    const submitted1 = makeAttempt({
      id: 'attempt-1',
      submitted_at: new Date(NOW_MS - 2 * 60 * 60 * 1000).toISOString(),
      passed: false,
    });
    const submitted2 = makeAttempt({
      id: 'attempt-2',
      submitted_at: new Date(NOW_MS - 1 * 60 * 60 * 1000).toISOString(),
      passed: false,
    });
    const active = findActiveAttempt([submitted1, submitted2], NOW_MS);
    expect(active).toBeNull();
  });
});

// ─── timed_out → submitted (INVALID — client submits after timeout) ───────────

describe('timed_out → submitted (INVALID: client cannot submit expired attempt)', () => {
  it('isAttemptExpired returns true for a timed-out attempt, blocking submission', () => {
    const timedOut = makeAttempt({
      started_at: new Date(NOW_MS - (TIME_LIMIT_S + GRACE_SECONDS + 10) * 1000).toISOString(),
      submitted_at: null,
    });
    // Route handler checks isAttemptExpired → if true, rejects with 200 (time limit exceeded)
    expect(isAttemptExpired(timedOut, NOW_MS)).toBe(true);
    expect(isAttemptActive(timedOut, NOW_MS)).toBe(false);
  });

  it('a client submitting just past grace window is rejected by the route guard', () => {
    // Simulates the route handler guard:
    //   if (isAttemptExpired(attempt, Date.now())) → reject, do not count as valid submission
    const justPastGrace = makeAttempt({
      started_at: new Date(NOW_MS - (TIME_LIMIT_S + GRACE_SECONDS + 1) * 1000).toISOString(),
    });
    expect(isAttemptExpired(justPastGrace, NOW_MS)).toBe(true);
  });
});

// ─── cooldown + max-attempts ──────────────────────────────────────────────────

describe('checkCooldown — cooldown and max-attempts guards', () => {
  it('allows first attempt (no past attempts)', () => {
    const result = checkCooldown([], NOW_MS);
    expect(result.canAttempt).toBe(true);
    expect(result.attemptNumber).toBe(1);
  });

  it('blocks retry within cooldown window after a fail', () => {
    const failedAttempt = {
      started_at: new Date(NOW_MS - 2 * 60 * 60 * 1000).toISOString(),
      submitted_at: new Date(NOW_MS - 1 * 60 * 60 * 1000).toISOString(), // 1h ago
      passed: false,
    };
    const result = checkCooldown([failedAttempt], NOW_MS);
    expect(result.canAttempt).toBe(false);
    expect(result.reason).toContain(`${COOLDOWN_HOURS} hours`);
    expect(result.retryAvailableAt).toBeDefined();
  });

  it('allows retry after cooldown window has elapsed', () => {
    const failedAttempt = {
      started_at: new Date(NOW_MS - (COOLDOWN_HOURS + 2) * 60 * 60 * 1000).toISOString(),
      submitted_at: new Date(NOW_MS - (COOLDOWN_HOURS + 1) * 60 * 60 * 1000).toISOString(),
      passed: false,
    };
    const result = checkCooldown([failedAttempt], NOW_MS);
    expect(result.canAttempt).toBe(true);
    expect(result.attemptNumber).toBe(2);
  });

  it(`blocks after ${MAX_ATTEMPTS} submitted attempts`, () => {
    const attempts = Array.from({ length: MAX_ATTEMPTS }, (_, i) => ({
      started_at: new Date(NOW_MS - (MAX_ATTEMPTS - i) * 2 * 24 * 60 * 60 * 1000).toISOString(),
      submitted_at: new Date(
        NOW_MS - (MAX_ATTEMPTS - i) * 2 * 24 * 60 * 60 * 1000 + 1800000
      ).toISOString(),
      passed: false,
    }));
    const result = checkCooldown(attempts, NOW_MS);
    expect(result.canAttempt).toBe(false);
    expect(result.reason).toContain('Maximum attempts reached');
  });

  it('allows attempt after a passing submission (cooldown only applies to fails)', () => {
    const passedAttempt = {
      started_at: new Date(NOW_MS - 2 * 60 * 60 * 1000).toISOString(),
      submitted_at: new Date(NOW_MS - 1 * 60 * 60 * 1000).toISOString(),
      passed: true,
    };
    // After passing, a new attempt would be permitted (they already have a cert,
    // but the scoring system doesn't block it — that's a separate guard in the route)
    const result = checkCooldown([passedAttempt], NOW_MS);
    expect(result.canAttempt).toBe(true);
  });
});

// ─── findActiveAttempt ────────────────────────────────────────────────────────

describe('findActiveAttempt', () => {
  it('returns the active attempt from a list', () => {
    const submitted = makeAttempt({
      id: 'old',
      submitted_at: new Date(NOW_MS - 2 * 24 * 60 * 60 * 1000).toISOString(),
      passed: false,
    });
    const active = makeAttempt({ id: 'current' });
    const found = findActiveAttempt([submitted, active], NOW_MS);
    expect(found?.id).toBe('current');
  });

  it('returns null when no active attempt exists', () => {
    const submitted = makeAttempt({ submitted_at: new Date(NOW_MS - 5000).toISOString() });
    expect(findActiveAttempt([submitted], NOW_MS)).toBeNull();
  });

  it('returns null for an empty list', () => {
    expect(findActiveAttempt([], NOW_MS)).toBeNull();
  });
});
