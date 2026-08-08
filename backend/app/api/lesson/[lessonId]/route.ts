/**
 * GET /api/lesson/[lessonId]
 * Returns lesson detail for the authenticated learner's lesson player.
 *
 * Response shape:
 * {
 *   lesson: {
 *     id, title, bodyMd, muxPlaybackId, videoDurationSeconds,
 *     moduleId, orderIndex, quickCheckQuestion, quickCheckOptions
 *   },
 *   module: { id, title, orderIndex, estimatedMinutes },
 *   lessons: [{ id, title, orderIndex, status }],   // all lessons in same module (for outline)
 *   progress: { status, watchedSeconds } | null,
 *   prevLessonId: string | null,
 *   nextLessonId: string | null,
 * }
 *
 * Auth: learner session required.
 * Module lock check: rejects 403 if lesson's module is locked.
 */
import 'server-only';
import { NextRequest, NextResponse } from 'next/server';
import { createServiceDb } from '@/lib/db/service';
import { requireRole } from '@/lib/auth/require-role';
import { isLessonLocked } from '@/lib/learner/progress';
import type { ModuleRow, ProgressMap } from '@/lib/learner/progress';
import type { LessonStatus } from '@/lib/types/db';

export async function GET(_req: NextRequest, { params }: { params: { lessonId: string } }) {
  const { lessonId } = params;

  if (!/^[0-9a-f-]{36}$/i.test(lessonId)) {
    return NextResponse.json({ error: 'Invalid lessonId' }, { status: 400 });
  }

  // ── Auth ──────────────────────────────────────────────────────────────────
  const auth = await requireRole({
    roles: ['learner', 'manager'],
    profileClient: 'session',
    columns: 'id, role',
    onMissingProfile: 'forbidden',
  });
  if (auth instanceof NextResponse) return auth;
  const { user } = auth;

  const db = createServiceDb();

  // ── Lesson lookup ─────────────────────────────────────────────────────────
  const { data: lesson, error: lessonError } = await db
    .from('lessons')
    .select(
      'id, module_id, order_index, title, body_md, video_mux_playback_id, video_duration_seconds, quick_check_question, quick_check_options'
    )
    .eq('id', lessonId)
    .single();

  if (lessonError || !lesson) {
    return NextResponse.json({ error: 'Lesson not found' }, { status: 404 });
  }

  // ── Load all modules + lessons for lock check + outline ───────────────────
  const [modulesRes, allLessonsRes, progressRes] = await Promise.all([
    db
      .from('modules')
      .select('id, order_index, title, estimated_minutes')
      .order('order_index', { ascending: true }),
    db
      .from('lessons')
      .select('id, module_id, order_index, title')
      .order('order_index', { ascending: true }),
    db
      .from('lesson_progress')
      .select('lesson_id, status, watched_seconds')
      .eq('profile_id', user.id),
  ]);

  // Type the raw Supabase rows explicitly to avoid implicit-any on .find()/.filter()/.map()
  // Use ModuleRow from lib/learner/progress (the authoritative type for isLessonLocked).
  type ExtModuleRow = ModuleRow & { title: string; estimated_minutes: number };
  type LessonRow = { id: string; module_id: string; order_index: number; title: string };
  type ProgressRow = { lesson_id: string; status: string; watched_seconds: number };

  const allModules = (modulesRes.data ?? []) as ExtModuleRow[];
  const allLessons = (allLessonsRes.data ?? []) as LessonRow[];
  const progressData = (progressRes.data ?? []) as ProgressRow[];

  // Build maps
  const lessonsPerModule: Record<string, string[]> = {};
  for (const l of allLessons) {
    if (!lessonsPerModule[l.module_id]) lessonsPerModule[l.module_id] = [];
    lessonsPerModule[l.module_id].push(l.id);
  }

  const progressMap: ProgressMap = {};
  for (const p of progressData) {
    progressMap[p.lesson_id] = {
      status: p.status as LessonStatus,
      watched_seconds: p.watched_seconds,
    };
  }

  // ── Module lock check ─────────────────────────────────────────────────────
  const lessonModule = allModules.find((m: ExtModuleRow) => m.id === lesson.module_id);
  if (!lessonModule) {
    return NextResponse.json({ error: 'Module not found' }, { status: 404 });
  }

  const locked = isLessonLocked(
    lessonModule.order_index,
    allModules,
    lessonsPerModule,
    progressMap
  );

  if (locked) {
    return NextResponse.json(
      { error: 'Module is locked. Complete the previous module first.' },
      { status: 403 }
    );
  }

  // ── Build module lesson outline with progress ─────────────────────────────
  const moduleLessons = allLessons
    .filter((l: LessonRow) => l.module_id === lesson.module_id)
    .sort((a: LessonRow, b: LessonRow) => a.order_index - b.order_index)
    .map((l: LessonRow) => ({
      id: l.id,
      title: l.title,
      orderIndex: l.order_index,
      status: progressMap[l.id]?.status ?? 'not_started',
    }));

  // ── Prev/next lesson nav within the module ────────────────────────────────
  const currentIdx = moduleLessons.findIndex((l: { id: string }) => l.id === lessonId);
  const prevLesson = currentIdx > 0 ? moduleLessons[currentIdx - 1] : null;
  const nextLesson = currentIdx < moduleLessons.length - 1 ? moduleLessons[currentIdx + 1] : null;

  // ── Learner's progress for this lesson ────────────────────────────────────
  const progress = progressMap[lessonId] ?? null;

  return NextResponse.json({
    lesson: {
      id: lesson.id,
      title: lesson.title,
      bodyMd: lesson.body_md,
      muxPlaybackId: lesson.video_mux_playback_id,
      videoDurationSeconds: lesson.video_duration_seconds,
      moduleId: lesson.module_id,
      orderIndex: lesson.order_index,
      quickCheckQuestion: lesson.quick_check_question,
      quickCheckOptions: lesson.quick_check_options,
    },
    module: {
      id: lessonModule.id,
      title: lessonModule.title,
      orderIndex: lessonModule.order_index,
      estimatedMinutes: lessonModule.estimated_minutes,
    },
    lessons: moduleLessons,
    progress: progress
      ? { status: progress.status, watchedSeconds: progress.watched_seconds }
      : null,
    prevLessonId: prevLesson?.id ?? null,
    nextLessonId: nextLesson?.id ?? null,
  });
}
