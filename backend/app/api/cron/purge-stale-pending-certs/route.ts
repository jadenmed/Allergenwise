/**
 * app/api/cron/purge-stale-pending-certs/route.ts
 *
 * Wave 2C — daily cron that hard-deletes pending certs older than the
 * configured TTL (default 14 days; env override PENDING_CERT_TTL_DAYS).
 * Cascades cert_warnings via FK; writes one `cert_purged` activity event
 * per cert.
 *
 * Authorization: Vercel Cron sends `Authorization: Bearer ${CRON_SECRET}`.
 *
 * This is the TTL side of the pending-on-issue model in
 * cert-payment-state-design.md (b). Pending certs that never receive a
 * cert-fee PI succeed within the TTL window get cleaned up so the
 * pending-pool doesn't grow unbounded.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServiceSupabase } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DEFAULT_TTL_DAYS = 14;

export async function GET(request: NextRequest): Promise<NextResponse> {
  if (request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const ttlDays = (() => {
    const raw = process.env.PENDING_CERT_TTL_DAYS;
    if (!raw) return DEFAULT_TTL_DAYS;
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) && n > 0 ? n : DEFAULT_TTL_DAYS;
  })();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = createServiceSupabase() as any;
  const cutoff = new Date(Date.now() - ttlDays * 86_400_000).toISOString();
  const errors: string[] = [];
  let purged = 0;

  try {
    const { data: stale, error: selectErr } = await supabase
      .from('certificates')
      .select('id, cert_code, profile_id, restaurant_id, exam_attempt_id, issued_at')
      .eq('status', 'pending')
      .lt('issued_at', cutoff);

    if (selectErr) {
      const msg = `select stale: ${(selectErr as { message: string }).message}`;
      console.error('[cron/purge-stale-pending-certs]', msg);
      return NextResponse.json({ ok: false, errors: [msg] }, { status: 500 });
    }

    const rows = (stale ?? []) as Array<{
      id: string;
      cert_code: string;
      profile_id: string;
      restaurant_id: string;
      exam_attempt_id: string | null;
      issued_at: string;
    }>;

    // Batched activity_events insert BEFORE the delete loop so the audit
    // trail survives even if a later delete fails — stronger than the
    // prior per-row interleaving, since every purge candidate's event is
    // now durably written before ANY delete is attempted. Explicit
    // strictly-increasing created_at because a single multi-row INSERT
    // evaluates now() once per statement.
    const eventBase = Date.now();
    const purgeEvents = rows.map((cert, i) => {
      const ageMs = Date.now() - new Date(cert.issued_at).getTime();
      const ageDays = Math.floor(ageMs / 86_400_000);
      return {
        restaurant_id: cert.restaurant_id,
        actor_id: null,
        type: 'cert_purged',
        payload: {
          certificate_id: cert.id,
          cert_code: cert.cert_code,
          profile_id: cert.profile_id,
          restaurant_id: cert.restaurant_id,
          exam_attempt_id: cert.exam_attempt_id,
          age_days: ageDays,
          ttl_days: ttlDays,
        },
        created_at: new Date(eventBase + i).toISOString(),
      };
    });

    if (purgeEvents.length > 0) {
      const { error: purgeEventErr } = await supabase.from('activity_events').insert(purgeEvents);
      if (purgeEventErr) {
        console.error(
          '[cron/purge-stale-pending-certs] activity_events batch insert failed:',
          purgeEventErr
        );
      }
    }

    for (const cert of rows) {
      const { error: delErr } = await supabase
        .from('certificates')
        .delete()
        .eq('id', cert.id)
        // Defense-in-depth: re-narrow status='pending' so a cert that just
        // activated between SELECT and DELETE is NOT purged.
        .eq('status', 'pending');

      if (delErr) {
        errors.push(`cert ${cert.id}: ${(delErr as { message: string }).message}`);
        continue;
      }
      purged++;
    }

    console.log(
      `[cron/purge-stale-pending-certs] purged=${purged} errors=${errors.length} ttl_days=${ttlDays}`
    );
    return NextResponse.json({ ok: errors.length === 0, purged, errors, ttl_days: ttlDays });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[cron/purge-stale-pending-certs] Unexpected:', message);
    return NextResponse.json({ ok: false, purged, errors: [...errors, message] }, { status: 500 });
  }
}
