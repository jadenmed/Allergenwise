/**
 * GET /api/signup/status?session_id=cs_…
 *
 * Answers exactly one question: has the webhook provisioned this Checkout
 * Session yet?
 *
 * Why this exists (T-41a, trap 4): Stripe returns the browser to
 * /signup/complete the moment payment succeeds, but checkout.session.completed
 * arrives on a separate connection and may land after the redirect. The success
 * page therefore cannot assume the subscriptions row exists — it polls this
 * until it does, instead of guessing with a fixed delay.
 *
 * Response: { provisioned: boolean }. Nothing else. That is deliberate:
 *
 *   - Unauthenticated by design. The arrival case this endpoint exists for
 *     includes the restaurant whose server-side sign-in failed (signedIn:false
 *     from POST /api/auth/signup), so requiring a session would blind the exact
 *     user who most needs the page to work.
 *   - The only input is a Stripe Checkout Session id — unguessable, Stripe-
 *     generated entropy — and the only output is a boolean. There is no name,
 *     no plan, no amount and no restaurant id to leak, and nothing enumerates.
 *   - One indexed lookup per call (subscriptions.stripe_invoice_id is UNIQUE
 *     since migration 0023). No Stripe API call, so polling cannot be
 *     amplified into Stripe traffic.
 */
import 'server-only';
import { NextRequest, NextResponse } from 'next/server';
import { createServiceSupabase } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Stripe Checkout Session ids: `cs_` + base62. Bounded so a junk query is cheap. */
const SESSION_ID_PATTERN = /^cs_[A-Za-z0-9_]{1,255}$/;

function noStore(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  });
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const sessionId = req.nextUrl.searchParams.get('session_id') ?? '';

  if (!SESSION_ID_PATTERN.test(sessionId)) {
    return noStore({ error: 'Invalid session_id.' }, 400);
  }

  const db = createServiceSupabase();

  const { data, error } = await db
    .from('subscriptions')
    .select('id')
    .eq('stripe_invoice_id', sessionId)
    .maybeSingle();

  if (error) {
    // Do NOT report "not provisioned" on a DB fault — the caller would keep
    // polling against a broken read and never surface the problem.
    console.error('[signup status] subscription lookup failed:', error);
    return noStore({ error: 'Status unavailable.' }, 503);
  }

  return noStore({ provisioned: data !== null });
}
