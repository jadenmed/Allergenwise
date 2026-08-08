/**
 * app/api/stripe/webhook/route.ts
 * Stripe webhook receiver — signature-verified, idempotent.
 *
 * CRITICAL: raw body required for Stripe HMAC verification.
 * App Router does NOT auto-parse the body — req.text() gives the raw string.
 * runtime='nodejs' ensures Buffer + crypto are available.
 *
 * Idempotency strategy (revised — see db/migrations/0023_webhook_retryability.sql):
 *   1. INSERT event ID into stripe_events with status='pending', BEFORE
 *      processing side-effects. ON CONFLICT DO NOTHING.
 *   2. A pre-existing row is a duplicate ONLY if its status is 'completed'.
 *      A 'pending'/'failed' row means an earlier delivery never finished, so
 *      this delivery must run.
 *   3. On success → status='completed' + processed_at=now(). That write, not
 *      the INSERT, is what makes future deliveries duplicates.
 *   4. On handler throw → status='failed' (guarded so it can never downgrade a
 *      row another delivery already completed) and return 500 so Stripe retries.
 *
 * The row is never deleted: a delete racing a concurrent retry can erase the
 * winner's completion marker, and a delete that itself fails — likely, given the
 * same fault just broke the handler — restores the poison pill. Every write here
 * moves monotonically toward 'completed'.
 *
 * Concurrent redeliveries of one event can both observe non-'completed' and both
 * process. That is safe by design: the cert/refund/dispute handlers use narrowed
 * WHERE clauses precisely so replay is a no-op.
 *
 * Who provisions a plan (T-41a):
 *   checkout.session.completed — and ONLY that event. A $0 comped Checkout
 *   Session produces no PaymentIntent at all, so payment_intent.succeeded is
 *   never delivered for a 100%-off pilot. A PAID Session delivers both events,
 *   so `case 'plan'` in the PaymentIntent router is an explicit no-op: the two
 *   paths would write different stripe_invoice_ids (cs_… vs pi_…) and the
 *   UNIQUE index could not collapse them into one subscription.
 *
 * Who activates certificates and opens a submission (T-41b):
 *   checkout.session.completed with kind='cert_fee', for the same reason. The
 *   PaymentIntent router's `case 'cert_fee'` stays as belt-and-braces only —
 *   T-48 deleted the off-session charge route, so nothing in this codebase
 *   creates a cert-fee PaymentIntent any more, and the Checkout path cannot
 *   reach that case because Session metadata does not propagate to the
 *   PaymentIntent. Double activation is impossible either way — the
 *   certificates UPDATE is narrowed to `status='pending'`, and the submission
 *   INSERT is keyed on the UNIQUE submissions.stripe_checkout_session_id.
 *
 * Type note: Supabase Database type omits __InternalSupabase, causing insert/update
 * types to resolve as 'never' under postgrest-js v12. We cast via `as any` at
 * the query boundary — the runtime behavior and DB schema are correct.
 */

import { NextRequest, NextResponse } from 'next/server';
import { stripe } from '@/lib/stripe';
import { createServiceSupabase } from '@/lib/supabase/server';
import {
  handleCertFeeSucceeded,
  handleCertFeeCanceled,
  handleCertFeeFailed,
  handleChargeRefunded,
  handleDisputeCreated,
  handleDisputeClosed,
  handleDisputeFundsWithdrawn,
  handleDisputeFundsReinstated,
  handleSubscriptionDeleted,
} from '@/lib/stripe/cert-event-handlers';
import {
  formatMissingKeys,
  parseCertFeeCheckoutMetadata,
  parsePaymentKind,
  parsePlanPaymentMetadata,
  parseRestaurantId,
  parseSubmissionId,
} from '@/lib/stripe/metadata';
import { finalizeSubmission } from '@/lib/submissions/finalize';
import { maskEmail } from '@/lib/security/mask-pii';
import { sendEmail } from '@/lib/email/send';
import type { SubscriptionPlan } from '@/lib/types/db';
import type Stripe from 'stripe';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// ─── Startup check ────────────────────────────────────────────────────────────
// Throw at module load time so the deployment fails loudly instead of silently
// accepting events without verifying them.

const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;
if (!WEBHOOK_SECRET) {
  throw new Error('STRIPE_WEBHOOK_SECRET is not set. Webhook handler cannot start.');
}

// ─── Types ────────────────────────────────────────────────────────────────────
// The payment `kind` union lives in lib/stripe/metadata.ts, so the routing
// switch below and the producers that stamp `kind` share one definition.

type ServiceDb = ReturnType<typeof createServiceSupabase>;

// ─── Main handler ─────────────────────────────────────────────────────────────

export async function POST(req: NextRequest): Promise<NextResponse> {
  // 1. Read raw body — must happen before any .json() call
  const rawBody = await req.text();
  const sig = req.headers.get('stripe-signature');

  if (!sig) {
    return NextResponse.json({ error: 'Missing stripe-signature header' }, { status: 400 });
  }

  // 2. Verify HMAC signature — throws on mismatch
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, WEBHOOK_SECRET!);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[Stripe webhook] Signature verification failed:', message);
    return NextResponse.json({ error: `Webhook signature invalid: ${message}` }, { status: 400 });
  }

  // 3. Idempotency — insert BEFORE side-effects, ON CONFLICT DO NOTHING
  //    The Database type lacks __InternalSupabase so postgrest resolves Insert as
  //    never; cast via (as any) to bypass the type error — runtime is correct.
  const db = createServiceSupabase();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: insertErr, count } = await (db as any)
    .from('stripe_events')
    .insert({ id: event.id, type: event.type, status: 'pending' }, { ignoreDuplicates: true })
    .select('id', { count: 'exact' });

  // 23505 = unique_violation. With ignoreDuplicates postgrest reports the
  // conflict as count=0 rather than an error, but both are handled: either way
  // a row for this event id already exists.
  if (insertErr && (insertErr as { code?: string }).code !== '23505') {
    console.error('[Stripe webhook] Failed to write stripe_event:', insertErr);
    return NextResponse.json({ error: 'DB write failed' }, { status: 500 });
  }

  if (insertErr || (count as number) === 0) {
    // A row exists — but "exists" is NOT "handled". Only a completed row means
    // an earlier delivery ran to the end; anything else is a delivery that died
    // mid-flight, and swallowing this retry would drop the event permanently.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: prior, error: priorErr } = await (db as any)
      .from('stripe_events')
      .select('status')
      .eq('id', event.id)
      .maybeSingle();

    if (priorErr) {
      // Can't tell duplicate from unfinished — 500 so Stripe redelivers rather
      // than us guessing "duplicate" and losing the event.
      console.error('[Stripe webhook] Failed to read stripe_event status:', priorErr);
      return NextResponse.json({ error: 'DB write failed' }, { status: 500 });
    }

    const priorStatus = (prior as { status?: string } | null)?.status ?? null;

    if (priorStatus === 'completed') {
      console.log('[Stripe webhook] Duplicate event, skipping:', event.id);
      return NextResponse.json({ received: true, duplicate: true });
    }

    console.warn(
      '[Stripe webhook] Redelivery of an unfinished event — reprocessing:',
      event.id,
      '| prior status:',
      priorStatus ?? 'row vanished'
    );
  }

  // 4. Route by event type — Wave 2C cert lifecycle expanded.
  try {
    switch (event.type) {
      case 'payment_intent.succeeded':
        await handlePaymentIntentSucceeded(db, event.data.object as Stripe.PaymentIntent, event.id);
        break;

      // T-41a — plan provisioning lives HERE, not on payment_intent.succeeded.
      // T-41b — so do certificate activation and the submission row.
      // A comped ($0) Checkout Session never produces a PaymentIntent, so the
      // old routing silently never provisioned a 100%-off pilot restaurant and
      // could never have activated a 100%-off pilot's certificates.
      //
      // Delayed-notification methods (ACH and friends) complete the Session
      // with payment_status='unpaid' and settle later. The handler refuses an
      // unsettled session, so async_payment_succeeded is the event that does
      // the work once the money actually arrives. Same Session id → the UNIQUE
      // indexes make a double-write impossible either way.
      case 'checkout.session.completed':
      case 'checkout.session.async_payment_succeeded':
        await handleCheckoutSessionCompleted(
          db,
          event.data.object as Stripe.Checkout.Session,
          event.id
        );
        break;

      case 'payment_intent.payment_failed':
        await handlePaymentIntentFailed(db, event.data.object as Stripe.PaymentIntent, event.id);
        break;

      case 'payment_intent.canceled':
        await handlePaymentIntentCanceled(db, event.data.object as Stripe.PaymentIntent, event.id);
        break;

      case 'charge.refunded':
        await handleChargeRefunded(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          db as any,
          event.data.object as Stripe.Charge,
          event.id
        );
        break;

      case 'charge.dispute.created':
        await handleDisputeCreated(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          db as any,
          event.data.object as Stripe.Dispute,
          event.id
        );
        break;

      case 'charge.dispute.closed':
        await handleDisputeClosed(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          db as any,
          event.data.object as Stripe.Dispute,
          event.id
        );
        break;

      case 'charge.dispute.funds_withdrawn':
        await handleDisputeFundsWithdrawn(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          db as any,
          event.data.object as Stripe.Dispute,
          event.id
        );
        break;

      case 'charge.dispute.funds_reinstated':
        await handleDisputeFundsReinstated(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          db as any,
          event.data.object as Stripe.Dispute,
          event.id
        );
        break;

      case 'customer.subscription.deleted':
        await handleSubscriptionDeleted(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          db as any,
          event.data.object as Stripe.Subscription,
          event.id
        );
        break;

      case 'customer.updated':
        await handleCustomerUpdated(db, event.data.object as Stripe.Customer);
        break;

      default:
        console.log('[Stripe webhook] Unhandled event type:', event.type);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[Stripe webhook] Handler threw:', event.type, message);

    // Leave the event RETRYABLE. The row stays (never deleted) so a stuck
    // delivery is queryable, and the neq guard stops a losing concurrent
    // delivery from downgrading a row another delivery already completed.
    // Best-effort: if this write fails the row is still 'pending', which is
    // also retryable — the failure mode points the safe way.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: markErr } = await (db as any)
      .from('stripe_events')
      .update({ status: 'failed' })
      .eq('id', event.id)
      .neq('status', 'completed');

    if (markErr) {
      console.error('[Stripe webhook] Failed to mark event failed:', event.id, markErr);
    }

    return NextResponse.json({ error: 'Handler failed', detail: message }, { status: 500 });
  }

  // 5. Completion marker. THIS write — not the INSERT above — is what makes a
  //    future delivery of this event a duplicate. If it fails we must return 500:
  //    a 200 with no marker means Stripe never retries and the event is stuck
  //    'pending' forever. The handlers are replay-safe, so a redelivery is cheap.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: completeErr } = await (db as any)
    .from('stripe_events')
    .update({ status: 'completed', processed_at: new Date().toISOString() })
    .eq('id', event.id);

  if (completeErr) {
    console.error('[Stripe webhook] Failed to mark event completed:', event.id, completeErr);
    return NextResponse.json({ error: 'DB write failed' }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}

// ─── payment_intent.succeeded ────────────────────────────────────────────────

async function handlePaymentIntentSucceeded(
  db: ServiceDb,
  pi: Stripe.PaymentIntent,
  stripeEventId: string
): Promise<void> {
  const kind = parsePaymentKind(pi.metadata);
  const restaurantId = parseRestaurantId(pi.metadata);

  console.log('[Stripe webhook] payment_intent.succeeded', {
    id: pi.id,
    kind,
    restaurantId,
  });

  switch (kind) {
    case 'plan':
      // NOT a provisioning path any more (T-41a). A PAID Checkout Session
      // fires BOTH checkout.session.completed and payment_intent.succeeded.
      // Provisioning from both would insert two subscriptions rows carrying
      // different ids (cs_… vs pi_…), which the UNIQUE index on
      // subscriptions.stripe_invoice_id cannot dedupe — so the second insert
      // succeeds and the restaurant is billed once but provisioned twice.
      //
      // Signup deliberately keeps plan metadata off payment_intent_data, so
      // this case should not even be reached from the signup flow; it stays
      // as an explicit no-op so an older PaymentIntent (or metadata that
      // starts propagating) still cannot double-provision.
      console.log(
        '[Stripe webhook] plan PaymentIntent succeeded — provisioning is owned by',
        'checkout.session.completed; ignoring here:',
        pi.id
      );
      break;

    case 'cert_fee':
      // Wave 2C — atomically activate all pending certs for the restaurant,
      // stamp PI + per-cert fee, write cert_activated events, fire-and-forget
      // PDF generation. R7 logged as cert_payment_orphaned if 0 pending.
      //
      // T-48: this case NO LONGER HAS A CALLER. T-41b moved submission fees
      // onto Checkout, and T-48 deleted app/api/stripe/charge-cert-fees —
      // nothing in this codebase creates a cert_fee PaymentIntent any more.
      // It is kept as belt-and-braces for one narrow case: a PaymentIntent
      // created by the old route before it was deleted, still in flight when
      // this deploys, must still activate the certificates it was charged
      // for. Deleting the branch would silently strand that money.
      //
      // Do not read its presence as evidence of a live off-session path. If
      // you are adding one, that is a new decision, not a resumption.
      //
      // Double activation is impossible regardless: the UPDATE inside is
      // narrowed to `.eq('status','pending')`, so a second run over the same
      // restaurant flips zero rows.
      //
      // Note this is NOT reached by the Checkout path. Session metadata does
      // not propagate to the PaymentIntent, and /api/submissions/create
      // deliberately does not stamp `kind` onto payment_intent_data, so a paid
      // cert-fee Checkout's PaymentIntent arrives with kind='unknown'.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await handleCertFeeSucceeded(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        db as any,
        { metadata: pi.metadata, amountCents: pi.amount, paymentId: pi.id },
        stripeEventId
      );
      break;

    case 'cert_topup':
      // T-45a. Same reasoning as 'plan' above: a PAID Checkout fires BOTH
      // checkout.session.completed and payment_intent.succeeded, and
      // lib/billing/cert-checkout.ts deliberately keeps `kind` off
      // payment_intent_data — so a top-up's PaymentIntent arrives here with
      // kind='unknown' and this case is not reached in practice. It is written
      // out rather than left to `default` so that a top-up PaymentIntent, if
      // metadata ever starts propagating, is an explicit no-op instead of a
      // warning that reads like a bug. Activation is owned by the Session.
      console.log(
        '[Stripe webhook] cert-topup PaymentIntent succeeded — activation is owned by',
        'checkout.session.completed; ignoring here:',
        pi.id
      );
      break;

    case 'submission':
      await handleSubmissionPayment(db, pi);
      break;

    default:
      console.warn('[Stripe webhook] Unknown payment kind:', kind, 'PI:', pi.id);
  }
}

// ─── checkout.session.completed → plan provisioning / cert activation ────────

/**
 * The only entry point for both money paths that matter (T-41a, T-41b).
 *
 * Stripe: "Completed Checkout Sessions that are free won't have an associated
 * PaymentIntent" and "If the total amount is 0, Checkout doesn't collect a
 * payment method." So a 100%-off pilot fires this event and nothing else —
 * routing off payment_intent.succeeded left those restaurants silently
 * unprovisioned and their staff silently uncertified.
 */
async function handleCheckoutSessionCompleted(
  db: ServiceDb,
  session: Stripe.Checkout.Session,
  stripeEventId: string
): Promise<void> {
  const kind = parsePaymentKind(session.metadata);

  console.log('[Stripe webhook] checkout.session.completed', {
    id: session.id,
    kind,
    payment_status: session.payment_status,
    amount_total: session.amount_total,
  });

  if (kind !== 'plan' && kind !== 'cert_fee' && kind !== 'cert_topup') {
    console.log(
      '[Stripe webhook] checkout.session.completed — unhandled kind, ignoring:',
      kind,
      'session:',
      session.id
    );
    return;
  }

  if (!isSessionSettled(session)) {
    console.warn(
      '[Stripe webhook]',
      kind,
      'session completed but not yet paid — deferring to',
      'checkout.session.async_payment_succeeded. session:',
      session.id,
      'payment_status:',
      session.payment_status
    );
    return;
  }

  if (kind === 'plan') {
    await handlePlanPayment(db, {
      metadata: session.metadata,
      amountCents: readSessionAmountTotal(session),
      // The Session id — stable across redeliveries, and unique per signup.
      idempotencyId: session.id,
    });
    return;
  }

  if (kind === 'cert_topup') {
    await handleCertTopUpCheckout(db, session, stripeEventId);
    return;
  }

  await handleCertFeeCheckout(db, session, stripeEventId);
}

// ─── cert_topup Checkout → activate certs, and STOP ──────────────────────────

/**
 * A LISTED restaurant paid for staff certified after its listing (T-45a).
 *
 * ONE write, and the absence of the second one is the point.
 *
 * `cert_fee` activates the certificates and then calls `finalizeSubmission`,
 * which inserts a submission row and flips the restaurant to `pending_review`.
 * That is right at submission and wrong here: this restaurant is already listed,
 * and re-queueing it for review every time a new hire passes the exam would pull
 * a live listing down over a $35 top-up. So this handler activates and returns.
 *
 * The activation itself is the SAME `handleCertFeeSucceeded` the submission path
 * uses — not a copy. It is narrowed to `WHERE status='pending'`, so it is
 * idempotent across redeliveries, it cannot touch a certificate that was already
 * paid for, and it can only ever move a certificate FORWARD. Nothing in the
 * top-up path revokes, expires or downgrades a credential; enforcement for an
 * unpaid balance belongs on the LISTING, and it belongs to T-45b.
 *
 * `submitted_by` is deliberately not required here. It exists to fill
 * `submissions.submitted_by` (NOT NULL), and no submission row is written on
 * this path — so a Session carrying only `restaurant_id` still settles correctly.
 */
async function handleCertTopUpCheckout(
  db: ServiceDb,
  session: Stripe.Checkout.Session,
  stripeEventId: string
): Promise<void> {
  const restaurantId = parseRestaurantId(session.metadata);

  if (!restaurantId) {
    console.error(
      '[Stripe webhook] cert-topup session missing restaurant_id:',
      session.id,
      session.metadata
    );
    // Loud 500, not a silent skip: money moved and nobody got certified.
    throw new Error('Missing restaurant_id in Stripe metadata');
  }

  const paymentIntentId = readSessionPaymentIntentId(session);

  // `paymentId` is the PaymentIntent when one exists, so a later
  // charge.refunded / dispute (which look certificates up by
  // stripe_payment_intent_id) still finds them. A comped $0 Session has no
  // PaymentIntent and nothing to refund, so it stamps the Session id.
  const { activatedCount } = await handleCertFeeSucceeded(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    db as any,
    {
      metadata: session.metadata,
      amountCents: readSessionAmountTotal(session),
      paymentId: paymentIntentId ?? session.id,
    },
    stripeEventId
  );

  console.log('[Stripe webhook] cert-topup settled:', {
    session: session.id,
    restaurantId,
    activatedCount,
  });
}

/**
 * Has the money actually arrived?
 *
 * 'no_payment_required' IS the comped case — a $0 total Stripe collected no
 * card for, and the one this whole change exists to make work. 'paid' is the
 * ordinary card case. Anything else (i.e. 'unpaid') is a delayed-notification
 * method that has not settled; acting on it would hand out a subscription, or
 * activate certificates, for money that may never arrive.
 * checkout.session.async_payment_succeeded re-runs the handler when it lands.
 */
function isSessionSettled(session: Stripe.Checkout.Session): boolean {
  return session.payment_status === 'paid' || session.payment_status === 'no_payment_required';
}

/** The PaymentIntent id, when Stripe made one. A $0 Session has none. */
function readSessionPaymentIntentId(session: Stripe.Checkout.Session): string | null {
  const pi = session.payment_intent;
  if (typeof pi === 'string') return pi;
  return pi?.id ?? null;
}

// ─── cert_fee Checkout → activate certs + record the submission ──────────────

/**
 * A restaurant paid its certification fees at submission (T-41b).
 *
 * Three writes, in this order and for this reason:
 *
 *   1. Activate the pending certificates. That is what the money bought, and
 *      it is idempotent (`WHERE status='pending'`), so doing it first costs
 *      nothing on a retry.
 *   2. Insert the submission row, keyed on the Session id. The UNIQUE index on
 *      `submissions.stripe_checkout_session_id` is what makes a redelivery a
 *      no-op — a read-then-write check would let two concurrent deliveries
 *      both pass.
 *   3. Flip the restaurant to `pending_review` (inside finalizeSubmission,
 *      after the insert, so the DB never holds a pending_review restaurant
 *      with no submission row).
 *
 * Closes T-05: certificate activation no longer waits on a payment that itself
 * waited on the certificates being active.
 */
async function handleCertFeeCheckout(
  db: ServiceDb,
  session: Stripe.Checkout.Session,
  stripeEventId: string
): Promise<void> {
  const parsed = parseCertFeeCheckoutMetadata(session.metadata);

  if (!parsed.ok) {
    console.error(
      '[Stripe webhook] cert-fee session missing metadata:',
      session.id,
      'missing:',
      formatMissingKeys(parsed.missing),
      session.metadata
    );
    // Loud 500, not a silent skip: money moved and nobody got certified.
    throw new Error(`Missing ${formatMissingKeys(parsed.missing)} in Stripe metadata`);
  }

  const { restaurantId, submittedBy } = parsed.value;
  const amountCents = readSessionAmountTotal(session);
  const paymentIntentId = readSessionPaymentIntentId(session);

  // 1. Activate. `paymentId` is the PaymentIntent when one exists so that a
  //    later charge.refunded / dispute (which look certificates up by
  //    stripe_payment_intent_id) still finds them; a comped $0 Session has no
  //    PaymentIntent and nothing to refund, so it stamps the Session id.
  const { activatedCount } = await handleCertFeeSucceeded(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    db as any,
    {
      metadata: session.metadata,
      amountCents,
      paymentId: paymentIntentId ?? session.id,
    },
    stripeEventId
  );

  // 2 + 3. Record the submission and open the review.
  const result = await finalizeSubmission({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    db: db as any,
    restaurantId,
    submittedBy,
    checkoutSessionId: session.id,
    paymentIntentId,
    // What was ACTUALLY charged. 0 after a 100%-off promotion code is a real
    // amount, not a missing one.
    certFeeTotalCents: amountCents,
    activatedCount,
    actorId: null,
  });

  if (result.outcome === 'duplicate') {
    console.log(
      '[Stripe webhook] cert-fee session already recorded — redelivery absorbed:',
      session.id
    );
    return;
  }

  if (result.outcome === 'conflict') {
    // A second Checkout Session was paid while a submission was already open.
    // The certificates are activated (the money did buy those), but no second
    // listing may be queued. Money in, nothing to show for it — the same R7
    // posture as cert_payment_orphaned: shout, and refund by hand.
    console.error(
      '[Stripe webhook] cert-fee paid but a submission is already open. Refund required.',
      'session:',
      session.id,
      'restaurant:',
      restaurantId,
      'amount_cents:',
      amountCents
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (db as any).from('activity_events').insert({
      restaurant_id: restaurantId,
      actor_id: null,
      type: 'submission_payment_orphaned',
      payload: {
        stripe_event_id: stripeEventId,
        stripe_checkout_session_id: session.id,
        stripe_payment_intent_id: paymentIntentId,
        restaurant_id: restaurantId,
        amount_cents: amountCents,
      },
    });
    return;
  }

  console.log(
    '[Stripe webhook] cert fees paid — submission',
    result.submissionId,
    'opened for restaurant:',
    restaurantId,
    '| certs activated:',
    activatedCount,
    '| amount_cents:',
    amountCents
  );
}

/**
 * `amount_total` in cents.
 *
 * 0 is a REAL amount (the 100%-off comp) and must be stored as 0 — a comped
 * subscription is a subscription worth zero, not a subscription with a missing
 * price. Only a null/absent amount is a fault, and it is loud: throwing returns
 * a 500 so Stripe redelivers, rather than inventing a price for a billing row.
 */
function readSessionAmountTotal(session: Stripe.Checkout.Session): number {
  if (typeof session.amount_total !== 'number') {
    throw new Error(
      `Checkout Session ${session.id} completed with no amount_total; refusing to guess a subscription price`
    );
  }
  return session.amount_total;
}

// ─── Plan payment → create subscription + enqueue WelcomeAdmin ───────────────

/**
 * What provisioning needs, independent of which Stripe object announced it.
 *
 * Deliberately not a Stripe type: checkout.session.completed and
 * payment_intent.succeeded carry the same three facts under different names,
 * and a second copy of this body for the second shape is how the two drift.
 */
interface PlanPaymentInput {
  /** Metadata stamped by lib/auth/signup.ts — read only via lib/stripe/metadata.ts. */
  metadata: Stripe.Metadata | null | undefined;
  /** Amount actually charged, in cents. 0 is a real, comped value. */
  amountCents: number;
  /**
   * Written to subscriptions.stripe_invoice_id, whose UNIQUE index is the only
   * thing two concurrent deliveries cannot both pass. Must be unique per signup
   * and stable across redeliveries of the same payment.
   */
  idempotencyId: string;
}

async function handlePlanPayment(db: ServiceDb, payment: PlanPaymentInput): Promise<void> {
  const parsed = parsePlanPaymentMetadata(payment.metadata);

  if (!parsed.ok) {
    console.error(
      '[Stripe webhook] plan payment missing metadata:',
      payment.idempotencyId,
      'missing:',
      formatMissingKeys(parsed.missing),
      payment.metadata
    );
    throw new Error(`Missing ${formatMissingKeys(parsed.missing)} in Stripe metadata`);
  }

  const { restaurantId, plan } = parsed.value;

  // Idempotency is enforced by the DB, not by a read-then-write check: the
  // UNIQUE index on subscriptions.stripe_invoice_id (0023) is the only guard two
  // concurrent deliveries of this event cannot both pass. The old
  // SELECT-then-INSERT let both see "not found" and both insert. Same precedent
  // as invoice_payments.stripe_invoice_id in 0020.

  // Calculate term
  const today = new Date();
  const startsAt = today.toISOString().slice(0, 10); // YYYY-MM-DD
  const endsDate = new Date(today);
  if (plan === 'quarterly') {
    endsDate.setMonth(endsDate.getMonth() + 3);
  } else {
    endsDate.setMonth(endsDate.getMonth() + 6);
  }
  const endsAt = endsDate.toISOString().slice(0, 10);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: subErr } = await (db as any).from('subscriptions').insert({
    restaurant_id: restaurantId,
    plan,
    starts_at: startsAt,
    ends_at: endsAt,
    amount_cents: payment.amountCents,
    status: 'active',
    stripe_invoice_id: payment.idempotencyId,
    stripe_subscription_id: null,
    auto_renew: false,
  });

  if (subErr) {
    // 23505 on this table can only be the stripe_invoice_id index (the PK is a
    // server-generated uuid), so the subscription already exists — an earlier or
    // concurrent delivery won. Return without re-firing the activity event or a
    // second WelcomeAdmin, exactly as the old duplicate branch did.
    if ((subErr as { code?: string }).code === '23505') {
      console.log('[Stripe webhook] Subscription already exists for:', payment.idempotencyId);
      return;
    }
    console.error('[Stripe webhook] Failed to insert subscription:', subErr);
    throw new Error(`Subscription insert failed: ${(subErr as { message: string }).message}`);
  }

  // Activity event
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (db as any).from('activity_events').insert({
    restaurant_id: restaurantId,
    actor_id: null,
    type: 'subscription_created',
    // Named for the column the value lands in, so ops can join the two. It is
    // a Checkout Session id (cs_…) now, not a PaymentIntent id.
    payload: {
      plan,
      amount_cents: payment.amountCents,
      stripe_invoice_id: payment.idempotencyId,
    },
  });

  console.log('[Stripe webhook] Subscription created for restaurant:', restaurantId, 'plan:', plan);

  // WelcomeAdmin email — fire-and-forget so email outage doesn't fail the webhook
  sendWelcomeAdminEmail(db, restaurantId, plan).catch((emailErr) => {
    console.error('[Stripe webhook] WelcomeAdmin email failed:', emailErr);
  });
}

/** Look up admin profile, then send WelcomeAdmin email via Resend. */
async function sendWelcomeAdminEmail(
  db: ServiceDb,
  restaurantId: string,
  plan: SubscriptionPlan
): Promise<void> {
  const { data: rows } = await db
    .from('profiles')
    .select('id, full_name, email')
    .eq('restaurant_id', restaurantId)
    .eq('role', 'manager')
    .limit(1);

  const admin = Array.isArray(rows)
    ? (rows[0] as { id: string; full_name: string; email: string } | undefined)
    : undefined;

  if (!admin) {
    console.warn('[Stripe webhook] No admin profile for restaurant:', restaurantId);
    return;
  }

  const { data: restRow } = await db
    .from('restaurants')
    .select('name')
    .eq('id', restaurantId)
    .maybeSingle();

  const restaurantName = (restRow as { name: string } | null)?.name ?? 'your restaurant';
  const appUrl = process.env.APP_URL ?? 'https://allergenwise.com';

  const result = await sendEmail('WelcomeAdmin', admin.email, {
    adminName: admin.full_name,
    restaurantName,
    plan,
    dashboardUrl: `${appUrl}/admin/dashboard`,
  });

  if (!result.ok) {
    console.error('[Stripe webhook] WelcomeAdmin email failed:', result.error);
    return;
  }

  console.log('[Stripe webhook] WelcomeAdmin email sent to:', maskEmail(admin.email));
}

// (Wave 2C) Cert-fee handling moved to lib/stripe/cert-event-handlers.ts.
// The legacy handleCertFeePayment is gone — it broke at scale because
// pi.metadata.certificate_id was never populated (cert→PI is N:1, not 1:1).

// ─── Submission payment → record PI on submission row ────────────────────────

async function handleSubmissionPayment(db: ServiceDb, pi: Stripe.PaymentIntent): Promise<void> {
  const submissionId = parseSubmissionId(pi.metadata);
  const restaurantId = parseRestaurantId(pi.metadata);

  if (!submissionId) {
    console.warn('[Stripe webhook] submission payment missing submission_id:', pi.id);
    return;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: subErr } = await (db as any)
    .from('submissions')
    .update({ stripe_payment_intent_id: pi.id })
    .eq('id', submissionId);

  if (subErr) {
    console.error('[Stripe webhook] Failed to update submission:', subErr);
    throw new Error(`Submission update failed: ${(subErr as { message: string }).message}`);
  }

  if (restaurantId) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (db as any).from('activity_events').insert({
      restaurant_id: restaurantId,
      actor_id: null,
      type: 'submission_created',
      payload: {
        submission_id: submissionId,
        payment_intent_id: pi.id,
        amount_cents: pi.amount,
      },
    });
  }

  console.log('[Stripe webhook] Submission payment recorded:', submissionId);
}

// ─── payment_intent.payment_failed ───────────────────────────────────────────

async function handlePaymentIntentFailed(
  db: ServiceDb,
  pi: Stripe.PaymentIntent,
  stripeEventId: string
): Promise<void> {
  const restaurantId = parseRestaurantId(pi.metadata);
  const kind = parsePaymentKind(pi.metadata);
  const failureMessage = pi.last_payment_error?.message ?? 'Payment declined.';

  // Wave 2C — cert-fee failures get the dedicated cert_payment_failed event.
  if (kind === 'cert_fee') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handleCertFeeFailed(db as any, pi, stripeEventId);
    return;
  }

  if (!restaurantId) {
    console.warn('[Stripe webhook] payment_failed missing restaurant_id:', pi.id);
    return;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (db as any).from('activity_events').insert({
    restaurant_id: restaurantId,
    actor_id: null,
    type: 'subscription_expired', // closest available type; payload disambiguates
    payload: {
      event: 'payment_failed',
      kind,
      payment_intent_id: pi.id,
      failure_message: failureMessage,
      failure_code: pi.last_payment_error?.code ?? null,
    },
  });

  // Placeholder: F2 owns the admin failure email template.
  console.log(
    '[Stripe webhook] Payment failed — admin notification placeholder:',
    restaurantId,
    '| kind:',
    kind,
    '| reason:',
    failureMessage
  );
}

// ─── payment_intent.canceled ─────────────────────────────────────────────────

async function handlePaymentIntentCanceled(
  db: ServiceDb,
  pi: Stripe.PaymentIntent,
  stripeEventId: string
): Promise<void> {
  const kind = parsePaymentKind(pi.metadata);

  if (kind === 'cert_fee') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handleCertFeeCanceled(db as any, pi, stripeEventId);
    return;
  }

  // For other kinds, log to console — non-cert flows don't need cert events.
  console.log('[Stripe webhook] payment_intent.canceled — non-cert kind:', kind, 'PI:', pi.id);
}

// ─── customer.updated → sync stripe_customer_id ──────────────────────────────

async function handleCustomerUpdated(db: ServiceDb, customer: Stripe.Customer): Promise<void> {
  const restaurantId = parseRestaurantId(customer.metadata);

  if (!restaurantId) {
    console.log(
      '[Stripe webhook] customer.updated: no restaurant_id in metadata, skipping:',
      customer.id
    );
    return;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (db as any)
    .from('restaurants')
    .update({ stripe_customer_id: customer.id })
    .eq('id', restaurantId);

  if (error) {
    console.error('[Stripe webhook] Failed to sync customer ID:', error);
  } else {
    console.log('[Stripe webhook] customer.updated synced:', customer.id, '→', restaurantId);
  }
}
