/**
 * POST /api/lessons/[lessonId]/quiz/start
 * Starts a lesson checkpoint-quiz attempt for the authenticated learner.
 *
 * Quizzes are NON-GATING: unlimited retries, no time limit, no cooldown. Each
 * start shuffles the lesson's question pool (shared question bank, migration
 * 0018) and opens a fresh quiz_attempts row.
 *
 * Returns { attemptId, questions: [{ id, prompt, choices: [{ id, text }] }] }.
 * The answer key (question_choices.is_correct) is NEVER selected or returned.
 */
import 'server-only';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createServiceDb } from '@/lib/db/service';
import { requireRole } from '@/lib/auth/require-role';
import { secureShuffle } from '@/lib/security/secure-random';

const paramsSchema = z.object({ lessonId: z.string().uuid('lessonId must be a UUID') });

type BankQuestion = {
  id: string;
  prompt: string;
  question_choices: { id: string; text: string; order_index: number }[];
};

export async function POST(_req: NextRequest, { params }: { params: { lessonId: string } }) {
  const parsedParams = paramsSchema.safeParse(params);
  if (!parsedParams.success) {
    return NextResponse.json({ error: 'Invalid lessonId' }, { status: 400 });
  }
  const { lessonId } = parsedParams.data;

  // ── Auth ──────────────────────────────────────────────────────────────────
  const auth = await requireRole({
    roles: ['learner'],
    profileClient: 'service',
    columns: 'id, role',
    forbiddenMessage: 'Forbidden: learner role required',
    onMissingProfile: 'forbidden',
  });
  if (auth instanceof NextResponse) return auth;
  const { user } = auth;

  const db = createServiceDb();

  // ── Lesson exists? ──────────────────────────────────────────────────────────
  const { data: lesson } = await db.from('lessons').select('id').eq('id', lessonId).maybeSingle();

  if (!lesson) {
    return NextResponse.json({ error: 'Lesson not found' }, { status: 404 });
  }

  // ── Load the lesson's question pool ─────────────────────────────────────────
  const { data: rows, error: qErr } = await db
    .from('questions')
    .select('id, prompt, question_choices(id, text, order_index)')
    .eq('lesson_id', lessonId);

  if (qErr) {
    return NextResponse.json({ error: 'Failed to load quiz questions' }, { status: 500 });
  }

  const pool = (rows ?? []) as BankQuestion[];
  if (pool.length === 0) {
    return NextResponse.json({ error: 'No quiz available for this lesson' }, { status: 404 });
  }

  // ── Open the attempt ────────────────────────────────────────────────────────
  const { data: attempt, error: insertError } = await db
    .from('quiz_attempts')
    .insert({ profile_id: user.id, lesson_id: lessonId })
    .select('id')
    .single();

  if (insertError || !attempt) {
    return NextResponse.json({ error: 'Failed to start quiz attempt' }, { status: 500 });
  }

  // ── Shuffle question order; sort choices by order_index; strip is_correct ───
  const questions = secureShuffle(pool).map((q) => ({
    id: q.id,
    prompt: q.prompt,
    choices: [...q.question_choices]
      .sort((a, b) => a.order_index - b.order_index)
      .map(({ id, text }) => ({ id, text })),
  }));

  return NextResponse.json({ attemptId: attempt.id, questions });
}
