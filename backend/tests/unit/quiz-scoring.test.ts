/**
 * tests/unit/quiz-scoring.test.ts
 *
 * Pure-function tests for lib/learner/quiz.ts:scoreQuiz — lesson checkpoint-quiz
 * scoring over the shared question bank (migration 0018_shared_question_bank).
 *
 * scoreQuiz mirrors scoreExam's correctness rules but has NON-GATING semantics:
 * no pass threshold, no `passed` flag. These tests pin the scoring contract that
 * app/api/lessons/[lessonId]/quiz/submit relies on:
 *   - unanswered question → wrong
 *   - chosen choiceId from a different question → wrong
 *   - question with no correct choice (content bug) → never correct, still counts
 *     toward the denominator (lowers the score, doesn't shrink it)
 *   - empty quiz → 0/0, 0%
 */

import { describe, it, expect } from 'vitest';
import { scoreQuiz, type QuizQuestionWithOptions } from '@/lib/learner/quiz';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

/** A 3-question quiz; each question's correct option id ends in `-correct`. */
const QUESTIONS: QuizQuestionWithOptions[] = [
  {
    id: 'q1',
    options: [
      { id: 'q1-a', text: 'A', correct: false },
      { id: 'q1-correct', text: 'B', correct: true },
      { id: 'q1-c', text: 'C', correct: false },
    ],
  },
  {
    id: 'q2',
    options: [
      { id: 'q2-correct', text: 'A', correct: true },
      { id: 'q2-b', text: 'B', correct: false },
    ],
  },
  {
    id: 'q3',
    options: [
      { id: 'q3-a', text: 'A', correct: false },
      { id: 'q3-correct', text: 'B', correct: true },
    ],
  },
];

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('scoreQuiz', () => {
  it('scores a perfect attempt as 100%', () => {
    const result = scoreQuiz(QUESTIONS, {
      q1: 'q1-correct',
      q2: 'q2-correct',
      q3: 'q3-correct',
    });
    expect(result).toEqual({ scorePercent: 100, correctCount: 3, totalCount: 3 });
  });

  it('scores a fully wrong attempt as 0%', () => {
    const result = scoreQuiz(QUESTIONS, {
      q1: 'q1-a',
      q2: 'q2-b',
      q3: 'q3-a',
    });
    expect(result).toEqual({ scorePercent: 0, correctCount: 0, totalCount: 3 });
  });

  it('rounds a partial score (2/3 → 67%)', () => {
    const result = scoreQuiz(QUESTIONS, {
      q1: 'q1-correct',
      q2: 'q2-correct',
      q3: 'q3-a', // wrong
    });
    expect(result).toEqual({ scorePercent: 67, correctCount: 2, totalCount: 3 });
  });

  it('counts unanswered questions as wrong (denominator stays full)', () => {
    // Only q1 answered; q2 and q3 omitted entirely.
    const result = scoreQuiz(QUESTIONS, { q1: 'q1-correct' });
    expect(result).toEqual({ scorePercent: 33, correctCount: 1, totalCount: 3 });
  });

  it('treats a choiceId from a different question as wrong', () => {
    // q2's answer is a valid choice id, but it belongs to q1 — must not match.
    const result = scoreQuiz(QUESTIONS, {
      q1: 'q1-correct',
      q2: 'q1-correct', // foreign id
      q3: 'q3-correct',
    });
    expect(result).toEqual({ scorePercent: 67, correctCount: 2, totalCount: 3 });
  });

  it('treats an unknown choiceId as wrong', () => {
    const result = scoreQuiz(QUESTIONS, {
      q1: 'does-not-exist',
      q2: 'q2-correct',
      q3: 'q3-correct',
    });
    expect(result).toEqual({ scorePercent: 67, correctCount: 2, totalCount: 3 });
  });

  it('never counts a question with no correct option, but keeps it in the total', () => {
    const broken: QuizQuestionWithOptions[] = [
      {
        id: 'bad',
        options: [
          { id: 'bad-a', text: 'A', correct: false },
          { id: 'bad-b', text: 'B', correct: false }, // no correct option (content bug)
        ],
      },
      QUESTIONS[1], // q2 (answerable)
    ];
    // Even picking an option for the broken question can't earn a point.
    const result = scoreQuiz(broken, { bad: 'bad-a', q2: 'q2-correct' });
    expect(result).toEqual({ scorePercent: 50, correctCount: 1, totalCount: 2 });
  });

  it('returns 0/0 at 0% for an empty quiz', () => {
    expect(scoreQuiz([], {})).toEqual({ scorePercent: 0, correctCount: 0, totalCount: 0 });
  });

  it('ignores answers for question ids not in the quiz', () => {
    // A client cannot inflate the score by submitting extra answers; only the
    // quiz's own questions count.
    const result = scoreQuiz([QUESTIONS[0]], {
      q1: 'q1-correct',
      qZ: 'whatever', // not part of this quiz
    });
    expect(result).toEqual({ scorePercent: 100, correctCount: 1, totalCount: 1 });
  });
});
