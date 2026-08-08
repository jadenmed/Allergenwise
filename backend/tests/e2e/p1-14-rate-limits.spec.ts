/**
 * tests/e2e/p1-14-rate-limits.spec.ts
 *
 * P1-14 — verify the rate-limit guards on signup / invite-accept /
 * invites-send hold at the HTTP layer.
 *
 * Two sections (mirror of p10-verify-rate-limit.spec.ts):
 *
 *   1. ALWAYS RUNS — format-first ordering checks. Malformed payloads
 *      must return 400 (NOT 429) regardless of whether the rate
 *      limiter is configured for the dev server.
 *
 *   2. RUNS ONLY WHEN UPSTASH IS CONFIGURED — fire-the-limit checks.
 *      Detected via a probe; skipped with a visible note otherwise.
 *
 * The skipped section is the canonical Wave 4B-style live-Upstash gate.
 * It is genuine end-to-end coverage when Upstash is wired into the dev
 * server (KV_REST_API_URL + KV_REST_API_TOKEN set).
 */

import { test, expect, type APIRequestContext } from '@playwright/test';

const BASE = process.env.BASE_URL || 'http://localhost:3000';

async function isUpstashConfigured(request: APIRequestContext): Promise<boolean> {
  // The verify endpoint fails closed to 503 when Redis is unreachable.
  // If the probe gets 200 (or anything other than 503) the dev server
  // has working Upstash credentials.
  //
  // The probe code MUST pass validateCertCode's format/check-digit check —
  // a format-invalid code short-circuits to a 200 "not_found" BEFORE the
  // rate limiter ever runs (Wave 4B ordering, see verify/route.ts), which
  // would make this probe always report "configured" regardless of Redis
  // availability. AW-TSSBF-HM3CD-D is a verified-valid, non-existent
  // Crockford Base32 + ISO 7064 check-digit code (confirmed via
  // generateCertCode()/validateCertCode()) — the previous literal here
  // (AW-XJ4T8-Q9M2K-5) failed its check digit, which silently defeated
  // this entire "skipped without Upstash" gate.
  const probe = await request.get(`${BASE}/api/certs/AW-TSSBF-HM3CD-D/verify`);
  return probe.status() !== 503;
}

// ─── ALWAYS RUNS — format-first ordering ─────────────────────────────────────

test.describe('P1-14 format-validation runs before rate-limit (always runs)', () => {
  test('signup with malformed body returns 400, not 429', async ({ request }) => {
    const res = await request.post(`${BASE}/api/auth/signup`, {
      headers: { 'content-type': 'application/json' },
      data: { admin: { email: 'bad' } },
    });
    expect(res.status()).toBe(400);
  });

  test('invite-accept with missing token returns 400, not 429', async ({ request }) => {
    const res = await request.post(`${BASE}/api/auth/invite/accept`, {
      headers: { 'content-type': 'application/json' },
      data: { password: 'too-short' },
    });
    expect(res.status()).toBe(400);
  });

  test('invites/send with malformed body returns 400, not 429', async ({ request }) => {
    const res = await request.post(`${BASE}/api/invites/send`, {
      headers: { 'content-type': 'application/json' },
      data: {},
    });
    // 400 if validation rejects before middleware/auth kicks in. The route's
    // own auth gate may also return 401 if no session — either is fine,
    // the important assertion is that we are NOT 429 (which would mean
    // the rate-limiter ran before format validation).
    expect([400, 401]).toContain(res.status());
  });
});

// ─── RUNS ONLY WITH UPSTASH ──────────────────────────────────────────────────

test.describe('P1-14 rate-limit enforcement (skipped without Upstash)', () => {
  test('11th signup request from one IP returns 429 with documented headers', async ({
    request,
  }) => {
    test.skip(
      !(await isUpstashConfigured(request)),
      'Upstash not configured for the dev server — set KV_REST_API_URL + KV_REST_API_TOKEN to enable'
    );
    // Signup hits real Stripe + Supabase admin. With placeholder dev
    // keys, every attempt returns 500 from performSignup well after the
    // limiter charge, so the test cannot distinguish 'limiter working'
    // from 'upstream broken'. The vitest integration test
    // tests/integration/signup-rate-limit.test.ts covers the same
    // contract with a mocked performSignup. Keep this e2e gated behind
    // an explicit env var for operators who have a fully-keyed dev env.
    test.skip(
      process.env.P1_14_LIVE_SIGNUP !== '1',
      'Set P1_14_LIVE_SIGNUP=1 with real Stripe + Supabase dev keys to enable.'
    );

    // Use a synthetic x-forwarded-for so we don't burn the test
    // runner's loopback IP budget, which would otherwise cascade and
    // 429 the pilot-loop's invite-accept step (shared test runner IP).
    // hrtime + Math.random give per-run uniqueness so chromium and
    // Mobile Chrome don't collide on the same Redis bucket. (Math.random
    // ban is scoped to app/ + lib/; test code is exempt.)
    const probeIp = `203.0.113.${Math.floor(Math.random() * 250) + 1}`;
    const statuses: number[] = [];
    let last = 0;
    for (let i = 0; i < 11; i++) {
      // Use a different email each time so the per-email limiter (5/min)
      // doesn't fire first. We want the per-IP (10/min) to be the
      // limiter that rejects on the 11th.
      const res = await request.post(`${BASE}/api/auth/signup`, {
        headers: { 'content-type': 'application/json', 'x-forwarded-for': probeIp },
        data: {
          restaurant: {
            name: `Probe ${i}`,
            address: '1 Test St',
            city: 'Austin',
            state: 'TX',
            zip: '78701',
            phone: '5125550000',
            cuisine: 'New American',
          },
          admin: {
            fullName: `Probe ${i}`,
            email: `p1-14-probe-${Date.now()}-${i}@example.test`,
            password: 'correct-horse-battery',
          },
          plan: 'quarterly',
        },
      });
      last = res.status();
      statuses.push(last);
    }
    // Robust to dev-server upstream noise: as long as 429 appears in the
    // window of 11 attempts, the limiter is enforcing.
    expect(statuses).toContain(429);
    const final = await request.post(`${BASE}/api/auth/signup`, {
      headers: { 'content-type': 'application/json', 'x-forwarded-for': probeIp },
      data: {
        restaurant: {
          name: 'final',
          address: '1 a',
          city: 'b',
          state: 'TX',
          zip: '78701',
          phone: '5125550000',
          cuisine: 'c',
        },
        admin: {
          fullName: 'Final',
          email: `final-${Date.now()}@example.test`,
          password: 'correct-horse-battery',
        },
        plan: 'quarterly',
      },
    });
    expect(final.status()).toBe(429);
    expect(final.headers()['retry-after']).toBe('60');
    expect(final.headers()['cache-control']).toBe('no-store');
  });

  test('11th invite-accept from one IP returns 429', async ({ request }) => {
    test.skip(!(await isUpstashConfigured(request)), 'Upstash not configured for the dev server');

    // Synthetic x-forwarded-for so the burn does not collide with the
    // pilot-loop's invite-accept step (same test runner IP). Math.random
    // ban is scoped to app/ + lib/; test code is exempt.
    const probeIp = `198.51.100.${Math.floor(Math.random() * 250) + 1}`;
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) {
      const res = await request.post(`${BASE}/api/auth/invite/accept`, {
        headers: { 'content-type': 'application/json', 'x-forwarded-for': probeIp },
        data: { token: `probe-token-${Date.now()}-${i}`, password: 'correct-horse-battery' },
      });
      statuses.push(res.status());
    }
    expect(statuses).toContain(429);
  });
});
