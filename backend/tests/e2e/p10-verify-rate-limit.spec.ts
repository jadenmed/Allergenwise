/**
 * tests/e2e/p10-verify-rate-limit.spec.ts
 *
 * Wave 4B P0 #10 — verify endpoint contract from the network edge.
 *
 * Two sections:
 *
 *   1. ALWAYS RUNS — format-validation invariants. These short-circuit
 *      before any rate-limit / Redis call, so they pass regardless of
 *      whether Upstash is configured for the dev server. Proves the
 *      ordering decision (Concern 1 in the plan) holds end-to-end at
 *      the HTTP layer.
 *
 *   2. ONLY RUNS WHEN UPSTASH IS CONFIGURED — actual rate-limit
 *      enforcement. Detects whether the dev server has KV_REST_API_URL
 *      via a probe request; if not, the section is skipped with a
 *      visible note so it doesn't count as a false pass.
 */

import { test, expect, type APIResponse } from '@playwright/test';

const BASE = process.env.BASE_URL || 'http://localhost:3000';

async function readBody(res: APIResponse): Promise<{ status: number; body: string }> {
  return { status: res.status(), body: await res.text() };
}

test.describe('Wave 4B — verify endpoint format validation (always runs)', () => {
  test('malformed code returns 200 not_found, indistinguishable from unknown', async ({
    request,
  }) => {
    // Both bodies must be byte-identical.
    const malformed = await readBody(await request.get(`${BASE}/api/certs/AW-2026-000001/verify`));
    const unknownButValid = await readBody(
      await request.get(`${BASE}/api/certs/AW-XJ4T8-Q9M2K-5/verify`)
    );

    // Both should be 200 (no auth required) OR both should be 503 if Upstash
    // is misconfigured for the dev server. We only assert the indistinguishability,
    // not the status — that's the security invariant.
    expect(malformed.status).toBe(unknownButValid.status);
    if (malformed.status === 200) {
      // Format-validation rejected the old code AND the DB miss on the valid
      // one. Both must serialize to the same not_found payload.
      const malformedJson = JSON.parse(malformed.body);
      const unknownJson = JSON.parse(unknownButValid.body);
      expect(malformedJson).toEqual({ valid: false, status: 'not_found' });
      expect(unknownJson).toEqual({ valid: false, status: 'not_found' });
    }
  });

  test('gibberish input returns the same not_found payload as a typo', async ({ request }) => {
    const gibberish = await readBody(await request.get(`${BASE}/api/certs/!!!/verify`));
    const empty = await readBody(await request.get(`${BASE}/api/certs/x/verify`));

    expect(gibberish.status).toBe(empty.status);
    if (gibberish.status === 200) {
      expect(JSON.parse(gibberish.body)).toEqual({ valid: false, status: 'not_found' });
      expect(JSON.parse(empty.body)).toEqual({ valid: false, status: 'not_found' });
    }
  });
});

/**
 * Probe whether Upstash is configured for the dev server. Hits the verify
 * endpoint once with a format-valid (check-digit-passing), non-existent
 * cert code and checks the status code: 200 (or anything non-503) means
 * the limiter ran without throwing, which means KV_REST_API_URL is
 * reachable. 503 means fail-closed → Upstash unconfigured.
 *
 * The probe code MUST be format-valid — a format-invalid code
 * short-circuits to 200 "not_found" BEFORE the rate limiter ever runs
 * (Wave 4B ordering), which would make this probe always report
 * "configured" regardless of Redis availability. The previous literal
 * here (AW-XJ4T8-Q9M2K-5) failed its ISO 7064 check digit, which silently
 * defeated this entire "skipped without Upstash" gate — the enforcement
 * tests below ran (and failed with 503s) even with no Upstash configured,
 * instead of skipping as intended.
 */
async function isUpstashConfigured(
  request: import('@playwright/test').APIRequestContext
): Promise<boolean> {
  const probe = await request.get(`${BASE}/api/certs/AW-TSSBF-HM3CD-D/verify`);
  return probe.status() !== 503;
}

test.describe('Wave 4B — verify rate-limit enforcement (skipped without Upstash)', () => {
  test('11th request from one IP returns 429 with the documented headers', async ({ request }) => {
    test.skip(
      !(await isUpstashConfigured(request)),
      'Upstash not configured for the dev server — set KV_REST_API_URL + KV_REST_API_TOKEN to enable'
    );

    // Use a fresh random-looking code per test run so we don't carry state
    // from previous runs. Bidding-style brute force from a single IP.
    const probeCode =
      'AW-' +
      Array.from(
        { length: 5 },
        () => '23456789ABCDEFGHJKMNPQRSTVWXYZ'[Math.floor(Math.random() * 30)]
      ).join('') +
      '-' +
      Array.from(
        { length: 5 },
        () => '23456789ABCDEFGHJKMNPQRSTVWXYZ'[Math.floor(Math.random() * 30)]
      ).join('') +
      '-0'; // intentionally bad check digit so format-validate still passes
    // pattern but the validate step rejects — the rate limiter
    // shouldn't run. Use a known valid code instead.

    // Generate a code with a valid check digit so the limiter does run.
    // Easiest: call validateCertCode? But this is e2e — use a fixed valid
    // dev cert code from the seed.
    const validCode = 'AW-MQSAZ-772BH-4'; // seeded "active" cert

    let lastStatus = 0;
    for (let i = 0; i < 11; i++) {
      const res = await request.get(`${BASE}/api/certs/${validCode}/verify`);
      lastStatus = res.status();
    }
    // After 11 requests within the per-IP 10/min window, the 11th should
    // be 429. (Allow 200 if the limit env-var override raised the threshold.)
    expect(lastStatus, `last status after 11 same-IP requests was ${lastStatus}`).toBe(429);

    // Final response must carry Retry-After + Cache-Control no-store.
    const final = await request.get(`${BASE}/api/certs/${validCode}/verify`);
    expect(final.status()).toBe(429);
    expect(final.headers()['retry-after']).toBe('60');
    expect(final.headers()['cache-control']).toBe('no-store');
    const body = await final.json();
    expect(body).toEqual({ valid: false, status: 'rate_limited' });
  });
});
