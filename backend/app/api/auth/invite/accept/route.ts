/**
 * POST /api/auth/invite/accept
 *
 * Accepts an employee invite by:
 *   1. Looking up the profile by invite_token
 *   2. Validating the token is not expired (< 7 days from invited_at) and not already used
 *   3. Setting the Supabase Auth password via admin API
 *   4. Marking profiles.accepted_at = now(), clearing invite_token
 *
 * Returns: { redirectUrl } based on role.
 * Error:   { error, code }
 *
 * Note: this route is public (unauthenticated) — the token IS the authentication.
 *
 * P1-14 — order is load-bearing:
 *   1. Parse JSON body. Malformed → 400 (NOT consume rate-limit).
 *   2. Zod validate. Invalid → 400.
 *   3. Per-IP rate-limit (10/60s).
 *   4. Per-token-hash rate-limit (5/60s). The token is sha256-hashed
 *      before it becomes a rate-limit key so the raw secret never
 *      lands in Redis keyspace.
 *   5. Token validation + acceptance.
 *
 * Byte-identical 429 across "real token throttled" vs "fake token
 * throttled" means an attacker cannot probe invite-token existence
 * by observing rate-limit shape.
 */
import 'server-only';
import type { ActivityEventType } from '@/lib/types/db';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createHash } from 'node:crypto';
import { validateInviteToken, acceptInvite } from '@/lib/auth/invite';
import { establishSession } from '@/lib/auth/establish-session';
import { createServiceSupabase } from '@/lib/supabase/server';
import { getClientIpHash } from '@/lib/security/client-ip';
import { getInviteAcceptIpLimiter, getInviteAcceptTokenLimiter } from '@/lib/security/rate-limit';
import {
  runRateLimit,
  rateLimitedResponse,
  rateLimitUnavailableResponse,
} from '@/lib/security/rate-limit-guard';

// ─── Request schema ───────────────────────────────────────────────────────────

const acceptSchema = z.object({
  token: z.string().min(1, 'Token is required').max(100),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .max(72, 'Password too long'),
});

// ─── Handler ──────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const parsed = acceptSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed.', issues: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  // ── Rate limit (per-IP + per-token-hash) ───────────────────────────────────
  const pepper = process.env.RATELIMIT_IP_PEPPER ?? '';
  const ipHash = getClientIpHash(req, pepper);
  const tokenHash = createHash('sha256').update(parsed.data.token).digest('hex').slice(0, 32);

  const guard = await runRateLimit([
    { kind: 'per_ip', limiter: getInviteAcceptIpLimiter, key: ipHash },
    { kind: 'per_token', limiter: getInviteAcceptTokenLimiter, key: tokenHash },
  ]);

  if (guard.outcome !== 'ok') {
    const db = createServiceSupabase();
    if (guard.outcome === 'rate_limited') {
      await logEvent(db, 'invite_accept_rate_limited', {
        kind: guard.kind,
        ip_hash: ipHash,
        token_hash: tokenHash,
      });
      return rateLimitedResponse();
    }
    await logEvent(db, 'invite_accept_rate_limiter_down', { error: guard.error });
    return rateLimitUnavailableResponse();
  }

  // ── Token validation + acceptance ──────────────────────────────────────────
  const validation = await validateInviteToken(parsed.data.token);

  if (!validation.valid) {
    const messages: Record<string, string> = {
      not_found: 'Invite link is invalid.',
      expired: 'Invite link has expired. Ask your manager to resend it.',
      already_accepted: 'This invite has already been used.',
    };

    const status = validation.reason === 'not_found' ? 404 : 410;
    return NextResponse.json(
      { error: messages[validation.reason] ?? 'Invalid invite.', code: validation.reason },
      { status }
    );
  }

  const { redirectUrl } = await acceptInvite(validation.profile, parsed.data.password);

  // acceptInvite sets the password via the SERVICE-ROLE admin API, which cannot
  // set a session cookie. Sign the user in on the cookie-bound client so the
  // role redirect is not bounced back to /login. Best-effort — see
  // lib/auth/establish-session.ts.
  const signedIn = await establishSession(validation.profile.email, parsed.data.password);

  return NextResponse.json({ redirectUrl, signedIn });
}

async function logEvent(
  db: ReturnType<typeof createServiceSupabase>,
  type: ActivityEventType,
  payload: Record<string, unknown>
): Promise<void> {
  try {
    await db.from('activity_events').insert({ type, payload, actor_id: null });
  } catch (err) {
    console.error('[invite/accept] activity_events insert failed:', err);
  }
}
