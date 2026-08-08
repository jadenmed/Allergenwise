/**
 * tests/e2e/f-s1-route-layer-expired-listing.spec.ts
 *
 * Locks in F-S1's APP-LAYER fix at the route layer, independent of RLS state.
 *
 * Background: F-S1 dropped the `restaurants_public_read_listed using(status='listed')`
 * RLS policy (Wave 2A migration 0011). The public directory + search routes already
 * filter `listing_expires_at > now()` in addition to status='listed'. This spec
 * confirms that filter is doing its job: a restaurant whose status='listed' but
 * whose listing_expires_at is in the past must NOT be reachable via:
 *   - GET /api/directory/[slug]   → not-found shape
 *   - GET /api/search?q=...        → does not include the expired row
 *
 * This is regression-protection at the route layer, separate from the RLS test
 * in tests/integration/rls-hardening.test.ts which protects against direct
 * anon-key Supabase calls bypassing the route altogether.
 */

import { test, expect } from '@playwright/test';
import { purgeFixtures } from '../helpers/fixture-cleanup';
import { createClient } from '@supabase/supabase-js';
import { hasLocalSupabase } from '../helpers/local-db';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

// T-25 — the gate below asks whether the target database is on THIS machine,
// not merely whether the vars are set. tests/helpers/local-db.ts is the one
// definition; it reads locality from tests/env-guard.ts, so "local" means the
// same thing here, in vitest.config.ts and in playwright.config.ts.
//
// Supersedes the inline T-27 composition this file used to carry: same
// locality check, one copy instead of five, and it now covers DATABASE_URL as
// well as the REST URL.

function makeServiceClient() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// T-30: module scope, not assigned inside the seed test. The seed step can fail
// or time out before it ever runs, and that is exactly the run that leaves the
// most behind — teardown has to know the token regardless.
const ts = `fs1-route-${Date.now()}`;

test.describe('F-S1 route-layer — expired listing not reachable via public APIs', () => {
  test.describe.configure({ mode: 'serial' });

  test.afterAll(async () => {
    if (!hasLocalSupabase()) return;
    const { errors } = await purgeFixtures(makeServiceClient(), ts);
    if (errors.length > 0) console.error('[f-s1-route-layer] teardown:', errors);
  });

  let expiredSlug: string;
  let activeSlug: string;
  let restaurantId: string;

  test('seed an expired-listing restaurant and a control active-listing restaurant', async () => {
    if (!hasLocalSupabase()) {
      test.skip(true, 'No local Supabase');
      return;
    }

    expiredSlug = `fs1-expired-${ts}`;
    activeSlug = `fs1-active-${ts}`;

    const db = makeServiceClient();

    // Expired listing — past listing_expires_at, but status still 'listed'.
    const yearAgo = new Date(Date.now() - 365 * 86400_000).toISOString();
    const yesterday = new Date(Date.now() - 86400_000).toISOString();
    const { data: expRow, error: expErr } = await db
      .from('restaurants')
      .insert({
        slug: expiredSlug,
        name: `Expired Bistro ${ts}`,
        address: '1 Past Way',
        city: 'San Diego',
        state: 'CA',
        zip: '92101',
        phone: '619-555-0300',
        cuisine: 'american',
        status: 'listed',
        listed_at: yearAgo,
        listing_expires_at: yesterday,
      })
      .select('id')
      .single();
    expect(expErr).toBeNull();
    restaurantId = (expRow as { id: string }).id;

    // Active control — status='listed' AND listing_expires_at far in future.
    const futureExpiry = new Date(Date.now() + 30 * 86400_000).toISOString();
    const recentListed = new Date(Date.now() - 86400_000).toISOString();
    const { error: activeErr } = await db.from('restaurants').insert({
      slug: activeSlug,
      name: `Active Bistro ${ts}`,
      address: '1 Future St',
      city: 'San Diego',
      state: 'CA',
      zip: '92101',
      phone: '619-555-0301',
      cuisine: 'american',
      status: 'listed',
      listed_at: recentListed,
      listing_expires_at: futureExpiry,
    });
    expect(activeErr).toBeNull();
  });

  test('GET /api/directory/[expired-slug] returns 404 not-found', async ({ request }) => {
    if (!hasLocalSupabase()) return;
    const res = await request.get(`/api/directory/${expiredSlug}`);
    const body = (await res.json()) as Record<string, unknown>;

    // Route filters listing_expires_at > now() — expired row matches no record.
    expect(res.status()).toBe(404);
    expect(body.error).toBe('Not found');
  });

  test('GET /api/directory/[active-slug] returns 200 (control: filter does not over-exclude)', async ({
    request,
  }) => {
    if (!hasLocalSupabase()) return;
    const res = await request.get(`/api/directory/${activeSlug}`);
    expect(res.status()).toBe(200);
    const body = (await res.json()) as { slug: string };
    expect(body.slug).toBe(activeSlug);
  });

  test('GET /api/search does NOT include the expired-listing restaurant', async ({ request }) => {
    if (!hasLocalSupabase()) return;
    // Search by a term that matches both restaurants' names ("Bistro <ts>")
    const res = await request.get(`/api/search?q=${encodeURIComponent(`Bistro ${ts}`)}`);
    expect(res.status()).toBe(200);
    // /api/search returns a top-level array of result rows
    const results = (await res.json()) as Array<{ slug: string }>;

    const slugs = (results ?? []).map((r) => r.slug);
    expect(slugs).not.toContain(expiredSlug);
    expect(slugs).toContain(activeSlug);
  });
});
