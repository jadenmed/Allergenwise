/**
 * tests/e2e/p09-csrf-middleware.spec.ts
 *
 * P0 #9 — CSRF protection in middleware.
 *
 * Background: middleware.ts allows state-changing POST/PUT/PATCH/DELETE
 * requests through with no Origin/Referer cross-origin check. A cross-site
 * <form action="https://allergenwise.com/api/admin/..." method="POST">
 * with the victim's SameSite=Lax cookie attached rides the victim's session.
 *
 * Fix design:
 *   - Skip CSRF check for paths in PUBLIC_PREFIXES (Stripe webhooks, Vercel
 *     Cron, internal /api/certs/generate).
 *   - For non-public state-changing routes:
 *       - Origin present → must match Host
 *       - else Referer present → its origin must match Host
 *       - else (neither) → allow (server-to-server fallback)
 *
 * Uses Playwright's per-test `request` fixture so paths stay relative —
 * baseURL comes from playwright.config.ts.
 */

import { test, expect } from '@playwright/test';

test.describe('P0 #9 — middleware CSRF protection', () => {
  test('1. Cross-origin POST to non-public route → 403 CSRF', async ({ request }) => {
    const res = await request.post('/api/invites/send', {
      headers: {
        'Content-Type': 'application/json',
        Origin: 'https://evil.example.com',
      },
      data: { email: 'x@x.com', fullName: 'X' },
    });
    expect(res.status()).toBe(403);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toMatch(/csrf|cross-origin/i);
  });

  test('2. Same-origin POST is NOT blocked by CSRF (reaches auth gate)', async ({
    request,
    baseURL,
  }) => {
    const hostUrl = new URL(baseURL!);
    const res = await request.post('/api/invites/send', {
      headers: {
        'Content-Type': 'application/json',
        Origin: `${hostUrl.protocol}//${hostUrl.host}`,
      },
      data: { email: 'x@x.com', fullName: 'X' },
    });
    // Without a session cookie this hits 401, NOT 403. Either way the body
    // must NOT mention CSRF.
    expect(res.status()).not.toBe(403);
    const body = (await res.json()) as { error?: string };
    expect(body.error ?? '').not.toMatch(/csrf|cross-origin/i);
  });

  test('3. PUBLIC_PREFIX bypass — cron route with Bearer + NO Origin still succeeds', async ({
    request,
  }) => {
    const cronSecret = process.env.CRON_SECRET ?? '';
    const res = await request.get('/api/cron/expire-listings', {
      headers: { Authorization: `Bearer ${cronSecret}` },
    });
    expect(res.status()).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toHaveProperty('ok');
    expect(body).toHaveProperty('processed');
  });

  test('4. PUBLIC_PREFIX bypass — /api/stripe/webhook with NO Origin reaches handler (400 sig)', async ({
    request,
  }) => {
    const res = await request.post('/api/stripe/webhook', {
      headers: { 'Content-Type': 'application/json' },
      data: { type: 'fake' },
    });
    // No stripe-signature → handler returns 400, not 403 CSRF
    expect(res.status()).toBe(400);
    const body = (await res.json()) as { error?: string };
    expect(body.error ?? '').not.toMatch(/csrf|cross-origin/i);
  });

  test('5. Cross-origin Referer (no Origin) → 403 CSRF', async ({ request }) => {
    const res = await request.post('/api/invites/send', {
      headers: {
        'Content-Type': 'application/json',
        Referer: 'https://evil.example.com/page',
      },
      data: { email: 'x@x.com', fullName: 'X' },
    });
    expect(res.status()).toBe(403);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toMatch(/csrf|cross-origin/i);
  });

  test('6. GET requests are NOT subject to CSRF check (state-changing methods only)', async ({
    request,
  }) => {
    const res = await request.get('/api/auth/session', {
      headers: { Origin: 'https://evil.example.com' },
    });
    // /api/auth/session is public and read-only; no CSRF block expected
    expect(res.status()).not.toBe(403);
  });

  // The class this covers: an INTERNAL, secret-guarded, STATE-CHANGING endpoint
  // called server-to-server — so it carries neither Origin nor Referer — must
  // still reach its own handler rather than being 403'd by the CSRF check.
  //
  // T-48 moved this off /api/stripe/charge-cert-fees, which was deleted. The
  // replacement is /api/certs/generate, not one of the /api/cron/* routes,
  // because the cron routes are GET: `isCsrfSafe` returns true for GET before
  // it ever looks at Origin, so a cron route cannot exercise the CSRF branch at
  // all — it would only re-prove the PUBLIC_PREFIXES bypass that test 3 above
  // already covers. /api/certs/generate is the surviving member of the actual
  // class: POST, `x-internal-secret` matching CRON_SECRET, and public via the
  // '/api/certs/' prefix.
  test('7. Internal secret-guarded POST with NO Origin still reaches its handler (not 403 CSRF)', async ({
    request,
  }) => {
    const cronSecret = process.env.CRON_SECRET ?? '';
    const res = await request.post('/api/certs/generate', {
      headers: {
        'Content-Type': 'application/json',
        'x-internal-secret': cronSecret,
      },
      // Well-formed UUID that matches no certificate, so the handler runs to
      // its lookup and stops there — no PDF is rendered and nothing is written.
      data: { certificateId: '00000000-0000-0000-0000-000000000000' },
    });

    // The invariant under test, asserted unconditionally.
    expect(res.status()).not.toBe(403);
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    expect(body.error ?? '').not.toMatch(/csrf|cross-origin/i);

    // Stronger half of the claim — "reaches its handler". 404 'Certificate not
    // found' can ONLY come from the route handler: it is past the middleware,
    // past the handler's own secret gate, and past Zod. Skipped when
    // CRON_SECRET is unset, where a 401 would say nothing about CSRF.
    if (cronSecret !== '' && !cronSecret.includes('placeholder_cron_secret_unset')) {
      expect(res.status(), 'handler-level 404 proves the request reached the route').toBe(404);
      expect(body.error).toBe('Certificate not found');
    }
  });
});
