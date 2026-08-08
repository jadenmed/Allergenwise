/**
 * POST   /api/admin/roster/[profileId]/departure  — take a learner off the roster
 * DELETE /api/admin/roster/[profileId]/departure  — undo that
 *
 * Auth: manager role required. Auth shape copied from
 * app/api/admin/roster/route.ts — requireRole with profileClient 'service',
 * then a service-role client, then every read and write scoped to the caller's
 * own restaurant_id.
 *
 * WHAT THIS DOES, AND WHAT IT REFUSES TO DO
 * ─────────────────────────────────────────
 * It sets one column: profiles.departed_at. That is the whole of membership
 * (lib/staff/membership.ts). It does NOT:
 *
 *   - touch the certificate. No status change, no deletion, no revocation. The
 *     person sat the exam, the restaurant paid for it, and the certificate
 *     names the restaurant and the date. It stays valid until it expires on its
 *     own schedule, and stays downloadable by them. Removal changes membership,
 *     never the credential.
 *   - null out restaurant_id. certificates.restaurant_id references it, and it
 *     is what lets the database still state "certified while at X".
 *   - delete lesson progress or exam attempts. The GDPR-erasure path
 *     (account_delete_user, 0016) is a different thing for a different reason,
 *     and using it to clear a roster destroys a credential the restaurant paid
 *     for.
 *   - transfer anything to another restaurant. Separate, later work.
 *
 * WHY LEARNERS ONLY
 * ─────────────────
 * auth_restaurant_id() (0026) has no role branch, so a departed MANAGER also
 * loses restaurant scope — correct in itself, but it means a restaurant whose
 * only manager was marked departed could no longer read or staff itself, and
 * profiles_manager_insert_learner would leave nobody able to recover it. So the
 * target must be role='learner'. That also makes self-departure impossible,
 * since the caller is a manager by definition.
 */
import 'server-only';
import { NextRequest, NextResponse } from 'next/server';
import { createServiceDb } from '@/lib/db/service';
import { requireRole } from '@/lib/auth/require-role';
import { LEARNER_ROLE } from '@/lib/staff/membership';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface RouteParams {
  params: { profileId: string };
}

/**
 * Shared body for both verbs. `departedAt` is the value to write: an ISO
 * timestamp to remove someone, null to put them back.
 */
async function setDeparture(profileId: string, departedAt: string | null): Promise<NextResponse> {
  // ── 1. Verify manager ──────────────────────────────────────────────────────
  const auth = await requireRole({
    roles: ['manager'],
    profileClient: 'service',
    columns: 'id, role, restaurant_id',
    unauthorizedMessage: 'Unauthorized.',
    forbiddenMessage: 'Forbidden. Manager role required.',
    requireRestaurant: { status: 403, message: 'Manager has no restaurant assigned.' },
  });
  if (auth instanceof NextResponse) return auth;
  const { user, profile: managerProfile } = auth;

  if (!UUID_PATTERN.test(profileId)) {
    return NextResponse.json({ error: 'Invalid profileId.' }, { status: 400 });
  }

  const db = createServiceDb();
  const restaurantId = managerProfile.restaurant_id as string;

  // ── 2. Resolve the target, scoped to the caller's own restaurant ───────────
  // The restaurant_id filter is the authorization check, not a convenience: a
  // manager has no business learning whether a given profile id exists at some
  // other restaurant, so a foreign id and a nonexistent one both 404.
  const { data: target, error: targetError } = await db
    .from('profiles')
    .select('id, role, departed_at')
    .eq('id', profileId)
    .eq('restaurant_id', restaurantId)
    .maybeSingle();

  if (targetError) {
    return NextResponse.json(
      { error: `Failed to load employee: ${targetError.message}` },
      { status: 500 }
    );
  }

  if (!target) {
    return NextResponse.json({ error: 'Employee not found at this restaurant.' }, { status: 404 });
  }

  const targetRow = target as { id: string; role: string; departed_at: string | null };

  // ── 3. Learners only — see the header ──────────────────────────────────────
  if (targetRow.role !== LEARNER_ROLE) {
    return NextResponse.json(
      { error: 'Only learner accounts can be removed from a roster.' },
      { status: 400 }
    );
  }

  // ── 4. Idempotent no-op ────────────────────────────────────────────────────
  // Removing someone twice is not an error, but it must not overwrite the
  // original departure date with a later one — that date is the record of when
  // they actually left.
  const alreadyInDesiredState =
    departedAt === null ? targetRow.departed_at === null : targetRow.departed_at !== null;

  if (alreadyInDesiredState) {
    return NextResponse.json({
      profileId: targetRow.id,
      departedAt: targetRow.departed_at,
      changed: false,
    });
  }

  // ── 5. The write — one column, scoped again ────────────────────────────────
  const { error: updateError } = await db
    .from('profiles')
    .update({ departed_at: departedAt })
    .eq('id', profileId)
    .eq('restaurant_id', restaurantId)
    .eq('role', LEARNER_ROLE);

  if (updateError) {
    return NextResponse.json(
      { error: `Failed to update employee: ${updateError.message}` },
      { status: 500 }
    );
  }

  // ── 6. Record it ───────────────────────────────────────────────────────────
  // Best-effort, like the other roster-adjacent writes: failing to log must not
  // undo a membership change the manager has already been told about.
  await db.from('activity_events').insert({
    type: departedAt === null ? 'staff_restored' : 'staff_departed',
    restaurant_id: restaurantId,
    actor_id: user.id,
    payload: { profileId: targetRow.id, departedAt },
  });

  return NextResponse.json({ profileId: targetRow.id, departedAt, changed: true });
}

// ─── Route handlers ───────────────────────────────────────────────────────────

/** Take a learner off the roster. */
export async function POST(_req: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  return setDeparture(params.profileId, new Date().toISOString());
}

/** Put them back. */
export async function DELETE(_req: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  return setDeparture(params.profileId, null);
}
