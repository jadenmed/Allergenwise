/**
 * POST /api/invites/[id]/resend
 * Alias for remind — but invalidates the old token and generates a fresh one.
 * Use when you suspect the original link was lost or compromised.
 *
 * Auth: caller must be admin; target must be in same restaurant.
 * Params: id = profileId (UUID)
 * Returns: { ok: true }
 *
 * DEPENDENCY: Agent A's 0005_invite_tokens.sql (profiles.invite_token column).
 */
import 'server-only';
import { NextResponse } from 'next/server';
import { createServiceDb } from '@/lib/db/service';
import { requireRole } from '@/lib/auth/require-role';
import { generateInviteToken } from '@/lib/auth/invite';
import { sendEmail } from '@/lib/email/send';

// ─── Route handler ────────────────────────────────────────────────────────────

export async function POST(_request: Request, { params }: { params: { id: string } }) {
  const profileId = params.id;

  // Basic UUID format check
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!UUID_RE.test(profileId)) {
    return NextResponse.json({ error: 'Invalid profile ID.' }, { status: 400 });
  }

  // ── 1. Verify caller is admin ──────────────────────────────────────────────
  const auth = await requireRole({
    roles: ['manager'],
    profileClient: 'service',
    columns: 'id, role, restaurant_id, full_name',
    unauthorizedMessage: 'Unauthorized.',
    forbiddenMessage: 'Forbidden. Admin role required.',
    requireRestaurant: { status: 403, message: 'Admin has no restaurant assigned.' },
  });
  if (auth instanceof NextResponse) return auth;
  const { profile: adminProfile } = auth;

  const serviceClient = createServiceDb();

  // ── 2. Fetch target profile ────────────────────────────────────────────────
  type ProfileWithToken = {
    id: string;
    email: string;
    full_name: string;
    restaurant_id: string | null;
    role: string;
    accepted_at: string | null;
    invite_token: string | null;
  };

  const { data: targetProfile, error: targetError } = (await serviceClient
    .from('profiles')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .select('id, email, full_name, restaurant_id, role, accepted_at, invite_token' as any)
    .eq('id', profileId)
    .single()) as unknown as { data: ProfileWithToken | null; error: { message: string } | null };

  if (targetError || !targetProfile) {
    return NextResponse.json({ error: 'Employee not found.' }, { status: 404 });
  }

  // ── 3. Cross-restaurant guard ──────────────────────────────────────────────
  if (targetProfile.restaurant_id !== adminProfile.restaurant_id) {
    return NextResponse.json(
      { error: 'Forbidden. Employee does not belong to your restaurant.' },
      { status: 403 }
    );
  }

  if (targetProfile.role !== 'learner') {
    return NextResponse.json(
      { error: 'Can only resend invites for learner accounts.' },
      { status: 400 }
    );
  }

  if (targetProfile.accepted_at) {
    return NextResponse.json(
      { error: 'This employee has already accepted their invitation.' },
      { status: 409 }
    );
  }

  // ── 4. Generate fresh token + update profile ───────────────────────────────
  const newToken = generateInviteToken();
  const now = new Date().toISOString();

  const { error: updateError } = await serviceClient
    .from('profiles')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .update({ invite_token: newToken, invited_at: now } as any)
    .eq('id', profileId);

  if (updateError) {
    return NextResponse.json(
      { error: `Failed to rotate invite token: ${updateError.message}` },
      { status: 500 }
    );
  }

  // ── 5. Fetch restaurant name ───────────────────────────────────────────────
  const { data: restaurant } = await serviceClient
    .from('restaurants')
    .select('name')
    .eq('id', adminProfile.restaurant_id)
    .single();

  const restaurantName = restaurant?.name ?? 'your restaurant';

  // ── 6. Send fresh invite email ─────────────────────────────────────────────
  const appUrl = process.env.APP_URL ?? 'http://localhost:3000';
  const inviteUrl = `${appUrl}/invite/${newToken}`;

  sendEmail('EmployeeInvite', targetProfile.email, {
    recipientName: targetProfile.full_name,
    restaurantName,
    inviteLink: inviteUrl,
  }).catch((emailErr) => {
    console.error('[invites/resend] email send failed (non-fatal):', emailErr);
  });

  // ── 7. Activity event ──────────────────────────────────────────────────────
  await serviceClient
    .from('activity_events')
    .insert({
      restaurant_id: adminProfile.restaurant_id,
      actor_id: adminProfile.id,
      type: 'invite_sent',
      payload: {
        inviteeEmail: targetProfile.email,
        inviteeId: targetProfile.id,
        action: 'resend_new_token',
      },
    })
    .then(() => {})
    .catch((err: unknown) => console.error('[invites/resend] activity_event insert failed:', err));

  return NextResponse.json({ ok: true });
}
