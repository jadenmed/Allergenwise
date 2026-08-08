/**
 * tests/integration/purge-stale-pending-certs-cron.test.ts
 *
 * Wave 2C — daily cron deletes pending certs older than the configured TTL
 * (default 14 days; env override PENDING_CERT_TTL_DAYS). Cascade-deletes
 * cert_warnings and writes a `cert_purged` activity event per cert.
 *
 * Does NOT touch:
 *   - pending certs younger than TTL
 *   - active / expired / revoked / disputed certs (any age)
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
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

function makeServiceClient(): SupabaseClient {
  return createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

const ts = `wave3-prg-${Date.now()}`;
const restId = '55555555-5555-5555-5555-' + Date.now().toString().padStart(12, '0').slice(-12);
const learnerEmail = `${ts}-learner@example.test`;
let learnerId: string;
let db: SupabaseClient;

async function insertCert(opts: {
  certCode: string;
  status: string;
  issuedAtIso?: string;
  expiresAtIso?: string;
}) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const row: any = {
    cert_code: opts.certCode,
    profile_id: learnerId,
    restaurant_id: restId,
    expires_at: opts.expiresAtIso ?? new Date(Date.now() + 365 * 86_400_000).toISOString(),
    status: opts.status,
  };
  if (opts.issuedAtIso) row.issued_at = opts.issuedAtIso;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (db as any).from('certificates').insert(row).select('id').single();
  if (error) throw new Error(`insertCert: ${error.message}`);
  return (data as { id: string }).id;
}

async function certExists(id: string): Promise<boolean> {
  const { data } = await db.from('certificates').select('id').eq('id', id).maybeSingle();
  return Boolean(data);
}

async function activityEventsByType(type: string) {
  const { data } = await db
    .from('activity_events')
    .select('type, payload, created_at')
    .eq('type', type)
    .order('created_at', { ascending: false })
    .limit(20);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data ?? []) as Array<{ type: string; payload: any; created_at: string }>;
}

async function deleteAllCerts() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (db as any).from('certificates').delete().eq('restaurant_id', restId);
}

function makeRequest() {
  return new NextRequest('http://localhost:3000/api/cron/purge-stale-pending-certs', {
    headers: {
      authorization: `Bearer ${process.env.CRON_SECRET ?? 'placeholder_cron_secret_build_only'}`,
    },
  });
}

describe.skipIf(!hasLocalSupabase())('cron/purge-stale-pending-certs — Wave 2C', () => {
  beforeAll(async () => {
    db = makeServiceClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (db as any).from('restaurants').insert({
      id: restId,
      slug: `${ts}-${restId.slice(0, 8)}`,
      name: 'Purge Test Restaurant',
      status: 'unlisted',
    });
    const { data: authData, error: authErr } = await db.auth.admin.createUser({
      email: learnerEmail,
      password: 'PrgPass!1234',
      email_confirm: true,
    });
    if (authErr || !authData.user) throw new Error(`auth: ${authErr?.message}`);
    learnerId = authData.user.id;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (db as any).from('profiles').upsert({
      id: learnerId,
      full_name: 'Prg Learner',
      email: learnerEmail,
      role: 'learner',
      restaurant_id: restId,
    });
  }, 30000);

  afterAll(async () => {
    if (!hasLocalSupabase()) return;
    // T-30: scoped by this run's token and re-resolved from the database. The
    // cron route under test writes cert_purged activity_events of its own; those
    // are part of the scope now, which is what previously blocked the
    // restaurants delete.
    const { errors } = await purgeFixtures(db, ts);
    if (errors.length > 0) console.error('[purge-stale-pending-certs-cron] teardown:', errors);
  });

  beforeEach(async () => {
    await deleteAllCerts();
    delete process.env.PENDING_CERT_TTL_DAYS;

    // T-19a — the ROUTE authorises against process.env.CRON_SECRET, while
    // makeRequest() above falls back to this same literal when the variable is
    // unset. Before this line the two disagreed whenever nothing supplied the
    // variable: the suite passed locally only because .env.local happened to
    // have one, and CI failed with 401 (expected 200). Self-provisioning makes
    // the suite independent of the ambient environment — the same thing
    // expire-certs-cron.test.ts:133 already does.
    //
    // `??` rather than `=`, so a real value still wins and this cannot mask a
    // genuine mismatch. The 401 test below is unaffected: it sends no header.
    process.env.CRON_SECRET = process.env.CRON_SECRET ?? 'placeholder_cron_secret_build_only';
  });

  it('deletes pending certs older than 14 days (default TTL)', async () => {
    const old = new Date(Date.now() - 15 * 86_400_000).toISOString();
    const cOld = await insertCert({
      certCode: generateCertCode(),
      status: 'pending',
      issuedAtIso: old,
    });

    const { GET } = await import('@/app/api/cron/purge-stale-pending-certs/route');
    const res = await GET(makeRequest());
    expect(res.status).toBe(200);

    expect(await certExists(cOld)).toBe(false);

    const purged = await activityEventsByType('cert_purged');
    expect(purged.find((e) => e.payload.certificate_id === cOld)).toBeDefined();
  });

  it('does NOT delete pending certs younger than 14 days', async () => {
    const fresh = new Date(Date.now() - 5 * 86_400_000).toISOString();
    const cFresh = await insertCert({
      certCode: generateCertCode(),
      status: 'pending',
      issuedAtIso: fresh,
    });

    const { GET } = await import('@/app/api/cron/purge-stale-pending-certs/route');
    await GET(makeRequest());

    expect(await certExists(cFresh)).toBe(true);
  });

  it('does NOT delete active / expired / revoked / disputed (any age)', async () => {
    const old = new Date(Date.now() - 90 * 86_400_000).toISOString();
    const cA = await insertCert({
      certCode: generateCertCode(),
      status: 'active',
      issuedAtIso: old,
    });
    const cE = await insertCert({
      certCode: generateCertCode(),
      status: 'expired',
      issuedAtIso: old,
    });
    const cR = await insertCert({
      certCode: generateCertCode(),
      status: 'revoked',
      issuedAtIso: old,
    });
    const cD = await insertCert({
      certCode: generateCertCode(),
      status: 'disputed',
      issuedAtIso: old,
    });

    const { GET } = await import('@/app/api/cron/purge-stale-pending-certs/route');
    await GET(makeRequest());

    for (const cid of [cA, cE, cR, cD]) {
      expect(await certExists(cid)).toBe(true);
    }
  });

  it('respects PENDING_CERT_TTL_DAYS env override (set to 30)', async () => {
    process.env.PENDING_CERT_TTL_DAYS = '30';
    const twentyDays = new Date(Date.now() - 20 * 86_400_000).toISOString();
    const c20 = await insertCert({
      certCode: generateCertCode(),
      status: 'pending',
      issuedAtIso: twentyDays,
    });

    const { GET } = await import('@/app/api/cron/purge-stale-pending-certs/route');
    await GET(makeRequest());

    expect(await certExists(c20)).toBe(true); // 20 < 30, kept
  });

  it('rejects requests without the CRON_SECRET bearer', async () => {
    const { GET } = await import('@/app/api/cron/purge-stale-pending-certs/route');
    const req = new NextRequest('http://localhost:3000/api/cron/purge-stale-pending-certs', {
      headers: {},
    });
    const res = await GET(req);
    expect(res.status).toBe(401);
  });
});
