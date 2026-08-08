/**
 * GET /api/reviewer/queue/[submissionId]
 *
 * Full submission detail for a reviewer. Includes:
 *  - Restaurant info
 *  - Employee roster with cert IDs + exam scores
 *  - Auto-checks recomputed live (never cached):
 *      { allCertified, allScoresPass, paymentValid, noPriorRejection }
 *
 * Reviewer-only. Role re-verified server-side.
 *
 * Note: supabase queries use `as any` casts because Database in lib/types/db.ts omits
 * the `Relationships` arrays required for @supabase/supabase-js v2 column-level
 * type inference. Explicit local interfaces below keep runtime types correct.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServiceSupabase } from '@/lib/supabase/server';
import { LEARNER_ROLE, onlyCurrentStaff } from '@/lib/staff/membership';
import { computeAutoChecks } from '@/lib/reviewer/auto-checks';
import { requireRole } from '@/lib/auth/require-role';

// ─── Local row shapes ─────────────────────────────────────────────────────────

interface SubmissionDetailRow {
  id: string;
  restaurant_id: string;
  submitted_by: string;
  submitted_at: string;
  status: string;
  reviewer_id: string | null;
  reviewer_notes: string | null;
  decided_at: string | null;
  cert_fee_total_cents: number | null;
  stripe_payment_intent_id: string | null;
  restaurants: {
    id: string;
    name: string;
    slug: string;
    cuisine: string | null;
    address: string | null;
    city: string | null;
    state: string | null;
    zip: string | null;
    phone: string | null;
    website: string | null;
    about: string | null;
    status: string;
    listed_at: string | null;
    listing_expires_at: string | null;
    created_at: string;
  };
}

interface ExamAttemptNestedRow {
  id: string;
  score_percent: number | null;
  passed: boolean | null;
  submitted_at: string | null;
}

interface CertNestedRow {
  id: string;
  cert_code: string;
  issued_at: string;
  expires_at: string;
  status: string;
  exam_attempt_id: string | null;
  exam_attempts: ExamAttemptNestedRow | null;
}

interface EmployeeRow {
  id: string;
  full_name: string;
  email: string;
  job_role: string | null;
  accepted_at: string | null;
  certificates: CertNestedRow[];
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export async function GET(
  _req: NextRequest,
  { params }: { params: { submissionId: string } }
): Promise<NextResponse> {
  const authResult = await requireRole({
    roles: ['reviewer'],
    profileClient: 'session',
    columns: 'id, role',
  });
  if (authResult instanceof NextResponse) return authResult;

  const { submissionId } = params;

  // Basic UUID format check
  if (
    !submissionId ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(submissionId)
  ) {
    return NextResponse.json({ error: 'Invalid submissionId' }, { status: 400 });
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const supabase = createServiceSupabase() as any;

    // ── Load submission + restaurant ─────────────────────────────────────────
    const { data: submissionRaw, error: subErr } = await supabase
      .from('submissions')
      .select(
        `
        id,
        restaurant_id,
        submitted_by,
        submitted_at,
        status,
        reviewer_id,
        reviewer_notes,
        decided_at,
        cert_fee_total_cents,
        stripe_payment_intent_id,
        restaurants!inner(
          id, name, slug, cuisine, address, city, state, zip,
          phone, website, about, status, listed_at, listing_expires_at,
          created_at
        )
      `
      )
      .eq('id', submissionId)
      .single();

    if (subErr || !submissionRaw) {
      return NextResponse.json({ error: 'Submission not found' }, { status: 404 });
    }

    const submission = submissionRaw as SubmissionDetailRow;

    // P1-2 — Per-resource authorization (IDOR defense).
    // Reviewer role alone is not sufficient: once a submission is claimed
    // (reviewer_id set), only that reviewer may view it. Unclaimed
    // submissions (reviewer_id IS NULL) remain visible to any reviewer so
    // the pickup-from-queue flow still works. Return 404 (not 403) so
    // ownership cannot be enumerated by guessing UUIDs.
    if (submission.reviewer_id !== null && submission.reviewer_id !== authResult.user.id) {
      return NextResponse.json({ error: 'Submission not found' }, { status: 404 });
    }

    const restaurant = submission.restaurants;

    // ── Load employee roster + compute auto-checks concurrently ──────────────
    // Both depend only on the already-loaded, IDOR-checked submission. The
    // profiles query resolves {data,error}; computeAutoChecks can throw, so it
    // is wrapped so its rejection does NOT pre-empt the empErr check. Error
    // precedence is preserved: empErr → "Failed to load employee roster" (500)
    // first; an auto-checks throw is rethrown to the outer catch → "Internal
    // server error" (500).
    const [{ data: employeesRaw, error: empErr }, acRes] = await Promise.all([
      // T-46a — the reviewer approves a listing against CURRENT staff. A
      // departed employee is neither a gap in the roster nor a name to approve;
      // their certificate is preserved but is no longer this restaurant's
      // headcount.
      onlyCurrentStaff(
        supabase
          .from('profiles')
          .select(
            `
          id,
          full_name,
          email,
          job_role,
          accepted_at,
          certificates(
            id,
            cert_code,
            issued_at,
            expires_at,
            status,
            exam_attempt_id,
            exam_attempts(
              id,
              score_percent,
              passed,
              submitted_at
            )
          )
        `
          )
          .eq('restaurant_id', submission.restaurant_id)
          .eq('role', LEARNER_ROLE)
      ),
      computeAutoChecks({
        submissionId,
        restaurantId: submission.restaurant_id,
      })
        .then((v) => ({ ok: true as const, v }))
        .catch((e) => ({ ok: false as const, e })),
    ]);

    if (empErr) {
      console.error('[reviewer/detail] employees error:', empErr);
      return NextResponse.json({ error: 'Failed to load employee roster' }, { status: 500 });
    }

    if (!acRes.ok) {
      throw acRes.e;
    }
    const autoChecks = acRes.v;

    const employees = (employeesRaw ?? []) as EmployeeRow[];
    const now = new Date().toISOString();

    const roster = employees.map((emp) => {
      // Wave 2C — most recent publicly-active cert (status='active' only).
      const validCert =
        emp.certificates
          .filter((c) => c.status === 'active' && c.expires_at > now)
          .sort((a, b) => b.issued_at.localeCompare(a.issued_at))[0] ?? null;

      return {
        profileId: emp.id,
        fullName: emp.full_name,
        email: emp.email,
        jobRole: emp.job_role,
        acceptedAt: emp.accepted_at,
        cert: validCert
          ? {
              id: validCert.id,
              certCode: validCert.cert_code,
              issuedAt: validCert.issued_at,
              expiresAt: validCert.expires_at,
              scorePercent: validCert.exam_attempts?.score_percent ?? null,
              passed: validCert.exam_attempts?.passed ?? null,
            }
          : null,
      };
    });

    return NextResponse.json({
      submission: {
        id: submission.id,
        restaurantId: submission.restaurant_id,
        submittedBy: submission.submitted_by,
        submittedAt: submission.submitted_at,
        status: submission.status,
        reviewerId: submission.reviewer_id,
        reviewerNotes: submission.reviewer_notes,
        decidedAt: submission.decided_at,
        certFeeTotalCents: submission.cert_fee_total_cents,
        stripePaymentIntentId: submission.stripe_payment_intent_id,
      },
      restaurant,
      roster,
      autoChecks,
    });
  } catch (err) {
    console.error('[reviewer/detail] unexpected error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
