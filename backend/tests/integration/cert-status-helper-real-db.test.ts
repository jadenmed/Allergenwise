/**
 * tests/integration/cert-status-helper-real-db.test.ts
 *
 * Wave 2C — exercises lib/learner/cert-status.ts helpers against the real
 * local Supabase. Seeds mixed-status certs and asserts query correctness.
 *
 * No mocks. Same standard as Wave 2A's RLS tests.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { purgeFixtures } from '../helpers/fixture-cleanup';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import {
  countPubliclyActiveCerts,
  getLatestActiveCertForLearner,
  getAllCertsForLearner,
} from '@/lib/learner/cert-status';
import type { ServiceDb } from '@/lib/db/service';
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

const ts = `wave3-cs-${Date.now()}`;
const restAId = '11111111-1111-1111-1111-' + Date.now().toString().padStart(12, '0').slice(-12);
const restBId = '22222222-2222-2222-2222-' + Date.now().toString().padStart(12, '0').slice(-12);
const learnerEmail = `${ts}-learner@example.test`;
const learnerPassword = 'CSPassword!1234';
let learnerId: string;

// Wave 4B CHECK constraint requires `AW-XXXXX-XXXXX-C` format. Generate
// valid codes; descriptive labels live in CODE_LABELS for assertions.
const CODES = {
  A_ACTIVE_1: generateCertCode(),
  A_ACTIVE_2: generateCertCode(),
  A_PENDING: generateCertCode(),
  A_EXPIRED: generateCertCode(),
  A_REVOKED: generateCertCode(),
  A_DISPUTED: generateCertCode(),
  B_ACTIVE_1: generateCertCode(),
};
const ACTIVE_CODES = new Set([CODES.A_ACTIVE_1, CODES.A_ACTIVE_2, CODES.B_ACTIVE_1]);

describe.skipIf(!hasLocalSupabase())('cert-status helpers — real DB', () => {
  let db: SupabaseClient;
  let serviceDb: ServiceDb;

  beforeAll(async () => {
    db = makeServiceClient();
    // Cast to the project's ServiceDb shape — same client, just narrower API.
    serviceDb = db as unknown as ServiceDb;

    // Insert 2 restaurants
    for (const id of [restAId, restBId]) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (db as any).from('restaurants').insert({
        id,
        slug: `${ts}-${id.slice(0, 8)}`,
        name: `Test Restaurant ${id.slice(0, 4)}`,
        status: 'unlisted',
      });
    }

    // Create one auth user as the learner
    const { data: authData, error: authErr } = await db.auth.admin.createUser({
      email: learnerEmail,
      password: learnerPassword,
      email_confirm: true,
    });
    if (authErr || !authData.user) throw new Error(`auth create: ${authErr?.message}`);
    learnerId = authData.user.id;

    // Insert profile linked to restaurant A
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (db as any).from('profiles').upsert({
      id: learnerId,
      full_name: 'CS Test Learner',
      email: learnerEmail,
      role: 'learner',
      restaurant_id: restAId,
    });

    const expiresFuture = new Date(Date.now() + 30 * 86_400_000).toISOString();
    const expiresPast = new Date(Date.now() - 1 * 86_400_000).toISOString();

    // Seed certs in every state for restaurant A + the same learner
    const seedRows = [
      {
        cert_code: CODES.A_ACTIVE_1,
        status: 'active',
        expires_at: expiresFuture,
        restaurant_id: restAId,
      },
      {
        cert_code: CODES.A_ACTIVE_2,
        status: 'active',
        expires_at: expiresFuture,
        restaurant_id: restAId,
      },
      {
        cert_code: CODES.A_PENDING,
        status: 'pending',
        expires_at: expiresFuture,
        restaurant_id: restAId,
      },
      {
        cert_code: CODES.A_EXPIRED,
        status: 'expired',
        expires_at: expiresPast,
        restaurant_id: restAId,
      },
      {
        cert_code: CODES.A_REVOKED,
        status: 'revoked',
        expires_at: expiresFuture,
        restaurant_id: restAId,
        revocation_reason: 'admin',
      },
      {
        cert_code: CODES.A_DISPUTED,
        status: 'disputed',
        expires_at: expiresFuture,
        restaurant_id: restAId,
        dispute_id: 'dp_test',
      },
      {
        cert_code: CODES.B_ACTIVE_1,
        status: 'active',
        expires_at: expiresFuture,
        restaurant_id: restBId,
      },
    ];

    for (const r of seedRows) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (db as any).from('certificates').insert({
        cert_code: r.cert_code,
        profile_id: learnerId,
        restaurant_id: r.restaurant_id,
        expires_at: r.expires_at,
        status: r.status,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ...((r as any).revocation_reason !== undefined
          ? { revocation_reason: (r as any).revocation_reason }
          : {}),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ...((r as any).dispute_id !== undefined ? { dispute_id: (r as any).dispute_id } : {}),
      });
      if (error) throw new Error(`seed ${r.cert_code}: ${error.message}`);
    }
  }, 30000);

  afterAll(async () => {
    if (!hasLocalSupabase()) return;
    // T-30: scoped by this run's token and re-resolved from the database, so it
    // still cleans up when beforeAll threw before learnerId/restAId/restBId were
    // set. Both restaurants share the `${ts}-` slug prefix, so both are reached.
    const { errors } = await purgeFixtures(db, ts);
    if (errors.length > 0) console.error('[cert-status-helper-real-db] teardown:', errors);
  });

  // ── countPubliclyActiveCerts ───────────────────────────────────────────────

  it('countPubliclyActiveCerts returns 2 for restaurant A (only active counted)', async () => {
    const n = await countPubliclyActiveCerts(serviceDb, restAId);
    expect(n).toBe(2);
  });

  it('countPubliclyActiveCerts returns 1 for restaurant B (other restaurants excluded)', async () => {
    const n = await countPubliclyActiveCerts(serviceDb, restBId);
    expect(n).toBe(1);
  });

  it('countPubliclyActiveCerts returns 0 for an unknown restaurant', async () => {
    const n = await countPubliclyActiveCerts(serviceDb, '00000000-0000-0000-0000-000000000000');
    expect(n).toBe(0);
  });

  it('countPubliclyActiveCerts excludes pending/expired/revoked/disputed', async () => {
    // Restaurant A has 6 certs total but only 2 active
    const n = await countPubliclyActiveCerts(serviceDb, restAId);
    expect(n).toBe(2);
  });

  // ── getLatestActiveCertForLearner ──────────────────────────────────────────

  it('getLatestActiveCertForLearner returns an active cert (most recent across restaurants)', async () => {
    const cert = await getLatestActiveCertForLearner(serviceDb, learnerId);
    expect(cert).not.toBeNull();
    // Must be one of the active certs we seeded (never the pending/expired/revoked/disputed)
    expect(ACTIVE_CODES.has(cert!.cert_code)).toBe(true);
  });

  it('getLatestActiveCertForLearner returns null for unknown learner', async () => {
    const cert = await getLatestActiveCertForLearner(
      serviceDb,
      '00000000-0000-0000-0000-000000000000'
    );
    expect(cert).toBeNull();
  });

  // ── getAllCertsForLearner ──────────────────────────────────────────────────

  it('getAllCertsForLearner returns all certs (every state)', async () => {
    const all = await getAllCertsForLearner(serviceDb, learnerId);
    expect(all.length).toBe(7);
    const states = new Set(all.map((c) => c.status));
    expect(states).toContain('active');
    expect(states).toContain('pending');
    expect(states).toContain('expired');
    expect(states).toContain('revoked');
    expect(states).toContain('disputed');
  });

  it('getAllCertsForLearner returns sorted by issued_at desc', async () => {
    const all = await getAllCertsForLearner(serviceDb, learnerId);
    for (let i = 1; i < all.length; i++) {
      expect(new Date(all[i - 1]!.issued_at).getTime()).toBeGreaterThanOrEqual(
        new Date(all[i]!.issued_at).getTime()
      );
    }
  });
});
