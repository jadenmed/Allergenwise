/**
 * @vitest-environment node
 */
/**
 * tests/integration/search-count-parity.test.ts
 *
 * T-23 — /api/search publishes its certification counts through TWO
 * independent implementations, and this file is the only thing that makes them
 * agree:
 *
 *   SQL  lib/directory/search.ts — COUNT(DISTINCT ch.id) FILTER (…) over a join
 *   TS   app/api/search/route.ts — countDistinctCertifiedLearners over embedded
 *        rows fetched by PostgREST
 *
 * The route currently aggregates in TypeScript; buildSearchQuery is exported
 * for the cron and any future consumer. Two implementations of one public
 * number is how two public pages come to disagree about the same restaurant, so
 * they are pinned here against ONE fixture in a REAL database — not two sets of
 * expectations that can drift apart.
 *
 * The fixture is built to catch every way the two could differ:
 *   L1  current learner, TWO active certificates      → certified (once)
 *   L2  current learner, one active + one expired     → certified (once)
 *   L3  current learner, one PENDING certificate      → not certified
 *   L4  current learner, no certificates              → not certified
 *   L5  DEPARTED learner, one active certificate      → in neither count
 *   M1  manager, one active certificate               → in neither count
 *
 * Expected for that restaurant: 2 certified of 4 staff — 50%.
 *
 * Before this task both paths counted certificates rather than people, and
 * neither applied membership to the numerator — and they did not even agree
 * with each other, because the SQL denominator was missing T-46a's departed
 * filter that the TypeScript one applies.
 *
 * Skips cleanly when local Supabase or psql is unavailable, and says so loudly
 * rather than passing quietly.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { execFileSync } from 'node:child_process';
import { NextRequest } from 'next/server';
import { buildSearchQuery } from '@/lib/directory/search';
import { generateCertCode } from '@/lib/learner/cert-code';
import { hasLocalSupabase, hasLocalPostgres } from '../helpers/local-db';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

// T-25 — this suite is the only one that reaches the database BOTH ways: the
// TypeScript path goes through PostgREST, the SQL path shells out to psql on
// DATABASE_URL. It therefore has to satisfy both predicates. The old flag
// checked neither for locality, and DATABASE_URL defaulted to a hardcoded local
// string, so an unset variable read as proof rather than as an unknown.
const DATABASE_URL = process.env.DATABASE_URL ?? '';

function hasPsql(): boolean {
  try {
    execFileSync('psql', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const canRun = hasLocalSupabase() && hasLocalPostgres() && hasPsql();

// ─── Fixture identity ─────────────────────────────────────────────────────────

const ts = `t23-${Date.now()}`;
const MIXED = `${ts}-mixed`;
const ALL_CERTIFIED = `${ts}-all`;
const DUPLICATES = `${ts}-dupes`;

const YEAR_MS = 365 * 86_400_000;

interface Counts {
  certified: number;
  total: number;
}

let svc: SupabaseClient;
const createdProfileIds: string[] = [];
const createdRestaurantIds: string[] = [];

function makeServiceClient(): SupabaseClient {
  return createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function seedRestaurant(slug: string): Promise<string> {
  const { data, error } = await svc
    .from('restaurants')
    .insert({
      slug,
      name: `Parity ${slug}`,
      address: '1 Parity Way',
      city: 'Austin',
      state: 'TX',
      zip: '78701',
      phone: '512-555-0123',
      cuisine: 'american',
      status: 'listed',
      listed_at: new Date().toISOString(),
      listing_expires_at: new Date(Date.now() + YEAR_MS).toISOString(),
    })
    .select('id')
    .single();

  expect(error).toBeNull();
  const id = (data as { id: string }).id;
  createdRestaurantIds.push(id);
  return id;
}

async function seedPerson(opts: {
  restaurantId: string;
  label: string;
  role: 'learner' | 'manager';
  departed?: boolean;
}): Promise<string> {
  const email = `${ts}-${opts.label}@example.test`;
  const { data, error } = await svc.auth.admin.createUser({
    email,
    password: 'ParityPassword!1234',
    email_confirm: true,
  });
  expect(error).toBeNull();
  const id = data.user!.id;
  createdProfileIds.push(id);

  const { error: profileError } = await svc.from('profiles').insert({
    id,
    full_name: `Parity ${opts.label}`,
    email,
    role: opts.role,
    restaurant_id: opts.restaurantId,
    accepted_at: new Date().toISOString(),
    departed_at: opts.departed ? new Date().toISOString() : null,
  });
  expect(profileError).toBeNull();

  return id;
}

async function seedCert(opts: {
  profileId: string;
  restaurantId: string;
  status: 'active' | 'expired' | 'pending' | 'revoked';
}): Promise<void> {
  // `expires_at` stays in the future for every state: the status column is the
  // only thing these counts read, and an expired-by-date active row would make
  // the fixture ambiguous about which signal did the work.
  const { error } = await svc.from('certificates').insert({
    cert_code: generateCertCode(),
    profile_id: opts.profileId,
    restaurant_id: opts.restaurantId,
    status: opts.status,
    expires_at: new Date(Date.now() + YEAR_MS).toISOString(),
  });
  expect(error).toBeNull();
}

// ─── The two paths ────────────────────────────────────────────────────────────

/**
 * The SQL path: the text buildSearchQuery emits, run through psql.
 *
 * `mode: 'none'` with no filters binds no parameters, so the emitted text runs
 * as-is — the query under test is byte-for-byte what the builder produced, not
 * a hand-copied approximation of it.
 */
function sqlCounts(): Map<string, Counts> {
  const { text, params } = buildSearchQuery(
    { q: '', allergens: [], cuisine: '', lat: undefined, lng: undefined, radiusMi: 25 },
    'none'
  );
  expect(params, 'the unfiltered query binds no parameters').toEqual([]);

  const wrapped = `select slug, certified_count, total_employees from (${text}) parity where slug like '${ts}-%' order by slug`;

  const out = execFileSync('psql', [DATABASE_URL, '-At', '-F', '|', '-c', wrapped], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const counts = new Map<string, Counts>();
  for (const line of out.trim().split('\n')) {
    if (!line) continue;
    const [slug, certified, total] = line.split('|');
    counts.set(slug, { certified: Number(certified), total: Number(total) });
  }
  return counts;
}

/** The TypeScript path: the real route handler against the real database. */
async function tsCounts(): Promise<Map<string, Counts>> {
  const { GET } = await import('@/app/api/search/route');
  const res = await GET(new NextRequest('http://localhost/api/search'));
  expect(res.status).toBe(200);

  const body = (await res.json()) as Array<{
    slug: string;
    certifiedCount: number;
    totalEmployees: number;
  }>;

  const counts = new Map<string, Counts>();
  for (const row of body) {
    if (!row.slug.startsWith(ts)) continue;
    counts.set(row.slug, { certified: row.certifiedCount, total: row.totalEmployees });
  }
  return counts;
}

// ─── Seed ─────────────────────────────────────────────────────────────────────

beforeAll(async () => {
  // This hook is at MODULE scope, not inside the gated describe, so
  // `describe.skipIf` does not cover it — vitest runs a module-level beforeAll
  // even when every describe in the file is skipped. The guard therefore has to
  // stay here explicitly, or the seed fires against whatever the environment
  // points at. Verified by running this file with a hosted URL: without this
  // line the seed attempts a real request; with it the file skips clean.
  if (!canRun) return;

  svc = makeServiceClient();

  // ── The mixed restaurant — every edge in one listing ──────────────────────
  const mixedId = await seedRestaurant(MIXED);

  const l1 = await seedPerson({ restaurantId: mixedId, label: 'l1', role: 'learner' });
  await seedCert({ profileId: l1, restaurantId: mixedId, status: 'active' });
  await seedCert({ profileId: l1, restaurantId: mixedId, status: 'active' });

  const l2 = await seedPerson({ restaurantId: mixedId, label: 'l2', role: 'learner' });
  await seedCert({ profileId: l2, restaurantId: mixedId, status: 'active' });
  await seedCert({ profileId: l2, restaurantId: mixedId, status: 'expired' });

  const l3 = await seedPerson({ restaurantId: mixedId, label: 'l3', role: 'learner' });
  await seedCert({ profileId: l3, restaurantId: mixedId, status: 'pending' });

  await seedPerson({ restaurantId: mixedId, label: 'l4', role: 'learner' });

  const l5 = await seedPerson({
    restaurantId: mixedId,
    label: 'l5',
    role: 'learner',
    departed: true,
  });
  await seedCert({ profileId: l5, restaurantId: mixedId, status: 'active' });

  const m1 = await seedPerson({ restaurantId: mixedId, label: 'm1', role: 'manager' });
  await seedCert({ profileId: m1, restaurantId: mixedId, status: 'active' });

  // ── Everyone certified, one certificate each — the honest 100% ────────────
  const allId = await seedRestaurant(ALL_CERTIFIED);
  for (const label of ['a1', 'a2']) {
    const id = await seedPerson({ restaurantId: allId, label, role: 'learner' });
    await seedCert({ profileId: id, restaurantId: allId, status: 'active' });
  }

  // ── One learner, three active certificates — the pure duplicate case ──────
  const dupeId = await seedRestaurant(DUPLICATES);
  const d1 = await seedPerson({ restaurantId: dupeId, label: 'd1', role: 'learner' });
  await seedCert({ profileId: d1, restaurantId: dupeId, status: 'active' });
  await seedCert({ profileId: d1, restaurantId: dupeId, status: 'active' });
  await seedCert({ profileId: d1, restaurantId: dupeId, status: 'active' });
}, 60_000);

afterAll(async () => {
  if (!canRun || !svc) return;

  for (const id of createdProfileIds) {
    await svc.from('certificates').delete().eq('profile_id', id);
  }
  for (const id of createdProfileIds) {
    await svc.from('profiles').delete().eq('id', id);
    await svc.auth.admin.deleteUser(id).catch(() => {});
  }
  for (const id of createdRestaurantIds) {
    await svc.from('restaurants').delete().eq('id', id);
  }
}, 60_000);

// ─── Tests ────────────────────────────────────────────────────────────────────

// T-25 follow-up — this note is deliberately OUTSIDE the gated describe below.
// The suite used to guard each test with an early `return`, so a run without a
// local database reported every test as PASSED while asserting nothing. It now
// skips as a block — and this note still runs, so the refusal is stated out
// loud rather than disappearing with the block.
describe('search-count-parity — environment', () => {
  it('reports when the parity check is not running', () => {
    if (!canRun) {
      console.warn(
        '\n[search-count-parity] local Supabase or psql unavailable — the SQL/TypeScript ' +
          'parity check did NOT run. Start it with `supabase start` and re-run `pnpm test`.\n'
      );
    }
    expect(true).toBe(true);
  });
});

describe.skipIf(!canRun)('search count parity — SQL vs TypeScript', () => {
  it('both paths agree on every seeded restaurant', async () => {
    const sql = sqlCounts();
    const typescript = await tsCounts();

    expect(sql.size, 'the SQL path found the fixture').toBe(3);
    expect(typescript.size, 'the TypeScript path found the fixture').toBe(3);

    for (const slug of [MIXED, ALL_CERTIFIED, DUPLICATES]) {
      expect(sql.get(slug), `SQL ${slug}`).toEqual(typescript.get(slug));
    }
  });

  it('the mixed restaurant is 2 certified of 4 — in both paths', async () => {
    const expected: Counts = { certified: 2, total: 4 };

    expect(sqlCounts().get(MIXED), 'SQL').toEqual(expected);
    expect((await tsCounts()).get(MIXED), 'TypeScript').toEqual(expected);
  });

  it('one learner with three active certificates is 1 of 1, not 3 of 1', async () => {
    const expected: Counts = { certified: 1, total: 1 };

    expect(sqlCounts().get(DUPLICATES), 'SQL').toEqual(expected);
    expect((await tsCounts()).get(DUPLICATES), 'TypeScript').toEqual(expected);
  });

  it('an honestly fully-certified restaurant still reads 2 of 2', async () => {
    const expected: Counts = { certified: 2, total: 2 };

    expect(sqlCounts().get(ALL_CERTIFIED), 'SQL').toEqual(expected);
    expect((await tsCounts()).get(ALL_CERTIFIED), 'TypeScript').toEqual(expected);
  });

  it('neither path can publish a ratio above 100%', async () => {
    const sql = sqlCounts();
    const typescript = await tsCounts();

    for (const [slug, counts] of [...sql, ...typescript]) {
      expect(counts.certified, `${slug} numerator ≤ denominator`).toBeLessThanOrEqual(counts.total);
      if (counts.total > 0) {
        expect(Math.round((counts.certified / counts.total) * 100)).toBeLessThanOrEqual(100);
      }
    }
  });
});
