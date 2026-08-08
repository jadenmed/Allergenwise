/**
 * lib/learner/quiz.ts
 * Pure scoring for lesson checkpoint quizzes (shared question bank, migration
 * 0018). No DB calls — takes canonical questions + the learner's answers and
 * returns a computed result.
 *
 * Mirrors lib/learner/exam.ts:scoreExam, but with LESSON-QUIZ semantics:
 *   - Quizzes are NON-GATING: there is no pass threshold and no `passed` flag.
 *     Unlimited retries; the best score is surfaced elsewhere.
 *   - Kept as a separate export from scoreExam on purpose — the two callsites
 *     have different pass/fail semantics, so each gets its own test surface.
 *
 * Tested by: tests/unit/quiz-scoring.test.ts
 */

import type { ExamQuestionOption } from '@/lib/types/db';

// ─── Scoring ─────────────────────────────────────────────────────────────────

export interface QuizQuestionWithOptions {
  id: string;
  options: ExamQuestionOption[]; // {id, text, correct}
}

export interface QuizScoreResult {
  scorePercent: number; // 0–100, rounded
  correctCount: number;
  totalCount: number;
}

/**
 * Computes a quiz score given a map of questionId → chosen choiceId and the
 * canonical questions with their correct choices.
 *
 * Rules (identical to scoreExam, minus the pass threshold):
 * - Questions not answered by the learner count as wrong.
 * - A chosen choiceId that does not belong to the question (e.g. a choice id
 *   from a different question) does not match the question's correct choice, so
 *   it counts as wrong.
 * - If a question has no correct choice marked (data error), it is skipped
 *   for scoring (never counted correct) but still counts toward the total,
 *   matching scoreExam — a content bug lowers the score rather than silently
 *   shrinking the denominator.
 */
export function scoreQuiz(
  questions: QuizQuestionWithOptions[],
  answers: Record<string, string>
): QuizScoreResult {
  const total = questions.length;
  if (total === 0) return { scorePercent: 0, correctCount: 0, totalCount: 0 };

  let correct = 0;
  for (const q of questions) {
    const chosenId = answers[q.id];
    if (!chosenId) continue; // unanswered → wrong
    const correctOption = q.options.find((o) => o.correct);
    if (!correctOption) continue; // data error — skip (counts as wrong)
    if (chosenId === correctOption.id) correct++;
  }

  return {
    scorePercent: Math.round((correct / total) * 100),
    correctCount: correct,
    totalCount: total,
  };
}
