/**
 * GET /api/learner/home-data
 * Returns the full data needed for the learner courses home page.
 *
 * Response shape:
 * {
 *   modules: [{
 *     id, title, orderIndex,
 *     lessons: [{ id, title, orderIndex, status, watchedSeconds, totalSeconds }],
 *     status: 'locked'|'not_started'|'in_progress'|'complete',
 *     completedCount
 *   }],
 *   examUnlocked: boolean,
 *   certificate?: { certCode, issuedAt, expiresAt, pdfUrl }
 * }
 */
import 'server-only';
import { NextRequest, NextResponse } from 'next/server';
import { createServiceDb } from '@/lib/db/service';
import { requireRole } from '@/lib/auth/require-role';
import { isLessonLocked, areAllModulesComplete, deriveModuleStatus } from '@/lib/learner/progress';
import type { LessonStatus, Module, Lesson, LessonProgress } from '@/lib/types/db';

export async function GET(_req: NextRequest) {
  // ── Auth ──────────────────────────────────────────────────────────────────
  const auth = await requireRole({
    roles: ['learner'],
    profileClient: 'session',
    columns: 'id, role, restaurant_id',
    forbiddenMessage: 'Forbidden: learner role required',
    onMissingProfile: 'forbidden',
    // T-46a — "lesson progress visible but not resumable". This route is the
    // visible half: modules and lessons are shared curriculum, and every
    // learner-specific read below is keyed on their own profile_id. It reads
    // nothing about the restaurant. The resumable half — /api/lesson/progress,
    // /api/lesson/[lessonId], the exam and the quizzes — does NOT opt in.
    allowDeparted: true,
  });
  if (auth instanceof NextResponse) return auth;
  const { user } = auth;

  const db = createServiceDb();

  // ── Load all modules, lessons, and learner's progress in parallel ─────────
  const [modulesRes, lessonsRes, progressRes] = await Promise.all([
    db
      .from('modules')
      .select('id, order_index, title, description, estimated_minutes')
      .order('order_index', { ascending: true }),
    db
      .from('lessons')
      .select('id, module_id, order_index, title, video_duration_seconds')
      .order('order_index', { ascending: true }),
    db
      .from('lesson_progress')
      .select('lesson_id, status, watched_seconds')
      .eq('profile_id', user.id),
  ]);

  if (modulesRes.error || !modulesRes.data) {
    return NextResponse.json({ error: 'Failed to load modules' }, { status: 500 });
  }
  if (lessonsRes.error || !lessonsRes.data) {
    return NextResponse.json({ error: 'Failed to load lessons' }, { status: 500 });
  }

  const allModules = modulesRes.data;
  const allLessons = lessonsRes.data;
  const progressData = progressRes.data ?? [];

  // Build progress map
  const progressMap: Record<string, { status: LessonStatus; watched_seconds: number }> = {};
  for (const p of progressData) {
    progressMap[p.lesson_id] = {
      status: p.status as LessonStatus,
      watched_seconds: p.watched_seconds,
    };
  }

  // Build lessonsPerModule
  const lessonsPerModule: Record<string, string[]> = {};
  for (const l of allLessons) {
    if (!lessonsPerModule[l.module_id]) lessonsPerModule[l.module_id] = [];
    lessonsPerModule[l.module_id].push(l.id);
  }

  // ── Build module response ─────────────────────────────────────────────────
  const modules = (allModules as Module[]).map((mod) => {
    const moduleLessonIds = lessonsPerModule[mod.id] ?? [];
    const summary = deriveModuleStatus(
      mod,
      moduleLessonIds,
      progressMap,
      allModules as Module[],
      lessonsPerModule
    );

    const lessons = (allLessons as Lesson[])
      .filter((l) => l.module_id === mod.id)
      .map((l: Lesson) => {
        const prog = progressMap[l.id] as
          | { status: LessonStatus; watched_seconds: number }
          | undefined;
        const locked = isLessonLocked(
          mod.order_index,
          allModules as Module[],
          lessonsPerModule,
          progressMap as Record<
            string,
            { status: LessonProgress['status']; watched_seconds: number }
          >
        );
        return {
          id: l.id,
          title: l.title,
          orderIndex: l.order_index,
          status: locked ? 'locked' : (prog?.status ?? 'not_started'),
          watchedSeconds: prog?.watched_seconds ?? 0,
          totalSeconds: l.video_duration_seconds ?? 0,
        };
      });

    return {
      id: mod.id,
      title: mod.title,
      orderIndex: mod.order_index,
      estimatedMinutes: mod.estimated_minutes,
      lessons,
      status: summary.status,
      completedCount: summary.completedCount,
      totalCount: summary.totalCount,
    };
  });

  // ── Exam unlock check ─────────────────────────────────────────────────────
  const examUnlocked = areAllModulesComplete(
    (allModules as Module[]).map((m) => m.id),
    lessonsPerModule,
    progressMap as Record<string, { status: LessonProgress['status']; watched_seconds: number }>
  );

  // ── Certificate lookup ────────────────────────────────────────────────────
  let certificate:
    | {
        certCode: string;
        issuedAt: string;
        expiresAt: string;
        pdfUrl: string | null;
      }
    | undefined;

  // Wave 2C — only the latest publicly-active cert is shown on home-data.
  // Pending/expired/revoked/disputed surface elsewhere (full list via
  // /api/learner/certificate full history) but the home tile is "current".
  const { data: cert } = await db
    .from('certificates')
    .select('cert_code, issued_at, expires_at, pdf_storage_path')
    .eq('profile_id', user.id)
    .eq('status', 'active')
    .order('issued_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (cert) {
    let pdfUrl: string | null = null;
    if (cert.pdf_storage_path) {
      const { data: signedData } = await db.storage
        .from('certificates')
        .createSignedUrl(cert.pdf_storage_path, 3600); // 1h expiry
      pdfUrl = signedData?.signedUrl ?? null;
    }

    certificate = {
      certCode: cert.cert_code,
      issuedAt: cert.issued_at,
      expiresAt: cert.expires_at,
      pdfUrl,
    };
  }

  return NextResponse.json({ modules, examUnlocked, certificate });
}
