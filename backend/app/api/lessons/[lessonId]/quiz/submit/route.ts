/**
 * POST /api/lessons/[lessonId]/quiz/submit
 * Scores a lesson checkpoint-quiz attempt server-side against the canonical
 * answer key in question_choices (shared question bank, migration 0018).
 *
 * Body: { attemptId: string, answers: { [questionId]: choiceId } }
 *
 * Server-side (mirrors app/api/exam/submit/route.ts):
 *   1. Auth: learner session required.
 *   2. Validate the attempt belongs to this learner + this lesson, unsubmitted.
 *   3. Load the lesson's questions + choices from the DB (never trust the client).
 *   4. Score with scoreQuiz() over the lesson's FULL question set (unanswered →
 *      wrong; choice ids that don't belong to the question → wrong).
 *   5. Persist the attempt header (score, counts) + one quiz_attempt_answers row
 *      per question (full audit, including unanswered).
 *   6. Log activity event 'lesson_quiz_completed'.
 *
 * Returns { scorePercent, correctCount, totalCount }. Quizzes are NON-GATING —
 * there is no pass/fail, so no `passed` flag is returned.
 */
import 'server-only';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createServerSupabase } from '@/lib/supabase/server';
import { createServiceDb } from '@/lib/db/service';
import { scoreQuiz } from '@/lib/learner/quiz';

const paramsSchema = z.object({ lessonId: z.string().uuid('lessonId must be a UUID') });
const bodySchema = z.object({
  attemptId: z.string().uuid('attemptId must be a UUID'),
  answers: z.record(z.string().uuid(), z.string()),
});

type CanonicalQuestion = {
  id: string;
  question_choices: { id: string; text: string; is_correct: boolean }[];
};

export async function POST(req: NextRequest, { params }: { params: { lessonId: string } }) {
  const parsedParams = paramsSchema.safeParse(params);
  if (!parsedParams.success) {
    return NextResponse.json({ error: 'Invalid lessonId' }, { status: 400 });
  }
  const { lessonId } = parsedParams.data;

  // ── Parse + validate body ──────────────────────────────────────────────────
  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch (err) {
    return NextResponse.json(
      {
        error: 'Invalid request body',
        details: err instanceof z.ZodError ? err.errors : undefined,
      },
      { status: 400 }
    );
  }
  const { attemptId, answers } = body;

  // ── Auth ──────────────────────────────────────────────────────────────────
  const userSupabase = await createServerSupabase();
  const {
    data: { user },
    error: authError,
  } = await userSupabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const db = createServiceDb();

  const { data: profile } = (await db
    .from('profiles')
    .select('id, role, restaurant_id')
    .eq('id', user.id)
    .single()) as {
    data: { id: string; role: string; restaurant_id: string | null } | null;
    error: unknown;
  };

  if (!profile) {
    return NextResponse.json({ error: 'Profile not found' }, { status: 404 });
  }

  // ── Fetch + validate the attempt ────────────────────────────────────────────
  const { data: attempt, error: attemptError } = await db
    .from('quiz_attempts')
    .select('id, profile_id, lesson_id, submitted_at')
    .eq('id', attemptId)
    .single();

  if (attemptError || !attempt) {
    return NextResponse.json({ error: 'Quiz attempt not found' }, { status: 404 });
  }
  if (attempt.profile_id !== user.id) {
    return NextResponse.json({ error: 'Forbidden: not your attempt' }, { status: 403 });
  }
  if (attempt.lesson_id !== lessonId) {
    return NextResponse.json({ error: 'Attempt does not belong to this lesson' }, { status: 400 });
  }
  if (attempt.submitted_at != null) {
    return NextResponse.json({ error: 'Attempt already submitted' }, { status: 409 });
  }

  // ── Load canonical questions + choices for this lesson ──────────────────────
  const { data: rows, error: qErr } = await db
    .from('questions')
    .select('id, question_choices(id, text, is_correct)')
    .eq('lesson_id', lessonId);

  if (qErr) {
    return NextResponse.json({ error: 'Failed to load quiz questions' }, { status: 500 });
  }

  const canonical = (rows ?? []) as CanonicalQuestion[];

  // Score over the lesson's FULL question set (unanswered count as wrong;
  // client cannot inject extra question ids — only lesson questions count).
  const scoringQuestions = canonical.map((q) => ({
    id: q.id,
    options: q.question_choices.map((c) => ({ id: c.id, text: c.text, correct: c.is_correct })),
  }));
  const result = scoreQuiz(scoringQuestions, answers);

  const now = new Date().toISOString();

  // ── Persist attempt header ──────────────────────────────────────────────────
  const { error: updateError } = await db
    .from('quiz_attempts')
    .update({
      submitted_at: now,
      score_percent: result.scorePercent,
      correct_count: result.correctCount,
      total_count: result.totalCount,
    })
    .eq('id', attemptId);

  if (updateError) {
    return NextResponse.json({ error: 'Failed to save quiz result' }, { status: 500 });
  }

  // ── Persist per-question answer rows (full audit, incl. unanswered) ─────────
  // A chosen choiceId that doesn't belong to its question is stored as NULL
  // (would otherwise violate the question_choices FK) and counts as wrong.
  const answerRows = canonical.map((q) => {
    const validChoiceIds = new Set(q.question_choices.map((c) => c.id));
    const chosenRaw = answers[q.id];
    const chosen = chosenRaw && validChoiceIds.has(chosenRaw) ? chosenRaw : null;
    const correctChoice = q.question_choices.find((c) => c.is_correct);
    return {
      attempt_id: attemptId,
      question_id: q.id,
      choice_id: chosen,
      is_correct: chosen != null && correctChoice != null && chosen === correctChoice.id,
    };
  });

  if (answerRows.length > 0) {
    const { error: answersError } = await db.from('quiz_attempt_answers').insert(answerRows);
    if (answersError) {
      return NextResponse.json({ error: 'Failed to save quiz answers' }, { status: 500 });
    }
  }

  // ── Activity event (non-fatal) ──────────────────────────────────────────────
  await db
    .from('activity_events')
    .insert({
      restaurant_id: profile.restaurant_id,
      actor_id: user.id,
      type: 'lesson_quiz_completed',
      payload: {
        lesson_id: lessonId,
        attempt_id: attemptId,
        score_percent: result.scorePercent,
        correct_count: result.correctCount,
        total_count: result.totalCount,
      },
    })
    .catch(() => {
      /* non-fatal */
    });

  return NextResponse.json({
    scorePercent: result.scorePercent,
    correctCount: result.correctCount,
    totalCount: result.totalCount,
  });
}
