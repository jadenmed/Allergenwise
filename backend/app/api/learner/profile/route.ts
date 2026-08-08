/**
 * /api/learner/profile
 *
 * GET   — the authenticated learner's own profile, their restaurant's public
 *         details, and restaurant-wide staff certification counts.
 * PATCH — update the caller's own full_name / job_role.
 *
 * Response shapes:
 *   GET   { fullName, email, jobRole, since, restaurant: { name, address, city,
 *           state, zip, phone } | null, staffCounts: { total, certified, inTraining } }
 *   PATCH { fullName, jobRole }
 */
import 'server-only';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createServiceDb } from '@/lib/db/service';
import { requireRole } from '@/lib/auth/require-role';
import {
  DEPARTED_AT_COLUMN,
  LEARNER_ROLE,
  currentLearnerIdSet,
  deriveStaffCounts,
} from '@/lib/staff/membership';

export async function GET(_req: NextRequest) {
  const auth = await requireRole({
    roles: ['learner'],
    profileClient: 'session',
    columns: 'id, role, full_name, email, job_role, restaurant_id, accepted_at, created_at',
    forbiddenMessage: 'Forbidden: learner role required',
    onMissingProfile: 'forbidden',
    allowDeparted: true,
  });
  if (auth instanceof NextResponse) return auth;
  const { profile } = auth;

  const db = createServiceDb();

  let restaurant: {
    name: string;
    address: string | null;
    city: string | null;
    state: string | null;
    zip: string | null;
    phone: string | null;
  } | null = null;

  let staffCounts = { total: 0, certified: 0, inTraining: 0 };

  if (profile.restaurant_id) {
    const [{ data: restaurantRow }, { data: learnerRows }] = await Promise.all([
      db
        .from('restaurants')
        .select('name, address, city, state, zip, phone')
        .eq('id', profile.restaurant_id)
        .maybeSingle(),
      db
        .from('profiles')
        .select(`id, role, ${DEPARTED_AT_COLUMN}`)
        .eq('restaurant_id', profile.restaurant_id)
        .eq('role', LEARNER_ROLE),
    ]);

    restaurant = restaurantRow ?? null;

    type LearnerRow = { id: string; role: string; departed_at: string | null };
    const learnerIdSet = currentLearnerIdSet((learnerRows ?? []) as LearnerRow[]);
    const learnerIds = [...learnerIdSet];

    const { data: certRows } =
      learnerIds.length > 0
        ? await db
            .from('certificates')
            .select('profile_id, status')
            .eq('restaurant_id', profile.restaurant_id)
            .in('profile_id', learnerIds)
            .eq('status', 'active')
            .gt('expires_at', new Date().toISOString())
        : { data: [] as { profile_id: string; status: string }[] };

    staffCounts = deriveStaffCounts(
      (learnerRows ?? []) as LearnerRow[],
      (certRows ?? []) as { profile_id: string; status: string }[]
    );
  }

  return NextResponse.json({
    fullName: profile.full_name,
    email: profile.email,
    jobRole: profile.job_role,
    since: profile.accepted_at ?? profile.created_at,
    restaurant,
    staffCounts,
  });
}

const PatchSchema = z
  .object({
    fullName: z.string().trim().min(1).max(200).optional(),
    jobRole: z.preprocess((v) => (v === '' ? null : v), z.string().trim().max(120).nullable().optional()),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), {
    message: 'At least one field is required.',
  });

export async function PATCH(req: NextRequest) {
  const auth = await requireRole({
    roles: ['learner'],
    profileClient: 'session',
    columns: 'id, role',
    forbiddenMessage: 'Forbidden: learner role required',
    onMissingProfile: 'forbidden',
    allowDeparted: true,
  });
  if (auth instanceof NextResponse) return auth;
  const { user } = auth;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed.', details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const update: Record<string, unknown> = {};
  if (parsed.data.fullName !== undefined) update.full_name = parsed.data.fullName;
  if (parsed.data.jobRole !== undefined) update.job_role = parsed.data.jobRole;

  const db = createServiceDb();
  const { data, error } = await db
    .from('profiles')
    .update(update)
    .eq('id', user.id)
    .select('full_name, job_role')
    .single();

  if (error || !data) {
    return NextResponse.json({ error: 'Failed to update profile.' }, { status: 500 });
  }

  return NextResponse.json({ fullName: data.full_name, jobRole: data.job_role });
}
