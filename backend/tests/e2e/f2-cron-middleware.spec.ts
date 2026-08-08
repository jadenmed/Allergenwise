/**
 * tests/e2e/f2-cron-middleware.spec.ts
 *
 * Regression test for follow-up F2 from audits/followups.md.
 *
 * All six `/api/cron/*` routes carry the same class of bug F1 first found on
 * `/api/stripe/charge-cert-fees` (a route since retired in T-48, though the
 * bug class it exposed is exactly why this file exists): they have a
 * Bearer-CRON_SECRET check inside the handler, but middleware blocks the
 * request before the handler runs because the path is missing from
 * PUBLIC_PREFIXES.
 *
 * Pre-fix: GET with the correct Bearer header returns
 *   HTTP 401 { error: 'Unauthorized' }   ← from middleware, not handler
 *
 * Post-fix: GET with the correct Bearer header returns
 *   HTTP 200 { ok: true|false, processed: N, errors: [] }   ← handler ran
 *
 * For each route this test asserts BOTH:
 *   1. No header               → 401 (handler-level Bearer check works)
 *   2. With Bearer CRON_SECRET → 200 (middleware no longer the gate)
 *
 * Side-effect notes:
 *   - expire-certs / digest-reviewer-queue / weekly-admin-digest all send
 *     emails via Resend. RESEND_API_KEY in .env.local is a placeholder —
 *     `lib/email/send.ts` returns `{ ok: false }` for those calls and
 *     swallows the error. No real emails leave the dev environment.
 *   - exam-timeout-sweep and the expire-* routes only mutate rows whose
 *     time-window has actually elapsed. With the curriculum-only seed
 *     state in dev, this set is empty or very small.
 *   - All six handlers are designed to be idempotent.
 */

import { test, expect } from '@playwright/test';

const CRON_ROUTES = [
  'expire-listings',
  'expire-subscriptions',
  'expire-certs',
  'exam-timeout-sweep',
  'digest-reviewer-queue',
  'weekly-admin-digest',
] as const;

test.describe('F2 — middleware allowlist for /api/cron/*', () => {
  for (const route of CRON_ROUTES) {
    test(`${route} — no header → 401, Bearer header → 200 (handler reached)`, async ({
      request,
    }) => {
      const cronSecret = process.env.CRON_SECRET ?? '';
      const hasCronSecret =
        cronSecret !== '' && !cronSecret.includes('placeholder_cron_secret_unset');
      if (!hasCronSecret) {
        test.skip(true, 'CRON_SECRET unset');
        return;
      }

      // 1. No Authorization header → handler-level 401
      const noAuthRes = await request.get(`/api/cron/${route}`);
      expect(noAuthRes.status(), `${route} without header should 401`).toBe(401);

      // 2. With correct Bearer → middleware passes through, handler runs.
      // Pre-fix: middleware 401s before the handler can see the bearer.
      // Post-fix: handler runs, returns its standard ok-shape JSON.
      const authRes = await request.get(`/api/cron/${route}`, {
        headers: { Authorization: `Bearer ${cronSecret}` },
      });

      const status = authRes.status();
      const body = (await authRes.json()) as Record<string, unknown>;

      expect(
        status,
        `${route} with Bearer should reach handler (got ${status} body=${JSON.stringify(body)})`
      ).toBe(200);

      // Handler success shape — every cron route returns { ok, processed, errors }
      expect(body, `${route} response shape`).toHaveProperty('ok');
      expect(body, `${route} response shape`).toHaveProperty('processed');
      expect(body, `${route} response shape`).toHaveProperty('errors');
      expect(typeof body.ok).toBe('boolean');
      expect(typeof body.processed).toBe('number');
      expect(Array.isArray(body.errors)).toBe(true);

      // Pre-fix middleware-leak signature
      expect(
        body.error,
        'middleware leak: pre-fix surfaces the bare middleware "Unauthorized" body'
      ).not.toBe('Unauthorized');
    });
  }
});
