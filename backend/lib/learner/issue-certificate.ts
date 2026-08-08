import 'server-only';
import type { ServiceDb } from '@/lib/db/service';
import { CERT_VALIDITY_YEARS } from '@/lib/disclaimer';
import { generateCertCode } from './cert-code';
import { findBlockingCertForLearner } from './issuance-guard';
import { sendEmail } from '@/lib/email/send';

/**
 * Issues a certificate for a passed exam attempt. Extracted from
 * app/api/exam/submit/route.ts (Wave 4B P0 #10.a cert-code redesign +
 * Wave 2C pending-cert design) so the collision-retry loop is directly
 * unit-testable in isolation from the full request/response cycle.
 *
 * T-49: this function is the LAST line of defence against one learner holding
 * two certificates, and deliberately so. /api/exam/start refuses entry and
 * /api/exam/submit refuses submission, but both are route-level checks that a
 * future caller — a backfill script, an admin tool, a second submit path — can
 * simply not perform. The check below is the one a new caller cannot skip,
 * because it lives inside the only code that inserts a `certificates` row.
 *
 * `blocked: true` in the return value distinguishes "refused, by design" from
 * the pre-existing `certCode: undefined`, which means "tried and failed" —
 * three cert-code collisions, or a non-23505 insert error.
 */
export async function issueCertificateForPassedExam(params: {
  db: ServiceDb;
  restaurantId: string;
  actorId: string;
  attemptId: string;
  scorePercent: number;
  learnerName: string;
  restaurantName: string;
}): Promise<{ certCode: string | undefined; blocked?: boolean }> {
  const { db, restaurantId, actorId, attemptId, scorePercent, learnerName, restaurantName } =
    params;

  // ── T-49 duplicate-issuance guard ────────────────────────────────────────
  // Refuse BEFORE drawing a cert code or touching the table. A learner holding
  // a pending or unexpired active certificate gets no second one; an expired,
  // revoked or disputed certificate does NOT block, because retaking the exam
  // is how a certificate is renewed (see lib/learner/cert-state.ts).
  //
  // The refusal is logged rather than silent. A block reaching this far means a
  // route-level guard was bypassed — a new caller, or a race between two
  // submits — and that is worth seeing in the activity feed. No email is sent:
  // the manager was already told when the first certificate was issued.
  const blockingCert = await findBlockingCertForLearner(db, actorId);
  if (blockingCert) {
    await db.from('activity_events').insert({
      restaurant_id: restaurantId,
      actor_id: actorId,
      type: 'cert_issuance_blocked_duplicate',
      payload: {
        exam_attempt_id: attemptId,
        score_percent: scorePercent,
        blocking_certificate_id: blockingCert.id,
        blocking_cert_code: blockingCert.cert_code,
        blocking_status: blockingCert.status,
        blocking_expires_at: blockingCert.expires_at,
      },
    });
    return { certCode: undefined, blocked: true };
  }

  // Wave 4B (P0 #10.a): cert codes are now random Crockford Base32
  // identifiers with an ISO 7064 Mod 37,36 check digit. See
  // lib/learner/cert-code.ts + audits/cert-code-redesign-plan.md.
  // Each insert attempt draws a fresh code from crypto.randomBytes(7);
  // no sequence counter, no "AW-{year}-{NNNNNN}" enumeration vector.
  //
  // Retry budget: 3 fresh draws. Every 23505 (unique constraint hit)
  // emits a `cert_code_collision_retry` activity event with the
  // attempted code + attempt number, so an entropy-source regression
  // surfaces as visible signal rather than a silent fix. The cliff
  // for "something is wrong" is documented in followups.md as a P2
  // monitoring threshold (>10 retries per rolling 24h window).
  // Certificate validity: 2 years (AllergenWise Curriculum Source —
  // "Certificate Validity: 2 years"). Was +1 in the pilot scaffold.
  const expiresAt = new Date();
  expiresAt.setFullYear(expiresAt.getFullYear() + CERT_VALIDITY_YEARS);

  let certCode: string | undefined;
  let certificateId: string | undefined;

  const MAX_CERT_INSERT_ATTEMPTS = 3;
  let collisionCount = 0;
  for (let attempt = 1; attempt <= MAX_CERT_INSERT_ATTEMPTS; attempt++) {
    const candidate = generateCertCode();
    const { data: insertedCert, error: certInsertError } = (await db
      .from('certificates')
      .insert({
        cert_code: candidate,
        profile_id: actorId,
        restaurant_id: restaurantId,
        exam_attempt_id: attemptId,
        expires_at: expiresAt.toISOString(),
        status: 'pending',
        // fee_charged_cents and stripe_payment_intent_id are intentionally
        // omitted — both populated by the webhook activation handler.
      })
      .select('id')
      .single()) as { data: { id: string } | null; error: { code?: string } | null };

    if (insertedCert) {
      certCode = candidate;
      certificateId = insertedCert.id;
      break;
    }

    if (certInsertError?.code === '23505') {
      // Collision — log the retry signal and try again. Don't log the
      // final attempt as a retry; if all 3 collide, the exhausted event
      // below covers it.
      collisionCount++;
      if (attempt < MAX_CERT_INSERT_ATTEMPTS) {
        await db.from('activity_events').insert({
          restaurant_id: restaurantId,
          actor_id: actorId,
          type: 'cert_code_collision_retry',
          payload: {
            attempt,
            generated_code: candidate,
            exam_attempt_id: attemptId,
          },
        });
      }
      continue;
    }

    // Non-unique error: log and bail out of the retry loop. Cert is not
    // created on this exam attempt; the exam attempt itself is preserved.
    console.error('[exam/submit] cert insert error:', certInsertError);
    certCode = undefined;
    certificateId = undefined;
    break;
  }

  if (!certificateId && collisionCount === MAX_CERT_INSERT_ATTEMPTS) {
    // 3 consecutive 23505 collisions exhausted the retry budget. Write
    // the explicit exhausted event so ops can distinguish "entropy
    // source broken" from other failures. P2 monitoring threshold
    // documented in audits/followups.md: >10 of these in any rolling
    // 24h window is an alert candidate.
    await db.from('activity_events').insert({
      restaurant_id: restaurantId,
      actor_id: actorId,
      type: 'cert_issuance_retry_exhausted',
      payload: {
        attempts: MAX_CERT_INSERT_ATTEMPTS,
        exam_attempt_id: attemptId,
      },
    });
  }

  // Wave 2C — PDF generation is deferred to the webhook activation handler
  // (cert-payment-state-design.md OQ-1). At exam-pass time the cert is
  // pending and has no payment yet; rendering the PDF now would waste
  // storage on certs that may TTL-purge if payment never confirms.

  if (certificateId) {
    // Activity events for Wave 2C cert lifecycle.
    // - cert_issued: pending insertion at exam pass (per design (g) "cert_issued
    //   (existing — repurposed): cert row inserted by exam/submit").
    // - exam_passed: scoring outcome (preserved).
    await db.from('activity_events').insert({
      restaurant_id: restaurantId,
      actor_id: actorId,
      type: 'cert_issued',
      payload: {
        certificate_id: certificateId,
        cert_code: certCode,
        exam_attempt_id: attemptId,
        status: 'pending',
      },
    });

    await db.from('activity_events').insert({
      restaurant_id: restaurantId,
      actor_id: actorId,
      type: 'exam_passed',
      payload: { attemptId, scorePercent, certCode },
    });
  }

  // ── Fire-and-forget: EmployeeExamPassedNotice email ──────────────────────
  // Wave 2C reword (OQ-5): the cert is NOT yet issued at exam-pass time.
  // Copy must reflect the pending state. New `CertActivated` email at the
  // pending → active transition is deferred to a P1 follow-up.
  const adminRes = await db
    .from('profiles')
    .select('email, full_name')
    .eq('restaurant_id', restaurantId)
    .eq('role', 'manager')
    .limit(1)
    .maybeSingle();

  // certCode can stay undefined if all collision-retry attempts were
  // exhausted above — skip the notice rather than send a cert code of
  // "undefined" (the cert itself was not issued in that case either).
  if (adminRes.data && certCode) {
    sendEmail('EmployeeExamPassedNotice', adminRes.data.email, {
      adminName: adminRes.data.full_name,
      learnerName,
      restaurantName,
      scorePercent,
      certCode,
    }).catch((emailErr) => {
      console.error('[exam/submit] EmployeeExamPassedNotice email failed (non-fatal):', emailErr);
    });
  }

  return { certCode };
}
