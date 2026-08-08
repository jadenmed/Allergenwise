/**
 * GET /api/admin/roster
 * Returns all learner profiles for the caller's restaurant with progress aggregates.
 *
 * Auth: admin role required.
 * Uses service-role client for predictable multi-table joins (RLS would work
 * but service-role avoids recursive policy evaluation on lesson_progress join).
 *
 * Returns: RosterEntry[]
 * Each entry: {
 *   profileId, fullName, email, jobRole,
 *   modulesComplete, totalModules, status ('invited'|'in_progress'|'certified'),
 *   startedAt, certCode?, lastActivityAt
 * }
 */
import 'server-only';
import { NextResponse } from 'next/server';
import { createServiceDb } from '@/lib/db/service';
import { requireRole } from '@/lib/auth/require-role';
import { LEARNER_ROLE, onlyCurrentStaff } from '@/lib/staff/membership';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface RosterEntry {
  profileId: string;
  fullName: string;
  email: string;
  jobRole: string | null;
  modulesComplete: number;
  totalModules: number;
  status: 'invited' | 'in_progress' | 'certified';
  startedAt: string | null;
  certCode: string | null;
  lastActivityAt: string | null;
  invitedAt: string | null;
  acceptedAt: string | null;
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function GET() {
  // ── 1. Verify admin ────────────────────────────────────────────────────────
  const auth = await requireRole({
    roles: ['manager'],
    profileClient: 'service',
    columns: 'id, role, restaurant_id',
    unauthorizedMessage: 'Unauthorized.',
    forbiddenMessage: 'Forbidden. Admin role required.',
    requireRestaurant: { status: 403, message: 'Admin has no restaurant assigned.' },
  });
  if (auth instanceof NextResponse) return auth;
  const { profile: adminProfile } = auth;

  const serviceClient = createServiceDb();

  const restaurantId = adminProfile.restaurant_id;

  // ── 2. Fetch all CURRENT learners for this restaurant ──────────────────────
  // T-46a — departed staff are off the roster. Their certificate, progress and
  // exam attempts are all preserved in the database; they are simply no longer
  // this restaurant's staff.
  const { data: learners, error: learnersError } = await onlyCurrentStaff(
    serviceClient
      .from('profiles')
      .select('id, full_name, email, job_role, invited_at, accepted_at, created_at')
      .eq('restaurant_id', restaurantId)
      .eq('role', LEARNER_ROLE)
  ).order('created_at', { ascending: false });

  if (learnersError) {
    return NextResponse.json(
      { error: `Failed to fetch roster: ${learnersError.message}` },
      { status: 500 }
    );
  }

  if (!learners || learners.length === 0) {
    return NextResponse.json({ roster: [] });
  }

  type LearnerRow = {
    id: string;
    full_name: string;
    email: string;
    job_role: string | null;
    invited_at: string | null;
    accepted_at: string | null;
    created_at: string;
  };
  const learnerIds = (learners as LearnerRow[]).map((l) => l.id);

  // ── 3-6. Fetch all per-learner aggregates concurrently ─────────────────────
  // Five independent reads — each keyed only on learnerIds / restaurantId, none
  // consumes another's output. Errors are checked below in the ORIGINAL order
  // (progress → lessons return 500); activityRows and certs errors stay
  // unchecked exactly as before.
  const now = new Date().toISOString();
  const [
    { count: totalModulesCount },
    { data: progressRows, error: progressError },
    { data: allLessons, error: lessonsError },
    { data: activityRows },
    { data: certs },
  ] = await Promise.all([
    serviceClient.from('modules').select('id', { count: 'exact', head: true }),
    serviceClient
      .from('lesson_progress')
      .select('profile_id, lesson_id, status, completed_at')
      .in('profile_id', learnerIds)
      .eq('status', 'complete'),
    serviceClient.from('lessons').select('id, module_id'),
    serviceClient
      .from('activity_events')
      .select('actor_id, created_at')
      .eq('restaurant_id', restaurantId)
      .in('actor_id', learnerIds)
      .order('created_at', { ascending: false }),
    // Wave 2C — status='active' is the canonical predicate. expires_at > now
    // remains as a defense-in-depth in case the expire-certs cron is late.
    serviceClient
      .from('certificates')
      .select('profile_id, cert_code, issued_at, expires_at, status')
      .eq('restaurant_id', restaurantId)
      .in('profile_id', learnerIds)
      .eq('status', 'active')
      .gt('expires_at', now),
  ]);

  if (progressError) {
    return NextResponse.json(
      { error: `Failed to fetch lesson progress: ${progressError.message}` },
      { status: 500 }
    );
  }

  if (lessonsError) {
    return NextResponse.json(
      { error: `Failed to fetch lessons: ${lessonsError.message}` },
      { status: 500 }
    );
  }

  const totalModules = totalModulesCount ?? 5;

  // A module is "complete" for a learner if ALL lessons in that module are complete.
  // Get all lessons per module
  const lessonsByModule = new Map<string, string[]>(); // moduleId → lessonIds
  for (const lesson of allLessons ?? []) {
    const existing = lessonsByModule.get(lesson.module_id) ?? [];
    existing.push(lesson.id);
    lessonsByModule.set(lesson.module_id, existing);
  }

  // Completed lessons per learner
  const completedByLearner = new Map<string, Set<string>>(); // profileId → Set<lessonId>
  for (const row of progressRows ?? []) {
    const existing = completedByLearner.get(row.profile_id) ?? new Set<string>();
    existing.add(row.lesson_id);
    completedByLearner.set(row.profile_id, existing);
  }

  // Compute modulesComplete per learner
  function modulesComplete(profileId: string): number {
    const completedLessons = completedByLearner.get(profileId) ?? new Set<string>();
    let count = 0;
    for (const [, lessonIds] of lessonsByModule) {
      if (lessonIds.length > 0 && lessonIds.every((id) => completedLessons.has(id))) {
        count++;
      }
    }
    return count;
  }

  // Most recent activity per learner
  const lastActivityByLearner = new Map<string, string>();
  for (const row of activityRows ?? []) {
    if (row.actor_id && !lastActivityByLearner.has(row.actor_id)) {
      lastActivityByLearner.set(row.actor_id, row.created_at);
    }
  }

  // Most recent valid cert per learner
  const certByLearner = new Map<string, { cert_code: string; issued_at: string }>();
  for (const cert of certs ?? []) {
    const existing = certByLearner.get(cert.profile_id);
    if (!existing || cert.issued_at > existing.issued_at) {
      certByLearner.set(cert.profile_id, { cert_code: cert.cert_code, issued_at: cert.issued_at });
    }
  }

  // Earliest lesson started_at per learner (proxy for startedAt) — first
  // non-null completed_at (close enough for MVP).
  const startedAtByLearner = new Map<string, string>();
  for (const row of progressRows ?? []) {
    const existing = startedAtByLearner.get(row.profile_id);
    if (row.completed_at && (!existing || row.completed_at < existing)) {
      startedAtByLearner.set(row.profile_id, row.completed_at);
    }
  }

  // ── 8. Build roster ────────────────────────────────────────────────────────
  const roster: RosterEntry[] = (learners as LearnerRow[]).map((learner) => {
    const hasCert = certByLearner.has(learner.id);
    const modComplete = modulesComplete(learner.id);
    const hasStarted = (completedByLearner.get(learner.id)?.size ?? 0) > 0;

    let status: RosterEntry['status'];
    if (hasCert) {
      status = 'certified';
    } else if (hasStarted || learner.accepted_at) {
      status = 'in_progress';
    } else {
      status = 'invited';
    }

    return {
      profileId: learner.id,
      fullName: learner.full_name,
      email: learner.email,
      jobRole: learner.job_role,
      modulesComplete: modComplete,
      totalModules,
      status,
      startedAt: startedAtByLearner.get(learner.id) ?? null,
      certCode: certByLearner.get(learner.id)?.cert_code ?? null,
      lastActivityAt: lastActivityByLearner.get(learner.id) ?? null,
      invitedAt: learner.invited_at,
      acceptedAt: learner.accepted_at,
    };
  });

  return NextResponse.json({ roster });
}
