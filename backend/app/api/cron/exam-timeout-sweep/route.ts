/**
 * app/api/cron/exam-timeout-sweep/route.ts
 *
 * Cron: every minute (* * * * *)
 * Action: find exam_attempts where:
 *   - submitted_at IS NULL (not yet submitted)
 *   - started_at + time_limit_seconds + 30 seconds grace < now()
 * For each: score the saved answers (missing = wrong), set submitted_at=now(),
 * score_percent, passed=false (timeout always fails), insert activity_event.
 * Does NOT issue certificates — timeout is always a fail.
 *
 * LIMIT 100 per run to prevent runaway on backlog. Subsequent runs will
 * catch remaining.
 *
 * Authorization: Vercel Cron sends `Authorization: Bearer {CRON_SECRET}`.
 * Returns: { ok, processed, errors }
 */
import { NextRequest, NextResponse } from 'next/server';
import { createServiceSupabase } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const GRACE_SECONDS = 30;
const BATCH_LIMIT = 100;

type AttemptRow = {
  id: string;
  profile_id: string;
  started_at: string;
  time_limit_seconds: number;
  answers: Record<string, string> | null;
};

type QuestionRow = {
  id: string;
  options: Array<{ id: string; correct: boolean }>;
};

/** Score an exam: count correct answers, return integer percent (0–100). */
function scoreAnswers(questions: QuestionRow[], answers: Record<string, string>): number {
  if (questions.length === 0) return 0;
  let correct = 0;
  for (const q of questions) {
    const chosenId = answers[q.id];
    if (!chosenId) continue;
    const correctOption = q.options.find((o) => o.correct);
    if (correctOption && correctOption.id === chosenId) {
      correct++;
    }
  }
  return Math.round((correct / questions.length) * 100);
}

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
    const now = new Date();

    // Conservative cutoff: attempts started more than (min time_limit + grace) ago.
    // time_limit_seconds defaults to 1800 (30 min). Smallest possible deadline = 1800+30 = 1830s.
    const conservativeCutoff = new Date(now.getTime() - 1830 * 1000).toISOString();

    const { data: candidatesRaw, error: fetchError } = await supabase
      .from('exam_attempts')
      .select('id, profile_id, started_at, time_limit_seconds, answers')
      .is('submitted_at', null)
      .lte('started_at', conservativeCutoff)
      .limit(BATCH_LIMIT);

    if (fetchError) {
      console.error('[cron/exam-timeout-sweep] fetch error:', fetchError);
      return NextResponse.json(
        { ok: false, processed: 0, errors: [(fetchError as { message: string }).message] },
        { status: 500 }
      );
    }

    const candidates = (candidatesRaw ?? []) as AttemptRow[];
    if (candidates.length === 0) {
      return NextResponse.json({ ok: true, processed: 0, errors: [] });
    }

    // Precise filter: deadline = started_at + time_limit_seconds + GRACE_SECONDS
    const trulyExpired = candidates.filter((attempt) => {
      const startedAt = new Date(attempt.started_at).getTime();
      const deadlineMs = startedAt + (attempt.time_limit_seconds + GRACE_SECONDS) * 1000;
      return now.getTime() > deadlineMs;
    });

    if (trulyExpired.length === 0) {
      return NextResponse.json({ ok: true, processed: 0, errors: [] });
    }

    // Fetch all exam questions for scoring (shared bank, 0018: exam-eligible
    // rows; correct answers live in question_choices.is_correct).
    const { data: allQuestionsRaw, error: questionsError } = await supabase
      .from('questions')
      .select('id, question_choices(id, is_correct)')
      .eq('is_exam_eligible', true);

    if (questionsError) {
      console.error('[cron/exam-timeout-sweep] questions fetch error:', questionsError);
      return NextResponse.json(
        { ok: false, processed: 0, errors: [(questionsError as { message: string }).message] },
        { status: 500 }
      );
    }

    const allQuestions: QuestionRow[] = (
      (allQuestionsRaw ?? []) as Array<{
        id: string;
        question_choices: Array<{ id: string; is_correct: boolean }>;
      }>
    ).map((q) => ({
      id: q.id,
      options: (q.question_choices ?? []).map((c) => ({ id: c.id, correct: c.is_correct })),
    }));
    const questionMap = new Map(allQuestions.map((q) => [q.id, q]));

    const submittedAt = now.toISOString();

    // Explicit strictly-increasing created_at: a single multi-row INSERT
    // evaluates now() once per statement, so the DB default alone would
    // collapse every batched row onto one timestamp and lose the ordering
    // the activity_events_certificate_id_idx `ORDER BY created_at` query
    // (and the audit trail generally) relies on.
    const activityRows: Array<{
      actor_id: string;
      type: string;
      payload: Record<string, unknown>;
      created_at: string;
    }> = [];
    const eventBase = Date.now();

    for (const attempt of trulyExpired) {
      const answers: Record<string, string> = (attempt.answers as Record<string, string>) ?? {};

      // Score: look up each answered question in the map
      const attemptQuestions = Object.keys(answers)
        .map((qId) => questionMap.get(qId))
        .filter((q): q is QuestionRow => !!q);

      const scorePercent =
        Object.keys(answers).length > 0 ? scoreAnswers(attemptQuestions, answers) : 0;

      // Update attempt: timeout = fail (passed=false) regardless of score
      const { error: updateError } = await supabase
        .from('exam_attempts')
        .update({
          submitted_at: submittedAt,
          score_percent: scorePercent,
          passed: false,
          answers,
        })
        .eq('id', attempt.id)
        .is('submitted_at', null); // Guard: only update if still unsubmitted

      if (updateError) {
        errors.push(
          `attempt ${attempt.id}: update failed: ${(updateError as { message: string }).message}`
        );
        continue;
      }

      activityRows.push({
        actor_id: attempt.profile_id,
        type: 'exam_failed',
        payload: {
          attempt_id: attempt.id,
          score_percent: scorePercent,
          reason: 'timeout',
        },
        created_at: new Date(eventBase + activityRows.length).toISOString(),
      });

      processed++;
    }

    // Batched activity_events insert (non-fatal if this fails).
    if (activityRows.length > 0) {
      const { error: activityError } = await supabase.from('activity_events').insert(activityRows);

      if (activityError) {
        errors.push(
          `activity batch insert failed: ${(activityError as { message: string }).message}`
        );
      }
    }

    console.log(`[cron/exam-timeout-sweep] processed=${processed} errors=${errors.length}`);
    return NextResponse.json({ ok: errors.length === 0, processed, errors });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[cron/exam-timeout-sweep] Unexpected error:', message);
    return NextResponse.json(
      { ok: false, processed, errors: [...errors, message] },
      { status: 500 }
    );
  }
}
