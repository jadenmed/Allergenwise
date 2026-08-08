/**
 * app/api/cron/expire-certs/route.ts
 *
 * Cron: daily 03:15 UTC
 * Action: for each certificate expiring within 30/14/7 days:
 *   - Check cert_warnings for existing (cert_id, threshold) record.
 *   - If absent: send CertExpiringSoon email to learner, insert warning row.
 *   - Fully idempotent — re-running on the same day never double-sends.
 *
 * Authorization: Vercel Cron sends `Authorization: Bearer {CRON_SECRET}`.
 * Returns: { ok, processed, errors }
 */
import { NextRequest, NextResponse } from 'next/server';
import { createServiceSupabase } from '@/lib/supabase/server';
import { sendEmail } from '@/lib/email/send';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const THRESHOLDS = [30, 14, 7] as const;

type CertRow = {
  id: string;
  cert_code: string;
  expires_at: string;
  profile_id: string;
  restaurant_id: string;
  profiles:
    | { full_name: string; email: string }
    | Array<{ full_name: string; email: string }>
    | null;
  restaurants: { name: string } | Array<{ name: string }> | null;
};

type WarningRow = { cert_id: string };

export async function GET(request: NextRequest): Promise<NextResponse> {
  // ── Authorization ──────────────────────────────────────────────────────────
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Cast to any to work around Supabase typed-client limitations.
  // lib/types/db.ts is read-only; cert_warnings is a new table not in the Database type.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = createServiceSupabase() as any;
  const errors: string[] = [];
  let processed = 0;

  try {
    // ── Wave 2C — flip already-expired certs to status='expired' ─────────────
    // Persists the status transition so F-S2/F-S3 (directory + search reading
    // expired certs as active) are structurally fixed. Idempotent: WHERE
    // narrows to status='active' so a second run after expiration is a no-op.
    const nowIso = new Date().toISOString();
    const { data: expiredRows, error: expireSelectErr } = await supabase
      .from('certificates')
      .select('id, cert_code, restaurant_id, expires_at')
      .eq('status', 'active')
      .lt('expires_at', nowIso);

    if (expireSelectErr) {
      const msg = `expire select: ${(expireSelectErr as { message: string }).message}`;
      console.error('[cron/expire-certs]', msg);
      errors.push(msg);
    } else if (Array.isArray(expiredRows) && expiredRows.length > 0) {
      const { error: expireUpdateErr } = await supabase
        .from('certificates')
        .update({
          status: 'expired',
          status_changed_at: nowIso,
        })
        .eq('status', 'active')
        .lt('expires_at', nowIso);

      if (expireUpdateErr) {
        const msg = `expire update: ${(expireUpdateErr as { message: string }).message}`;
        console.error('[cron/expire-certs]', msg);
        errors.push(msg);
      } else {
        // Explicit strictly-increasing created_at: a single multi-row INSERT
        // evaluates now() once per statement, so the DB default alone would
        // collapse every batched row onto one timestamp and lose the
        // ordering the activity_events_certificate_id_idx
        // `ORDER BY created_at` query relies on.
        const eventBase = Date.now();
        const expiredEvents = (
          expiredRows as Array<{
            id: string;
            cert_code: string;
            restaurant_id: string;
            expires_at: string;
          }>
        ).map((cert, i) => ({
          restaurant_id: cert.restaurant_id,
          actor_id: null,
          type: 'cert_expired',
          payload: {
            certificate_id: cert.id,
            cert_code: cert.cert_code,
            expires_at: cert.expires_at,
            before_status: 'active',
            after_status: 'expired',
            reason: 'scheduled_expiration',
          },
          created_at: new Date(eventBase + i).toISOString(),
        }));

        const { error: expireEventErr } = await supabase
          .from('activity_events')
          .insert(expiredEvents);
        if (expireEventErr) {
          console.error('[cron/expire-certs] activity_events batch insert failed:', expireEventErr);
        }
        processed += expiredRows.length;
      }
    }

    // ── Existing behaviour — warning emails for upcoming expiries ────────────
    for (const threshold of THRESHOLDS) {
      // Find certs expiring within the threshold window.
      // Window: (now + (threshold-1) days, now + threshold days]
      const now = new Date();
      const windowStart = new Date(now.getTime() + (threshold - 1) * 24 * 60 * 60 * 1000);
      const windowEnd = new Date(now.getTime() + threshold * 24 * 60 * 60 * 1000);

      const { data: certsRaw, error: certsError } = await supabase
        .from('certificates')
        .select(
          `
          id,
          cert_code,
          expires_at,
          profile_id,
          restaurant_id,
          profiles!certificates_profile_id_fkey (
            full_name,
            email
          ),
          restaurants!certificates_restaurant_id_fkey (
            name
          )
        `
        )
        .eq('status', 'active')
        .gt('expires_at', windowStart.toISOString())
        .lte('expires_at', windowEnd.toISOString());

      if (certsError) {
        const msg = `threshold=${threshold}: ${(certsError as { message: string }).message}`;
        console.error('[cron/expire-certs]', msg);
        errors.push(msg);
        continue;
      }

      const certs = (certsRaw ?? []) as CertRow[];
      if (certs.length === 0) continue;

      // Fetch existing warnings for this threshold
      const certIds = certs.map((c) => c.id);
      const { data: existingWarningsRaw, error: warnError } = await supabase
        .from('cert_warnings')
        .select('cert_id')
        .eq('threshold', threshold)
        .in('cert_id', certIds);

      if (warnError) {
        const msg = `threshold=${threshold} warnings lookup: ${(warnError as { message: string }).message}`;
        console.error('[cron/expire-certs]', msg);
        errors.push(msg);
        continue;
      }

      const existingWarnings = (existingWarningsRaw ?? []) as WarningRow[];
      const alreadySent = new Set(existingWarnings.map((w) => w.cert_id));

      for (const cert of certs) {
        if (alreadySent.has(cert.id)) continue;

        // Unwrap join result (Supabase may return object or array)
        const profileData = Array.isArray(cert.profiles) ? cert.profiles[0] : cert.profiles;
        const restaurantData = Array.isArray(cert.restaurants)
          ? cert.restaurants[0]
          : cert.restaurants;

        if (!profileData || !restaurantData) {
          errors.push(`cert ${cert.id}: missing profile or restaurant data`);
          continue;
        }

        // Send warning email
        const emailResult = await sendEmail('CertExpiringSoon', profileData.email, {
          recipientName: profileData.full_name,
          restaurantName: restaurantData.name,
          daysRemaining: threshold,
          certCode: cert.cert_code,
        });

        if (!emailResult.ok) {
          errors.push(`cert ${cert.id} threshold=${threshold}: email failed: ${emailResult.error}`);
          continue;
        }

        // Insert idempotency row — PK (cert_id, threshold) prevents duplicates
        const { error: insertError } = await supabase
          .from('cert_warnings')
          .insert({ cert_id: cert.id, threshold });

        if (insertError) {
          const msg = (insertError as { message: string }).message;
          // Duplicate key = race condition, already sent — acceptable
          if (!msg.includes('duplicate key')) {
            errors.push(`cert ${cert.id} threshold=${threshold}: warning insert failed: ${msg}`);
          }
        } else {
          processed++;
        }
      }
    }

    console.log(`[cron/expire-certs] processed=${processed} errors=${errors.length}`);
    return NextResponse.json({ ok: errors.length === 0, processed, errors });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[cron/expire-certs] Unexpected error:', message);
    return NextResponse.json(
      { ok: false, processed, errors: [...errors, message] },
      { status: 500 }
    );
  }
}
