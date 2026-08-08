/**
 * lib/stripe/cert-event-handlers.ts
 *
 * Wave 2C cert-lifecycle Stripe event handlers.
 *
 * Each handler:
 *   - Reads pending/active/disputed certs from the DB,
 *   - Validates the proposed transition via lib/learner/cert-state.ts,
 *   - Issues the row UPDATE (idempotent — narrowed `WHERE status IN (...)`),
 *   - Writes one activity_events row per cert touched,
 *   - Never throws on illegal transitions (logs `cert_state_transition_blocked`
 *     so Stripe keeps getting 200s).
 *
 * The route handler at app/api/stripe/webhook/route.ts dispatches into
 * these on the dedupe-passed event.
 *
 * Tested by: tests/integration/stripe-cert-events.test.ts (real local DB).
 */

import 'server-only';
import type Stripe from 'stripe';
import type { ServiceDb } from '@/lib/db/service';
import { transitionCert, type CertStatus, type TransitionTrigger } from '@/lib/learner/cert-state';
import { parseRestaurantId } from '@/lib/stripe/metadata';
import { resolveAppUrl } from '@/lib/app-url';

// ─── Helper: load certs ───────────────────────────────────────────────────────

interface CertLite {
  id: string;
  cert_code: string;
  status: CertStatus;
  restaurant_id: string;
  profile_id: string;
  stripe_payment_intent_id: string | null;
}

async function certsByPaymentIntent(db: ServiceDb, paymentIntentId: string): Promise<CertLite[]> {
  const { data, error } = await db
    .from('certificates')
    .select('id, cert_code, status, restaurant_id, profile_id, stripe_payment_intent_id')
    .eq('stripe_payment_intent_id', paymentIntentId);
  if (error) throw new Error(`certsByPaymentIntent: ${error.message}`);
  return (data as CertLite[] | null) ?? [];
}

async function pendingCertsByRestaurant(db: ServiceDb, restaurantId: string): Promise<CertLite[]> {
  const { data, error } = await db
    .from('certificates')
    .select('id, cert_code, status, restaurant_id, profile_id, stripe_payment_intent_id')
    .eq('restaurant_id', restaurantId)
    .eq('status', 'pending');
  if (error) throw new Error(`pendingCertsByRestaurant: ${error.message}`);
  return (data as CertLite[] | null) ?? [];
}

// ─── Helper: write activity event (typed loose; ActivityEvent insert is jsonb) ─

async function writeEvent(
  db: ServiceDb,
  row: {
    restaurant_id: string | null;
    actor_id: string | null;
    type: string;
    payload: Record<string, unknown>;
  }
) {
  const { error } = await db.from('activity_events').insert(row);
  if (error) {
    console.error('[cert-event-handlers] activity_events insert failed:', error);
  }
}

/**
 * Batched sibling of writeEvent. A single multi-row INSERT evaluates now()
 * once per statement, so created_at is stamped explicitly with a strictly
 * increasing offset per row to preserve iteration order for the
 * activity_events_certificate_id_idx `ORDER BY created_at` query.
 */
async function writeEvents(
  db: ServiceDb,
  rows: Array<{
    restaurant_id: string | null;
    actor_id: string | null;
    type: string;
    payload: Record<string, unknown>;
  }>
) {
  if (rows.length === 0) return;
  const base = Date.now();
  const stamped = rows.map((row, i) => ({
    ...row,
    created_at: new Date(base + i).toISOString(),
  }));
  const { error } = await db.from('activity_events').insert(stamped);
  if (error) {
    console.error('[cert-event-handlers] activity_events batch insert failed:', error);
  }
}

// ─── Helper: PDF fire-and-forget at activation ────────────────────────────────

function fireAndForgetPdfGeneration(certificateId: string) {
  // resolveAppUrl throws in production when no base URL is configured. This is
  // a fire-and-forget internal call, so swallow it into a log rather than
  // failing the webhook: the certificate IS active, and a missing PDF is
  // recoverable where an un-activated certificate is not. (lib/app-url.ts:42
  // named this call site as T-41b's to clean up — this is that cleanup.)
  let appUrl: string;
  try {
    appUrl = resolveAppUrl();
  } catch (err) {
    console.error(
      '[cert-event-handlers] PDF generate skipped — no base URL configured:',
      err instanceof Error ? err.message : err
    );
    return;
  }
  const secret = process.env.CRON_SECRET ?? '';
  fetch(`${appUrl}/api/certs/generate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-internal-secret': secret,
    },
    body: JSON.stringify({ certificateId }),
  }).catch((err) => {
    console.error('[cert-event-handlers] PDF generate fire-and-forget failed:', err);
  });
}

// ─── handleCertFeeSucceeded ──────────────────────────────────────────────────

/**
 * What certificate activation needs, independent of which Stripe object
 * announced the payment.
 *
 * Deliberately not a Stripe type (T-41b, the same move `handlePlanPayment` got
 * in T-41a): `payment_intent.succeeded` and `checkout.session.completed` carry
 * the same three facts under different names, and a second copy of the body
 * below for the second shape is how the two drift.
 */
export interface CertFeePaymentInput {
  /** Metadata stamped by the producer — read only via lib/stripe/metadata.ts. */
  metadata: Stripe.Metadata | null | undefined;
  /**
   * Total actually charged, in cents. 0 is a REAL, comped value: a 100%-off
   * promotion code takes a Checkout Session's amount_total to zero, and each
   * certificate then legitimately stores fee_charged_cents = 0.
   */
  amountCents: number;
  /**
   * The Stripe id stamped onto every activated certificate.
   *
   * The PaymentIntent id whenever one exists — `handleChargeRefunded` and the
   * dispute handlers look certificates up by
   * `certificates.stripe_payment_intent_id` against `charge.payment_intent`, so
   * a paid checkout MUST stamp the PI or a later refund would revoke nothing.
   * For a comped $0 Session there is no PaymentIntent at all, so the caller
   * passes the Session id: nothing was charged, so nothing can be refunded or
   * disputed, and the id is still the traceable link back to Stripe.
   */
  paymentId: string;
}

/**
 * A cert-fee payment succeeded — on either event shape.
 *
 * Flips ALL pending certs for the restaurant to active in a single idempotent
 * UPDATE, stamps each with `paymentId` and a per-cert fee_charged_cents
 * (= floor(amountCents / N)). Inserts a cert_activated event per cert. Fires
 * PDF generation fire-and-forget per cert (deferred from exam/submit per OQ-1).
 *
 * Replay-safe by construction: the UPDATE is narrowed to `status='pending'`, so
 * a second delivery flips nothing. Returns how many certificates this payment
 * covered, which is what the caller records on the submission row.
 *
 * R7: if N=0 AND no certificate already carries this payment id, log
 * `cert_payment_orphaned` at error level — money received, nothing delivered.
 * Pre-launch posture is a manual Stripe-dashboard refund. N=0 WITH matching
 * certificates is just a redelivery of a payment that already landed, and is
 * logged as such rather than raising a false alarm.
 */
export async function handleCertFeeSucceeded(
  db: ServiceDb,
  payment: CertFeePaymentInput,
  stripeEventId: string
): Promise<{ activatedCount: number }> {
  const restaurantId = parseRestaurantId(payment.metadata);
  if (!restaurantId) {
    console.error('[cert-fee-succeeded] missing restaurant_id metadata:', payment.paymentId);
    return { activatedCount: 0 };
  }

  const pending = await pendingCertsByRestaurant(db, restaurantId);

  if (pending.length === 0) {
    // Distinguish a redelivery from a genuine orphan before crying wolf: if
    // certificates already carry this payment id, an earlier delivery of this
    // same payment activated them and nothing is wrong.
    const alreadyPaid = await certsByPaymentIntent(db, payment.paymentId);
    if (alreadyPaid.length > 0) {
      console.log(
        '[cert-fee-succeeded] replay — certs already activated by this payment:',
        payment.paymentId,
        'count:',
        alreadyPaid.length
      );
      return { activatedCount: alreadyPaid.length };
    }

    // R7 — orphaned payment.
    console.error(
      '[cert-fee-succeeded] payment succeeded but 0 pending certs:',
      payment.paymentId,
      'restaurant:',
      restaurantId
    );
    await writeEvent(db, {
      restaurant_id: restaurantId,
      actor_id: null,
      type: 'cert_payment_orphaned',
      payload: {
        stripe_event_id: stripeEventId,
        stripe_payment_intent_id: payment.paymentId,
        restaurant_id: restaurantId,
        amount_cents: payment.amountCents,
      },
    });
    return { activatedCount: 0 };
  }

  // floor, not round: the remainder of an odd split stays with AllergenWise
  // rather than over-reporting what each certificate cost. A comped total of 0
  // divides to 0, which is the correct stored value — see CertFeePaymentInput.
  const feePerCert = Math.floor(payment.amountCents / pending.length);

  // Idempotent activation — narrowed WHERE status='pending' so a replay is
  // a no-op even past the dedupe table (defense in depth).
  const { error: updateErr } = await db
    .from('certificates')
    .update({
      status: 'active',
      status_changed_at: new Date().toISOString(),
      stripe_payment_intent_id: payment.paymentId,
      fee_charged_cents: feePerCert,
    })
    .eq('restaurant_id', restaurantId)
    .eq('status', 'pending');

  if (updateErr) {
    throw new Error(`cert activation update failed: ${updateErr.message}`);
  }

  const events: Array<{
    restaurant_id: string | null;
    actor_id: string | null;
    type: string;
    payload: Record<string, unknown>;
  }> = [];

  for (const cert of pending) {
    const t = transitionCert('pending', 'active', 'payment_succeeded');
    if (!t.ok) {
      // Should never happen given pre-condition; defensive log.
      events.push({
        restaurant_id: cert.restaurant_id,
        actor_id: null,
        type: 'cert_state_transition_blocked',
        payload: {
          certificate_id: cert.id,
          attempted_from: 'pending',
          attempted_to: 'active',
          source: 'webhook',
          reason: t.reason,
        },
      });
      continue;
    }

    events.push({
      restaurant_id: cert.restaurant_id,
      actor_id: null,
      type: 'cert_activated',
      payload: {
        certificate_id: cert.id,
        cert_code: cert.cert_code,
        stripe_event_id: stripeEventId,
        stripe_payment_intent_id: payment.paymentId,
        fee_charged_cents: feePerCert,
        before_status: 'pending',
        after_status: 'active',
      },
    });

    fireAndForgetPdfGeneration(cert.id);
  }

  await writeEvents(db, events);

  console.log(
    '[cert-fee-succeeded] activated:',
    pending.length,
    'certs for restaurant:',
    restaurantId
  );

  return { activatedCount: pending.length };
}

// ─── handleCertFeeCanceled ────────────────────────────────────────────────────

/**
 * payment_intent.canceled with kind='cert_fee'.
 * Pending certs are NOT auto-purged — they wait for TTL. Activity event only.
 */
export async function handleCertFeeCanceled(
  db: ServiceDb,
  pi: Stripe.PaymentIntent,
  stripeEventId: string
): Promise<void> {
  const restaurantId = parseRestaurantId(pi.metadata);
  await writeEvent(db, {
    restaurant_id: restaurantId,
    actor_id: null,
    type: 'cert_payment_canceled',
    payload: {
      stripe_event_id: stripeEventId,
      stripe_payment_intent_id: pi.id,
      restaurant_id: restaurantId,
    },
  });
}

// ─── handleCertFeeFailed ──────────────────────────────────────────────────────

/**
 * payment_intent.payment_failed with kind='cert_fee'.
 * Pending certs stay pending until TTL or admin retry. Activity event only.
 */
export async function handleCertFeeFailed(
  db: ServiceDb,
  pi: Stripe.PaymentIntent,
  stripeEventId: string
): Promise<void> {
  const restaurantId = parseRestaurantId(pi.metadata);
  await writeEvent(db, {
    restaurant_id: restaurantId,
    actor_id: null,
    type: 'cert_payment_failed',
    payload: {
      stripe_event_id: stripeEventId,
      stripe_payment_intent_id: pi.id,
      last_payment_error: pi.last_payment_error?.message ?? null,
      failure_code: pi.last_payment_error?.code ?? null,
    },
  });
}

// ─── handleChargeRefunded ─────────────────────────────────────────────────────

/**
 * charge.refunded — refund (full or partial) on a cert-fee PI.
 *
 * Revokes every cert paid by that PI. WHERE clause widens to
 * status IN ('active','disputed','expired') because:
 *   - active → revoked: standard refund-flow revocation.
 *   - disputed → revoked: the lost-dispute path can also walk through here
 *     when the merchant accepts via refund.
 *   - expired → revoked: R5 carve-out (refund post-expiration) — permitted
 *     by STATE_MACHINE_EXCEPTIONS.
 *
 * Partial refunds still revoke ALL certs paid by the PI. Stripe doesn't
 * carry per-cert refund metadata.
 */
export async function handleChargeRefunded(
  db: ServiceDb,
  charge: Stripe.Charge,
  stripeEventId: string
): Promise<void> {
  const piId =
    typeof charge.payment_intent === 'string' ? charge.payment_intent : charge.payment_intent?.id;
  if (!piId) {
    console.error('[charge.refunded] no payment_intent id on charge:', charge.id);
    return;
  }

  const certs = await certsByPaymentIntent(db, piId);
  const eligible = certs.filter(
    (c) => c.status === 'active' || c.status === 'disputed' || c.status === 'expired'
  );

  if (eligible.length === 0) {
    console.log('[charge.refunded] no eligible certs to revoke for PI:', piId);
    return;
  }

  const { error: updateErr } = await db
    .from('certificates')
    .update({
      status: 'revoked',
      status_changed_at: new Date().toISOString(),
      revocation_reason: 'refund',
    })
    .eq('stripe_payment_intent_id', piId)
    .in('status', ['active', 'disputed', 'expired']);

  if (updateErr) {
    throw new Error(`charge.refunded UPDATE failed: ${updateErr.message}`);
  }

  const events: Array<{
    restaurant_id: string | null;
    actor_id: string | null;
    type: string;
    payload: Record<string, unknown>;
  }> = [];

  for (const cert of eligible) {
    const t = transitionCert(cert.status, 'revoked', 'refund');
    if (!t.ok) {
      events.push({
        restaurant_id: cert.restaurant_id,
        actor_id: null,
        type: 'cert_state_transition_blocked',
        payload: {
          certificate_id: cert.id,
          attempted_from: cert.status,
          attempted_to: 'revoked',
          source: 'webhook',
          reason: t.reason,
        },
      });
      continue;
    }

    events.push({
      restaurant_id: cert.restaurant_id,
      actor_id: null,
      type: 'cert_revoked',
      payload: {
        certificate_id: cert.id,
        cert_code: cert.cert_code,
        before_status: cert.status,
        after_status: 'revoked',
        reason: 'refund',
        stripe_event_id: stripeEventId,
        amount_refunded_cents: charge.amount_refunded,
      },
    });
  }

  await writeEvents(db, events);
}

// ─── handleDisputeCreated ─────────────────────────────────────────────────────

/**
 * charge.dispute.created — chargeback opened.
 *
 * Active certs flip to disputed (publicly verify as revoked per (a) masking).
 * Already-expired certs stay expired (R6 — funds movement is at Stripe level
 * only). Already-revoked certs stay revoked.
 */
export async function handleDisputeCreated(
  db: ServiceDb,
  dispute: Stripe.Dispute,
  stripeEventId: string
): Promise<void> {
  const piId =
    typeof dispute.payment_intent === 'string'
      ? dispute.payment_intent
      : dispute.payment_intent?.id;
  if (!piId) {
    console.error('[dispute.created] no payment_intent id on dispute:', dispute.id);
    return;
  }

  const certs = await certsByPaymentIntent(db, piId);
  const eligible = certs.filter((c) => c.status === 'active');

  const blockedEvents: Array<{
    restaurant_id: string | null;
    actor_id: string | null;
    type: string;
    payload: Record<string, unknown>;
  }> = [];

  for (const cert of certs) {
    if (cert.status !== 'active') {
      const t = transitionCert(cert.status, 'disputed', 'dispute_created');
      if (!t.ok) {
        blockedEvents.push({
          restaurant_id: cert.restaurant_id,
          actor_id: null,
          type: 'cert_state_transition_blocked',
          payload: {
            certificate_id: cert.id,
            attempted_from: cert.status,
            attempted_to: 'disputed',
            source: 'webhook',
            reason: t.reason,
            stripe_event_id: stripeEventId,
            dispute_id: dispute.id,
          },
        });
      }
    }
  }

  await writeEvents(db, blockedEvents);

  if (eligible.length === 0) return;

  const { error: updateErr } = await db
    .from('certificates')
    .update({
      status: 'disputed',
      status_changed_at: new Date().toISOString(),
      dispute_id: dispute.id,
      disputed_at: new Date().toISOString(),
    })
    .eq('stripe_payment_intent_id', piId)
    .eq('status', 'active');

  if (updateErr) {
    throw new Error(`dispute.created UPDATE failed: ${updateErr.message}`);
  }

  const disputedEvents = eligible.map((cert) => ({
    restaurant_id: cert.restaurant_id,
    actor_id: null,
    type: 'cert_disputed',
    payload: {
      certificate_id: cert.id,
      cert_code: cert.cert_code,
      stripe_event_id: stripeEventId,
      dispute_id: dispute.id,
      dispute_amount: dispute.amount,
      before_status: 'active',
      after_status: 'disputed',
    },
  }));

  await writeEvents(db, disputedEvents);
}

// ─── handleDisputeClosed ──────────────────────────────────────────────────────

/**
 * charge.dispute.closed — outcome arrives.
 *
 *   won / warning_closed → disputed → active (re-issue the trust signal)
 *   lost                 → disputed → revoked (with revocation_reason='dispute_lost')
 *                          + expired → revoked (R6 carve-out)
 *
 * Other statuses (needs_response/under_review on closed shouldn't happen but
 * defensive): log only.
 */
export async function handleDisputeClosed(
  db: ServiceDb,
  dispute: Stripe.Dispute,
  stripeEventId: string
): Promise<void> {
  const piId =
    typeof dispute.payment_intent === 'string'
      ? dispute.payment_intent
      : dispute.payment_intent?.id;
  if (!piId) {
    console.error('[dispute.closed] no payment_intent id on dispute:', dispute.id);
    return;
  }

  const outcome = dispute.status; // 'won' | 'lost' | 'warning_closed' | etc.

  if (outcome === 'won' || outcome === 'warning_closed') {
    const certs = await certsByPaymentIntent(db, piId);
    const eligible = certs.filter((c) => c.status === 'disputed');
    if (eligible.length === 0) return;

    const { error: updateErr } = await db
      .from('certificates')
      .update({
        status: 'active',
        status_changed_at: new Date().toISOString(),
      })
      .eq('stripe_payment_intent_id', piId)
      .eq('status', 'disputed');
    if (updateErr) {
      throw new Error(`dispute.closed (won) UPDATE failed: ${updateErr.message}`);
    }

    const trigger: TransitionTrigger = outcome === 'won' ? 'dispute_won' : 'dispute_warning_closed';

    const events: Array<{
      restaurant_id: string | null;
      actor_id: string | null;
      type: string;
      payload: Record<string, unknown>;
    }> = [];

    for (const cert of eligible) {
      const t = transitionCert('disputed', 'active', trigger);
      if (!t.ok) {
        events.push({
          restaurant_id: cert.restaurant_id,
          actor_id: null,
          type: 'cert_state_transition_blocked',
          payload: {
            certificate_id: cert.id,
            attempted_from: 'disputed',
            attempted_to: 'active',
            source: 'webhook',
            reason: t.reason,
          },
        });
        continue;
      }
      events.push({
        restaurant_id: cert.restaurant_id,
        actor_id: null,
        type: 'cert_dispute_resolved',
        payload: {
          certificate_id: cert.id,
          cert_code: cert.cert_code,
          stripe_event_id: stripeEventId,
          dispute_id: dispute.id,
          dispute_outcome: outcome,
          before_status: 'disputed',
          after_status: 'active',
        },
      });
    }

    await writeEvents(db, events);
    return;
  }

  if (outcome === 'lost') {
    const certs = await certsByPaymentIntent(db, piId);
    const eligible = certs.filter((c) => c.status === 'disputed' || c.status === 'expired');
    if (eligible.length === 0) return;

    const { error: updateErr } = await db
      .from('certificates')
      .update({
        status: 'revoked',
        status_changed_at: new Date().toISOString(),
        revocation_reason: 'dispute_lost',
      })
      .eq('stripe_payment_intent_id', piId)
      .in('status', ['disputed', 'expired']);
    if (updateErr) {
      throw new Error(`dispute.closed (lost) UPDATE failed: ${updateErr.message}`);
    }

    const events: Array<{
      restaurant_id: string | null;
      actor_id: string | null;
      type: string;
      payload: Record<string, unknown>;
    }> = [];

    for (const cert of eligible) {
      const t = transitionCert(cert.status, 'revoked', 'dispute_lost');
      if (!t.ok) {
        events.push({
          restaurant_id: cert.restaurant_id,
          actor_id: null,
          type: 'cert_state_transition_blocked',
          payload: {
            certificate_id: cert.id,
            attempted_from: cert.status,
            attempted_to: 'revoked',
            source: 'webhook',
            reason: t.reason,
          },
        });
        continue;
      }
      events.push({
        restaurant_id: cert.restaurant_id,
        actor_id: null,
        type: 'cert_revoked',
        payload: {
          certificate_id: cert.id,
          cert_code: cert.cert_code,
          before_status: cert.status,
          after_status: 'revoked',
          reason: 'dispute_lost',
          stripe_event_id: stripeEventId,
          dispute_id: dispute.id,
        },
      });
    }

    await writeEvents(db, events);
    return;
  }

  // Defensive — shouldn't appear on `closed`.
  console.warn('[dispute.closed] unexpected outcome — log only:', outcome, dispute.id);
}

// ─── Funds-movement events (log-only) ────────────────────────────────────────

export async function handleDisputeFundsWithdrawn(
  db: ServiceDb,
  dispute: Stripe.Dispute,
  stripeEventId: string
): Promise<void> {
  await writeEvent(db, {
    restaurant_id: null,
    actor_id: null,
    type: 'cert_dispute_funds_withdrawn',
    payload: {
      stripe_event_id: stripeEventId,
      dispute_id: dispute.id,
      amount: dispute.amount,
    },
  });
}

export async function handleDisputeFundsReinstated(
  db: ServiceDb,
  dispute: Stripe.Dispute,
  stripeEventId: string
): Promise<void> {
  await writeEvent(db, {
    restaurant_id: null,
    actor_id: null,
    type: 'cert_dispute_funds_reinstated',
    payload: {
      stripe_event_id: stripeEventId,
      dispute_id: dispute.id,
      amount: dispute.amount,
    },
  });
}

// ─── customer.subscription.deleted (no cert revocation) ──────────────────────

/**
 * No cert revocation. The current subscription model is per-quarter
 * PaymentIntents, not Stripe Subscriptions; if a future Stripe Subscription
 * is deleted, the certs already issued under it remain valid for their
 * expires_at window. The expire-subscriptions cron handles the restaurant's
 * listing eligibility separately.
 */
export async function handleSubscriptionDeleted(
  db: ServiceDb,
  subscription: Stripe.Subscription,
  stripeEventId: string
): Promise<void> {
  await writeEvent(db, {
    restaurant_id: null,
    actor_id: null,
    type: 'subscription_expired',
    payload: {
      event: 'subscription_deleted',
      stripe_event_id: stripeEventId,
      stripe_subscription_id: subscription.id,
    },
  });
}
