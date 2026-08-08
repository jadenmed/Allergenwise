/**
 * POST /api/lesson/progress
 * Updates lesson_progress for the authenticated learner.
 *
 * Body: { lessonId: string, watchedSeconds: number }
 *
 * Behavior:
 * 1. Resolve learner from session (403 if not learner).
 * 2. Look up lesson → its module → all modules (for prereq check).
 * 3. Reject if module is locked (prereq module not complete).
 * 4. Anti-cheat: reject if wall-clock elapsed since first POST < 0.5 × watchedSeconds.
 * 5. Upsert lesson_progress: watched_seconds = max(existing, body).
 * 6. Mark complete if watched_seconds >= 0.9 × lesson.video_duration_seconds.
 * 7. Insert activity_events only on first transition to complete.
 */
import 'server-only';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createServiceDb } from '@/lib/db/service';
import { requireRole } from '@/lib/auth/require-role';
import {
  isLessonLocked,
  isWatchedSecondsPlausible,
  deriveLessonStatus,
} from '@/lib/learner/progress';
import type { LessonProgress } from '@/lib/types/db';

// ─── Validation ───────────────────────────────────────────────────────────────

const bodySchema = z.object({
  lessonId: z.string().uuid('lessonId must be a UUID'),
  watchedSeconds: z.number().int().nonnegative().max(86400, 'watchedSeconds too large'),
});

// ─── Route handler ────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  // ── Parse + validate body ─────────────────────────────────────────────────
  let body: z.infer<typeof bodySchema>;
  try {
    const raw = await req.json();
    body = bodySchema.parse(raw);
  } catch (err) {
    return NextResponse.json(
      {
        error: 'Invalid request body',
        details: err instanceof z.ZodError ? err.errors : undefined,
      },
      { status: 400 }
    );
  }

  const { lessonId, watchedSeconds } = body;

  // ── Auth: require learner session ─────────────────────────────────────────
  const auth = await requireRole({
    roles: ['learner'],
    profileClient: 'session',
    columns: 'id, role, restaurant_id',
    forbiddenMessage: 'Forbidden: learner role required',
    onMissingProfile: { status: 401, message: 'Profile not found' },
  });
  if (auth instanceof NextResponse) return auth;
  const { user, profile } = auth;

  // ── Use service client for all remaining reads/writes ────────────────────
  // (RLS would allow learner to read their own data, but service role avoids
  //  edge cases with complex joins and lets us write activity_events)
  const db = createServiceDb();

  // ── Look up the lesson + its module ──────────────────────────────────────
  const { data: lesson, error: lessonError } = await db
    .from('lessons')
    .select('id, module_id, video_duration_seconds')
    .eq('id', lessonId)
    .single();

  if (lessonError || !lesson) {
    return NextResponse.json({ error: 'Lesson not found' }, { status: 404 });
  }

  // ── Load all modules + all lessons (for lock check) ───────────────────────
  const { data: allModules, error: modulesError } = await db
    .from('modules')
    .select('id, order_index')
    .order('order_index', { ascending: true });

  if (modulesError || !allModules) {
    return NextResponse.json({ error: 'Failed to load modules' }, { status: 500 });
  }

  const { data: allLessons, error: allLessonsError } = await db
    .from('lessons')
    .select('id, module_id, order_index');

  if (allLessonsError || !allLessons) {
    return NextResponse.json({ error: 'Failed to load lessons' }, { status: 500 });
  }

  // Build lessonsPerModule map
  const lessonsPerModule: Record<string, string[]> = {};
  for (const l of allLessons) {
    if (!lessonsPerModule[l.module_id]) lessonsPerModule[l.module_id] = [];
    lessonsPerModule[l.module_id].push(l.id);
  }

  // ── Load learner's progress for all lessons ───────────────────────────────
  const { data: allProgress, error: progressError } = await db
    .from('lesson_progress')
    .select('lesson_id, status, watched_seconds')
    .eq('profile_id', user.id);

  if (progressError) {
    return NextResponse.json({ error: 'Failed to load progress' }, { status: 500 });
  }

  const progressMap: Record<string, { status: string; watched_seconds: number }> = {};
  for (const p of allProgress ?? []) {
    progressMap[p.lesson_id] = { status: p.status, watched_seconds: p.watched_seconds };
  }

  // ── Module lock check ─────────────────────────────────────────────────────
  const lessonModule = allModules.find(
    (m: { id: string; order_index: number }) => m.id === lesson.module_id
  );
  if (!lessonModule) {
    return NextResponse.json({ error: 'Lesson module not found' }, { status: 404 });
  }

  const locked = isLessonLocked(
    lessonModule.order_index,
    allModules,
    lessonsPerModule,
    progressMap as Parameters<typeof isLessonLocked>[3]
  );

  if (locked) {
    return NextResponse.json(
      { error: 'This module is locked. Complete the previous module first.' },
      { status: 403 }
    );
  }

  // ── Fetch existing progress row (if any) for anti-cheat ─────────────────
  const { data: existing } = await db
    .from('lesson_progress')
    .select('id, status, watched_seconds, started_at')
    .eq('profile_id', user.id)
    .eq('lesson_id', lessonId)
    .maybeSingle();

  // ── Anti-cheat: wall-clock elapsed time check ─────────────────────────────
  // On first POST (no existing row), started_at will be set to now() by the DB.
  // On subsequent POSTs, we have the real started_at to check against.
  const existingStartedAt =
    (existing as (LessonProgress & { started_at: string | null }) | null)?.started_at ?? null;
  const wasAlreadyStarted = existing != null;

  if (wasAlreadyStarted) {
    const plausible = isWatchedSecondsPlausible(watchedSeconds, existingStartedAt);
    if (!plausible) {
      return NextResponse.json(
        { error: 'Watch time exceeds elapsed time. Possible cheat attempt rejected.' },
        { status: 422 }
      );
    }
  }

  // ── Compute new watched_seconds (max of existing and incoming) ────────────
  const prevWatched = existing?.watched_seconds ?? 0;
  const newWatchedSeconds = Math.max(prevWatched, watchedSeconds);

  // ── Determine new status ──────────────────────────────────────────────────
  const existingStatus = (existing?.status ?? 'not_started') as LessonProgress['status'];
  const wasComplete = existingStatus === 'complete';
  const newStatus = deriveLessonStatus(
    newWatchedSeconds,
    lesson.video_duration_seconds,
    existingStatus
  );
  const justCompleted = !wasComplete && newStatus === 'complete';

  // ── Upsert lesson_progress ────────────────────────────────────────────────
  const now = new Date().toISOString();
  const upsertData: Record<string, unknown> = {
    profile_id: user.id,
    lesson_id: lessonId,
    status: newStatus,
    watched_seconds: newWatchedSeconds,
    completed_at: newStatus === 'complete' ? (existing?.completed_at ?? now) : null,
    // started_at: set only on first insert; on update, preserve via DB default
  };

  // On first insert, set started_at explicitly so we have a reliable anchor
  if (!wasAlreadyStarted) {
    upsertData['started_at'] = now;
  }

  const { error: upsertError } = await db
    .from('lesson_progress')
    .upsert(upsertData, { onConflict: 'profile_id,lesson_id' });

  if (upsertError) {
    return NextResponse.json({ error: 'Failed to save progress' }, { status: 500 });
  }

  // ── Insert activity_event on first completion ─────────────────────────────
  if (justCompleted) {
    await db.from('activity_events').insert({
      restaurant_id: profile.restaurant_id,
      actor_id: user.id,
      type: 'lesson_completed',
      payload: { lessonId, moduleId: lesson.module_id },
    });
    // Fire-and-forget: activity event failure is non-fatal for the learner
  }

  return NextResponse.json({
    ok: true,
    status: newStatus,
    watchedSeconds: newWatchedSeconds,
    justCompleted,
  });
}
