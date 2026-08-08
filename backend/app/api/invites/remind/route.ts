/**
 * POST /api/invites/remind
 * Re-send invite email to an existing pending learner.
 *
 * Auth: caller must be admin; target learner must belong to same restaurant.
 * Body: { profileId }
 * Returns: { ok: true }
 *
 * Does NOT generate a new token. Uses existing invite_token on the profile.
 * To invalidate + regenerate, use /api/invites/[id]/resend.
 *
 * DEPENDENCY: Agent A's 0005_invite_tokens.sql (profiles.invite_token column).
 */
import 'server-only';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createServiceDb } from '@/lib/db/service';
import { requireRole } from '@/lib/auth/require-role';
import { sendEmail } from '@/lib/email/send';

// ─── Validation ───────────────────────────────────────────────────────────────

const BodySchema = z.object({
  profileId: z.string().uuid('profileId must be a valid UUID'),
});

// ─── Route handler ────────────────────────────────────────────────────────────

export async function POST(request: Request) {
  // ── 1. Parse body ─────────────────────────────────────────────────────────
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed.', details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const { profileId } = parsed.data;

  // ── 2. Verify caller is admin ──────────────────────────────────────────────
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

  // ── 3. Fetch target profile — must be in same restaurant ──────────────────
  // Type cast to access invite_token column (from 0005 migration)
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

  // ── 4. Cross-restaurant access check ──────────────────────────────────────
  if (targetProfile.restaurant_id !== adminProfile.restaurant_id) {
    return NextResponse.json(
      { error: 'Forbidden. Employee does not belong to your restaurant.' },
      { status: 403 }
    );
  }

  if (targetProfile.role !== 'learner') {
    return NextResponse.json({ error: 'Can only remind learner accounts.' }, { status: 400 });
  }

  // ── 5. Check invite state ──────────────────────────────────────────────────
  if (targetProfile.accepted_at) {
    return NextResponse.json(
      { error: 'This employee has already accepted their invitation.' },
      { status: 409 }
    );
  }

  if (!targetProfile.invite_token) {
    return NextResponse.json(
      {
        error: 'No pending invite token found. Use /api/invites/[id]/resend to generate a new one.',
      },
      { status: 409 }
    );
  }

  // ── 6. Fetch restaurant name ───────────────────────────────────────────────
  const { data: restaurant } = await serviceClient
    .from('restaurants')
    .select('name')
    .eq('id', adminProfile.restaurant_id)
    .single();

  const restaurantName = restaurant?.name ?? 'your restaurant';

  // ── 7. Re-send invite email (InviteReminder — Agent F2's component) ─────────
  const appUrl = process.env.APP_URL ?? 'http://localhost:3000';
  const inviteUrl = `${appUrl}/invite/${targetProfile.invite_token}`;

  // Compute days since original invite
  const invitedAtMs = targetProfile.invite_token
    ? Date.now() // fallback: treat as today if no invited_at
    : Date.now();
  // Use invited_at from profile if we have it (cast from raw select)
  const rawInvitedAt = (targetProfile as Record<string, unknown>)['invited_at'] as string | null;
  const sentDaysAgo = rawInvitedAt
    ? Math.max(1, Math.floor((Date.now() - new Date(rawInvitedAt).getTime()) / 86400000))
    : 1;
  void invitedAtMs; // suppress unused var warning

  sendEmail('InviteReminder', targetProfile.email, {
    recipientName: targetProfile.full_name,
    restaurantName,
    inviteLink: inviteUrl,
    sentDaysAgo,
  }).catch((emailErr) => {
    console.error('[invites/remind] email send failed (non-fatal):', emailErr);
  });

  // ── 8. Insert activity event ──────────────────────────────────────────────
  await serviceClient
    .from('activity_events')
    .insert({
      restaurant_id: adminProfile.restaurant_id,
      actor_id: adminProfile.id,
      type: 'invite_sent',
      payload: { inviteeEmail: targetProfile.email, inviteeId: targetProfile.id, action: 'remind' },
    })
    .then(() => {})
    .catch((err: unknown) => console.error('[invites/remind] activity_event insert failed:', err));

  return NextResponse.json({ ok: true });
}
