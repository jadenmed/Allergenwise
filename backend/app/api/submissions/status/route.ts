/**
 * GET /api/submissions/status?session_id=cs_…
 *
 * Answers exactly one question: has the webhook recorded the submission this
 * Checkout Session paid for?
 *
 * Why this exists (T-41b): Stripe returns the browser to
 * /admin/submit/complete the moment payment succeeds, but
 * checkout.session.completed travels on a separate connection and can land
 * after the redirect. The success page therefore cannot assume the submission
 * row exists — it polls this until it does, rather than guessing with a fixed
 * delay. Same shape as /api/signup/status, which does this for T-41a.
 *
 * It differs from that route in one deliberate way: it requires a manager
 * session and scopes the lookup to the caller's own restaurant.
 * /api/signup/status is public because its caller may be a restaurant whose
 * sign-in failed; there is no such case here — reaching /admin/submit at all
 * means being signed in — so there is no reason to answer an anonymous caller.
 */
import 'server-only';
import { NextRequest, NextResponse } from 'next/server';
import { createServiceDb } from '@/lib/db/service';
import { requireRole } from '@/lib/auth/require-role';

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

  const auth = await requireRole({
    roles: ['manager'],
    profileClient: 'service',
    columns: 'id, role, restaurant_id',
    unauthorizedMessage: 'Unauthorized',
    forbiddenMessage: 'Forbidden: manager role required',
    onMissingProfile: 'forbidden',
    requireRestaurant: { status: 400, message: 'Manager profile has no associated restaurant' },
  });
  if (auth instanceof NextResponse) return auth;

  const restaurantId = auth.profile.restaurant_id as string;
  const db = createServiceDb();

  const { data, error } = await db
    .from('submissions')
    .select('id')
    // Scoped to the caller's restaurant as well as the session id: a manager
    // has no business learning anything about another restaurant's checkout,
    // even a boolean.
    .eq('stripe_checkout_session_id', sessionId)
    .eq('restaurant_id', restaurantId)
    .maybeSingle();

  if (error) {
    // Do NOT report "not submitted" on a DB fault — the caller would keep
    // polling against a broken read and never surface the problem.
    console.error('[submissions status] lookup failed:', error);
    return noStore({ error: 'Status unavailable.' }, 503);
  }

  return noStore({ submitted: data !== null });
}
