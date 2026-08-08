/**
 * app/api/cron/weekly-admin-digest/route.ts
 *
 * Cron: Mondays 08:00 UTC
 * Action: for each admin profile, aggregate:
 *   - certReadinessPct: (certified learners / total learners) * 100
 *   - expiringCertsIn30Days: count of certs expiring in next 30 days
 *   - pendingInvites: count of learners with accepted_at IS NULL
 * Then send a simple digest email.
 *
 * Authorization: Vercel Cron sends `Authorization: Bearer {CRON_SECRET}`.
 * Returns: { ok, processed, errors }
 */
import { NextRequest, NextResponse } from 'next/server';
import { createServiceSupabase } from '@/lib/supabase/server';
import { LEARNER_ROLE, onlyCurrentStaff } from '@/lib/staff/membership';
import { sendEmail } from '@/lib/email/send';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type AdminRow = {
  id: string;
  full_name: string;
  email: string;
  restaurant_id: string | null;
  restaurants:
    | { id: string; name: string; status: string }
    | Array<{ id: string; name: string; status: string }>
    | null;
};

type LearnerRow = { id: string; accepted_at: string | null };

export async function GET(request: NextRequest): Promise<NextResponse> {
  // ── Authorization ──────────────────────────────────────────────────────────
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Cast to any to work around Supabase typed-client limitations.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = createServiceSupabase() as any;
  const errors: string[] = [];
  let processed = 0;

  try {
    const { data: adminsRaw, error: adminsError } = await supabase
      .from('profiles')
      .select(
        `
        id,
        full_name,
        email,
        restaurant_id,
        restaurants!profiles_restaurant_id_fkey (
          id,
          name,
          status
        )
      `
      )
      .eq('role', 'manager')
      .not('restaurant_id', 'is', null);

    if (adminsError) {
      console.error('[cron/weekly-admin-digest] fetch admins error:', adminsError);
      return NextResponse.json(
        { ok: false, processed: 0, errors: [(adminsError as { message: string }).message] },
        { status: 500 }
      );
    }

    const admins = (adminsRaw ?? []) as AdminRow[];
    if (admins.length === 0) {
      return NextResponse.json({ ok: true, processed: 0, errors: [] });
    }

    const appUrl = process.env.APP_URL ?? 'https://allergenwise.com';
    const thirtyDaysFromNow = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    const now = new Date().toISOString();

    for (const admin of admins) {
      const restaurantData = Array.isArray(admin.restaurants)
        ? admin.restaurants[0]
        : admin.restaurants;

      if (!restaurantData || !admin.restaurant_id) continue;

      const restaurantId = admin.restaurant_id;
      const restaurantName = restaurantData.name;

      const [learnersResult, certsResult, expiringResult] = await Promise.all([
        // T-46a — CURRENT staff only. This read is the denominator of the
        // "N of M certified" line in the weekly email; counting someone who
        // left would report the restaurant as less ready than it is.
        onlyCurrentStaff(
          supabase
            .from('profiles')
            .select('id, accepted_at')
            .eq('restaurant_id', restaurantId)
            .eq('role', LEARNER_ROLE)
        ),

        supabase
          .from('certificates')
          .select('id', { count: 'exact', head: true })
          .eq('restaurant_id', restaurantId)
          .eq('status', 'active')
          .gt('expires_at', now),

        supabase
          .from('certificates')
          .select('id', { count: 'exact', head: true })
          .eq('restaurant_id', restaurantId)
          .eq('status', 'active')
          .gt('expires_at', now)
          .lte('expires_at', thirtyDaysFromNow),
      ]);

      if (learnersResult.error || certsResult.error || expiringResult.error) {
        const errMsg = ((learnersResult.error as { message: string } | null) ??
          (certsResult.error as { message: string } | null) ??
          (expiringResult.error as { message: string } | null))!.message;
        errors.push(`admin ${admin.id}: ${errMsg}`);
        continue;
      }

      const learners = (learnersResult.data ?? []) as LearnerRow[];
      const totalLearners = learners.length;
      const certifiedCount = (certsResult.count as number) ?? 0;
      const expiringCerts = (expiringResult.count as number) ?? 0;
      const pendingInvites = learners.filter((p) => !p.accepted_at).length;
      const certReadinessPct =
        totalLearners === 0 ? 0 : Math.round((certifiedCount / totalLearners) * 100);

      const result = await sendEmail('WeeklyAdminDigest', admin.email, {
        adminName: admin.full_name,
        restaurantName,
        certReadinessPct,
        certifiedCount,
        totalLearners,
        expiringCerts,
        pendingInvites,
        dashboardUrl: `${appUrl}/admin/dashboard`,
      });

      if (!result.ok) {
        errors.push(`admin ${admin.id}: email failed: ${result.error}`);
      } else {
        processed++;
      }
    }

    console.log(`[cron/weekly-admin-digest] sent=${processed} errors=${errors.length}`);
    return NextResponse.json({ ok: errors.length === 0, processed, errors });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[cron/weekly-admin-digest] Unexpected error:', message);
    return NextResponse.json(
      { ok: false, processed, errors: [...errors, message] },
      { status: 500 }
    );
  }
}
