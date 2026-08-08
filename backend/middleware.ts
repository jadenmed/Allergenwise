import { NextResponse, type NextRequest } from 'next/server';
import { updateSession } from '@/lib/supabase/middleware';
import { createServerClient } from '@supabase/ssr';
import type { Database } from '@/lib/types/db';
import { isComingSoonEnabled } from '@/lib/coming-soon';

/* ────────────────────────────────────────────────────────────────────────────
 * P1-3 — Browser security headers
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Every response emitted by this middleware carries five hardening headers.
 * The directives are tuned to AllergenWise's actual third-party surface:
 * Stripe (Payment Element on /admin/billing), Mux Player + Mux Data (lesson
 * pages), Supabase (auth/REST/Storage/realtime), self-hosted Inter via
 * next/font/google (no Google host needed at runtime — fonts are pulled at
 * build time and served from /_next).
 *
 *   Strict-Transport-Security:
 *     63072000s (2 years) + includeSubDomains + preload. Tells the browser to
 *     refuse plain-HTTP requests to the apex and every subdomain, including
 *     before-first-visit if listed in the HSTS preload list. Header is emitted
 *     even on http://localhost in dev; browsers ignore HSTS over HTTP, but
 *     emitting it unconditionally keeps tests deterministic and means there is
 *     no environment in which prod ships with HSTS off by accident.
 *
 *   X-Content-Type-Options:
 *     `nosniff`. Disables MIME-sniffing — defeats the "upload a .gif that's
 *     actually JS" XSS class on /api/admin/upload-photo and the directory
 *     storage paths.
 *
 *   Referrer-Policy:
 *     `strict-origin-when-cross-origin`. Sends full URL on same-origin nav,
 *     origin-only on HTTPS-to-HTTPS cross-origin, nothing on HTTPS-to-HTTP.
 *     Stops cert codes / invite tokens from leaking via the Referer header
 *     when a learner clicks an external link inside the course player.
 *
 *   Permissions-Policy:
 *     Camera / microphone / geolocation / browsing-topics / interest-cohort
 *     locked off — AllergenWise never asks for them and we want third-party
 *     scripts (Stripe.js, Mux Player) silently denied if they ever try. The
 *     payment feature is explicitly allowed for self + js.stripe.com because
 *     the Stripe Payment Element relies on it.
 *
 *   Content-Security-Policy:
 *     Permissive-but-correct starting point. Goals (in order):
 *       1. Block remote-script injection that would be the actual attack on
 *          the lesson player (already DOMPurified, but defence-in-depth).
 *       2. Allow every host the app currently loads in a browser — Stripe.js,
 *          Mux Player, Mux Data, Supabase REST/Storage/Realtime, self assets.
 *       3. Leave `'unsafe-inline'` + `'unsafe-eval'` on script-src for now
 *          (Stripe.js injects inline scripts; Mux uses workers; Next.js App
 *          Router uses inline runtime config). Tightening via per-request
 *          nonces is a follow-up — not in scope for P1-3.
 *     Directives:
 *       default-src 'self'              — fallback
 *       script-src                      — self + inline/eval + Stripe.js
 *       style-src                       — self + inline (Tailwind/Radix
 *                                          ship inline style attributes)
 *       img-src                         — self + data:/blob: + Supabase
 *                                          Storage + Mux thumbnails + Stripe
 *                                          telemetry pixel
 *       font-src                        — self + data: (some packages inline
 *                                          tiny icon fonts)
 *       connect-src                     — self + Supabase REST/Realtime (wss)
 *                                          + Stripe API + Mux HLS playlists
 *                                          + Mux Data beacons
 *       media-src                       — self + blob: + Mux HLS streams
 *       frame-src                       — Stripe.js + Stripe hooks + Stripe
 *                                          payment network (3DS challenge)
 *       worker-src                      — self + blob: (Mux + Next.js
 *                                          dynamic workers)
 *       object-src 'none'               — no <object>/<embed>/applets ever
 *       base-uri 'self'                 — pin <base href> to same origin
 *       frame-ancestors 'none'          — replaces X-Frame-Options DENY;
 *                                          AllergenWise is never embedded
 *       form-action                     — self + Stripe hooks (Stripe 3DS
 *                                          posts back through hooks.stripe)
 * ──────────────────────────────────────────────────────────────────────── */

const STRIPE_JS = 'https://js.stripe.com';
const STRIPE_HOOKS = 'https://hooks.stripe.com';
const STRIPE_NETWORK = 'https://m.stripe.network';
const STRIPE_API = 'https://api.stripe.com';
const STRIPE_TELEMETRY_IMG = 'https://q.stripe.com';

const MUX_STREAM = 'https://stream.mux.com';
const MUX_IMAGE = 'https://image.mux.com';
const MUX_WILD = 'https://*.mux.com';
const MUX_DATA = 'https://img.litix.io';

const SUPABASE_HTTPS = 'https://*.supabase.co https://*.supabase.com';
const SUPABASE_WSS = 'wss://*.supabase.co wss://*.supabase.com';

const CSP_DIRECTIVES: Record<string, string> = {
  'default-src': "'self'",
  'script-src': `'self' 'unsafe-inline' 'unsafe-eval' ${STRIPE_JS}`,
  'style-src': "'self' 'unsafe-inline'",
  'img-src': `'self' data: blob: ${SUPABASE_HTTPS} ${MUX_IMAGE} ${MUX_WILD} ${MUX_DATA} ${STRIPE_TELEMETRY_IMG}`,
  'font-src': "'self' data:",
  'connect-src': `'self' ${SUPABASE_HTTPS} ${SUPABASE_WSS} ${STRIPE_API} ${MUX_STREAM} ${MUX_DATA}`,
  'media-src': `'self' blob: ${MUX_STREAM}`,
  'frame-src': `${STRIPE_JS} ${STRIPE_HOOKS} ${STRIPE_NETWORK}`,
  'worker-src': "'self' blob:",
  'object-src': "'none'",
  'base-uri': "'self'",
  'frame-ancestors': "'none'",
  'form-action': `'self' ${STRIPE_HOOKS}`,
};

const CSP_HEADER_VALUE = Object.entries(CSP_DIRECTIVES)
  .map(([k, v]) => `${k} ${v}`)
  .join('; ');

const PERMISSIONS_POLICY_VALUE = [
  'camera=()',
  'microphone=()',
  'geolocation=()',
  'browsing-topics=()',
  'interest-cohort=()',
  'payment=(self "https://js.stripe.com")',
].join(', ');

function applySecurityHeaders(res: NextResponse): NextResponse {
  res.headers.set('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
  res.headers.set('X-Content-Type-Options', 'nosniff');
  res.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.headers.set('Permissions-Policy', PERMISSIONS_POLICY_VALUE);
  res.headers.set('Content-Security-Policy', CSP_HEADER_VALUE);
  return res;
}

/* ────────────────────────────────────────────────────────────────────────────
 * CORS — cross-origin API access for the Vite frontend
 * ────────────────────────────────────────────────────────────────────────────
 * The Vite dev server (default http://localhost:5173) and this Next.js API
 * (default http://localhost:3000) are two different origins, so every
 * fetch() from the frontend with `credentials: 'include'` needs an explicit
 * Access-Control-Allow-Origin echoing the caller's origin (never "*" — that's
 * incompatible with credentialed requests) plus Access-Control-Allow-
 * Credentials: true. ALLOWED_ORIGINS is a comma-separated env var; defaults
 * to the Vite dev server for local development.
 * ──────────────────────────────────────────────────────────────────────── */
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS ?? 'http://localhost:5173')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

function isAllowedOrigin(origin: string | null): boolean {
  return origin !== null && ALLOWED_ORIGINS.includes(origin);
}

function applyCorsHeaders(res: NextResponse, request: NextRequest): NextResponse {
  const origin = request.headers.get('origin');
  if (isAllowedOrigin(origin)) {
    res.headers.set('Access-Control-Allow-Origin', origin as string);
    res.headers.set('Access-Control-Allow-Credentials', 'true');
    res.headers.set('Vary', 'Origin');
    res.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    res.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-internal-secret');
  }
  return res;
}

// Routes that never require auth.
//
// /signup/complete is where Stripe Checkout returns the browser (T-41a). It
// must be reachable WITHOUT a session: POST /api/auth/signup signs the new
// manager in before the redirect, but that step can fail (signedIn:false), and
// bouncing that restaurant to /login would strip the session_id the page needs
// to tell them whether their payment provisioned.
const PUBLIC_ROUTES = ['/', '/pricing', '/login', '/signup', '/signup/complete', '/coming-soon'];

/* ────────────────────────────────────────────────────────────────────────────
 * Coming-soon gate (T-03)
 * ────────────────────────────────────────────────────────────────────────────
 * While the gate is on — which is the DEFAULT, see lib/coming-soon.ts —
 * these page prefixes redirect to /coming-soon and these API prefixes 404
 * instead of running. Opening them takes a deliberate `COMING_SOON=false`
 * in the deployment; nothing else does it. Checked BEFORE the public-route
 * bypass and BEFORE the session lookup — some of these (directory, verify,
 * pricing) are otherwise public routes with no auth to gate on, and reviewer
 * gets sent to /coming-soon instead of a login prompt so an anonymous visitor
 * sees the same placeholder a signed-in reviewer would. /coming-soon itself
 * must never appear in these lists (redirect loop).
 * ──────────────────────────────────────────────────────────────────────── */
const GATED_PAGE_PREFIXES = ['/directory', '/verify', '/pricing', '/reviewer'];

const GATED_API_PREFIXES = ['/api/directory', '/api/search', '/api/reviewer'];

// Public verify-by-code lookup only — /api/certs/generate (PDF render,
// called server-side from the exam-pass flow) is NOT part of the verify
// surface and must keep working in paid mode.
function isGatedCertsApi(pathname: string): boolean {
  return pathname.startsWith('/api/certs/') && !pathname.startsWith('/api/certs/generate');
}

function isGatedRoute(pathname: string): boolean {
  if (GATED_PAGE_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + '/'))) return true;
  if (GATED_API_PREFIXES.some((p) => pathname.startsWith(p))) return true;
  if (isGatedCertsApi(pathname)) return true;
  return false;
}

const PUBLIC_PREFIXES = [
  '/directory',
  '/verify',
  '/invite',
  '/_next',
  // Public API routes — auth/rate-limiting handled inside each route handler
  '/api/auth/',
  '/api/stripe/webhook',
  '/api/stripe/payment-intent',
  // Provisioning poll for /signup/complete (T-41a). Public for the same reason
  // that page is: the caller may be the restaurant whose sign-in failed. It
  // takes an unguessable Checkout Session id and returns one boolean — see the
  // route handler's header for the full reasoning.
  '/api/signup/status',
  // Vercel Cron routes. Each handler enforces `Authorization: Bearer
  // ${CRON_SECRET}` itself. Listed explicitly (not as `/api/cron/`) so that
  // any future cron handler MUST be added here consciously — the forcing
  // function that catches a missing handler-level bearer check.
  '/api/cron/expire-listings',
  '/api/cron/expire-subscriptions',
  '/api/cron/expire-certs',
  '/api/cron/purge-stale-pending-certs',
  '/api/cron/exam-timeout-sweep',
  '/api/cron/digest-reviewer-queue',
  '/api/cron/weekly-admin-digest',
  '/api/reviews/submit',
  '/api/search',
  '/api/directory/',
  '/api/certs/',
  '/403',
];

function isPublicRoute(pathname: string): boolean {
  if (PUBLIC_ROUTES.includes(pathname)) return true;
  return PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

/** Methods that mutate server state and therefore require CSRF protection. */
const STATE_CHANGING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * CSRF policy. Applies to non-public, state-changing requests only.
 *
 * Decision matrix:
 *   - GET / HEAD / OPTIONS               → safe by definition (allow)
 *   - Path is in PUBLIC_PREFIXES         → bypass (Stripe webhook signature,
 *                                          Vercel Cron Bearer, internal
 *                                          x-internal-secret routes — none of
 *                                          which carry an Origin header from
 *                                          their server-to-server callers)
 *   - Origin header present              → must match Host (modern browsers
 *                                          set Origin on every cross-site
 *                                          form POST, so this catches the
 *                                          form-CSRF attack class)
 *   - Origin missing, Referer present    → Referer's origin must match Host
 *   - Both headers missing               → allow. This is the server-to-
 *                                          server fallback for non-browser
 *                                          consumers (curl, mobile native).
 *                                          Browser CSRF attackers cannot
 *                                          suppress Origin on a form POST,
 *                                          so this hole is unreachable from
 *                                          the threat we're protecting against.
 *
 * Returns true when the request is safe to forward; false when the middleware
 * should reject it with 403.
 */
function isCsrfSafe(request: NextRequest): boolean {
  if (!STATE_CHANGING_METHODS.has(request.method.toUpperCase())) return true;

  const host = request.headers.get('host');
  if (!host) return false; // Should never happen; treat as suspicious.

  const origin = request.headers.get('origin');
  if (origin) {
    if (isAllowedOrigin(origin)) return true;
    try {
      return new URL(origin).host === host;
    } catch {
      return false;
    }
  }

  const referer = request.headers.get('referer');
  if (referer) {
    try {
      return new URL(referer).host === host;
    } catch {
      return false;
    }
  }

  // Neither Origin nor Referer — server-to-server consumer.
  // The route handler's own auth gate (session cookie / x-internal-secret /
  // Bearer / Stripe HMAC) is the next defense.
  return true;
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const respond = (res: NextResponse) => applyCorsHeaders(applySecurityHeaders(res), request);

  // CORS preflight — browsers send an OPTIONS request before any credentialed
  // cross-origin POST/PUT/PATCH/DELETE or non-simple GET. Must be answered
  // immediately, before auth/CSRF/coming-soon logic, with no body required.
  if (request.method === 'OPTIONS') {
    return respond(new NextResponse(null, { status: 204 }));
  }

  // Always allow static assets through
  if (
    pathname.startsWith('/_next/static') ||
    pathname.startsWith('/_next/image') ||
    pathname.startsWith('/favicon') ||
    pathname.endsWith('.png') ||
    pathname.endsWith('.jpg') ||
    pathname.endsWith('.svg') ||
    pathname.endsWith('.ico')
  ) {
    return respond(NextResponse.next());
  }

  // Coming-soon gate — checked before session lookup so a gated page
  // never requires auth to see the placeholder, and so we skip a Supabase
  // round-trip for a request that's about to be redirected anyway.
  if (isComingSoonEnabled() && isGatedRoute(pathname)) {
    if (pathname.startsWith('/api/')) {
      return respond(NextResponse.json({ error: 'Not available yet.' }, { status: 404 }));
    }
    return respond(NextResponse.redirect(new URL('/coming-soon', request.url)));
  }

  // Refresh Supabase session (keeps auth cookies fresh)
  const { supabaseResponse, user } = await updateSession(request);

  // If it's a public route, no further checks needed.
  // PUBLIC_PREFIXES routes are exempt from CSRF too (intentional): Stripe
  // webhook handlers verify HMAC signatures, Vercel Cron handlers verify
  // Bearer tokens, and internal x-internal-secret routes are called server-
  // to-server with no Origin header. Running the CSRF check on them would
  // false-positive every legitimate webhook delivery and cron invocation.
  if (isPublicRoute(pathname)) {
    return respond(supabaseResponse);
  }

  // CSRF protection — applied to non-public, state-changing requests only.
  // Cross-site form POSTs from a browser carry an attacker-origin `Origin`
  // header but ride the victim's SameSite=Lax session cookie. This check
  // rejects them at the middleware layer before any handler runs.
  if (!isCsrfSafe(request)) {
    return respond(
      NextResponse.json(
        { error: 'CSRF check failed: cross-origin request denied' },
        { status: 403 }
      )
    );
  }

  // No user — for API routes return 401 JSON; for page routes redirect to /login
  if (!user) {
    if (pathname.startsWith('/api/')) {
      return respond(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }));
    }
    const loginUrl = new URL('/login', request.url);
    // Only set redirect if it's a legitimate same-origin path (no open-redirect)
    const redirectTo = pathname;
    if (redirectTo !== '/login') {
      loginUrl.searchParams.set('redirect', redirectTo);
    }
    return respond(NextResponse.redirect(loginUrl));
  }

  // Fetch the user's role from profiles table
  let userRole: string | null = null;

  try {
    const supabase = createServerClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return request.cookies.getAll();
          },
          setAll() {
            // Read-only in this context; session refresh already handled above
          },
        },
      }
    );

    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .maybeSingle();

    userRole = (profile as { role?: string } | null)?.role ?? null;
  } catch {
    // If profile lookup fails, treat as unauthenticated
    return respond(NextResponse.redirect(new URL('/login', request.url)));
  }

  // Role-based access control (page routes only — the deleted UI route
  // groups no longer exist, but /api/admin, /api/learner, /api/reviewer
  // routes are NOT covered by these prefixes and must enforce their own
  // role checks in-handler, same as before this middleware was adapted).
  const isAdminRoute = pathname.startsWith('/admin');
  const isLearnerRoute = pathname.startsWith('/learner');
  const isReviewerRoute = pathname.startsWith('/reviewer');

  if (isAdminRoute && userRole !== 'manager') {
    return respond(NextResponse.redirect(new URL('/403', request.url)));
  }

  if (isLearnerRoute && userRole !== 'learner') {
    return respond(NextResponse.redirect(new URL('/403', request.url)));
  }

  if (isReviewerRoute && userRole !== 'reviewer') {
    return respond(NextResponse.redirect(new URL('/403', request.url)));
  }

  return respond(supabaseResponse);
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico, sitemap.xml, robots.txt
     */
    '/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt).*)',
  ],
};
