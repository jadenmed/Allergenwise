/**
 * tests/e2e/f-s6-admin-photo-upload.spec.ts
 *
 * F-S6 / Wave 2A.5 — full admin photo upload flow.
 *
 * Drives the API contract end-to-end: log in as admin, POST a real JPEG
 * with embedded EXIF to /api/admin/upload-photo, assert 200 + a storage
 * path, then read the uploaded blob back via service-role client and
 * confirm the EXIF block is gone.
 *
 * Browser-side actions (UI navigation + setInputFiles) are intentionally
 * not used. The contract under test is the route, which SubmitClient.tsx
 * fetches into. UI-level testing of SubmitClient itself is covered by the
 * existing pilot loop's submission step.
 */

import { test, expect, request as playwrightRequest } from '@playwright/test';
import { purgeFixtures } from '../helpers/fixture-cleanup';
import { createClient } from '@supabase/supabase-js';
import sharp from 'sharp';
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

// T-30: module scope, not assigned inside the seed test.
const ts = `f-s6-${Date.now()}`;

test.describe('F-S6 — admin photo upload route', () => {
  test.describe.configure({ mode: 'serial' });

  test.afterAll(async () => {
    if (!hasLocalSupabase()) return;
    const { errors } = await purgeFixtures(makeServiceClient(), ts);
    if (errors.length > 0) console.error('[f-s6-admin-photo-upload] teardown:', errors);
  });

  let adminEmail: string;
  let adminPassword: string;
  let restaurantId: string;
  let inputBufferBytes: number;
  let storagePath: string;

  test('seed admin + restaurant', async () => {
    if (!hasLocalSupabase()) {
      test.skip(true, 'No local Supabase');
      return;
    }
    adminEmail = `${ts}-admin@example.test`;
    adminPassword = 'FS6Password!1234';

    const svc = makeServiceClient();
    const { data: auth, error: authErr } = await svc.auth.admin.createUser({
      email: adminEmail,
      password: adminPassword,
      email_confirm: true,
      user_metadata: { full_name: 'F-S6 Admin' },
    });
    expect(authErr).toBeNull();
    const adminId = auth.user!.id;

    const { data: rest, error: restErr } = await svc
      .from('restaurants')
      .insert({
        slug: `f-s6-bistro-${ts}`,
        name: `F-S6 Bistro ${ts}`,
        address: '1 F-S6 Way',
        city: 'San Diego',
        state: 'CA',
        zip: '92101',
        phone: '619-555-0500',
        cuisine: 'american',
        status: 'unlisted',
      })
      .select('id')
      .single();
    expect(restErr).toBeNull();
    restaurantId = (rest as { id: string }).id;

    const { error: profErr } = await svc.from('profiles').insert({
      id: adminId,
      full_name: 'F-S6 Admin',
      email: adminEmail,
      role: 'manager',
      restaurant_id: restaurantId,
      accepted_at: new Date().toISOString(),
    });
    expect(profErr).toBeNull();
  });

  test('admin login → POST /api/admin/upload-photo with EXIF JPEG → 200, EXIF stripped, blob in Storage', async ({
    request,
  }) => {
    if (!hasLocalSupabase()) return;

    const loginRes = await request.post('/api/auth/login', {
      data: { email: adminEmail, password: adminPassword },
    });
    expect(loginRes.status()).toBe(200);

    // Build a JPEG with embedded EXIF
    const inputBuf = await sharp({
      create: { width: 64, height: 64, channels: 3, background: { r: 200, g: 100, b: 50 } },
    })
      .withMetadata({
        exif: {
          IFD0: {
            ImageDescription: 'sensitive description with location data',
            Make: 'F-S6 Cam',
            Model: 'F-S6 Model',
          },
        },
      })
      .jpeg()
      .toBuffer();
    const inputMeta = await sharp(inputBuf).metadata();
    expect(inputMeta.exif, 'fixture must have EXIF before upload').toBeTruthy();
    inputBufferBytes = inputBuf.length;

    // Build the multipart request via Playwright's `multipart` helper
    const res = await request.post('/api/admin/upload-photo', {
      multipart: {
        photo: { name: 'photo.jpg', mimeType: 'image/jpeg', buffer: inputBuf },
      },
    });

    expect(res.status()).toBe(200);
    const body = (await res.json()) as { storagePath: string; contentType: string; bytes: number };
    expect(body.storagePath).toMatch(new RegExp(`^${restaurantId}/`));
    expect(body.contentType).toBe('image/jpeg');
    expect(body.bytes).toBeGreaterThan(0);
    storagePath = body.storagePath;

    // Read the uploaded blob back via service-role
    const svc = makeServiceClient();
    const { data: dl, error: dlErr } = await svc.storage
      .from('restaurant-photos')
      .download(storagePath);
    expect(dlErr).toBeNull();
    expect(dl).toBeTruthy();
    const downloadedBytes = Buffer.from(await dl!.arrayBuffer());

    const outMeta = await sharp(downloadedBytes).metadata();
    expect(outMeta.format).toBe('jpeg');
    expect(outMeta.exif, 'uploaded blob must have EXIF stripped').toBeUndefined();
  });

  test('non-admin (curl-style direct POST without admin role) → 403', async ({ baseURL }) => {
    if (!hasLocalSupabase()) return;

    // Seed a learner profile + log in as them
    // T-30: derived from the module-scope token so teardown reaches this
    // learner too — it previously minted its own unrelated timestamp.
    const learnerEmail = `f-s6-learner-${ts}@example.test`;
    const learnerPassword = 'LearnerFS6!1234';

    const svc = makeServiceClient();
    const { data: auth } = await svc.auth.admin.createUser({
      email: learnerEmail,
      password: learnerPassword,
      email_confirm: true,
      user_metadata: { full_name: 'F-S6 Learner' },
    });
    await svc.from('profiles').insert({
      id: auth.user!.id,
      full_name: 'F-S6 Learner',
      email: learnerEmail,
      role: 'learner',
      restaurant_id: restaurantId,
      accepted_at: new Date().toISOString(),
    });

    // Fresh context so admin cookies from earlier test don't leak in
    const learnerApi = await playwrightRequest.newContext({ baseURL: baseURL! });
    try {
      const loginRes = await learnerApi.post('/api/auth/login', {
        data: { email: learnerEmail, password: learnerPassword },
      });
      expect(loginRes.status()).toBe(200);

      const tinyJpeg = await sharp({
        create: { width: 8, height: 8, channels: 3, background: { r: 0, g: 0, b: 0 } },
      })
        .jpeg()
        .toBuffer();

      const res = await learnerApi.post('/api/admin/upload-photo', {
        multipart: {
          photo: { name: 'p.jpg', mimeType: 'image/jpeg', buffer: tinyJpeg },
        },
      });
      expect(res.status()).toBe(403);
    } finally {
      await learnerApi.dispose();
    }
  });
});
