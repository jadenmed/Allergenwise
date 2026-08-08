/**
 * POST /api/reviewer/reviews/[id]/decide
 *
 * Body: { action: 'publish' | 'hide' }
 *
 * Updates reviews.status to 'published' or 'hidden'.
 * Idempotent: if already in target status, returns success without re-writing.
 *
 * Notes:
 * - `publish` makes the review immediately visible via the public RLS policy
 *   ("reviews_public_read_published"). This is intentional per spec §5.5.
 * - Reviewer-only. Role re-verified server-side.
 * - P1-2 (IDOR review): user-submitted restaurant reviews are a shared
 *   moderation pool with no per-reviewer assignment. Any reviewer may
 *   publish or hide any pending review. Not an IDOR vector — see the
 *   matching note in `../queue/route.ts`. Idempotency on already-applied
 *   status prevents double-write races.
 * - supabase queries use `as any` casts because Database in lib/types/db.ts omits
 *   the `Relationships` arrays required for @supabase/supabase-js v2 column-level
 *   type inference.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createServiceSupabase } from '@/lib/supabase/server';
import { requireRole } from '@/lib/auth/require-role';

// ─── Validation schema ────────────────────────────────────────────────────────

const DecideBodySchema = z.object({
  action: z.enum(['publish', 'hide']),
});

// ─── Local row shapes ─────────────────────────────────────────────────────────

interface ReviewStatusRow {
  id: string;
  status: string;
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
  const authResult = await requireRole({
    roles: ['reviewer'],
    profileClient: 'session',
    columns: 'id, role',
  });
  if (authResult instanceof NextResponse) return authResult;

  const { id } = params;

  // UUID format check
  if (!id || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return NextResponse.json({ error: 'Invalid review id' }, { status: 400 });
  }

  // Parse + validate body
  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = DecideBodySchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', issues: parsed.error.issues },
      { status: 400 }
    );
  }

  const { action } = parsed.data;
  const newStatus = action === 'publish' ? 'published' : 'hidden';

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const supabase = createServiceSupabase() as any;

    // Verify the review exists and is in a decidable state.
    const { data: reviewRaw, error: fetchErr } = await supabase
      .from('reviews')
      .select('id, status')
      .eq('id', id)
      .single();

    if (fetchErr || !reviewRaw) {
      return NextResponse.json({ error: 'Review not found' }, { status: 404 });
    }

    const review = reviewRaw as ReviewStatusRow;

    // Idempotent: if already in target status, return success without re-writing.
    if (review.status === newStatus) {
      return NextResponse.json({ ok: true, status: newStatus });
    }

    const { error: updateErr } = await supabase
      .from('reviews')
      .update({ status: newStatus })
      .eq('id', id);

    if (updateErr) {
      console.error('[reviewer/reviews/decide] update error:', updateErr);
      return NextResponse.json({ error: 'Failed to update review' }, { status: 500 });
    }

    return NextResponse.json({ ok: true, status: newStatus });
  } catch (err) {
    console.error('[reviewer/reviews/decide] unexpected error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
