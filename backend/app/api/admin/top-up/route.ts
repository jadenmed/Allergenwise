/**
 * /api/admin/top-up — the balance for staff certified after the listing, and
 * the Checkout Session that settles it. T-45a.
 *
 *   GET   what is owed, and the three counts the public surfaces display.
 *   POST  a Stripe Checkout Session priced from the pending certificates.
 *
 * THE SITUATION THIS EXISTS FOR
 * ─────────────────────────────
 * Payment is attached to SUBMISSION. A restaurant submits, pays for the staff it
 * has, and gets listed. Two months later it hires someone; that person passes
 * the exam, their certificate lands `pending` — and nothing triggers a payment,
 * because the submission already happened. $35 is owed with no mechanism to
 * collect it, and the public listing keeps asserting a fully-certified roster
 * that is no longer true.
 *
 * NO UI SHIPS WITH THIS
 * ─────────────────────
 * The roster and dashboard are being rebuilt, so a pay button written now would
 * be thrown away. This is the backend the rebuilt surface will call, and the one
 * T-45b's dunning lifecycle will drive. The GET exists because the counts and
 * the balance are DATA — a surface that wants to render "10 of 13 staff
 * certified · 3 new team members in training" reads them here rather than
 * deriving its own.
 *
 * NO DUNNING LIFECYCLE HERE EITHER. No reminders, no warnings, no escalation, no
 * deactivation, no cron. That is T-45b and it needs its own decisions. The grace
 * period constant those will read already exists, in lib/billing/grace-period.ts,
 * and nothing in this file imports it — because a grace period governs
 * CONSEQUENCES and must never touch a displayed number.
 *
 * THIS ROUTE WRITES NOTHING. Not to `certificates`, not to `restaurants`, not to
 * `submissions`. It reads a balance and asks Stripe for a payment page. The
 * certificates are activated later, by the existing cert-fee webhook handler, on
 * proof of payment — never by this route, and never as enforcement.
 *
 * Tested by: tests/unit/cert-topup-checkout.test.ts
 */
import 'server-only';
import { NextResponse } from 'next/server';
import { createServiceDb } from '@/lib/db/service';
import { requireRole } from '@/lib/auth/require-role';
import { resolveAppUrl } from '@/lib/app-url';
import { readCertSnapshot } from '@/lib/billing/cert-balance';
import { createCertCheckoutSession } from '@/lib/billing/cert-checkout';
import { CERT_FEE_CENTS } from '@/lib/billing/pricing';

export const runtime = 'nodejs';

/**
 * A balance is never cacheable. The counts inside it are read from the database
 * on every read by design, and a cached copy is a frozen number — the exact
 * thing the T-45a decision forbids.
 */
const NO_STORE = { 'Cache-Control': 'no-store, must-revalidate' } as const;

// ─── Shared preamble ──────────────────────────────────────────────────────────

async function requireManager() {
  return requireRole({
    roles: ['manager'],
    profileClient: 'service',
    columns: 'id, role, restaurant_id',
    unauthorizedMessage: 'Unauthorized.',
    forbiddenMessage: 'Forbidden. Manager role required.',
    onMissingProfile: 'forbidden',
    requireRestaurant: { status: 400, message: 'Manager profile has no associated restaurant' },
  });
}

// ─── GET — the balance, as data ───────────────────────────────────────────────

export async function GET() {
  const auth = await requireManager();
  if (auth instanceof NextResponse) return auth;

  const db = createServiceDb();
  const restaurantId = auth.profile.restaurant_id as string;

  const snapshot = await readCertSnapshot(db, restaurantId);

  // A failed count renders as an ABSENCE, never as 0. The 503 is what makes it
  // impossible for a caller to mistake this for data, and the discriminated body
  // is what lets one that handles it distinguish "unknown" from "zero owed".
  // There is deliberately no `?? 0` on this path — that fallback is what let a
  // failed query render as full certification (T-18).
  if (snapshot.kind === 'unavailable') {
    return NextResponse.json({ kind: 'unavailable' as const }, { status: 503, headers: NO_STORE });
  }

  return NextResponse.json(
    {
      kind: 'known' as const,
      // ── The balance ──────────────────────────────────────────────────────
      pendingCertCount: snapshot.pendingCertCount,
      amountOwedCents: snapshot.amountOwedCents,
      feePerCertCents: CERT_FEE_CENTS,
      /** When the debt started — `issued_at` of the oldest unpaid certificate. */
      owedSince: snapshot.owedSince,
      // ── The three counts ─────────────────────────────────────────────────
      // certified + inTraining === total, by construction: inTraining is the
      // complement of the certified set within the very learner id set `total`
      // is drawn from. See lib/billing/cert-balance.ts.
      certifiedCount: snapshot.certified,
      totalStaff: snapshot.total,
      inTrainingCount: snapshot.inTraining,
    },
    { status: 200, headers: NO_STORE }
  );
}

// ─── POST — the Checkout Session ──────────────────────────────────────────────

export async function POST() {
  const auth = await requireManager();
  if (auth instanceof NextResponse) return auth;
  const { user, profile } = auth;

  const db = createServiceDb();
  const restaurantId = profile.restaurant_id as string;

  // Resolve the return-URL base BEFORE touching Stripe. Same reasoning as
  // lib/auth/signup.ts and /api/submissions/create: an unconfigured base URL
  // would send a manager who has already paid to http://localhost:3000, and
  // nothing would report it. Failing here costs a retry; failing there costs
  // the customer.
  let appUrl: string;
  try {
    appUrl = resolveAppUrl();
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[admin/top-up] no application base URL configured:', msg);
    return NextResponse.json(
      { error: 'Payment is not configured.', detail: msg },
      { status: 500, headers: NO_STORE }
    );
  }

  // Price from a LIVE read. Never from a number the client sent, and never from
  // a cached one — a stale count here is a wrong invoice.
  const snapshot = await readCertSnapshot(db, restaurantId);

  if (snapshot.kind === 'unavailable') {
    // Refusing to charge is the only safe move: a Session priced from a count we
    // could not read is either an over-charge or an under-charge, and the
    // over-charge is not recoverable by a retry.
    console.error('[admin/top-up] balance unavailable — refusing to price a Session', {
      restaurantId,
    });
    return NextResponse.json(
      { kind: 'unavailable' as const, error: 'Balance is unavailable. Please try again.' },
      { status: 503, headers: NO_STORE }
    );
  }

  // Nothing owed is a legitimate, common state — every certificate is already
  // paid for. It is NOT a $0 Session: Stripe rejects a zero-quantity line item,
  // and sending a manager to a checkout page for nothing is a bug they would
  // report. 409 rather than 400: the request was well-formed, the state simply
  // does not permit it.
  if (snapshot.pendingCertCount === 0) {
    return NextResponse.json(
      {
        error: 'Nothing is owed.',
        pendingCertCount: 0,
        amountOwedCents: 0,
        certifiedCount: snapshot.certified,
        totalStaff: snapshot.total,
        inTrainingCount: snapshot.inTraining,
      },
      { status: 409, headers: NO_STORE }
    );
  }

  const { data: restaurantRaw } = (await db
    .from('restaurants')
    .select('id, name, stripe_customer_id')
    .eq('id', restaurantId)
    .single()) as {
    data: { id: string; name: string; stripe_customer_id: string | null } | null;
    error: unknown;
  };

  if (!restaurantRaw) {
    return NextResponse.json({ error: 'Restaurant not found' }, { status: 404, headers: NO_STORE });
  }

  try {
    const session = await createCertCheckoutSession({
      restaurant: restaurantRaw,
      pendingCertCount: snapshot.pendingCertCount,
      submittedBy: user.id,
      // The whole reason this kind exists. `cert_fee` would make the webhook
      // call finalizeSubmission — inserting a submission row and flipping the
      // restaurant to `pending_review`. This restaurant is already LISTED;
      // that would drag a live listing back into review every time a new hire
      // passed the exam. `cert_topup` activates the certificates and stops.
      kind: 'cert_topup',
      successUrl: `${appUrl}/admin/billing?topup=success&session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${appUrl}/admin/billing?topup=canceled`,
    });

    console.log('[admin/top-up] Checkout Session created:', {
      restaurantId,
      pendingCertCount: snapshot.pendingCertCount,
      certFeeTotalCents: session.certFeeTotalCents,
      checkoutSessionId: session.checkoutSessionId,
    });

    return NextResponse.json(
      {
        checkoutUrl: session.checkoutUrl,
        checkoutSessionId: session.checkoutSessionId,
        pendingCertCount: snapshot.pendingCertCount,
        // The LIST total, before any promotion code. What is actually charged is
        // whatever Stripe reports as amount_total — a 100%-off comp code takes
        // it to 0, and that 0 is a real amount, not a missing one.
        certFeeTotalCents: session.certFeeTotalCents,
      },
      { status: 200, headers: NO_STORE }
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[admin/top-up] Checkout Session creation failed:', msg);
    return NextResponse.json(
      { error: 'Failed to initialize payment.', detail: msg },
      { status: 502, headers: NO_STORE }
    );
  }
}
