/**
 * POST /api/auth/signup
 *
 * Creates a new restaurant account:
 *   1. auth.users (Supabase Auth, password)
 *   2. restaurants row (status='unlisted')
 *   3. profiles row (role='manager')
 *   4. Stripe Customer
 *   5. Stripe Checkout Session (plan fee; returns the hosted-page URL to redirect to)
 *
 * The subscriptions row is intentionally NOT created here —
 * it is created by the Stripe webhook handler on checkout.session.completed
 * (T-41a: a comped $0 signup produces no PaymentIntent, so provisioning cannot
 * hang off payment_intent.succeeded).
 *
 * Rollback: if any step fails, all prior steps are undone via compensating transactions.
 *
 * P1-14 — order is load-bearing:
 *   1. Parse JSON body. Malformed → 400 (NOT consume rate-limit).
 *   2. Zod validate. Invalid → 400 (NOT consume rate-limit).
 *   3. Per-IP rate-limit (10/60s).
 *   4. Per-email rate-limit (5/60s, key = email.toLowerCase()).
 *   5. performSignup orchestration.
 *
 * The byte-identical 429 body across all enumeration states (email
 * exists vs not) is the load-bearing enumeration defense.
 *
 * P1-12 response-shape: failures from performSignup that would
 * otherwise let an attacker distinguish "email already registered"
 * (`EMAIL_EXISTS`) from "auth provider rejected this credential"
 * (`AUTH_ERROR`) are collapsed into one client-facing response — same
 * status, same body, no `code` discriminator. Ops keeps the original
 * signal via an `activity_events` row (`signup_email_exists` vs
 * `signup_auth_error`); validation/format errors keep their own
 * codes since they are not enumeration-distinguishing.
 *
 * Response: { checkoutUrl, checkoutSessionId, customerId, restaurantId, signedIn }
 * Error:    { error, code?, issues? }
 */
import 'server-only';
import type { ActivityEventType } from '@/lib/types/db';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { performSignup } from '@/lib/auth/signup';
import { establishSession } from '@/lib/auth/establish-session';
import { createServiceSupabase } from '@/lib/supabase/server';
import { getClientIpHash } from '@/lib/security/client-ip';
import { getSignupIpLimiter, getSignupEmailLimiter } from '@/lib/security/rate-limit';
import {
  runRateLimit,
  rateLimitedResponse,
  rateLimitUnavailableResponse,
} from '@/lib/security/rate-limit-guard';

// ─── Request schema ───────────────────────────────────────────────────────────

const signupSchema = z.object({
  restaurant: z.object({
    name: z.string().min(1, 'Restaurant name is required').max(120),
    address: z.string().min(1, 'Address is required').max(200),
    city: z.string().min(1, 'City is required').max(100),
    state: z.string().min(2, 'State is required').max(2, 'State must be 2-letter code'),
    zip: z.string().regex(/^\d{5}(-\d{4})?$/, 'Invalid ZIP code'),
    phone: z.string().min(7, 'Phone is required').max(20),
    cuisine: z.string().min(1, 'Cuisine is required').max(60),
  }),
  admin: z.object({
    fullName: z.string().min(1, 'Full name is required').max(120),
    email: z.string().email('Invalid email address'),
    password: z
      .string()
      .min(8, 'Password must be at least 8 characters')
      .max(72, 'Password too long'),
  }),
  plan: z.enum(['quarterly', 'semiannual']),
});

export type SignupRequestBody = z.infer<typeof signupSchema>;

// ─── Handler ──────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  // 1. Parse and validate request body
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const parsed = signupSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed.', issues: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  // 2. Rate-limit (per-IP first, then per-email). Format already
  //    validated above so malformed traffic cannot drain a victim's
  //    per-IP budget.
  const pepper = process.env.RATELIMIT_IP_PEPPER ?? '';
  const ipHash = getClientIpHash(req, pepper);
  const emailKey = parsed.data.admin.email.toLowerCase();

  const guard = await runRateLimit([
    { kind: 'per_ip', limiter: getSignupIpLimiter, key: ipHash },
    { kind: 'per_email', limiter: getSignupEmailLimiter, key: emailKey },
  ]);

  if (guard.outcome !== 'ok') {
    const db = createServiceSupabase();
    if (guard.outcome === 'rate_limited') {
      await logEvent(db, 'signup_rate_limited', {
        kind: guard.kind,
        ip_hash: ipHash,
      });
      return rateLimitedResponse();
    }
    await logEvent(db, 'signup_rate_limiter_down', { error: guard.error });
    return rateLimitUnavailableResponse();
  }

  // 3. Perform signup orchestration (with rollback)
  const result = await performSignup(parsed.data);

  if (!result.ok) {
    // P1-12: collapse EMAIL_EXISTS and AUTH_ERROR into one byte-identical
    // response so an attacker cannot enumerate registered addresses.
    // Ops keeps the distinction via activity_events.
    if (result.code === 'EMAIL_EXISTS' || result.code === 'AUTH_ERROR') {
      const db = createServiceSupabase();
      await logEvent(
        db,
        result.code === 'EMAIL_EXISTS' ? 'signup_email_exists' : 'signup_auth_error',
        { ip_hash: ipHash }
      );
      return NextResponse.json(
        { error: 'Unable to create account with the provided credentials.' },
        { status: 422 }
      );
    }

    const status = result.code === 'STRIPE_ERROR' ? 502 : 500;

    return NextResponse.json({ error: result.error, code: result.code }, { status });
  }

  // performSignup creates the auth user with the SERVICE-ROLE client, which
  // cannot set a session cookie. Sign the new manager in on the cookie-bound
  // client so the client-side redirect to /admin/dashboard is not bounced back
  // to /login by middleware. Best-effort: the account exists either way, so a
  // failure here is reported to the client rather than failing the request.
  const signedIn = await establishSession(parsed.data.admin.email, parsed.data.admin.password);

  return NextResponse.json(
    {
      checkoutUrl: result.checkoutUrl,
      checkoutSessionId: result.checkoutSessionId,
      customerId: result.customerId,
      restaurantId: result.restaurantId,
      signedIn,
    },
    { status: 201 }
  );
}

// ─── Activity-event helper (best-effort; never affects response) ─────────────

async function logEvent(
  db: ReturnType<typeof createServiceSupabase>,
  type: ActivityEventType,
  payload: Record<string, unknown>
): Promise<void> {
  try {
    await db.from('activity_events').insert({ type, payload, actor_id: null });
  } catch (err) {
    console.error('[signup] activity_events insert failed:', err);
  }
}
