/**
 * POST /api/submissions/create
 * Starts a restaurant certification submission by sending the manager to
 * Stripe Checkout to pay the certification fees.
 *
 * Flow (T-41b — supersedes the off-session charge entirely):
 * 1. Auth: manager session required (re-verified from DB, not trusted from client).
 * 2. Zod-validate request body.
 * 3. Server-side eligibility check via lib/admin/eligibility.ts. Condition 2 is
 *    now "every learner has passed the exam" (cert in pending OR active) — see
 *    that file for why the old `active`-only rule could never be satisfied.
 * 4. Persist the restaurant's own profile fields (cuisine, specialties, photo,
 *    about, hours). Deliberately WITHOUT status='pending_review': nothing has
 *    been paid yet, and an abandoned checkout must leave no trace beyond the
 *    restaurant's own data, which is harmless to keep.
 * 5. Create a Stripe Checkout Session priced from the PENDING certificates
 *    only — $35 × pendingCertCount — with promotion codes enabled, and return
 *    its URL. SubmitClient redirects the browser to it.
 * 6. Nothing else happens here. `checkout.session.completed` activates the
 *    certificates, flips the restaurant to pending_review and inserts the
 *    submission row (app/api/stripe/webhook/route.ts → lib/submissions/finalize.ts).
 *
 * The one case with no Checkout Session: a resubmission where every learner is
 * already `active`, so there are zero pending certificates and nothing to
 * charge. That finalizes immediately, through the same
 * lib/submissions/finalize.ts the webhook uses.
 *
 * Why the money moved to Checkout: a 100%-off comped pilot has no saved card,
 * so the old `stripe.paymentIntents.create({ off_session: true })` returned
 * "No default payment method on file." Checkout is also the only surface where
 * a promotion code applies — Stripe's own guidance is that a raw PaymentIntent
 * requires discounting server-side.
 */

import 'server-only';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createServiceDb } from '@/lib/db/service';
import { requireRole } from '@/lib/auth/require-role';
import { checkEligibility } from '@/lib/admin/eligibility';
import { finalizeSubmission } from '@/lib/submissions/finalize';
import { resolveAppUrl } from '@/lib/app-url';
import { createCertCheckoutSession } from '@/lib/billing/cert-checkout';

export const runtime = 'nodejs';

// ─── Validation ───────────────────────────────────────────────────────────────

const ALLERGEN_SPECIALTIES = [
  'peanut_free',
  'tree_nut_aware',
  'dairy_free',
  'gluten_free_menu',
  'egg_free',
  'soy_free',
  'fish_free',
  'shellfish_free',
  'sesame_free',
] as const;

const bodySchema = z.object({
  cuisine: z.string().min(1).max(60),
  allergenSpecialties: z
    .array(z.enum(ALLERGEN_SPECIALTIES))
    .min(0)
    .max(ALLERGEN_SPECIALTIES.length),
  heroPhotoStoragePath: z.string().min(1).max(500),
  about: z.string().max(2000).optional(),
  hoursJson: z
    .record(
      z.enum(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']),
      z.object({
        open: z.string().regex(/^\d{2}:\d{2}$/),
        close: z.string().regex(/^\d{2}:\d{2}$/),
      })
    )
    .optional(),
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

  const { cuisine, allergenSpecialties, heroPhotoStoragePath, about, hoursJson } = body;

  // ── Auth: require manager session — re-read from DB, never trust client ───
  const auth = await requireRole({
    roles: ['manager'],
    profileClient: 'service',
    columns: 'id, role, restaurant_id, email, full_name',
    unauthorizedMessage: 'Unauthorized',
    forbiddenMessage: 'Forbidden: admin role required',
    onMissingProfile: 'forbidden',
    requireRestaurant: { status: 400, message: 'Admin profile has no associated restaurant' },
  });
  if (auth instanceof NextResponse) return auth;
  const { user, profile: profileRaw } = auth;

  const db = createServiceDb();

  const restaurantId = profileRaw.restaurant_id as string;

  // ── Resolve the return-URL base BEFORE touching anything ──────────────────
  // Same reasoning as lib/auth/signup.ts: an unconfigured base URL would send a
  // manager who has already paid to http://localhost:3000, and nothing would
  // report it. Failing here costs a retry; failing there costs the customer.
  let appUrl: string;
  try {
    appUrl = resolveAppUrl();
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[submissions/create] no application base URL configured:', msg);
    return NextResponse.json({ error: 'Payment is not configured.', detail: msg }, { status: 500 });
  }

  // ── Server-side eligibility check ─────────────────────────────────────────
  let eligibility: Awaited<ReturnType<typeof checkEligibility>>;
  try {
    eligibility = await checkEligibility({
      restaurantId,
      supabaseServiceClient: db,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[submissions/create] eligibility check failed:', msg);
    return NextResponse.json(
      { error: 'Failed to verify eligibility', detail: msg },
      { status: 500 }
    );
  }

  if (!eligibility.eligible) {
    return NextResponse.json(
      {
        error: 'Restaurant is not eligible for submission',
        reasons: eligibility.reasons,
        certifiedCount: eligibility.certifiedCount,
        totalLearners: eligibility.totalLearners,
      },
      { status: 422 }
    );
  }

  const { certifiedCount, pendingCertCount } = eligibility;

  // ── Fetch the restaurant ──────────────────────────────────────────────────
  const { data: restaurantRaw } = (await db
    .from('restaurants')
    .select('id, name, status, stripe_customer_id')
    .eq('id', restaurantId)
    .single()) as {
    data: {
      id: string;
      name: string;
      status: string;
      stripe_customer_id: string | null;
    } | null;
    error: unknown;
  };

  if (!restaurantRaw) {
    return NextResponse.json({ error: 'Restaurant not found' }, { status: 404 });
  }

  // ── Persist the restaurant's own profile fields ───────────────────────────
  // NOT status. Until the fee is paid this restaurant has not submitted
  // anything, and an abandoned checkout must leave `status` exactly as it was.
  // The listing content itself is the restaurant's data — keeping it means the
  // manager does not retype the form after a cancelled payment.
  const { error: updateError } = await db
    .from('restaurants')
    .update({
      cuisine,
      allergen_specialties: allergenSpecialties,
      hero_photo_url: heroPhotoStoragePath,
      ...(about !== undefined ? { about } : {}),
      ...(hoursJson !== undefined ? { hours_json: hoursJson } : {}),
    })
    .eq('id', restaurantId);

  if (updateError) {
    console.error('[submissions/create] restaurant update failed:', updateError);
    return NextResponse.json({ error: 'Failed to update restaurant' }, { status: 500 });
  }

  // ── Nothing to charge? Record the submission and stop ─────────────────────
  // Every learner already holds an `active` certificate — this is a
  // resubmission after a decision, and those staff were paid for the first
  // time round. Charging again would be charging twice for the same people.
  if (pendingCertCount === 0) {
    let result: Awaited<ReturnType<typeof finalizeSubmission>>;
    try {
      result = await finalizeSubmission({
        db,
        restaurantId,
        submittedBy: user.id,
        checkoutSessionId: null,
        paymentIntentId: null,
        certFeeTotalCents: 0,
        activatedCount: 0,
        actorId: user.id,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      console.error('[submissions/create] free resubmission failed:', msg);
      return NextResponse.json(
        { error: 'Failed to record submission', detail: msg },
        { status: 500 }
      );
    }

    if (result.outcome !== 'created') {
      // The partial unique index caught a submission that is already open. The
      // eligibility check should have refused this, so report it the same way.
      return NextResponse.json(
        {
          error: 'Restaurant is not eligible for submission',
          reasons: [
            'A submission is already under review. You cannot submit again until it is resolved.',
          ],
          certifiedCount,
          totalLearners: eligibility.totalLearners,
        },
        { status: 422 }
      );
    }

    return NextResponse.json(
      { submissionId: result.submissionId, certFeeTotalCents: 0, pendingCertCount: 0 },
      { status: 201 }
    );
  }

  // ── Create the Checkout Session ───────────────────────────────────────────
  // The Session shape lives in lib/billing/cert-checkout.ts (T-45a). It used to
  // be inline here; /api/admin/top-up needs the identical Session for a
  // restaurant that is already listed and has hired since, and a second
  // `checkout.sessions.create` written next to this one is how two payment paths
  // come to disagree about price, promotion codes, or routing metadata. Nothing
  // this route sends to Stripe changed — only where it is written.
  let checkoutUrl: string;
  let checkoutSessionId: string;
  let certFeeTotalCents: number;

  try {
    const session = await createCertCheckoutSession({
      restaurant: restaurantRaw,
      pendingCertCount,
      submittedBy: user.id,
      // Submission fees. For this kind the webhook activates the certificates
      // AND records the submission — see PAYMENT_KINDS in lib/stripe/metadata.ts.
      kind: 'cert_fee',
      // The browser comes back immediately; the webhook arrives separately.
      // /admin/submit/complete must not assume the submission row exists yet —
      // it polls for it, exactly as /signup/complete does.
      successUrl: `${appUrl}/admin/submit/complete?session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${appUrl}/admin/submit?canceled=1`,
    });

    checkoutUrl = session.checkoutUrl;
    checkoutSessionId = session.checkoutSessionId;
    certFeeTotalCents = session.certFeeTotalCents;
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[submissions/create] Checkout Session creation failed:', msg);
    return NextResponse.json(
      { error: 'Failed to initialize payment.', detail: msg },
      { status: 502 }
    );
  }

  console.log('[submissions/create] Checkout Session created:', {
    restaurantId,
    pendingCertCount,
    certFeeTotalCents,
    checkoutSessionId,
  });

  return NextResponse.json(
    {
      checkoutUrl,
      checkoutSessionId,
      pendingCertCount,
      // The LIST total, before any promotion code. What is actually charged is
      // whatever Stripe reports as amount_total, and that is what the
      // submission row records.
      certFeeTotalCents,
    },
    { status: 200 }
  );
}
