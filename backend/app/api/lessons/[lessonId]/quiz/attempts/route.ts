/**
 * GET /api/lessons/[lessonId]/quiz/attempts
 * Lists checkpoint-quiz attempts for a lesson (shared question bank, 0018).
 *
 * Scope by role (mirrors the RLS policies on quiz_attempts):
 *   - learner  → their OWN attempts for this lesson, plus their best score.
 *   - admin    → every attempt for this lesson by learners in THEIR restaurant.
 *   - reviewer → every attempt for this lesson.
 *
 * Best score is surfaced by default; the raw per-attempt list is included so
 * admins can audit progress. Per-answer detail lives in quiz_attempt_answers
 * (queryable separately).
 */
import 'server-only';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createServerSupabase } from '@/lib/supabase/server';
import { createServiceDb } from '@/lib/db/service';

const paramsSchema = z.object({ lessonId: z.string().uuid('lessonId must be a UUID') });

type AttemptRow = {
  id: string;
  profile_id: string;
  started_at: string;
  submitted_at: string | null;
  score_percent: number | null;
  correct_count: number | null;
  total_count: number | null;
};

function toView(a: AttemptRow) {
  return {
    id: a.id,
    profileId: a.profile_id,
    startedAt: a.started_at,
    submittedAt: a.submitted_at,
    scorePercent: a.score_percent,
    correctCount: a.correct_count,
    totalCount: a.total_count,
  };
}

function bestScore(rows: AttemptRow[]): number | null {
  const scores = rows.map((r) => r.score_percent).filter((s): s is number => s != null);
  return scores.length > 0 ? Math.max(...scores) : null;
}

export async function GET(_req: NextRequest, { params }: { params: { lessonId: string } }) {
  const parsedParams = paramsSchema.safeParse(params);
  if (!parsedParams.success) {
    return NextResponse.json({ error: 'Invalid lessonId' }, { status: 400 });
  }
  const { lessonId } = parsedParams.data;

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

  const cols =
    'id, profile_id, started_at, submitted_at, score_percent, correct_count, total_count';

  // ── Learner: own attempts ───────────────────────────────────────────────────
  if (profile.role === 'learner') {
    const { data, error } = await db
      .from('quiz_attempts')
      .select(cols)
      .eq('lesson_id', lessonId)
      .eq('profile_id', user.id)
      .order('started_at', { ascending: false });

    if (error) {
      return NextResponse.json({ error: 'Failed to load attempts' }, { status: 500 });
    }
    const rows = (data ?? []) as AttemptRow[];
    return NextResponse.json({ attempts: rows.map(toView), bestScorePercent: bestScore(rows) });
  }

  // ── Reviewer: all attempts for the lesson ───────────────────────────────────
  if (profile.role === 'reviewer') {
    const { data, error } = await db
      .from('quiz_attempts')
      .select(cols)
      .eq('lesson_id', lessonId)
      .order('started_at', { ascending: false });

    if (error) {
      return NextResponse.json({ error: 'Failed to load attempts' }, { status: 500 });
    }
    return NextResponse.json({ attempts: ((data ?? []) as AttemptRow[]).map(toView) });
  }

  // ── Manager: attempts by learners in their restaurant ───────────────────────
  if (profile.role === 'manager') {
    if (!profile.restaurant_id) {
      return NextResponse.json({ attempts: [] });
    }
    // Resolve the restaurant's learner profile ids first, then scope attempts to
    // them. (Service-role bypasses RLS, so the tenant filter is enforced here.)
    const { data: learners, error: learnersError } = await db
      .from('profiles')
      .select('id')
      .eq('restaurant_id', profile.restaurant_id);

    if (learnersError) {
      return NextResponse.json({ error: 'Failed to load roster' }, { status: 500 });
    }
    const learnerIds = (learners ?? []).map((p: { id: string }) => p.id);
    if (learnerIds.length === 0) {
      return NextResponse.json({ attempts: [] });
    }

    const { data, error } = await db
      .from('quiz_attempts')
      .select(cols)
      .eq('lesson_id', lessonId)
      .in('profile_id', learnerIds)
      .order('started_at', { ascending: false });

    if (error) {
      return NextResponse.json({ error: 'Failed to load attempts' }, { status: 500 });
    }
    return NextResponse.json({ attempts: ((data ?? []) as AttemptRow[]).map(toView) });
  }

  return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
}
