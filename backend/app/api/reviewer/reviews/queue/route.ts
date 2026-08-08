/**
 * GET /api/reviewer/reviews/queue
 *
 * Returns pending reviews ordered by created_at ASC (oldest first).
 * Includes restaurant name and review body for the reviewer's listing.
 *
 * Reviewer-only. Role re-verified server-side.
 *
 * P1-2 (IDOR review): user-submitted restaurant reviews are a *shared
 * moderation pool*, not per-reviewer assignments. There is no `reviewer_id`
 * column on `reviews` because the workflow is "any reviewer may publish or
 * hide any pending review". This is intentional design — auditors confirmed
 * this is not an IDOR vector. Decisions are recorded only as the resulting
 * `status` ('published' | 'hidden'), with no per-reviewer ownership.
 *
 * Note: supabase queries use `as any` casts because Database in lib/types/db.ts omits
 * the `Relationships` arrays required for @supabase/supabase-js v2 column-level
 * type inference. Explicit local interfaces below keep runtime types correct.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServiceSupabase } from '@/lib/supabase/server';
import { requireRole } from '@/lib/auth/require-role';

// ─── Local row shapes ─────────────────────────────────────────────────────────

interface ReviewQueueRow {
  id: string;
  restaurant_id: string;
  author_name: string;
  author_email: string | null;
  rating: number;
  body: string;
  allergen_context: string | null;
  status: string;
  created_at: string;
  updated_at: string;
  restaurants: {
    id: string;
    name: string;
    city: string | null;
    state: string | null;
    slug: string;
  };
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export async function GET(_req: NextRequest): Promise<NextResponse> {
  const authResult = await requireRole({
    roles: ['reviewer'],
    profileClient: 'session',
    columns: 'id, role',
  });
  if (authResult instanceof NextResponse) return authResult;

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const supabase = createServiceSupabase() as any;

    const { data: reviewsRaw, error } = await supabase
      .from('reviews')
      .select(
        `
        id,
        restaurant_id,
        author_name,
        author_email,
        rating,
        body,
        allergen_context,
        status,
        created_at,
        updated_at,
        restaurants!inner(
          id,
          name,
          city,
          state,
          slug
        )
      `
      )
      .eq('status', 'pending')
      .order('created_at', { ascending: true });

    if (error) {
      console.error('[reviewer/reviews/queue] DB error:', error);
      return NextResponse.json({ error: 'Failed to load review queue' }, { status: 500 });
    }

    const reviews = (reviewsRaw ?? []) as ReviewQueueRow[];
    const now = Date.now();

    const rows = reviews.map((r) => {
      const restaurant = r.restaurants;
      const createdMs = new Date(r.created_at).getTime();
      const daysPending = Math.floor((now - createdMs) / 86_400_000);

      return {
        id: r.id,
        restaurantId: restaurant.id,
        restaurantName: restaurant.name,
        restaurantCity: restaurant.city,
        restaurantState: restaurant.state,
        restaurantSlug: restaurant.slug,
        authorName: r.author_name,
        authorEmail: r.author_email,
        rating: r.rating,
        body: r.body,
        allergenContext: r.allergen_context,
        status: r.status,
        createdAt: r.created_at,
        daysPending,
      };
    });

    return NextResponse.json({ reviews: rows });
  } catch (err) {
    console.error('[reviewer/reviews/queue] unexpected error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
