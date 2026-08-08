/**
 * tests/unit/middleware-coming-soon-gate.test.ts
 *
 * T-03 — middleware.ts's isGatedRoute() redirects gated page routes to
 * /coming-soon and 404s gated API routes while the coming-soon gate is on.
 * The gate check runs before the Supabase session lookup, so these tests
 * exercise it without needing real auth state.
 *
 * ── WHAT THIS FILE IS ACTUALLY FOR ───────────────────────────────────────
 * The gate DEFAULTS TO ON (`COMING_SOON !== 'false'`, see lib/coming-soon.ts).
 * That inversion is the single most dangerous property in T-03: written the
 * other way round — `=== 'true'` — a missing or misspelled environment
 * variable publishes an unfinished product to the internet, silently, with
 * nothing anywhere to alert anyone.
 *
 * So the load-bearing cases here are the ones asserting that a request with
 * NO `COMING_SOON` set is still gated, and that a garbage value is treated
 * as "on" rather than "off". Exactly one value opens the door, and an
 * operator has to type it. Do not weaken these into "unset behaves like
 * pre-gate" — that was the OLD contract and it is now backwards.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

vi.mock('@/lib/supabase/middleware', () => ({
  updateSession: vi.fn(async () => ({
    supabaseResponse: NextResponse.next(),
    user: null,
  })),
}));

vi.mock('@supabase/ssr', () => ({
  createServerClient: vi.fn(() => ({
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }),
    }),
  })),
}));

function req(path: string) {
  return new NextRequest(`http://localhost:3000${path}`);
}

const COMING_SOON_URL = 'http://localhost:3000/coming-soon';

describe('middleware — coming-soon gate (T-03)', () => {
  const originalComingSoon = process.env.COMING_SOON;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    // Every test declares its own flag state. Starting from "unset" means a
    // test that forgets to is exercising the default, which is the state
    // that matters most.
    delete process.env.COMING_SOON;
  });

  afterEach(() => {
    if (originalComingSoon === undefined) delete process.env.COMING_SOON;
    else process.env.COMING_SOON = originalComingSoon;
  });

  const gatedPages = [
    '/directory',
    '/directory/some-slug',
    '/verify/AW-7K4M9-3XPQR-A',
    '/pricing',
    '/reviewer/queue',
    '/reviewer/brands',
    '/reviewer/partners',
  ];

  const gatedApis = [
    '/api/directory/some-slug',
    '/api/search',
    '/api/reviewer/queue',
    '/api/certs/AW-7K4M9-3XPQR-A',
  ];

  // ── The default: nothing set, everything gated ────────────────────────────

  it.each(gatedPages)(
    'COMING_SOON unset (the default): %s redirects to /coming-soon',
    async (path) => {
      const { middleware } = await import('@/middleware');

      const res = await middleware(req(path));

      expect(res.status).toBe(307);
      expect(res.headers.get('location')).toBe(COMING_SOON_URL);
    }
  );

  it.each(gatedApis)('COMING_SOON unset (the default): %s returns 404 JSON', async (path) => {
    const { middleware } = await import('@/middleware');

    const res = await middleware(req(path));

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBeTruthy();
  });

  // ── Anything that is not the exact string 'false' keeps the site private ──

  const notFalse = [
    ['empty string', ''],
    ['the explicit opposite', 'true'],
    ['wrong case', 'FALSE'],
    ['a plausible synonym', 'no'],
    ['a numeric zero', '0'],
    ['a typo an operator would not notice', 'flase'],
    ['a value with stray whitespace', ' false'],
  ] as const;

  it.each(notFalse)('COMING_SOON is %s → still gated', async (_label, value) => {
    process.env.COMING_SOON = value;
    const { middleware } = await import('@/middleware');

    const res = await middleware(req('/directory'));

    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe(COMING_SOON_URL);
  });

  // ── The one value that opens the door ─────────────────────────────────────

  it.each(gatedPages)('COMING_SOON=false: %s is NOT redirected', async (path) => {
    process.env.COMING_SOON = 'false';
    const { middleware } = await import('@/middleware');

    const res = await middleware(req(path));

    expect(res.headers.get('location')).not.toBe(COMING_SOON_URL);
  });

  it.each(gatedApis)('COMING_SOON=false: %s is NOT 404ed by the gate', async (path) => {
    process.env.COMING_SOON = 'false';
    const { middleware } = await import('@/middleware');

    const res = await middleware(req(path));

    expect(res.status).not.toBe(404);
  });

  // ── Properties that must survive in both directions ───────────────────────

  it('/coming-soon itself is never redirected (no loop)', async () => {
    const { middleware } = await import('@/middleware');

    const res = await middleware(req('/coming-soon'));

    expect(res.status).not.toBe(307);
  });

  it('/api/certs/generate is NOT gated (server-to-server PDF render)', async () => {
    const { middleware } = await import('@/middleware');

    const res = await middleware(req('/api/certs/generate'));

    // Not gated → falls through to the existing public-route bypass
    // (/api/certs/ prefix was already public pre-gate) — never a 404 from
    // the gate itself. This one matters more now than it did: certificates
    // are issued on every exam pass again (T-03), so the PDF render runs
    // while the rest of the site is still private.
    expect(res.status).not.toBe(404);
  });

  it('in-scope restaurant surfaces are unaffected by the gate', async () => {
    const { middleware } = await import('@/middleware');

    // No session → existing (pre-gate) behavior is a redirect to /login,
    // never to /coming-soon.
    const res = await middleware(req('/admin/dashboard'));

    expect(res.headers.get('location')).not.toBe(COMING_SOON_URL);
  });

  it('/signup, /login and / stay reachable while the gate is on', async () => {
    // A gate that blocks signup is a gate that blocks revenue. These are in
    // PUBLIC_ROUTES and must not drift into GATED_PAGE_PREFIXES.
    const { middleware } = await import('@/middleware');

    for (const path of ['/signup', '/login', '/']) {
      const res = await middleware(req(path));
      expect(res.headers.get('location'), `${path} was gated`).not.toBe(COMING_SOON_URL);
    }
  });
});
