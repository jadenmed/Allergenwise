/**
 * app/api/cron/digest-reviewer-queue/route.ts
 *
 * Cron: daily 09:00 UTC
 * Action: count submissions where status in ('pending','in_review') and
 *   submitted_at < now() - 24 hours. If > 0, email REVIEWER_EMAIL.
 *
 * Uses a plain-text email (not a full React Email template) per spec —
 * this is an operational digest, not a user-facing transactional email.
 *
 * Authorization: Vercel Cron sends `Authorization: Bearer {CRON_SECRET}`.
 * Returns: { ok, processed, errors }
 */
import { NextRequest, NextResponse } from 'next/server';
import { createServiceSupabase } from '@/lib/supabase/server';
import { REVIEWER_EMAIL } from '@/lib/email/client';
import { sendEmail } from '@/lib/email/send';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest): Promise<NextResponse> {
  // ── Authorization ──────────────────────────────────────────────────────────
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Cast to any to work around Supabase typed-client limitations.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = createServiceSupabase() as any;

  try {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const { count, error } = await supabase
      .from('submissions')
      .select('id', { count: 'exact', head: true })
      .in('status', ['pending', 'in_review'])
      .lt('submitted_at', cutoff);

    if (error) {
      console.error('[cron/digest-reviewer-queue] count error:', error);
      return NextResponse.json(
        { ok: false, processed: 0, errors: [(error as { message: string }).message] },
        { status: 500 }
      );
    }

    const pendingCount = (count as number) ?? 0;

    if (pendingCount === 0) {
      console.log('[cron/digest-reviewer-queue] No stale submissions — digest skipped.');
      return NextResponse.json({ ok: true, processed: 0, errors: [] });
    }

    const reviewQueueUrl = `${process.env.APP_URL ?? 'https://allergenwise.com'}/reviewer/queue`;

    const result = await sendEmail('ReviewerQueueDigest', REVIEWER_EMAIL, {
      pendingCount,
      reviewQueueUrl,
    });

    if (!result.ok) {
      console.error('[cron/digest-reviewer-queue] email error:', result.error);
      return NextResponse.json(
        { ok: false, processed: 0, errors: [result.error ?? 'Send failed'] },
        { status: 500 }
      );
    }

    console.log(`[cron/digest-reviewer-queue] Digest sent: ${pendingCount} stale submission(s).`);
    return NextResponse.json({ ok: true, processed: 1, errors: [] });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[cron/digest-reviewer-queue] Unexpected error:', message);
    return NextResponse.json({ ok: false, processed: 0, errors: [message] }, { status: 500 });
  }
}
