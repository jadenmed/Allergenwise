/**
 * GET /api/reviewer/queue
 *
 * Returns pending + in_review submissions ordered by submitted_at ASC (oldest first).
 * Includes restaurant name, certified-employee count, days pending.
 *
 * Reviewer-only. Role is re-verified server-side on every request even if middleware
 * already checked it (defense in depth).
 *
 * Note: supabase queries use `as any` casts because Database in lib/types/db.ts omits
 * the `Relationships` arrays required for @supabase/supabase-js v2 column-level
 * type inference. The explicit local interfaces below keep runtime types correct.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServiceSupabase } from '@/lib/supabase/server';
import { requireRole } from '@/lib/auth/require-role';

// ─── Local row shapes ─────────────────────────────────────────────────────────

interface SubmissionQueueRow {
  id: string;
  submitted_at: string;
  status: string;
  cert_fee_total_cents: number | null;
  restaurants: {
    id: string;
    name: string;
    city: string | null;
    state: string | null;
  };
}

interface CertRestaurantRow {
  restaurant_id: string;
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export async function GET(_req: NextRequest): Promise<NextResponse> {
  const authResult = await requireRole({
    roles: ['reviewer'],
    profileClient: 'session',
    columns: 'id, role',
  });
  if (authResult instanceof NextResponse) return authResult;

  const callerId = authResult.user.id;

  try {
    // Use service role to read across all restaurants without RLS filtering.
    // The role check above already verified the caller is a reviewer.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const supabase = createServiceSupabase() as any;

    // P1-2 — Queue scope: unclaimed (reviewer_id IS NULL) OR claimed by the
    // caller. A second reviewer must not see another reviewer's in-progress
    // submissions in their queue. Pending items remain in the shared pool
    // until claimed.
    const { data: submissionsRaw, error } = await supabase
      .from('submissions')
      .select(
        `
        id,
        submitted_at,
        status,
        cert_fee_total_cents,
        reviewer_id,
        restaurants!inner(
          id,
          name,
          city,
          state
        )
      `
      )
      .in('status', ['pending', 'in_review'])
      .or(`reviewer_id.is.null,reviewer_id.eq.${callerId}`)
      .order('submitted_at', { ascending: true });

    if (error) {
      console.error('[reviewer/queue] DB error:', error);
      return NextResponse.json({ error: 'Failed to load queue' }, { status: 500 });
    }

    const submissions = (submissionsRaw ?? []) as SubmissionQueueRow[];
    const now = Date.now();

    // Enrich each submission with certified-employee count and days pending.
    // Single batch query for all cert counts rather than N+1.
    const restaurantIds = submissions.map((s) => s.restaurants.id);

    // Wave 2C — status='active' is the canonical "publicly active" predicate.
    // expires_at > now kept as a belt-and-suspenders guard in case the
    // expire-certs cron is late.
    const { data: certCountsRaw, error: certErr } = await supabase
      .from('certificates')
      .select('restaurant_id')
      .in('restaurant_id', restaurantIds)
      .eq('status', 'active')
      .gt('expires_at', new Date().toISOString());

    if (certErr) {
      console.error('[reviewer/queue] cert count error:', certErr);
      // Non-fatal — return queue with 0 cert counts rather than erroring out.
    }

    const certCounts = (certCountsRaw ?? []) as CertRestaurantRow[];
    const certCountByRestaurant = new Map<string, number>();
    for (const cert of certCounts) {
      certCountByRestaurant.set(
        cert.restaurant_id,
        (certCountByRestaurant.get(cert.restaurant_id) ?? 0) + 1
      );
    }

    const rows = submissions.map((s) => {
      const restaurant = s.restaurants;
      const submittedMs = new Date(s.submitted_at).getTime();
      const daysPending = Math.floor((now - submittedMs) / 86_400_000);

      return {
        id: s.id,
        restaurantId: restaurant.id,
        restaurantName: restaurant.name,
        restaurantCity: restaurant.city,
        restaurantState: restaurant.state,
        status: s.status,
        submittedAt: s.submitted_at,
        daysPending,
        certifiedCount: certCountByRestaurant.get(restaurant.id) ?? 0,
        certFeeTotalCents: s.cert_fee_total_cents,
      };
    });

    return NextResponse.json({ submissions: rows });
  } catch (err) {
    console.error('[reviewer/queue] unexpected error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
