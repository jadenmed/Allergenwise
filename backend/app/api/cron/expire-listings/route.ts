/**
 * app/api/cron/expire-listings/route.ts
 *
 * Cron: daily 03:00 UTC
 * Action: set restaurants.status='paused' where listing_expires_at < now()
 *         and status='listed'. Idempotent — safe to re-run.
 *
 * Authorization: Vercel Cron sends `Authorization: Bearer {CRON_SECRET}`.
 * Returns: { ok, processed, errors }
 */
import { NextRequest, NextResponse } from 'next/server';
import { createServiceSupabase } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest): Promise<NextResponse> {
  // ── Authorization ──────────────────────────────────────────────────────────
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Service-role client bypasses RLS. Cast to any to work around Supabase
  // typed-client limitations when the Database generic type is incomplete
  // (lib/types/db.ts is read-only; pre-existing type gap affects all agents).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = createServiceSupabase() as any;

  try {
    // Update all listed restaurants whose listing_expires_at has passed.
    // updated_at is handled by the trg_restaurants_updated_at trigger.
    const { data, error } = await supabase
      .from('restaurants')
      .update({ status: 'paused' })
      .eq('status', 'listed')
      .lt('listing_expires_at', new Date().toISOString())
      .select('id, name');

    if (error) {
      console.error('[cron/expire-listings] DB error:', error);
      return NextResponse.json(
        { ok: false, processed: 0, errors: [error.message] },
        { status: 500 }
      );
    }

    const rows = data as Array<{ id: string; name: string }> | null;
    const processed = rows?.length ?? 0;
    console.log(`[cron/expire-listings] Paused ${processed} expired listing(s).`);

    return NextResponse.json({ ok: true, processed, errors: [] });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[cron/expire-listings] Unexpected error:', message);
    return NextResponse.json({ ok: false, processed: 0, errors: [message] }, { status: 500 });
  }
}
