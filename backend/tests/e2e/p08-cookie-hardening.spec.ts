/**
 * tests/e2e/p08-cookie-hardening.spec.ts
 *
 * P0 #8 regression — Supabase auth cookies must carry HttpOnly and SameSite,
 * plus Secure when NODE_ENV=production. Default `@supabase/ssr` cookie options
 * have `httpOnly: false`, which any XSS exfiltrates.
 *
 * The fix overrides the `setAll` cookie-options merge in:
 *   - lib/supabase/server.ts (server-component / route-handler context)
 *   - lib/supabase/middleware.ts (middleware context)
 *
 * Test: log in as a seeded admin, inspect raw Set-Cookie headers on the
 * /api/auth/login response. Every `sb-*-auth-token` cookie must include
 * `HttpOnly` and `SameSite=Lax|Strict`. In dev (NODE_ENV !== 'production')
 * the Secure flag is intentionally omitted so localhost auth works; in
 * prod it must be present.
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

// T-30: module scope, not assigned inside the seed test — the seed can fail
// before it runs, and that is the run that leaves the most behind.
const ts = `p08-${Date.now()}`;

test.describe('P0 #8 — auth cookie hardening', () => {
  test.describe.configure({ mode: 'serial' });

  test.afterAll(async () => {
    if (!hasLocalSupabase()) return;
    const svc = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { errors } = await purgeFixtures(svc, ts);
    if (errors.length > 0) console.error('[p08-cookie-hardening] teardown:', errors);
  });

  let adminEmail: string;
  let adminPassword: string;

  test('seed: admin auth user + profile + restaurant', async () => {
    if (!hasLocalSupabase()) {
      test.skip(true, 'No local Supabase');
      return;
    }

    adminEmail = `${ts}-admin@example.test`;
    adminPassword = 'P08Password!1234';

    const svc = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: auth, error: authErr } = await svc.auth.admin.createUser({
      email: adminEmail,
      password: adminPassword,
      email_confirm: true,
      user_metadata: { full_name: 'P08 Admin' },
    });
    expect(authErr).toBeNull();
    const adminId = auth.user!.id;

    const { data: rest } = await svc
      .from('restaurants')
      .insert({
        slug: `p08-bistro-${ts}`,
        name: `P08 Bistro ${ts}`,
        address: '1 P08 Way',
        city: 'San Diego',
        state: 'CA',
        zip: '92101',
        phone: '619-555-0400',
        cuisine: 'american',
        status: 'unlisted',
      })
      .select('id')
      .single();
    const restaurantId = (rest as { id: string }).id;

    await svc.from('profiles').insert({
      id: adminId,
      full_name: 'P08 Admin',
      email: adminEmail,
      role: 'manager',
      restaurant_id: restaurantId,
      accepted_at: new Date().toISOString(),
    });
  });

  test('login Set-Cookie headers carry HttpOnly + SameSite (and Secure in prod)', async ({
    request,
  }) => {
    if (!hasLocalSupabase()) return;

    const res = await request.post('/api/auth/login', {
      data: { email: adminEmail, password: adminPassword },
    });

    // Successful login (200) regardless of cookie hardening
    expect(res.status()).toBe(200);

    const headers = res.headersArray();
    const setCookies = headers
      .filter((h) => h.name.toLowerCase() === 'set-cookie')
      .map((h) => h.value);

    const authCookies = setCookies.filter((c) => /^sb-.*-auth-token/i.test(c));
    expect(
      authCookies.length,
      `expected at least one sb-*-auth-token Set-Cookie; got ${setCookies.length} cookies total`
    ).toBeGreaterThan(0);

    for (const c of authCookies) {
      // P0 #8 fix mandates HttpOnly
      expect(c, `cookie missing HttpOnly: ${c.slice(0, 60)}...`).toMatch(/HttpOnly/i);
      // SameSite must be set (Lax acceptable; Strict if it doesn't break flow)
      expect(c, `cookie missing SameSite: ${c.slice(0, 60)}...`).toMatch(/SameSite=(Lax|Strict)/i);

      if (process.env.NODE_ENV === 'production') {
        expect(c, `cookie missing Secure (prod): ${c.slice(0, 60)}...`).toMatch(/Secure/i);
      }
    }
  });
});
