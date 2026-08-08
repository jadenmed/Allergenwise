/**
 * tests/integration/verify-endpoint-states.test.ts
 *
 * Wave 2C — verify endpoint must reflect the 5-state cert machine:
 *
 *   pending  → not_found (treated as if cert does not exist publicly)
 *   active   → active 4-field response
 *   expired  → expired 4-field response
 *   revoked  → revoked 4-field response
 *   disputed → revoked 4-field response (intentional public masking)
 *
 * Public response leak rules per CLAUDE.md non-negotiables — assert NO PII,
 * NO restaurant address/lat/lng/phone, NO internal UUIDs.
 */

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { purgeFixtures } from '../helpers/fixture-cleanup';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { NextRequest } from 'next/server';
import { config } from 'dotenv';
import { generateCertCode } from '@/lib/learner/cert-code';
import { _resetForTests as resetRateLimit } from '@/lib/security/rate-limit';
import { hasLocalSupabase } from '../helpers/local-db';

// Mock @upstash so the rate-limit guard always passes; these tests assert
// post-limiter behavior against a real Supabase.
vi.mock('@upstash/ratelimit', () => ({
  Ratelimit: class {
    static slidingWindow() {
      return {};
    }
    limit = vi.fn().mockResolvedValue({
      success: true,
      remaining: 100,
      reset: Date.now() + 60_000,
      limit: 100,
    });
  },
}));
vi.mock('@upstash/redis', () => ({
  Redis: class {
    constructor() {}
  },
}));

config({ path: '.env.local' });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
// T-25 — the gate below asks whether the target database is on THIS machine,
// not merely whether the vars are set. tests/helpers/local-db.ts is the one
// definition; it reads locality from tests/env-guard.ts, so "local" means the
// same thing here, in vitest.config.ts and in playwright.config.ts.

function makeServiceClient(): SupabaseClient {
  return createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

const ts = `WAVE3-VFY-${Date.now()}`;
const restId = '66666666-6666-6666-6666-' + Date.now().toString().padStart(12, '0').slice(-12);
const restName = 'Verify Test Bistro';
const learnerEmail = `${ts}-learner@example.test`;
let learnerId: string;
let db: SupabaseClient;

async function insertCert(opts: { certCode: string; status: string; expiresAtIso?: string }) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (db as any)
    .from('certificates')
    .insert({
      cert_code: opts.certCode,
      profile_id: learnerId,
      restaurant_id: restId,
      expires_at: opts.expiresAtIso ?? new Date(Date.now() + 365 * 86_400_000).toISOString(),
      status: opts.status,
    })
    .select('id, cert_code')
    .single();
  if (error) throw new Error(`insertCert: ${error.message}`);
  return data as { id: string; cert_code: string };
}

async function deleteAllCerts() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (db as any).from('certificates').delete().eq('restaurant_id', restId);
}

async function callVerify(certCode: string) {
  const { GET } = await import('@/app/api/certs/[certCode]/verify/route');
  const req = new NextRequest(`http://localhost:3000/api/certs/${certCode}/verify`);
  const res = await GET(req, { params: { certCode } });
  return await res.json();
}

describe.skipIf(!hasLocalSupabase())('verify endpoint — 5-state behaviour', () => {
  beforeAll(async () => {
    db = makeServiceClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (db as any).from('restaurants').insert({
      id: restId,
      slug: `${ts}-${restId.slice(0, 8)}`,
      name: restName,
      status: 'unlisted',
    });
    const { data: authData, error: authErr } = await db.auth.admin.createUser({
      email: learnerEmail,
      password: 'VfyPass!1234',
      email_confirm: true,
    });
    if (authErr || !authData.user) throw new Error(`auth: ${authErr?.message}`);
    learnerId = authData.user.id;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (db as any).from('profiles').upsert({
      id: learnerId,
      full_name: 'PII That Must Not Leak',
      email: learnerEmail,
      role: 'learner',
      restaurant_id: restId,
    });
  }, 30000);

  afterAll(async () => {
    if (!hasLocalSupabase()) return;
    // T-30: scoped by this run's token and re-resolved from the database. The
    // verify route logs an activity_event per call; those rows referenced this
    // restaurant and silently failed the restaurants delete on every run.
    const { errors } = await purgeFixtures(db, ts);
    if (errors.length > 0) console.error('[verify-endpoint-states] teardown:', errors);
  });

  beforeEach(async () => {
    await deleteAllCerts();
    resetRateLimit();
    process.env.KV_REST_API_URL = 'http://test-kv';
    process.env.KV_REST_API_TOKEN = 'test-kv-token';
    process.env.RATELIMIT_IP_PEPPER = 'test-pepper';
  });

  it('pending cert → not_found (invisible publicly)', async () => {
    const cert = await insertCert({ certCode: generateCertCode(), status: 'pending' });
    const body = await callVerify(cert.cert_code);
    expect(body.valid).toBe(false);
    expect(body.status).toBe('not_found');
    expect(body.restaurantName).toBeUndefined();
  });

  it('active cert → 4-field active response', async () => {
    const cert = await insertCert({ certCode: generateCertCode(), status: 'active' });
    const body = await callVerify(cert.cert_code);
    expect(body.valid).toBe(true);
    expect(body.status).toBe('active');
    expect(body.restaurantName).toBe(restName);
    expect(typeof body.issuedAt).toBe('string');
    expect(typeof body.expiresAt).toBe('string');
  });

  it('expired cert → 4-field expired response', async () => {
    const past = new Date(Date.now() - 5 * 86_400_000).toISOString();
    const cert = await insertCert({
      certCode: generateCertCode(),
      status: 'expired',
      expiresAtIso: past,
    });
    const body = await callVerify(cert.cert_code);
    expect(body.valid).toBe(false);
    expect(body.status).toBe('expired');
    expect(body.restaurantName).toBe(restName);
  });

  it('revoked cert → 4-field revoked response', async () => {
    const cert = await insertCert({ certCode: generateCertCode(), status: 'revoked' });
    const body = await callVerify(cert.cert_code);
    expect(body.valid).toBe(false);
    expect(body.status).toBe('revoked');
    expect(body.restaurantName).toBe(restName);
  });

  it('disputed cert → masked as revoked publicly', async () => {
    const cert = await insertCert({ certCode: generateCertCode(), status: 'disputed' });
    const body = await callVerify(cert.cert_code);
    expect(body.valid).toBe(false);
    expect(body.status, 'disputed must mask to revoked from the diner view').toBe('revoked');
    expect(body.restaurantName).toBe(restName);
  });

  it('response shape leaks no PII or extended restaurant fields', async () => {
    const cert = await insertCert({ certCode: generateCertCode(), status: 'active' });
    const body = await callVerify(cert.cert_code);
    const allowedKeys = new Set(['valid', 'status', 'restaurantName', 'issuedAt', 'expiresAt']);
    for (const key of Object.keys(body)) {
      expect(allowedKeys.has(key), `unexpected field in verify response: ${key}`).toBe(true);
    }
    // No PII names should ever appear in the body string
    const json = JSON.stringify(body);
    expect(json).not.toContain('PII That Must Not Leak');
  });

  it('unknown cert_code → not_found', async () => {
    const body = await callVerify('AW-9999-NONEXISTENT');
    expect(body.valid).toBe(false);
    expect(body.status).toBe('not_found');
  });
});
