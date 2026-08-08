/**
 * app/api/cron/expire-subscriptions/route.ts
 *
 * Cron: daily 03:30 UTC
 * Action:
 *   1. Set subscriptions.status='expired' where status='active' and ends_at < today.
 *   2. For each newly-expired sub: if the restaurant has no active renewal
 *      (no other active subscription), set restaurants.status='paused'.
 *
 * Idempotent — re-running on the same day is a no-op (already expired rows
 * won't match the 'active' filter; already-paused restaurants won't match).
 *
 * Authorization: Vercel Cron sends `Authorization: Bearer {CRON_SECRET}`.
 * Returns: { ok, processed, errors }
 */
import { NextRequest, NextResponse } from 'next/server';
import { createServiceSupabase } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type ExpiredSubRow = { id: string; restaurant_id: string };
type ActiveSubRow = { id: string };

export async function GET(request: NextRequest): Promise<NextResponse> {
  // ── Authorization ──────────────────────────────────────────────────────────
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Cast to any to work around Supabase typed-client limitations.
  // lib/types/db.ts is read-only; pre-existing type gap affects all cron routes.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = createServiceSupabase() as any;
  const errors: string[] = [];
  let processed = 0;

  try {
    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

    // Step 1: Expire active subscriptions whose ends_at has passed
    const { data: expiredSubsRaw, error: expireError } = await supabase
      .from('subscriptions')
      .update({ status: 'expired' })
      .eq('status', 'active')
      .lt('ends_at', today)
      .select('id, restaurant_id');

    if (expireError) {
      console.error('[cron/expire-subscriptions] expire error:', expireError);
      return NextResponse.json(
        { ok: false, processed: 0, errors: [(expireError as { message: string }).message] },
        { status: 500 }
      );
    }

    const expiredSubs = (expiredSubsRaw ?? []) as ExpiredSubRow[];
    processed = expiredSubs.length;

    if (processed === 0) {
      return NextResponse.json({ ok: true, processed: 0, errors: [] });
    }

    // Step 2: Pause restaurants that no longer have any active subscription
    const restaurantIds = [...new Set(expiredSubs.map((s) => s.restaurant_id))];

    for (const restaurantId of restaurantIds) {
      const { data: activeSubsRaw, error: checkError } = await supabase
        .from('subscriptions')
        .select('id')
        .eq('restaurant_id', restaurantId)
        .eq('status', 'active')
        .limit(1);

      if (checkError) {
        errors.push(
          `restaurant ${restaurantId}: check active subs failed: ${(checkError as { message: string }).message}`
        );
        continue;
      }

      const activeSubs = (activeSubsRaw ?? []) as ActiveSubRow[];
      if (activeSubs.length > 0) {
        // Still has an active plan — don't pause
        continue;
      }

      // No active subscription — pause the restaurant listing
      const { error: pauseError } = await supabase
        .from('restaurants')
        .update({ status: 'paused' })
        .eq('id', restaurantId)
        .eq('status', 'listed');

      if (pauseError) {
        errors.push(
          `restaurant ${restaurantId}: pause failed: ${(pauseError as { message: string }).message}`
        );
      }
    }

    console.log(
      `[cron/expire-subscriptions] expired=${processed} restaurants checked=${restaurantIds.length} errors=${errors.length}`
    );
    return NextResponse.json({ ok: errors.length === 0, processed, errors });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[cron/expire-subscriptions] Unexpected error:', message);
    return NextResponse.json(
      { ok: false, processed, errors: [...errors, message] },
      { status: 500 }
    );
  }
}
