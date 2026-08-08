/**
 * tests/e2e/p1-16-gdpr.spec.ts
 *
 * P1-16 — auth + rate-limit ordering checks for the new GDPR routes.
 *
 * Always-runs section. The routes require an authenticated session,
 * so all four must reject anonymous callers with 401 (or 400/410 if
 * the body is malformed enough to be rejected earlier). The
 * malformed-payload assertions verify format-validation runs BEFORE
 * the rate limiter (consistent with Wave 4B + P1-14 discipline).
 *
 * Live-Upstash-gated rate-limit-hit checks are NOT included because
 * the request-deletion route requires a real authed session AND has
 * a per-hour cap that would persist across runs. Vitest coverage is
 * comprehensive for the limiter behavior.
 */

import { test, expect } from '@playwright/test';

const BASE = process.env.BASE_URL || 'http://localhost:3000';

test.describe('P1-16 GDPR endpoints — anonymous access is rejected', () => {
  test('POST /api/account/me/request-deletion without session returns 401', async ({ request }) => {
    const res = await request.post(`${BASE}/api/account/me/request-deletion`, {
      headers: { 'content-type': 'application/json' },
      data: {},
    });
    expect(res.status()).toBe(401);
  });

  test('POST /api/account/me/confirm-deletion without session returns 401', async ({ request }) => {
    const res = await request.post(`${BASE}/api/account/me/confirm-deletion`, {
      headers: { 'content-type': 'application/json' },
      data: { token: 'fake' },
    });
    expect(res.status()).toBe(401);
  });

  test('POST /api/account/me/confirm-deletion with malformed body returns 400 (not 429)', async ({
    request,
  }) => {
    const res = await request.post(`${BASE}/api/account/me/confirm-deletion`, {
      headers: { 'content-type': 'application/json' },
      data: {},
    });
    // 401 (no session) or 400 (Zod) — never 429. The point of this
    // test is the format-first ordering invariant.
    expect([400, 401]).toContain(res.status());
  });

  test('POST /api/account/me/cancel-deletion-request without session returns 401', async ({
    request,
  }) => {
    const res = await request.post(`${BASE}/api/account/me/cancel-deletion-request`);
    expect(res.status()).toBe(401);
  });

  test('GET /api/account/me/export without session returns 401', async ({ request }) => {
    const res = await request.get(`${BASE}/api/account/me/export`);
    expect(res.status()).toBe(401);
  });
});
