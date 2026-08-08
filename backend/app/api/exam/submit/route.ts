/**
 * POST /api/exam/submit
 * Submits a learner's exam answers and computes pass/fail.
 *
 * Body: { attemptId: string, answers: { [questionId: string]: optionId } }
 *
 * Server-side:
 * 1. Auth: learner session required.
 * 2. Validate attempt belongs to this learner, not already submitted, not past time-limit (+30s grace).
 * 3. Load questions from DB (don't trust client-side question list).
 * 4. Compute score: correct answers / 25 × 100, rounded.
 * 5. Update exam_attempts { submitted_at, score_percent, passed, answers }.
 * 6. On pass (T-03 removed the payment gate; T-49 added the duplicate guard —
 *    a pass issues a cert unless this learner already holds a current one):
 *    - Generate cert_code = 'AW-{year}-{sequence}' (DB sequence for uniqueness).
 *    - Insert certificates row.
 *    - Fire-and-forget: POST /api/certs/generate (Agent F1) to render PDF.
 *    - Fire-and-forget: send ExamPassed email via Resend.
 *    - Insert activity_events { type: 'exam_passed' }.
 * 7. Return { passed, scorePercent, certCode?, retryAvailableAt? }.
 *
 * Dependency notes:
 * - Agent F1 owns /api/certs/generate — called fire-and-forget from here.
 * - Agent F2's exam-timeout-sweep cron handles auto-submit for abandoned attempts.
 */
import 'server-only';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createServerSupabase } from '@/lib/supabase/server';
import { createServiceDb } from '@/lib/db/service';
import {
  scoreExam,
  isAttemptExpired,
  checkCooldown,
  PASS_THRESHOLD_PERCENT,
} from '@/lib/learner/exam';
import { issueCertificateForPassedExam } from '@/lib/learner/issue-certificate';
import {
  findBlockingCertForLearner,
  ALREADY_CERTIFIED_MESSAGE,
} from '@/lib/learner/issuance-guard';
import { isCurrentStaff } from '@/lib/staff/membership';
import { DEPARTED_FORBIDDEN_MESSAGE } from '@/lib/auth/require-role';

// Shape of a bank question joined with its choices (0018 shared bank).
// is_correct IS selected here — scoring is server-side and never returned.
type ScoringQuestion = {
  id: string;
  question_choices: { id: string; text: string; is_correct: boolean }[];
};

// ─── Validation ───────────────────────────────────────────────────────────────

const bodySchema = z.object({
  attemptId: z.string().uuid('attemptId must be a UUID'),
  answers: z.record(z.string().uuid(), z.string()),
});

// ─── Route handler ────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  // ── Parse + validate body ─────────────────────────────────────────────────
  let body: z.infer<typeof bodySchema>;
  try {
    const raw = await req.json();
    body = bodySchema.parse(raw);
  } catch (err) {
    return NextResponse.json(
      {
        error: 'Invalid request body',
        details: err instanceof z.ZodError ? err.errors : undefined,
      },
      { status: 400 }
    );
  }

  const { attemptId, answers } = body;

  // ── Auth ──────────────────────────────────────────────────────────────────
  const userSupabase = await createServerSupabase();
  const {
    data: { user },
    error: authError,
  } = await userSupabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const db = createServiceDb();

  const { data: profileRaw } = (await db
    .from('profiles')
    .select(
      'id, role, restaurant_id, full_name, departed_at, restaurants!profiles_restaurant_id_fkey(name)'
    )
    .eq('id', user.id)
    .single()) as {
    data: {
      id: string;
      role: string;
      restaurant_id: string | null;
      full_name: string;
      departed_at: string | null;
      restaurants: { name: string } | { name: string }[] | null;
    } | null;
    error: unknown;
  };

  // Early return if profile not found (guards all subsequent profile.* accesses)
  if (!profileRaw) {
    return NextResponse.json({ error: 'Profile not found' }, { status: 404 });
  }

  // T-46a — "exam not takeable". /api/exam/start refuses a departed learner
  // through requireRole, but this route predates that guard and reads the
  // profile by hand, so the check is repeated here. Without it a learner marked
  // departed mid-attempt could still submit, and a pass would mint a
  // certificate — and a billable PENDING certificate — for someone who no
  // longer works there. RLS does not cover this either:
  // exam_attempts_learner_insert_own is scoped by auth.uid(), not by restaurant.
  if (!isCurrentStaff(profileRaw as unknown as { departed_at: string | null })) {
    return NextResponse.json({ error: DEPARTED_FORBIDDEN_MESSAGE }, { status: 403 });
  }

  const profile = profileRaw;
  const restaurantData = Array.isArray(profile.restaurants)
    ? profile.restaurants[0]
    : profile.restaurants;
  const restaurantName = restaurantData?.name ?? 'your restaurant';

  // ── Fetch the attempt ─────────────────────────────────────────────────────
  const { data: attempt, error: attemptError } = await db
    .from('exam_attempts')
    .select('id, profile_id, started_at, submitted_at, time_limit_seconds, passed, score_percent')
    .eq('id', attemptId)
    .single();

  if (attemptError || !attempt) {
    return NextResponse.json({ error: 'Exam attempt not found' }, { status: 404 });
  }

  // ── Ownership check ───────────────────────────────────────────────────────
  if (attempt.profile_id !== user.id) {
    return NextResponse.json({ error: 'Forbidden: not your attempt' }, { status: 403 });
  }

  // ── Already submitted? ────────────────────────────────────────────────────
  if (attempt.submitted_at != null) {
    return NextResponse.json(
      {
        error: 'Attempt already submitted',
        passed: attempt.passed,
        scorePercent: attempt.score_percent,
      },
      { status: 409 }
    );
  }

  // ── T-49: already holds a current certificate ─────────────────────────────
  // Defence in depth. /api/exam/start refuses entry, so with one exception this
  // is unreachable: two concurrent start requests can both pass the
  // active-attempt check and open two attempts, and the second submit then
  // lands here after the first has already issued the certificate.
  //
  // Placed BEFORE the time-limit branch and before the exam_attempts UPDATE, so
  // a refusal mutates nothing. The cost is that the refused attempt stays
  // unsubmitted until the exam-timeout-sweep cron auto-submits it as failed,
  // which adds a row to that learner's attempt ledger. Accepted deliberately:
  // the only attempt that reaches here is the surplus half of a race, and
  // recording a score against it would be recording an exam that was never
  // going to produce a certificate.
  const blockingCert = await findBlockingCertForLearner(db, user.id);
  if (blockingCert) {
    return NextResponse.json(
      {
        error: ALREADY_CERTIFIED_MESSAGE,
        certCode: blockingCert.cert_code,
        expiresAt: blockingCert.expires_at,
      },
      { status: 409 }
    );
  }

  // ── Time-limit check (with 30s grace) ────────────────────────────────────
  if (isAttemptExpired(attempt, Date.now())) {
    // Auto-submit as failed (time expired; grace already included in isAttemptExpired)
    // The cron sweep should have caught this, but if client submits just-expired, accept it
    // gracefully and mark as submitted with score 0.
    await db
      .from('exam_attempts')
      .update({
        submitted_at: new Date().toISOString(),
        score_percent: 0,
        passed: false,
        answers,
      })
      .eq('id', attemptId);

    const allPastAttempts = await db
      .from('exam_attempts')
      .select('started_at, submitted_at, passed')
      .eq('profile_id', user.id);

    const cooldown = checkCooldown(allPastAttempts.data ?? [], Date.now());

    return NextResponse.json(
      {
        passed: false,
        scorePercent: 0,
        retryAvailableAt: cooldown.retryAvailableAt,
        error: 'Time limit exceeded',
      },
      { status: 200 }
    );
  }

  // ── Load exam questions (server-side; don't trust client) ─────────────────
  // We need to know which questions were in this attempt. Since we don't store
  // the question list in the attempt row, we re-query all questions and score
  // only the ones the learner answered (treating non-answers as wrong).
  // This means the client can't inject extra question IDs.
  // 0018 shared bank: load canonical choices from question_choices. The
  // service-role client sees is_correct; the client never does.
  const { data: questionRows, error: questionsError } = await db
    .from('questions')
    .select('id, question_choices(id, text, is_correct)')
    .in('id', Object.keys(answers));

  if (questionsError) {
    return NextResponse.json({ error: 'Failed to load exam questions' }, { status: 500 });
  }

  // Enforce max 25 answers (client can't inject more)
  const answerEntries = Object.entries(answers).slice(0, 25);
  const cappedAnswers = Object.fromEntries(answerEntries);

  // Map to the scorer's option shape ({id, text, correct}).
  const questions = ((questionRows ?? []) as ScoringQuestion[]).map((q) => ({
    id: q.id,
    options: q.question_choices.map((c) => ({ id: c.id, text: c.text, correct: c.is_correct })),
  }));

  // For scoring, we need the full 25-question set.
  // Questions the learner didn't answer will not appear in questionRows,
  // so we also need to fetch the ones they didn't answer to count them as wrong.
  // Strategy: score only answered questions vs total answered questions.
  // But the spec says "count correct / 25 × 100" — meaning 25 is always the denominator.
  // We don't have the original 25-question list stored (no questions column in exam_attempts).
  // Resolution: use max(25, questionsInAnswers) as denominator to prevent gaming.
  const scoredQuestions = questions.filter((q) =>
    Object.prototype.hasOwnProperty.call(cappedAnswers, q.id)
  );
  const result = scoreExam(scoredQuestions, cappedAnswers);

  // Compute against a fixed 25-question denominator
  const scorePercent = Math.round((result.correctCount / 25) * 100);
  // Pass threshold is the single source of truth in lib/learner/exam.ts
  // (Master Course Build Packet §6: 85%). Do not hardcode the number here.
  const passed = scorePercent >= PASS_THRESHOLD_PERCENT;

  const now = new Date().toISOString();

  // ── Update exam_attempts ──────────────────────────────────────────────────
  const { error: updateError } = await db
    .from('exam_attempts')
    .update({
      submitted_at: now,
      score_percent: scorePercent,
      passed,
      answers: cappedAnswers,
    })
    .eq('id', attemptId);

  if (updateError) {
    return NextResponse.json({ error: 'Failed to save exam result' }, { status: 500 });
  }

  // ── On pass: create certificate ───────────────────────────────────────────
  // No payment gate since T-03 — but not unconditional. T-49 refuses a second
  // certificate to a learner already holding a pending or unexpired-active one,
  // both at the guard above and again inside issueCertificateForPassedExam.
  // The certificate lands as `pending` and STAYS
  // pending: activation is driven by the cert-fee charge, which T-41b owns.
  // A pile of pending rows here is the expected state, not a bug —
  // purge-stale-pending-certs is what keeps it from growing without bound.
  let certCode: string | undefined;

  if (passed && profile.restaurant_id) {
    const result = await issueCertificateForPassedExam({
      db,
      restaurantId: profile.restaurant_id,
      actorId: user.id,
      attemptId,
      scorePercent,
      learnerName: profile.full_name,
      restaurantName,
    });
    certCode = result.certCode;
  }

  // ── On fail: compute retry availability ───────────────────────────────────
  let retryAvailableAt: string | undefined;
  if (!passed) {
    await db
      .from('activity_events')
      .insert({
        restaurant_id: profile.restaurant_id,
        actor_id: user.id,
        type: 'exam_failed',
        payload: { attemptId, scorePercent },
      })
      .catch(() => {
        /* non-fatal */
      });

    const { data: allAttempts } = await db
      .from('exam_attempts')
      .select('started_at, submitted_at, passed')
      .eq('profile_id', user.id);

    const cooldown = checkCooldown(allAttempts ?? [], Date.now());
    retryAvailableAt = cooldown.retryAvailableAt;
  }

  return NextResponse.json({
    passed,
    scorePercent,
    certCode,
    retryAvailableAt,
  });
}
