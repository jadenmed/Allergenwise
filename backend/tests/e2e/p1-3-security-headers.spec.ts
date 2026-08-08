/**
 * tests/e2e/p1-3-security-headers.spec.ts
 *
 * P1-3 — Browser security headers emitted by middleware.ts on every response.
 *
 * Covers:
 *   - Strict-Transport-Security (HSTS) — `max-age >= 1y; includeSubDomains; preload`
 *   - X-Content-Type-Options — `nosniff`
 *   - Referrer-Policy — `strict-origin-when-cross-origin`
 *   - Permissions-Policy — camera/microphone/geolocation/browsing-topics off;
 *                          payment allows self + js.stripe.com (Stripe Payment Element)
 *   - Content-Security-Policy — directive-name presence + key sources required
 *     for Stripe.js, Mux Player + Data, Supabase, self
 *
 * Strategy:
 *   - Non-CSP headers: exact-value assertions (these are static).
 *   - CSP: assert the directive name is present + that critical sources for each
 *     third-party SDK appear under the right directive. Exact-string match on the
 *     full CSP would be fragile to whitespace/ordering changes; per-directive
 *     substring checks are what actually protect against regressions that would
 *     silently break Stripe.js or Mux in production.
 *
 * Routes covered (cross-section of public, auth, API):
 *   - `/`            — public landing page
 *   - `/login`       — auth page (must allow Supabase + Stripe later via shared CSP)
 *   - `/api/search`  — public API route (PUBLIC_PREFIXES bypass path)
 *
 * Uses Playwright's `request` fixture so we get the raw response headers without
 * a browser rewriting them. baseURL comes from playwright.config.ts.
 */

import { test, expect, type APIResponse } from '@playwright/test';

const ROUTES = [
  { path: '/', label: 'public landing' },
  { path: '/login', label: 'auth page' },
  { path: '/api/search?q=test', label: 'public API' },
] as const;

function getCspMap(csp: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of csp.split(';')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const space = trimmed.indexOf(' ');
    if (space === -1) {
      out[trimmed] = '';
    } else {
      out[trimmed.slice(0, space)] = trimmed.slice(space + 1).trim();
    }
  }
  return out;
}

async function headers(res: APIResponse): Promise<Record<string, string>> {
  const all = res.headers();
  const lower: Record<string, string> = {};
  for (const [k, v] of Object.entries(all)) lower[k.toLowerCase()] = v;
  return lower;
}

test.describe('P1-3 — browser security headers', () => {
  for (const { path, label } of ROUTES) {
    test.describe(`${label} (${path})`, () => {
      test('HSTS: includes preload + includeSubDomains + max-age >= 1y', async ({ request }) => {
        const res = await request.get(path, { maxRedirects: 0 });
        const h = await headers(res);
        const hsts = h['strict-transport-security'];
        expect(hsts, 'Strict-Transport-Security header must be present').toBeTruthy();
        expect(hsts).toMatch(/max-age=(\d+)/);
        const m = hsts!.match(/max-age=(\d+)/);
        const seconds = Number(m![1]);
        expect(seconds).toBeGreaterThanOrEqual(31536000); // 1 year minimum
        expect(hsts).toMatch(/includeSubDomains/i);
        expect(hsts).toMatch(/preload/i);
      });

      test('X-Content-Type-Options: nosniff', async ({ request }) => {
        const res = await request.get(path, { maxRedirects: 0 });
        const h = await headers(res);
        expect(h['x-content-type-options']).toBe('nosniff');
      });

      test('Referrer-Policy: strict-origin-when-cross-origin', async ({ request }) => {
        const res = await request.get(path, { maxRedirects: 0 });
        const h = await headers(res);
        expect(h['referrer-policy']).toBe('strict-origin-when-cross-origin');
      });

      test('Permissions-Policy: locks down camera/mic/geolocation/topics; allows Stripe payment', async ({
        request,
      }) => {
        const res = await request.get(path, { maxRedirects: 0 });
        const h = await headers(res);
        const pp = h['permissions-policy'];
        expect(pp, 'Permissions-Policy header must be present').toBeTruthy();
        // Locked-down features: empty allowlist `=()`
        expect(pp).toMatch(/camera=\(\)/);
        expect(pp).toMatch(/microphone=\(\)/);
        expect(pp).toMatch(/geolocation=\(\)/);
        expect(pp).toMatch(/browsing-topics=\(\)/);
        // Payment must allow self + Stripe.js (required by the Payment Element).
        expect(pp).toMatch(/payment=\(self "https:\/\/js\.stripe\.com"\)/);
      });

      test('CSP: present, includes all required directives', async ({ request }) => {
        const res = await request.get(path, { maxRedirects: 0 });
        const h = await headers(res);
        const csp = h['content-security-policy'];
        expect(csp, 'Content-Security-Policy header must be present').toBeTruthy();

        const map = getCspMap(csp!);

        // Required directive names — these gate the whole policy.
        const required = [
          'default-src',
          'script-src',
          'style-src',
          'img-src',
          'font-src',
          'connect-src',
          'media-src',
          'frame-src',
          'worker-src',
          'object-src',
          'base-uri',
          'frame-ancestors',
          'form-action',
        ];
        for (const d of required) {
          expect(map, `CSP missing directive: ${d}`).toHaveProperty(d);
        }

        // Lock-down directives.
        expect(map['object-src']).toMatch(/'none'/);
        expect(map['frame-ancestors']).toMatch(/'none'/);
        expect(map['base-uri']).toMatch(/'self'/);

        // Stripe.js — script + frame + connect.
        expect(map['script-src']).toMatch(/https:\/\/js\.stripe\.com/);
        expect(map['frame-src']).toMatch(/https:\/\/js\.stripe\.com/);
        expect(map['frame-src']).toMatch(/https:\/\/hooks\.stripe\.com/);
        expect(map['connect-src']).toMatch(/https:\/\/api\.stripe\.com/);

        // Mux Player + Mux Data.
        expect(map['media-src']).toMatch(/https:\/\/stream\.mux\.com/);
        expect(map['img-src']).toMatch(/https:\/\/.+\.mux\.com|https:\/\/image\.mux\.com/);
        expect(map['connect-src']).toMatch(/https:\/\/img\.litix\.io|https:\/\/stream\.mux\.com/);

        // Supabase — REST + storage + realtime websockets.
        expect(map['connect-src']).toMatch(/\*\.supabase\.co|supabase\.co/);
        expect(map['connect-src']).toMatch(/wss:\/\//);
        expect(map['img-src']).toMatch(/supabase\.(co|com)/);
      });
    });
  }
});
