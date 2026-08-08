/**
 * lib/app-url.ts
 *
 * One answer to "what is this deployment's base URL", for the places where
 * getting it wrong is customer-visible.
 *
 * Why this exists (T-41a review)
 * ──────────────────────────────
 * Stripe Checkout's `success_url` is where a PAYING restaurant's browser is
 * sent the instant the charge succeeds. The old inline fallback —
 *
 *     const appUrl = process.env.APP_URL ?? 'http://localhost:3000';
 *
 * — is silent in exactly the wrong direction. APP_URL is not set in .env.local,
 * and if it is also unset in the deployment then every paying restaurant is
 * redirected to `http://localhost:3000/signup/complete`: their own machine.
 * The charge succeeds, the webhook provisions, and the customer sees a
 * connection error. Nothing appears in any log, because from the server's point
 * of view nothing failed.
 *
 * So the resolution order below ends in a THROW rather than a guess. A signup
 * that fails loudly is recoverable; a paying customer bounced to localhost is
 * not, and nobody finds out.
 *
 * Order (first usable value wins):
 *   1. APP_URL — the server-side spelling, used by the email/PDF link builders.
 *   2. NEXT_PUBLIC_APP_URL — the client-visible spelling, already used by the
 *      directory + verify metadata builders. Both spellings exist in this repo,
 *      so both are honoured rather than making callers guess which one is live.
 *   3. https://${VERCEL_URL} — Vercel injects the host with no scheme. This is
 *      the same chain app/(public)/directory/page.tsx and friends already use.
 *   4. Throw when NODE_ENV === 'production'.
 *   5. http://localhost:3000 for local dev.
 *
 * Every returned value has its trailing slash stripped, so callers can append
 * `/signup/complete` without producing a double slash.
 *
 * A value that does not parse as an http(s) URL is treated as ABSENT rather
 * than passed through: in production that falls through to the throw, which is
 * the loud outcome a malformed base URL deserves.
 *
 * NOTE: lib/stripe/cert-event-handlers.ts:103 still has the old inline pattern.
 * That file is T-41b's and is deliberately left alone here.
 */
import 'server-only';

/** What this module needs from an environment: string lookups, nothing more. */
export type EnvLike = Readonly<Record<string, string | undefined>>;

/** The dev-only fallback. Never returned when NODE_ENV === 'production'. */
export const LOCAL_DEV_APP_URL = 'http://localhost:3000';

/**
 * Normalize a candidate base URL, or null when it cannot be used.
 *
 * - blank / whitespace-only → null (an env var set to '' is not a value)
 * - no scheme → https:// is assumed (this is what VERCEL_URL looks like)
 * - trailing slashes stripped
 * - anything that is not http(s) → null
 */
function normalizeBaseUrl(value: string | undefined): string | null {
  if (typeof value !== 'string') return null;

  const trimmed = value.trim();
  if (trimmed === '') return null;

  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  const withoutTrailingSlash = withScheme.replace(/\/+$/, '');

  let parsed: URL;
  try {
    parsed = new URL(withoutTrailingSlash);
  } catch {
    return null;
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  if (parsed.hostname === '') return null;

  return withoutTrailingSlash;
}

/**
 * This deployment's base URL, with no trailing slash.
 *
 * @param env Environment to read. Defaults to process.env; injectable so the
 *            tests can prove every branch without mutating the real one.
 * @throws    In production when nothing usable is configured. That is the
 *            point: see the module header.
 */
export function resolveAppUrl(env: EnvLike = process.env): string {
  const explicit = normalizeBaseUrl(env.APP_URL) ?? normalizeBaseUrl(env.NEXT_PUBLIC_APP_URL);
  if (explicit !== null) return explicit;

  const vercel = normalizeBaseUrl(env.VERCEL_URL);
  if (vercel !== null) return vercel;

  if (env.NODE_ENV === 'production') {
    throw new Error(
      [
        'No application base URL is configured.',
        '',
        'Set APP_URL (or NEXT_PUBLIC_APP_URL) to this deployment’s public origin,',
        'e.g. https://allergenwise.com. On Vercel, VERCEL_URL is also accepted.',
        '',
        'This throws instead of defaulting because the value is used for Stripe',
        'Checkout success_url: a wrong base URL redirects a restaurant that has',
        'already paid to a host that is not us, and nothing else reports it.',
      ].join('\n')
    );
  }

  return LOCAL_DEV_APP_URL;
}
