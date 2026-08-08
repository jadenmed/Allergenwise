/**
 * POST /api/reviewer/queue/[submissionId]/decide
 *
 * Body: { action: 'approve' | 'reject' | 'request_info', notes?: string }
 *
 * Calls decide_submission() Postgres RPC (single transaction), then sends email.
 * Email failure is logged but does not roll back the decision (transaction already committed).
 * Response includes `emailQueued: boolean` so callers know if email succeeded.
 *
 * Reviewer-only. Role re-verified server-side.
 *
 * Note: supabase queries use `as any` casts because Database in lib/types/db.ts omits
 * the `Relationships` arrays required for @supabase/supabase-js v2 column-level inference.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createServiceSupabase } from '@/lib/supabase/server';
import { decideSubmission } from '@/lib/reviewer/decide';
import { requireRole } from '@/lib/auth/require-role';

// ─── Validation schema ────────────────────────────────────────────────────────

const DecideBodySchema = z.object({
  action: z.enum(['approve', 'reject', 'request_info']),
  notes: z.string().max(4000).optional(),
});

// ─── Handler ──────────────────────────────────────────────────────────────────

export async function POST(
  req: NextRequest,
  { params }: { params: { submissionId: string } }
): Promise<NextResponse> {
  const authResult = await requireRole({
    roles: ['reviewer'],
    profileClient: 'session',
    columns: 'id, role',
  });
  if (authResult instanceof NextResponse) return authResult;

  const reviewerId = authResult.user.id;
  const { submissionId } = params;

  // UUID format validation
  if (
    !submissionId ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(submissionId)
  ) {
    return NextResponse.json({ error: 'Invalid submissionId' }, { status: 400 });
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

  const { action, notes } = parsed.data;

  // ── P1-2 ownership pre-check (defense-in-depth at HTTP layer) ───────────────
  // The decide_submission RPC enforces ownership transactionally (migration
  // 0017). We still pre-check here so a violation surfaces as a clean 403
  // rather than bubbling Postgres `insufficient_privilege` to a generic 500.
  // Reviewer A's claimed submission must not be decidable by Reviewer B,
  // even by guessing the UUID.
  {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const svc = createServiceSupabase() as any;
    const { data: ownerRow, error: ownerErr } = await svc
      .from('submissions')
      .select('reviewer_id')
      .eq('id', submissionId)
      .single();

    if (ownerErr || !ownerRow) {
      return NextResponse.json({ error: 'Submission not found' }, { status: 404 });
    }

    const claimedBy = (ownerRow as { reviewer_id: string | null }).reviewer_id;
    if (claimedBy !== null && claimedBy !== reviewerId) {
      return NextResponse.json(
        { error: 'Submission is owned by another reviewer' },
        { status: 403 }
      );
    }
  }

  try {
    const result = await decideSubmission({
      submissionId,
      reviewerId,
      action,
      notes,
    });

    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';

    // P1-2: if RPC raised `insufficient_privilege` because of a TOCTOU race
    // between the pre-check and the RPC call, surface as 403 (not 500).
    if (message.includes('owned by another reviewer') || message.includes('ownership lost')) {
      return NextResponse.json(
        { error: 'Submission is owned by another reviewer' },
        { status: 403 }
      );
    }

    // Distinguish user-facing errors from internal errors.
    if (
      message.includes('not found') ||
      message.includes('terminal state') ||
      message.includes('invalid action')
    ) {
      return NextResponse.json({ error: message }, { status: 400 });
    }

    console.error('[reviewer/decide] error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
