/**
 * POST /api/lesson/[lessonId]/complete
 * Hard-marks a lesson complete. Intended as:
 * - Admin override (bypass watch-time requirement for demo/admin scenarios).
 * - Final-second sync from player when video ends (insurance POST).
 *
 * Same auth + module-lock check as /api/lesson/progress.
 * Does NOT perform the anti-cheat wall-clock check (by design — this is an
 * explicit "mark complete" action, not a progress update).
 *
 * Requires authenticated learner OR admin. Admins can hard-mark for themselves
 * only (not on behalf of other learners).
 */
import 'server-only';
import { NextRequest, NextResponse } from 'next/server';
import { createServiceDb } from '@/lib/db/service';
import { requireRole } from '@/lib/auth/require-role';
import { isLessonLocked } from '@/lib/learner/progress';

export async function POST(_req: NextRequest, { params }: { params: { lessonId: string } }) {
  const { lessonId } = params;

  // Basic UUID format check
  if (!/^[0-9a-f-]{36}$/i.test(lessonId)) {
    return NextResponse.json({ error: 'Invalid lessonId' }, { status: 400 });
  }

  // ── Auth ──────────────────────────────────────────────────────────────────
  const auth = await requireRole({
    roles: ['learner', 'manager'],
    profileClient: 'session',
    columns: 'id, role, restaurant_id',
    onMissingProfile: 'forbidden',
  });
  if (auth instanceof NextResponse) return auth;
  const { user, profile } = auth;

  const db = createServiceDb();

  // ── Lesson lookup ─────────────────────────────────────────────────────────
  const { data: lesson, error: lessonError } = await db
    .from('lessons')
    .select('id, module_id, video_duration_seconds')
    .eq('id', lessonId)
    .single();

  if (lessonError || !lesson) {
    return NextResponse.json({ error: 'Lesson not found' }, { status: 404 });
  }

  // ── Module lock check ─────────────────────────────────────────────────────
  const { data: allModules } = await db
    .from('modules')
    .select('id, order_index')
    .order('order_index', { ascending: true });

  const { data: allLessons } = await db.from('lessons').select('id, module_id');

  const lessonsPerModule: Record<string, string[]> = {};
  for (const l of allLessons ?? []) {
    if (!lessonsPerModule[l.module_id]) lessonsPerModule[l.module_id] = [];
    lessonsPerModule[l.module_id].push(l.id);
  }

  const { data: allProgress } = await db
    .from('lesson_progress')
    .select('lesson_id, status, watched_seconds')
    .eq('profile_id', user.id);

  const progressMap: Record<string, { status: string; watched_seconds: number }> = {};
  for (const p of allProgress ?? []) {
    progressMap[p.lesson_id] = { status: p.status, watched_seconds: p.watched_seconds };
  }

  const lessonModule = (allModules ?? []).find(
    (m: { id: string; order_index: number }) => m.id === lesson.module_id
  );
  if (!lessonModule) {
    return NextResponse.json({ error: 'Module not found' }, { status: 404 });
  }

  const locked = isLessonLocked(
    lessonModule.order_index,
    allModules ?? [],
    lessonsPerModule,
    progressMap as Parameters<typeof isLessonLocked>[3]
  );

  if (locked) {
    return NextResponse.json(
      { error: 'Module is locked. Complete the previous module first.' },
      { status: 403 }
    );
  }

  // ── Fetch existing progress ───────────────────────────────────────────────
  const { data: existing } = await db
    .from('lesson_progress')
    .select('id, status, watched_seconds, completed_at')
    .eq('profile_id', user.id)
    .eq('lesson_id', lessonId)
    .maybeSingle();

  const wasComplete = existing?.status === 'complete';
  const now = new Date().toISOString();

  // ── Upsert as complete ────────────────────────────────────────────────────
  const { error: upsertError } = await db.from('lesson_progress').upsert(
    {
      profile_id: user.id,
      lesson_id: lessonId,
      status: 'complete',
      watched_seconds: Math.max(existing?.watched_seconds ?? 0, lesson.video_duration_seconds ?? 0),
      completed_at: existing?.completed_at ?? now,
      started_at: now, // safe: on conflict, update does not overwrite if we exclude it
    },
    { onConflict: 'profile_id,lesson_id' }
  );

  if (upsertError) {
    return NextResponse.json({ error: 'Failed to mark complete' }, { status: 500 });
  }

  // ── Activity event on first completion ────────────────────────────────────
  if (!wasComplete) {
    await db.from('activity_events').insert({
      restaurant_id: profile.restaurant_id,
      actor_id: user.id,
      type: 'lesson_completed',
      payload: { lessonId, moduleId: lesson.module_id, via: 'hard_complete' },
    });
  }

  return NextResponse.json({ ok: true, status: 'complete', justCompleted: !wasComplete });
}
