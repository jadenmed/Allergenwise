/**
 * POST /api/invites/send
 * Invite a single employee (learner) to the restaurant.
 *
 * Auth: caller must be an authenticated admin.
 * Body: { email, fullName, jobRole }
 * Returns: { inviteId, email }
 *
 * Steps:
 *   1. Verify caller is admin (session lookup → profiles.role).
 *   2. Verify employee email not already in profiles for this restaurant.
 *   3. Create auth.users with email_confirm=false.
 *   4. Generate invite token via lib/auth/invite.ts generateInviteToken().
 *   5. Insert profiles row (role='learner', restaurant_id=admin's restaurant_id).
 *   6. Send EmployeeInvite email via Resend.
 *   7. Insert activity_event (type='invite_sent').
 *   8. Return { inviteId, email }.
 *
 * DEPENDENCY: Agent A's 0005_invite_tokens.sql must be run first (adds profiles.invite_token column).
 * Email uses Agent F2's EmployeeInvite React Email component (already shipped).
 */
import 'server-only';
import type { ActivityEventType } from '@/lib/types/db';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createServiceSupabase } from '@/lib/supabase/server';
import { createServiceDb } from '@/lib/db/service';
import { requireRole } from '@/lib/auth/require-role';
import { generateInviteToken } from '@/lib/auth/invite';
import { sendEmail } from '@/lib/email/send';
import { getClientIpHash } from '@/lib/security/client-ip';
import { getInviteSendIpLimiter, getInviteSendRestaurantLimiter } from '@/lib/security/rate-limit';
import {
  runRateLimit,
  rateLimitedResponse,
  rateLimitUnavailableResponse,
} from '@/lib/security/rate-limit-guard';

// ─── Validation schema ────────────────────────────────────────────────────────

const BodySchema = z.object({
  email: z.string().email('Invalid email address'),
  fullName: z.string().min(1, 'Full name is required').max(200),
  jobRole: z.string().min(1, 'Job role is required').max(100),
});

// ─── Route handler ────────────────────────────────────────────────────────────

export async function POST(request: Request) {
  const req = request as NextRequest;
  // ── 1. Parse + validate body ───────────────────────────────────────────────
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

  const { email, fullName, jobRole } = parsed.data;
  const emailLower = email.toLowerCase();

  // ── 1a. Per-IP rate-limit (pre-auth — protects against scanner traffic) ───
  // P1-14 ordering: format-validate → rate-limit → DB. The per-restaurant
  // limiter runs AFTER the admin/role lookup below (it needs the resolved
  // restaurant_id); the per-IP guard runs here.
  const pepper = process.env.RATELIMIT_IP_PEPPER ?? '';
  const ipHash = getClientIpHash(req, pepper);

  const ipGuard = await runRateLimit([
    { kind: 'per_ip', limiter: getInviteSendIpLimiter, key: ipHash },
  ]);

  if (ipGuard.outcome !== 'ok') {
    const log = createServiceSupabase();
    if (ipGuard.outcome === 'rate_limited') {
      await logEvent(log, 'invite_send_rate_limited', { kind: 'per_ip', ip_hash: ipHash });
      return rateLimitedResponse();
    }
    await logEvent(log, 'invite_send_rate_limiter_down', { error: ipGuard.error });
    return rateLimitUnavailableResponse();
  }

  // ── 2. Verify caller is admin (server-side — do not trust middleware alone) ─
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

  const restaurantId = adminProfile.restaurant_id;

  // ── 2a. Per-restaurant rate-limit (20/min — admins legitimately bulk-send) ─
  const restGuard = await runRateLimit([
    {
      kind: 'per_restaurant',
      limiter: getInviteSendRestaurantLimiter,
      key: restaurantId,
    },
  ]);

  if (restGuard.outcome !== 'ok') {
    const log = createServiceSupabase();
    if (restGuard.outcome === 'rate_limited') {
      await logEvent(log, 'invite_send_rate_limited', {
        kind: 'per_restaurant',
        ip_hash: ipHash,
        restaurant_id: restaurantId,
      });
      return rateLimitedResponse();
    }
    await logEvent(log, 'invite_send_rate_limiter_down', { error: restGuard.error });
    return rateLimitUnavailableResponse();
  }

  // ── 3. Check for duplicate email within this restaurant ───────────────────
  const { data: existingProfile } = await serviceClient
    .from('profiles')
    .select('id, accepted_at')
    .eq('restaurant_id', restaurantId)
    .eq('email', emailLower)
    .maybeSingle();

  if (existingProfile) {
    if (existingProfile.accepted_at) {
      return NextResponse.json(
        { error: 'An employee with this email has already accepted their invitation.' },
        { status: 409 }
      );
    }
    return NextResponse.json(
      { error: 'An invite for this email is already pending. Use /api/invites/remind to resend.' },
      { status: 409 }
    );
  }

  // ── 4. Fetch restaurant name for the email ────────────────────────────────
  const { data: restaurant } = await serviceClient
    .from('restaurants')
    .select('name')
    .eq('id', restaurantId)
    .single();

  const restaurantName = restaurant?.name ?? 'your restaurant';

  // ── 5. Create Supabase Auth user (email_confirm=false) ────────────────────
  const { data: newAuthUser, error: createUserError } = await serviceClient.auth.admin.createUser({
    email: emailLower,
    email_confirm: false,
    user_metadata: { full_name: fullName },
  });

  if (createUserError || !newAuthUser.user) {
    return NextResponse.json(
      { error: `Failed to create user account: ${createUserError?.message ?? 'unknown error'}` },
      { status: 500 }
    );
  }

  const newUserId = newAuthUser.user.id;

  // ── 6. Generate invite token ──────────────────────────────────────────────
  // Uses Agent A's lib/auth/invite.ts generateInviteToken() — 32-byte random, base64url
  const inviteToken = generateInviteToken();
  const now = new Date().toISOString();

  // ── 7. Insert profile row ─────────────────────────────────────────────────
  // invite_token column added by Agent A's 0005_invite_tokens.sql migration.
  // We use a type assertion to bypass the static Database type until the
  // generated types are regenerated post-migration.
  type ProfileInsert = {
    id: string;
    full_name: string;
    email: string;
    role: 'learner';
    restaurant_id: string;
    job_role: string;
    invited_at: string;
    invited_by: string;
    invite_token: string;
  };

  // SECURITY: this endpoint MUST NOT insert role='manager'.
  // The profiles_manager_insert_learner RLS policy provides
  // defense in depth, but it depends on this route never
  // attempting it. See audits/manager-course-architecture.md §10.5.
  const profileInsert: ProfileInsert = {
    id: newUserId,
    full_name: fullName,
    email: emailLower,
    role: 'learner',
    restaurant_id: restaurantId,
    job_role: jobRole,
    invited_at: now,
    invited_by: adminProfile.id,
    invite_token: inviteToken,
  };

  const { data: newProfile, error: insertProfileError } = await serviceClient
    .from('profiles')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .insert(profileInsert as any)
    .select('id')
    .single();

  if (insertProfileError || !newProfile) {
    // Rollback: delete the auth user we just created
    await serviceClient.auth.admin.deleteUser(newUserId).catch(() => {});
    return NextResponse.json(
      {
        error: `Failed to create employee profile: ${insertProfileError?.message ?? 'unknown error'}`,
      },
      { status: 500 }
    );
  }

  // ── 8. Send invite email (using Agent F2's EmployeeInvite React Email component) ─
  const appUrl = process.env.APP_URL ?? 'http://localhost:3000';
  const inviteUrl = `${appUrl}/invite/${inviteToken}`;

  sendEmail('EmployeeInvite', emailLower, {
    recipientName: fullName,
    restaurantName,
    inviteLink: inviteUrl,
  }).catch((emailErr) => {
    console.error('[invites/send] Email send failed:', emailErr);
  });

  // ── 9. Insert activity event ─────────────────────────────────────────────
  await serviceClient
    .from('activity_events')
    .insert({
      restaurant_id: restaurantId,
      actor_id: adminProfile.id,
      type: 'invite_sent',
      payload: { inviteeEmail: emailLower, inviteeId: newProfile.id, jobRole },
    })
    .then(() => {})
    .catch((err: unknown) => console.error('[invites/send] activity_event insert failed:', err));

  // ── 10. Return success ────────────────────────────────────────────────────
  // Email delivery is fire-and-forget (B4) — its outcome is no longer known
  // synchronously, so the response can no longer carry a real-time
  // delivery-failure warning. Use /api/invites/remind to retry regardless.
  return NextResponse.json(
    {
      inviteId: newProfile.id,
      email: emailLower,
    },
    { status: 201 }
  );
}

// ─── Activity-event helper for rate-limit observability ──────────────────────

async function logEvent(
  db: ReturnType<typeof createServiceSupabase>,
  type: ActivityEventType,
  payload: Record<string, unknown>
): Promise<void> {
  try {
    await db.from('activity_events').insert({ type, payload, actor_id: null });
  } catch (err) {
    console.error('[invites/send] activity_events insert failed:', err);
  }
}
