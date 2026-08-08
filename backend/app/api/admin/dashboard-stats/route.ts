/**
 * GET /api/admin/dashboard-stats
 * Returns stat-card data for the admin dashboard.
 *
 * Auth: admin role required.
 * Returns: {
 *   employeesTotal, certifiedCount, inProgressCount,
 *   daysUntilPlanEnds, certReadinessPct, pendingInvites,
 *   recentActivity: ActivitySummary[]
 * }
 *
 * daysUntilPlanEnds: from latest active subscriptions row.
 * recentActivity: last 10 activity_events for the restaurant (ordered desc).
 * certReadinessPct: certifiedCount / employeesTotal × 100 (0 if no employees).
 *
 * certifiedCount counts distinct CURRENT LEARNERS holding at least one active
 * certificate — people, the same unit as employeesTotal — not certificate rows
 * (T-23). certReadinessPct therefore cannot exceed 100 and needs no clamp:
 * certifiedSet is a subset of the learner id set employeesTotal is drawn from.
 */
import 'server-only';
import { NextResponse } from 'next/server';
import { createServiceDb } from '@/lib/db/service';
import { requireRole } from '@/lib/auth/require-role';
import {
  DEPARTED_AT_COLUMN,
  LEARNER_ROLE,
  certifiedLearnerIdSet,
  currentLearnerIdSet,
  onlyCurrentStaff,
} from '@/lib/staff/membership';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ActivitySummary {
  id: string;
  type: string;
  actorId: string | null;
  actorName: string | null;
  payload: Record<string, unknown> | null;
  createdAt: string;
}

export interface DashboardStats {
  employeesTotal: number;
  certifiedCount: number;
  inProgressCount: number;
  daysUntilPlanEnds: number | null; // null if no active plan
  certReadinessPct: number; // 0-100
  pendingInvites: number;
  recentActivity: ActivitySummary[];
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
  const now = new Date().toISOString();
  const today = now.split('T')[0]; // YYYY-MM-DD

  // ── 2. All CURRENT learners ────────────────────────────────────────────────
  // T-46a — departed staff drop out of every number on this dashboard:
  // employeesTotal, pendingInvites, certifiedCount and inProgressCount all
  // derive from this one read.
  // T-23 — `role` and `departed_at` join the select so the membership predicate
  // can be re-applied in memory by the module that owns it. The query filters
  // are unchanged; this is the same belt-and-braces posture as /api/search,
  // and it is what lets one helper produce the id set every count below uses.
  const { data: learners, error: learnersError } = await onlyCurrentStaff(
    serviceClient
      .from('profiles')
      .select(`id, accepted_at, invited_at, role, ${DEPARTED_AT_COLUMN}`)
      .eq('restaurant_id', restaurantId)
      .eq('role', LEARNER_ROLE)
  );

  if (learnersError) {
    return NextResponse.json({ error: 'Failed to fetch learner data.' }, { status: 500 });
  }

  type LearnerRow = {
    id: string;
    accepted_at: string | null;
    role: string;
    departed_at: string | null;
  };

  const learnerRows = (learners ?? []) as LearnerRow[];
  const learnerIdSet = currentLearnerIdSet(learnerRows);
  const currentLearners = learnerRows.filter((l) => learnerIdSet.has(l.id));

  const employeesTotal = learnerIdSet.size;
  const learnerIds = [...learnerIdSet];

  // ── 3. Pending invites (invited but not yet accepted) ──────────────────────
  const pendingInvites = currentLearners.filter((l) => l.accepted_at === null).length;

  // ── 4-8. Independent reads: certs (merged), subscription, recent activity ──
  // The two prior certificate queries (a count + a profile_id list) are merged
  // into ONE select: the distinct profile_id set drives both certifiedCount and
  // inProgressCount. The actor-name lookup stays sequential below (it depends
  // on actorIds from activityRows). certs/subs/activity errors stay unchecked
  // exactly as before.
  //
  // T-23 — `status` joins the select so certifiedLearnerIdSet applies the
  // publicly-active predicate itself rather than trusting the .eq() above.
  const certsPromise =
    learnerIds.length > 0
      ? serviceClient
          .from('certificates')
          .select('profile_id, status')
          .eq('restaurant_id', restaurantId)
          .in('profile_id', learnerIds)
          .eq('status', 'active')
          .gt('expires_at', now)
      : Promise.resolve({ data: [] as { profile_id: string; status: string }[] });

  const [{ data: certRows }, { data: activeSubs }, { data: activityRows }] = await Promise.all([
    certsPromise,
    serviceClient
      .from('subscriptions')
      .select('ends_at')
      .eq('restaurant_id', restaurantId)
      .eq('status', 'active')
      .gte('ends_at', today)
      .order('ends_at', { ascending: false })
      .limit(1),
    serviceClient
      .from('activity_events')
      .select('id, type, actor_id, payload, created_at')
      .eq('restaurant_id', restaurantId)
      .order('created_at', { ascending: false })
      .limit(10),
  ]);

  // Certificates — T-23. `certifiedCount` was `certRows.length`, i.e. certificate
  // ROWS, while `employeesTotal` counts distinct learner PROFILES. One learner
  // holding two active certificates counted twice, so certReadinessPct below
  // could read 200%. The distinct set was already being built here for
  // inProgressCount; the count now comes from it, so both numbers are people.
  const certifiedSet = certifiedLearnerIdSet(
    (certRows ?? []) as Array<{ profile_id: string; status: string }>,
    learnerIdSet
  );
  const certifiedCount = certifiedSet.size;

  // "In progress" = accepted_at set AND not certified
  const inProgressCount = currentLearners.filter(
    (l) => l.accepted_at !== null && !certifiedSet.has(l.id)
  ).length;

  // Days until plan ends
  let daysUntilPlanEnds: number | null = null;
  if (activeSubs && activeSubs.length > 0) {
    const endsAt = new Date(activeSubs[0].ends_at);
    const nowDate = new Date(today);
    const diffMs = endsAt.getTime() - nowDate.getTime();
    daysUntilPlanEnds = Math.max(0, Math.ceil(diffMs / 86400000));
  }

  // Cert readiness %
  const certReadinessPct =
    employeesTotal === 0 ? 0 : Math.round((certifiedCount / employeesTotal) * 100);

  // Fetch actor names for activity events (sequential — depends on activityRows)
  const actorIds = [
    ...new Set(
      (activityRows ?? [])
        .map((r: { actor_id: string | null }) => r.actor_id)
        .filter(Boolean) as string[]
    ),
  ];

  const actorNameMap = new Map<string, string>();
  if (actorIds.length > 0) {
    const { data: actors } = await serviceClient
      .from('profiles')
      .select('id, full_name')
      .in('id', actorIds);

    for (const actor of actors ?? []) {
      actorNameMap.set(actor.id, actor.full_name);
    }
  }

  const recentActivity: ActivitySummary[] = (activityRows ?? []).map(
    (row: {
      id: string;
      type: string;
      actor_id: string | null;
      payload: Record<string, unknown> | null;
      created_at: string;
    }) => ({
      id: row.id,
      type: row.type,
      actorId: row.actor_id,
      actorName: row.actor_id ? (actorNameMap.get(row.actor_id) ?? null) : null,
      payload: row.payload as Record<string, unknown> | null,
      createdAt: row.created_at,
    })
  );

  // ── 9. Return stats ───────────────────────────────────────────────────────
  const stats: DashboardStats = {
    employeesTotal,
    certifiedCount,
    inProgressCount,
    daysUntilPlanEnds,
    certReadinessPct,
    pendingInvites,
    recentActivity,
  };

  return NextResponse.json(stats);
}
