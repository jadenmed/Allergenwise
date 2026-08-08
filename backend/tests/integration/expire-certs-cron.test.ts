/**
 * tests/integration/expire-certs-cron.test.ts
 *
 * Wave 2C — the expire-certs cron must (a) flip status active → expired for
 * any cert whose expires_at < now and (b) leave pending/revoked/disputed
 * untouched. The pre-existing warning-email behaviour for upcoming expiries
 * is preserved.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { purgeFixtures } from '../helpers/fixture-cleanup';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { NextRequest } from 'next/server';
import { config } from 'dotenv';
import { generateCertCode } from '@/lib/learner/cert-code';
import { hasLocalSupabase } from '../helpers/local-db';

config({ path: '.env.local' });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
// T-25 — the gate below asks whether the target database is on THIS machine,
// not merely whether the vars are set. tests/helpers/local-db.ts is the one
// definition; it reads locality from tests/env-guard.ts, so "local" means the
// same thing here, in vitest.config.ts and in playwright.config.ts.

vi.mock('@/lib/email/send', () => ({
  sendEmail: vi.fn().mockResolvedValue({ ok: true }),
}));

function makeServiceClient(): SupabaseClient {
  return createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

const ts = `wave3-exp-${Date.now()}`;
const restId = '44444444-4444-4444-4444-' + Date.now().toString().padStart(12, '0').slice(-12);
const learnerEmail = `${ts}-learner@example.test`;
let learnerId: string;
let db: SupabaseClient;

async function insertCert(opts: { certCode: string; status: string; expiresAtIso: string }) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (db as any)
    .from('certificates')
    .insert({
      cert_code: opts.certCode,
      profile_id: learnerId,
      restaurant_id: restId,
      expires_at: opts.expiresAtIso,
      status: opts.status,
    })
    .select('id')
    .single();
  if (error) throw new Error(`insertCert: ${error.message}`);
  return (data as { id: string }).id;
}

async function getCert(id: string) {
  const { data, error } = await db.from('certificates').select('id, status').eq('id', id).single();
  if (error) throw new Error(`getCert: ${error.message}`);
  return data as { id: string; status: string };
}

async function deleteAllCerts() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (db as any).from('certificates').delete().eq('restaurant_id', restId);
}

function makeRequest() {
  return new NextRequest('http://localhost:3000/api/cron/expire-certs', {
    headers: {
      authorization: `Bearer ${process.env.CRON_SECRET ?? 'placeholder_cron_secret_build_only'}`,
    },
  });
}

describe.skipIf(!hasLocalSupabase())('cron/expire-certs — Wave 2C status flip', () => {
  beforeAll(async () => {
    db = makeServiceClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (db as any).from('restaurants').insert({
      id: restId,
      slug: `${ts}-${restId.slice(0, 8)}`,
      name: 'Expire Test Restaurant',
      status: 'unlisted',
    });
    const { data: authData, error: authErr } = await db.auth.admin.createUser({
      email: learnerEmail,
      password: 'ExpPassword!1234',
      email_confirm: true,
    });
    if (authErr || !authData.user) throw new Error(`auth: ${authErr?.message}`);
    learnerId = authData.user.id;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (db as any).from('profiles').upsert({
      id: learnerId,
      full_name: 'Exp Learner',
      email: learnerEmail,
      role: 'learner',
      restaurant_id: restId,
    });
  }, 30000);

  afterAll(async () => {
    if (!hasLocalSupabase()) return;
    // T-30: scoped by this run's token and re-resolved from the database. The
    // cron route under test writes activity_events of its own; those are part of
    // the scope now, which is what previously blocked the restaurants delete.
    const { errors } = await purgeFixtures(db, ts);
    if (errors.length > 0) console.error('[expire-certs-cron] teardown:', errors);
  });

  beforeEach(async () => {
    await deleteAllCerts();
  });

  it('flips status=active → expired when expires_at < now', async () => {
    const past = new Date(Date.now() - 86_400_000).toISOString();
    const c1 = await insertCert({
      certCode: generateCertCode(),
      status: 'active',
      expiresAtIso: past,
    });
    const c2 = await insertCert({
      certCode: generateCertCode(),
      status: 'active',
      expiresAtIso: past,
    });

    const { GET } = await import('@/app/api/cron/expire-certs/route');
    process.env.CRON_SECRET = process.env.CRON_SECRET ?? 'placeholder_cron_secret_build_only';
    const res = await GET(makeRequest());
    expect(res.status).toBe(200);

    expect((await getCert(c1)).status).toBe('expired');
    expect((await getCert(c2)).status).toBe('expired');
  });

  it('does NOT touch pending / revoked / disputed certs', async () => {
    const past = new Date(Date.now() - 86_400_000).toISOString();
    const cP = await insertCert({
      certCode: generateCertCode(),
      status: 'pending',
      expiresAtIso: past,
    });
    const cR = await insertCert({
      certCode: generateCertCode(),
      status: 'revoked',
      expiresAtIso: past,
    });
    const cD = await insertCert({
      certCode: generateCertCode(),
      status: 'disputed',
      expiresAtIso: past,
    });

    const { GET } = await import('@/app/api/cron/expire-certs/route');
    await GET(makeRequest());

    expect((await getCert(cP)).status).toBe('pending');
    expect((await getCert(cR)).status).toBe('revoked');
    expect((await getCert(cD)).status).toBe('disputed');
  });

  it('does NOT flip active certs whose expires_at is still in the future', async () => {
    const future = new Date(Date.now() + 30 * 86_400_000).toISOString();
    const cA = await insertCert({
      certCode: generateCertCode(),
      status: 'active',
      expiresAtIso: future,
    });

    const { GET } = await import('@/app/api/cron/expire-certs/route');
    await GET(makeRequest());

    expect((await getCert(cA)).status).toBe('active');
  });

  it('idempotent — re-running on the same DB does not re-flip already-expired certs', async () => {
    const past = new Date(Date.now() - 86_400_000).toISOString();
    const c1 = await insertCert({
      certCode: generateCertCode(),
      status: 'active',
      expiresAtIso: past,
    });

    const { GET } = await import('@/app/api/cron/expire-certs/route');
    await GET(makeRequest());
    expect((await getCert(c1)).status).toBe('expired');
    await GET(makeRequest()); // second run — must not throw
    expect((await getCert(c1)).status).toBe('expired');
  });
});
