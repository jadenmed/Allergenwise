/**
 * POST /api/account/me/confirm-deletion
 *
 * P1-16 — phase 2. Body: `{ token }`.
 *
 *   1. Auth required — session must match the token's profile.
 *      A token alone is NOT enough.
 *   2. Per-IP rate-limit (brute-force defense against 256-bit token).
 *   3. Hash the token, look up by hash, validate (expired / used /
 *      mismatch all → 410 Gone with a generic message).
 *   4. Run `executeAccountDeletion` (auth ban + RPC transaction +
 *      storage cleanup).
 *   5. Stamp `used_at` on the token row.
 *
 * The 410 body is deliberately generic — does not reveal whether the
 * token was expired, used, or never existed. The activity event
 * differentiates for ops.
 */
import 'server-only';
import type { ActivityEventType } from '@/lib/types/db';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createServerSupabase, createServiceSupabase } from '@/lib/supabase/server';
import { getClientIpHash } from '@/lib/security/client-ip';
import { getAccountDeleteConfirmIpLimiter } from '@/lib/security/rate-limit';
import {
  runRateLimit,
  rateLimitedResponse,
  rateLimitUnavailableResponse,
} from '@/lib/security/rate-limit-guard';
import { hashDeletionToken, validateTokenRow } from '@/lib/account/deletion-token';
import { executeAccountDeletion } from '@/lib/account/deletion';

const Body = z.object({
  token: z.string().min(1).max(200),
});

async function logEvent(
  db: ReturnType<typeof createServiceSupabase>,
  type: ActivityEventType,
  payload: Record<string, unknown>
): Promise<void> {
  try {
    await db.from('activity_events').insert({ type, payload, actor_id: null });
  } catch (err) {
    console.error('[account/confirm-deletion] activity_events insert failed:', err);
  }
}

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }
  const parsed = Body.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed.' }, { status: 400 });
  }

  // Auth.
  const sessionClient = await createServerSupabase();
  const {
    data: { user },
    error: authError,
  } = await sessionClient.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  }

  // Per-IP rate-limit (brute-force defense).
  const pepper = process.env.RATELIMIT_IP_PEPPER ?? '';
  const ipHash = getClientIpHash(req, pepper);
  const db = createServiceSupabase();

  const guard = await runRateLimit([
    { kind: 'per_ip', limiter: getAccountDeleteConfirmIpLimiter, key: ipHash },
  ]);
  if (guard.outcome !== 'ok') {
    if (guard.outcome === 'rate_limited') {
      await logEvent(db, 'account_deletion_confirm_rate_limited', {
        kind: 'per_ip',
        ip_hash: ipHash,
        profile_id: user.id,
      });
      return rateLimitedResponse();
    }
    await logEvent(db, 'account_deletion_confirm_rate_limiter_down', { error: guard.error });
    return rateLimitUnavailableResponse();
  }

  // Hash the supplied token and look up by hash.
  const tokenHash = hashDeletionToken(parsed.data.token);
  const { data: tokenRow } = await db
    .from('account_deletion_tokens')
    .select('id, profile_id, expires_at, used_at')
    .eq('token_hash', tokenHash)
    .single();

  const validation = validateTokenRow(
    tokenRow as {
      profile_id: string;
      expires_at: string;
      used_at: string | null;
    } | null,
    user.id
  );

  if (!validation.ok) {
    // Generic 410 — do not reveal reason.
    await logEvent(db, 'account_deletion_confirm_invalid', {
      reason: validation.reason,
      ip_hash: ipHash,
      profile_id: user.id,
    });
    return NextResponse.json(
      { error: 'This confirmation link is invalid or has expired.' },
      { status: 410 }
    );
  }

  const validTokenRow = tokenRow as { id: string };

  // Execute the deletion sequence.
  const result = await executeAccountDeletion(db, {
    profileId: user.id,
    deletionRequestId: validTokenRow.id,
  });

  if (!result.ok) {
    return NextResponse.json(
      { error: 'Account deletion failed.', detail: result.error },
      { status: 500 }
    );
  }

  // Stamp the token as consumed.
  await (
    db as unknown as {
      from(t: string): {
        update(v: Record<string, unknown>): {
          eq(c: string, v: string): Promise<{ error: unknown }>;
        };
      };
    }
  )
    .from('account_deletion_tokens')
    .update({ used_at: new Date().toISOString(), used_reason: 'confirmed' })
    .eq('id', validTokenRow.id);

  await logEvent(db, 'account_deletion_confirmed', {
    profile_id: user.id,
    deletion_request_id: validTokenRow.id,
    ip_hash: ipHash,
    removed_pdf_count: result.removedPdfPaths.length,
  });

  return NextResponse.json({ ok: true, deletedAt: new Date().toISOString() }, { status: 200 });
}
