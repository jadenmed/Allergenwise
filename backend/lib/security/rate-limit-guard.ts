/**
 * lib/security/rate-limit-guard.ts
 *
 * P1-14 — shared 429/503 helper for non-verify endpoints.
 *
 * Wave 4B's verify route emits a tiny constant-body 429 + 503 with
 * Retry-After: 60 and Cache-Control: no-store. P1-14 adds the same
 * shape to signup / invite-accept / invites-send, so we centralize the
 * boilerplate here to keep each route handler focused on its own
 * business logic.
 *
 * Contract:
 *   - `runRateLimit(...)` accepts an ordered list of [name, limiter,
 *     key] guards. It calls them in order. The first failure returns
 *     `{ outcome: 'rate_limited', kind }`. A throw from any limiter
 *     short-circuits to `{ outcome: 'unavailable', error }`.
 *   - On success it returns `{ outcome: 'ok' }`.
 *
 * The 429 and 503 response bodies are byte-identical across all
 * callers and across all identifier states (existing vs unknown email,
 * existing vs unknown invite token, etc.). The 429 body is a single
 * frozen literal — no per-call interpolation — so the byte-equality
 * assertion in the test plan holds by construction.
 */

import { NextResponse } from 'next/server';
import type { Ratelimit } from '@upstash/ratelimit';

export interface RateLimitGuard {
  /** Stable label used in the activity-events payload for the firing limiter. */
  kind: string;
  /**
   * Lazy factory — built inside the try/catch so a missing KV env var
   * (`getRedis()` throwing at construction) is caught and surfaces as
   * the canonical fail-closed `unavailable` outcome rather than an
   * uncaught 500 from the route handler.
   */
  limiter: () => Ratelimit;
  /** The key (already hashed / normalized) to charge. */
  key: string;
}

export type RateLimitOutcome =
  | { outcome: 'ok' }
  | { outcome: 'rate_limited'; kind: string }
  | { outcome: 'unavailable'; error: string };

/**
 * Run an ordered list of rate-limit guards. Returns on the first
 * rejection. A thrown exception during factory construction OR during
 * `.limit()` short-circuits to fail-closed `unavailable`.
 */
export async function runRateLimit(guards: RateLimitGuard[]): Promise<RateLimitOutcome> {
  for (const g of guards) {
    try {
      const limiter = g.limiter();
      const result = await limiter.limit(g.key);
      if (!result.success) {
        return { outcome: 'rate_limited', kind: g.kind };
      }
    } catch (err) {
      return {
        outcome: 'unavailable',
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
  return { outcome: 'ok' };
}

// ─── Canonical 429 / 503 responses ───────────────────────────────────────────
//
// The bodies are typed `unknown` so callers can compare them
// byte-for-byte in tests. They are intentionally tiny and contain no
// per-call data — only a `status` discriminator.

const RATE_LIMITED_BODY = { error: 'rate_limited' } as const;
const UNAVAILABLE_BODY = { error: 'unavailable' } as const;

const RETRY_HEADERS = {
  'Retry-After': '60',
  'Cache-Control': 'no-store',
} as const;

export function rateLimitedResponse(): NextResponse {
  return NextResponse.json(RATE_LIMITED_BODY, { status: 429, headers: { ...RETRY_HEADERS } });
}

export function rateLimitUnavailableResponse(): NextResponse {
  return NextResponse.json(UNAVAILABLE_BODY, { status: 503, headers: { ...RETRY_HEADERS } });
}
