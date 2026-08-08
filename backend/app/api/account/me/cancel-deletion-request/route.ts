/**
 * POST /api/account/me/cancel-deletion-request
 *
 * P1-16 OQ-G2 — authenticated user voluntarily revokes any
 * outstanding deletion tokens.
 *
 * Stamps `used_at` on every unused token row for this profile, with
 * audit reason `canceled_by_user`. Returns 204 on success regardless
 * of whether any tokens existed (idempotent).
 */
import 'server-only';
import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase, createServiceSupabase } from '@/lib/supabase/server';

export async function POST(_req: NextRequest) {
  const sessionClient = await createServerSupabase();
  const {
    data: { user },
    error: authError,
  } = await sessionClient.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  }

  const db = createServiceSupabase();
  const now = new Date().toISOString();

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
    .update({ used_at: now, used_reason: 'canceled_by_user' })
    .eq('profile_id', user.id)
    .is('used_at', null);

  try {
    await db.from('activity_events').insert({
      type: 'account_deletion_cancelled',
      actor_id: user.id,
      payload: { profile_id: user.id, timestamp: now },
    });
  } catch (err) {
    console.error('[account/cancel-deletion-request] activity_events insert failed:', err);
  }

  return new NextResponse(null, { status: 204 });
}
