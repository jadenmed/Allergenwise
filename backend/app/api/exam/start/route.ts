/**
 * POST /api/exam/start
 * Starts a new exam attempt for the authenticated learner.
 *
 * Server-side checks (in order):
 * 1. Auth: learner session required.
 * 2. All 5 modules' lessons complete (server-verified from DB).
 * 3. T-49: no pending / unexpired-active certificate already held. An expired,
 *    revoked or disputed one does NOT block — retaking the exam is the renewal
 *    flow.
 * 4. No active (unsubmitted, not-expired) exam_attempts row.
 * 5. Cooldown: if last submitted attempt failed, must be >24h since submission.
 * 6. If cumulative submitted attempts >= 3, reject with "contact admin".
 * 7. Randomly draw 25 questions (5 per module, order by random() limit 5).
 * 8. Insert exam_attempts row (started_at=now(), time_limit_seconds=1800).
 * 9. Return { attemptId, questions (sans correct), startedAt, timeLimitSeconds, attemptNumber }.
 *
 * Note: Exam auto-submit on timer expiry is handled by Agent F's cron sweep
 * (app/api/cron/exam-timeout-sweep/route.ts). If a learner closes their browser
 * without submitting, the cron will auto-submit the expired attempt.
 */
import 'server-only';
import { NextRequest, NextResponse } from 'next/server';
import { createServiceDb } from '@/lib/db/service';
import { requireRole } from '@/lib/auth/require-role';
import { areAllModulesComplete } from '@/lib/learner/progress';
import { checkCooldown, findActiveAttempt } from '@/lib/learner/exam';
import {
  findBlockingCertForLearner,
  ALREADY_CERTIFIED_MESSAGE,
} from '@/lib/learner/issuance-guard';
import { secureShuffle } from '@/lib/security/secure-random';

// Shape of a drawn bank question joined with its choices (0018 shared bank).
type DrawnExamQuestion = {
  id: string;
  prompt: string;
  question_choices: { id: string; text: string; order_index: number }[];
};

const TIME_LIMIT_SECONDS = 1800; // 30 minutes
const QUESTIONS_PER_MODULE = 5;

// ─── Route handler ────────────────────────────────────────────────────────────

export async function POST(_req: NextRequest) {
  // ── Auth ──────────────────────────────────────────────────────────────────
  const auth = await requireRole({
    roles: ['learner'],
    profileClient: 'service',
    columns: 'id, role',
    forbiddenMessage: 'Forbidden: learner role required',
    onMissingProfile: 'forbidden',
  });
  if (auth instanceof NextResponse) return auth;
  const { user } = auth;

  const db = createServiceDb();

  // ── Server-verify all modules complete ────────────────────────────────────
  const [modulesRes, lessonsRes, progressRes] = await Promise.all([
    db.from('modules').select('id, order_index').order('order_index', { ascending: true }),
    db.from('lessons').select('id, module_id'),
    db
      .from('lesson_progress')
      .select('lesson_id, status, watched_seconds')
      .eq('profile_id', user.id),
  ]);

  if (modulesRes.error || !modulesRes.data) {
    return NextResponse.json({ error: 'Failed to verify module completion' }, { status: 500 });
  }

  const allModules = modulesRes.data;
  const allLessons = lessonsRes.data ?? [];
  const progressData = progressRes.data ?? [];

  const lessonsPerModule: Record<string, string[]> = {};
  for (const l of allLessons) {
    if (!lessonsPerModule[l.module_id]) lessonsPerModule[l.module_id] = [];
    lessonsPerModule[l.module_id].push(l.id);
  }

  const progressMap: Record<string, { status: string; watched_seconds: number }> = {};
  for (const p of progressData) {
    progressMap[p.lesson_id] = { status: p.status, watched_seconds: p.watched_seconds };
  }

  const allComplete = areAllModulesComplete(
    (allModules as Array<{ id: string }>).map((m) => m.id),
    lessonsPerModule,
    progressMap as Parameters<typeof areAllModulesComplete>[2]
  );

  if (!allComplete) {
    return NextResponse.json(
      { error: 'You must complete all 5 modules before taking the exam.' },
      { status: 403 }
    );
  }

  // ── T-49: already holds a current certificate ─────────────────────────────
  // Ahead of BOTH the active-attempt guard and the cooldown check, on purpose.
  //
  // Ahead of the cooldown check, because `checkCooldown` cannot see
  // certificates and would answer the wrong question. A learner who passed on
  // their third attempt trips MAX_ATTEMPTS first and is told to "contact your
  // administrator" — accurate about the attempt ledger, useless to someone
  // whose actual situation is that they are already certified.
  //
  // Ahead of the active-attempt guard, because that one hands back an attemptId
  // and invites the learner to carry on. For someone who acquired a certificate
  // mid-attempt, that is an invitation to finish an exam they can never bank.
  //
  // Refusing entry — rather than only refusing the certificate at submit — is
  // the whole reason this check exists here and not only in the issuer. Thirty
  // minutes of exam for a result that cannot be recorded is a worse experience
  // than a clear "you are already certified".
  const blockingCert = await findBlockingCertForLearner(db, user.id);
  if (blockingCert) {
    return NextResponse.json(
      {
        error: ALREADY_CERTIFIED_MESSAGE,
        certCode: blockingCert.cert_code,
        expiresAt: blockingCert.expires_at,
      },
      { status: 403 }
    );
  }

  // ── Load past attempts ────────────────────────────────────────────────────
  const { data: pastAttempts, error: attemptsError } = await db
    .from('exam_attempts')
    .select('id, started_at, submitted_at, time_limit_seconds, passed')
    .eq('profile_id', user.id)
    .order('started_at', { ascending: false });

  if (attemptsError) {
    return NextResponse.json({ error: 'Failed to check exam history' }, { status: 500 });
  }

  const attempts = pastAttempts ?? [];
  const nowMs = Date.now();

  // ── No active attempt guard ───────────────────────────────────────────────
  const activeAttempt = findActiveAttempt(attempts, nowMs);
  if (activeAttempt) {
    return NextResponse.json(
      {
        error: 'You already have an active exam attempt.',
        attemptId: activeAttempt.id,
      },
      { status: 409 }
    );
  }

  // ── Cooldown / max-attempts check ─────────────────────────────────────────
  const cooldown = checkCooldown(attempts, nowMs);
  if (!cooldown.canAttempt) {
    return NextResponse.json(
      {
        error: cooldown.reason,
        retryAvailableAt: cooldown.retryAvailableAt,
      },
      { status: 403 }
    );
  }

  // ── Draw 25 questions (5 per module) ──────────────────────────────────────
  // Using individual per-module queries with limit rather than ORDER BY random()
  // in a single query, because Supabase JS doesn't expose per-partition sampling.
  // Each query does ORDER BY random() LIMIT 5 on the Postgres side.
  const questionsByModule = await Promise.all(
    (allModules as Array<{ id: string }>).map(async (mod) => {
      // 0018 shared bank: the exam pool is `questions` rows tagged
      // is_exam_eligible=true. Choices come from `question_choices`; we never
      // select is_correct here — the client must not receive the answer key.
      const { data, error } = await db
        .from('questions')
        .select('id, prompt, question_choices(id, text, order_index)')
        .eq('is_exam_eligible', true)
        .eq('module_id', mod.id)
        // Supabase doesn't support ORDER BY random() directly in the JS client;
        // we fetch the module's pool and shuffle in JS to avoid adding a custom
        // RPC just for this. Pool is 10+ per module so this is fine.
        .limit(100); // never more than 100 per module

      if (error || !data || data.length === 0) return [];

      // P1-9: CSPRNG-backed Fisher-Yates so question order is not
      // predictable from a prior attempt's observed sequence.
      const shuffled = secureShuffle(data as DrawnExamQuestion[]);
      return shuffled.slice(0, QUESTIONS_PER_MODULE);
    })
  );

  const allQuestions = questionsByModule.flat();

  // ── Final exam pool gate ────────────────────────────────────────────────
  // A full draw is 25 questions (5 per module). The AllergenWise Curriculum
  // Source does not provide the Final Certification Test pool, so it ships
  // empty and NO certificate can issue until it is seeded. Block here with a
  // clear message rather than drawing (and grading) a partial exam.
  if (allQuestions.length < 25) {
    return NextResponse.json(
      { error: 'Final exam not yet available — content pending' },
      { status: 503 }
    );
  }

  // ── Insert exam_attempts row ──────────────────────────────────────────────
  const { data: newAttempt, error: insertError } = await db
    .from('exam_attempts')
    .insert({
      profile_id: user.id,
      time_limit_seconds: TIME_LIMIT_SECONDS,
    })
    .select('id, started_at')
    .single();

  if (insertError || !newAttempt) {
    return NextResponse.json({ error: 'Failed to start exam attempt' }, { status: 500 });
  }

  // ── Shape options for the client (is_correct was never selected) ──────────
  const questionsForClient = (allQuestions as DrawnExamQuestion[]).map((q) => ({
    id: q.id,
    question: q.prompt,
    options: [...q.question_choices]
      .sort((a, b) => a.order_index - b.order_index)
      .map(({ id, text }) => ({ id, text })),
  }));

  return NextResponse.json({
    attemptId: newAttempt.id,
    questions: questionsForClient,
    startedAt: newAttempt.started_at,
    timeLimitSeconds: TIME_LIMIT_SECONDS,
    attemptNumber: cooldown.attemptNumber,
  });
}
