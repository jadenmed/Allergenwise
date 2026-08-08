/**
 * lib/submissions/finalize.ts
 *
 * "The submission is now paid for — record it." One body, two callers.
 *
 * Who calls this (T-41b)
 * ──────────────────────
 *   1. app/api/stripe/webhook/route.ts, on `checkout.session.completed` with
 *      kind='cert_fee'. This is the normal path: the manager paid (or a
 *      100%-off promotion code took the total to $0) and Stripe told us.
 *   2. app/api/submissions/create/route.ts, when the restaurant has ZERO
 *      pending certificates. Every learner is already `active`, so there is
 *      nothing to charge and no Checkout Session to create — but the
 *      submission still has to be recorded. Stripe is not involved at all.
 *
 * It is one function because those two paths must agree on every write. The
 * previous shape — the route handler doing it inline — is what would have made
 * a second copy inevitable the moment the webhook needed the same three writes.
 *
 * Idempotency
 * ───────────
 * `submissions.stripe_checkout_session_id` is UNIQUE (migration 0024) and holds
 * the Checkout Session id. A redelivery of the same Session cannot insert a
 * second row: the INSERT is rejected with 23505 and this returns
 * `outcome: 'duplicate'`. That is a DB guarantee, not a read-then-write check —
 * two concurrent deliveries can both observe "no row" but they cannot both
 * insert.
 *
 * A SECOND unique index, partial on `restaurant_id` where the status is open,
 * rejects a different Session that would open a second concurrent review for
 * the same restaurant. That surfaces here as `outcome: 'conflict'`, which the
 * webhook logs as `submission_payment_orphaned` — money arrived and no listing
 * was created, so somebody has to refund it by hand. Silence would be worse.
 */
import 'server-only';
import type { ServiceDb } from '@/lib/db/service';
import { resolveAppUrl } from '@/lib/app-url';
import { sendEmail } from '@/lib/email/send';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface FinalizeSubmissionInput {
  db: ServiceDb;
  restaurantId: string;
  /** profiles.id of the submitting manager. NOT NULL, FK to profiles. */
  submittedBy: string;
  /**
   * The Checkout Session that paid for this submission — the idempotency key.
   * NULL only on the zero-pending-certificates path, where no Session exists.
   */
  checkoutSessionId: string | null;
  /**
   * The PaymentIntent Stripe created, when it created one. NULL for a comped
   * $0 Session (Stripe makes no PaymentIntent for a free order) and for the
   * zero-certificate path.
   */
  paymentIntentId: string | null;
  /**
   * What was actually charged, in cents. 0 is a REAL value — a comped
   * submission cost zero; it is not a submission with a missing price.
   */
  certFeeTotalCents: number;
  /**
   * How many certificates THIS payment activated. The money trail — it is not
   * how many the restaurant holds, and the two differ on every resubmission.
   * `countActiveCertificates` reads the number the reviewer is actually shown.
   */
  activatedCount: number;
  /** activity_events.actor_id. NULL from the webhook, which has no session. */
  actorId: string | null;
}

export type FinalizeSubmissionResult =
  | { outcome: 'created'; submissionId: string }
  /** This exact Checkout Session already has a submission row. Nothing to do. */
  | { outcome: 'duplicate' }
  /** Another submission for this restaurant is already open. Needs a human. */
  | { outcome: 'conflict' };

// ─── Constraint identification ────────────────────────────────────────────────

/**
 * Both unique indexes raise 23505, and they mean opposite things: one is a
 * benign redelivery, the other is a paid-for submission that could not be
 * recorded. PostgREST puts the index name in `message`/`details`, so match on
 * it rather than guessing from context.
 *
 * If a future index makes this ambiguous, the safe default is 'conflict' — it
 * logs loudly and asks for a human, where a wrong 'duplicate' would swallow
 * the problem.
 */
function classifyUniqueViolation(err: {
  message?: string;
  details?: string;
}): 'duplicate' | 'conflict' {
  const haystack = `${err.message ?? ''} ${err.details ?? ''}`;
  return haystack.includes('stripe_checkout_session_id') ? 'duplicate' : 'conflict';
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export async function finalizeSubmission(
  input: FinalizeSubmissionInput
): Promise<FinalizeSubmissionResult> {
  const {
    db,
    restaurantId,
    submittedBy,
    checkoutSessionId,
    paymentIntentId,
    certFeeTotalCents,
    activatedCount,
    actorId,
  } = input;

  // ── 1. The submission row. This INSERT is the idempotency boundary ────────
  const { data: inserted, error: insertError } = (await db
    .from('submissions')
    .insert({
      restaurant_id: restaurantId,
      submitted_by: submittedBy,
      status: 'pending',
      cert_fee_total_cents: certFeeTotalCents,
      stripe_payment_intent_id: paymentIntentId,
      stripe_checkout_session_id: checkoutSessionId,
    })
    .select('id')
    .single()) as {
    data: { id: string } | null;
    error: { code?: string; message?: string; details?: string } | null;
  };

  if (insertError) {
    if (insertError.code === '23505') {
      const kind = classifyUniqueViolation(insertError);
      if (kind === 'duplicate') {
        console.log(
          '[finalize-submission] submission already recorded for session:',
          checkoutSessionId
        );
      } else {
        console.error(
          '[finalize-submission] a submission is already open for restaurant:',
          restaurantId,
          '— refusing to open a second one. session:',
          checkoutSessionId
        );
      }
      return { outcome: kind };
    }

    throw new Error(`submission insert failed: ${insertError.message ?? 'unknown error'}`);
  }

  if (!inserted) {
    throw new Error('submission insert returned no row');
  }

  const submissionId = inserted.id;

  // ── 2. Move the restaurant into the reviewer queue ────────────────────────
  // Deliberately AFTER the insert. The DB must never hold a `pending_review`
  // restaurant with no matching submission row — that is the invariant the old
  // route protected with a compensating rollback, and doing the insert first
  // removes the need for one.
  const { error: statusError } = await db
    .from('restaurants')
    .update({ status: 'pending_review' })
    .eq('id', restaurantId);

  if (statusError) {
    // Throw: the webhook returns 500, Stripe redelivers, and the insert above
    // is absorbed as a duplicate on the retry while this update runs again.
    throw new Error(`restaurant status update failed: ${statusError.message}`);
  }

  // ── 3. How many certificates does this restaurant actually hold? ──────────
  // Read live, not passed in (T-47). Both callers activate the certificates
  // before calling this, so the read is correct on both paths and cannot drift
  // from `activatedCount` the way a second argument would.
  //
  // Read ONCE, here, and hand the same value to the event payload and the
  // email. Counting separately in each place would let two queries microseconds
  // apart disagree, which is the same failure this task exists to remove.
  const certifiedCount = await countActiveCertificates(db, restaurantId);

  // ── 4. Activity event (non-fatal) ─────────────────────────────────────────
  // Both counts, deliberately. `activatedCount` is how many certificates this
  // payment bought — the money trail — and `certifiedCount` is how many the
  // restaurant holds. On a resubmission where 3 of 10 staff are new they read
  // 3 and 10, and collapsing them into one key loses the audit.
  const { error: eventError } = await db.from('activity_events').insert({
    restaurant_id: restaurantId,
    actor_id: actorId,
    type: 'submission_created',
    payload: {
      submissionId,
      activatedCount,
      certifiedCount,
      certFeeTotalCents,
      stripe_checkout_session_id: checkoutSessionId,
      stripe_payment_intent_id: paymentIntentId,
    },
  });

  if (eventError) {
    console.error('[finalize-submission] activity event insert failed (non-fatal):', eventError);
  }

  // ── 5. Tell the reviewers (non-fatal) ─────────────────────────────────────
  void notifyReviewers({ db, restaurantId, submissionId, certifiedCount }).catch((err: unknown) => {
    console.error('[finalize-submission] RestaurantSubmitted email failed (non-fatal):', err);
  });

  console.log(
    '[finalize-submission] recorded submission:',
    submissionId,
    'restaurant:',
    restaurantId,
    'fee cents:',
    certFeeTotalCents
  );

  return { outcome: 'created', submissionId };
}

// ─── The reviewer-facing count ────────────────────────────────────────────────

/**
 * How many certificates this restaurant currently holds (T-47).
 *
 * The predicate is copied from app/api/reviewer/queue/route.ts — `status =
 * 'active'` AND `expires_at > now()`, BOTH clauses. The queue is where the
 * reviewer sees this same number for this same submission; if the email and
 * the queue disagreed, the reviewer would have no way to tell which one was
 * lying. Certificate ROWS are counted, not distinct learners, because that is
 * what the queue counts: a staff member holding two active certificates is
 * counted the same way on both surfaces.
 *
 * Returns `null` when the count could not be read. Never 0 — see T-18, where a
 * `?? 0` fallback laundered a failed query into a green stat telling the public
 * every restaurant was fully certified. The discriminator is "did a number
 * arrive", not "is the number zero": a successful count of zero yields the
 * NUMBER 0 and can never yield null, so "nobody is certified" and "the count
 * failed" stay distinguishable all the way to the render boundary. Same shape
 * as app/api/directory/[slug]/route.ts.
 */
async function countActiveCertificates(
  db: ServiceDb,
  restaurantId: string
): Promise<number | null> {
  try {
    const { count, error } = (await db
      .from('certificates')
      .select('id', { count: 'exact', head: true })
      .eq('restaurant_id', restaurantId)
      .eq('status', 'active')
      .gt('expires_at', new Date().toISOString())) as {
      count: number | null;
      error: { message?: string } | null;
    };

    if (error) {
      console.error('[finalize-submission] certified count failed for', restaurantId, ':', error);
    }

    return error || count == null ? null : count;
  } catch (err) {
    // A transport-level throw, which PostgREST does not return as `{error}`.
    // Swallowed on purpose: this runs AFTER the submission row is inserted and
    // the restaurant is queued, so rethrowing would 500 the webhook, Stripe
    // would redeliver, the redelivery would take the `duplicate` early return —
    // and the reviewer email would never be sent at all. The count is
    // decoration on an email; the submission is the money. Degrade the number.
    console.error('[finalize-submission] certified count threw for', restaurantId, ':', err);
    return null;
  }
}

// ─── Reviewer notification ────────────────────────────────────────────────────

async function notifyReviewers(params: {
  db: ServiceDb;
  restaurantId: string;
  submissionId: string;
  /** Live count from `countActiveCertificates`. `null` means "unknown". */
  certifiedCount: number | null;
}): Promise<void> {
  const { db, restaurantId, submissionId, certifiedCount } = params;

  const { data: restRow } = await db
    .from('restaurants')
    .select('name')
    .eq('id', restaurantId)
    .maybeSingle();

  const restaurantName = (restRow as { name: string } | null)?.name ?? 'A restaurant';
  const reviewerEmail = process.env.REVIEWER_EMAIL ?? 'reviewers@allergenwise.com';
  const appUrl = resolveAppUrl();

  const result = await sendEmail('RestaurantSubmitted', reviewerEmail, {
    restaurantName,
    submissionId,
    certifiedCount,
    reviewLink: `${appUrl}/reviewer/queue/${submissionId}`,
  });

  if (!result.ok) {
    console.error('[finalize-submission] RestaurantSubmitted email failed:', result.error);
  }
}
