/**
 * POST /api/account/me/request-deletion
 *
 * P1-16 — phase 1 of the two-phase deletion flow.
 *
 *   1. Authenticated user requests deletion of their own account.
 *   2. We generate a 256-bit token, sha256-hash it, insert the hash
 *      into `account_deletion_tokens`, invalidate any prior
 *      outstanding tokens for this profile.
 *   3. We email the user a confirmation link carrying the raw token.
 *   4. We return `{ requestedAt, expiresAt, warnings }` where
 *      `warnings` is the sole-admin pre-warning per Concern 1.
 *
 * Order (load-bearing):
 *   parse JSON → auth → per-IP RL → per-account RL → DB writes.
 *
 * The body MAY be empty `{}`. The route does not need any caller-
 * supplied data; the subject is the authenticated user.
 */
import 'server-only';
import type { ActivityEventType } from '@/lib/types/db';
import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase, createServiceSupabase } from '@/lib/supabase/server';
import { getClientIpHash } from '@/lib/security/client-ip';
import {
  getAccountDeleteRequestIpLimiter,
  getAccountDeleteRequestAcctLimiter,
} from '@/lib/security/rate-limit';
import {
  runRateLimit,
  rateLimitedResponse,
  rateLimitUnavailableResponse,
} from '@/lib/security/rate-limit-guard';
import {
  generateDeletionToken,
  hashDeletionToken,
  TOKEN_TTL_MS,
} from '@/lib/account/deletion-token';
import { buildDeletionWarnings } from '@/lib/account/deletion-warnings';
import { sendEmail } from '@/lib/email/send';
import { maskEmail } from '@/lib/security/mask-pii';

async function logEvent(
  db: ReturnType<typeof createServiceSupabase>,
  type: ActivityEventType,
  payload: Record<string, unknown>,
  actorId: string | null = null
): Promise<void> {
  try {
    await db.from('activity_events').insert({ type, payload, actor_id: actorId });
  } catch (err) {
    console.error('[account/request-deletion] activity_events insert failed:', err);
  }
}

export async function POST(req: NextRequest) {
  // Parse body — tolerant of empty `{}`; never trust body content.
  try {
    await req.json().catch(() => undefined);
  } catch {
    /* ignore */
  }

  // Auth — session required.
  const sessionClient = await createServerSupabase();
  const {
    data: { user },
    error: authError,
  } = await sessionClient.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  }

  // Per-IP + per-account rate limit (in that order).
  const pepper = process.env.RATELIMIT_IP_PEPPER ?? '';
  const ipHash = getClientIpHash(req, pepper);
  const db = createServiceSupabase();

  const guard = await runRateLimit([
    { kind: 'per_ip', limiter: getAccountDeleteRequestIpLimiter, key: ipHash },
    { kind: 'per_account', limiter: getAccountDeleteRequestAcctLimiter, key: user.id },
  ]);

  if (guard.outcome !== 'ok') {
    if (guard.outcome === 'rate_limited') {
      await logEvent(db, 'account_deletion_request_rate_limited', {
        kind: guard.kind,
        ip_hash: ipHash,
        profile_id: user.id,
      });
      return rateLimitedResponse();
    }
    await logEvent(db, 'account_deletion_request_rate_limiter_down', { error: guard.error });
    return rateLimitUnavailableResponse();
  }

  // Look up profile (need full_name for the email greeting + email for delivery).
  const { data: profile } = await db
    .from('profiles')
    .select('id, full_name, email')
    .eq('id', user.id)
    .single();

  if (!profile) {
    return NextResponse.json({ error: 'Profile not found.' }, { status: 404 });
  }

  const p = profile as { id: string; full_name: string; email: string };

  // Invalidate any prior outstanding tokens for this profile.
  await (
    db as unknown as {
      from(t: string): {
        update(v: Record<string, unknown>): {
          eq(c: string, v: string): { is(c: string, v: null): Promise<{ error: unknown }> };
        };
      };
    }
  )
    .from('account_deletion_tokens')
    .update({ used_at: new Date().toISOString(), used_reason: 'superseded' })
    .eq('profile_id', p.id)
    .is('used_at', null);

  // Issue a new token.
  const rawToken = generateDeletionToken();
  const tokenHash = hashDeletionToken(rawToken);
  const issuedAt = new Date();
  const expiresAt = new Date(issuedAt.getTime() + TOKEN_TTL_MS);

  const { data: tokenRow, error: insertErr } = await (
    db as unknown as {
      from(t: string): {
        insert(v: Record<string, unknown>): {
          select(c: string): {
            single(): Promise<{ data: { id: string } | null; error: { message: string } | null }>;
          };
        };
      };
    }
  )
    .from('account_deletion_tokens')
    .insert({
      profile_id: p.id,
      token_hash: tokenHash,
      issued_at: issuedAt.toISOString(),
      expires_at: expiresAt.toISOString(),
      ip_hash: ipHash,
    })
    .select('id')
    .single();

  if (insertErr || !tokenRow) {
    return NextResponse.json({ error: 'Failed to issue deletion token.' }, { status: 500 });
  }

  // Sole-admin warnings — pure logic on top of a few service-role reads.
  const warnings = await buildDeletionWarnings(db, p.id).catch(() => [] as string[]);

  // Send confirmation email. Failure to send does NOT roll back the
  // token — the user can retry by requesting again (which supersedes).
  const appUrl = process.env.APP_URL ?? 'http://localhost:3000';
  const confirmLink = `${appUrl}/account/delete/confirm?token=${rawToken}`;

  sendEmail('AccountDeletionConfirm', p.email, {
    recipientName: p.full_name,
    confirmLink,
    expiresAt: expiresAt.toISOString(),
    warnings,
  }).catch((err) => {
    console.error(
      `[account/request-deletion] email send/render failed for to=${maskEmail(p.email)}:`,
      err
    );
  });

  // Audit-trail event — no PII.
  await logEvent(
    db,
    'account_deletion_requested',
    {
      profile_id: p.id,
      deletion_request_id: tokenRow.id,
      ip_hash: ipHash,
      warning_count: warnings.length,
    },
    null
  );

  return NextResponse.json(
    {
      requestedAt: issuedAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
      warnings,
    },
    { status: 201 }
  );
}
