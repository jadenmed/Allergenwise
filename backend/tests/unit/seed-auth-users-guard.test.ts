/**
 * tests/unit/seed-auth-users-guard.test.ts
 *
 * Regression coverage for the T-31 seed-script guard.
 *
 * The bug: scripts/seed-auth-users.ts loaded .env.local — which points at the
 * HOSTED production project — built a SERVICE-ROLE admin client, and called
 * auth.admin.createUser() for admin@example.test, reviewer@example.test and
 * learner@example.test with the password DemoPassword123!. Its only checks were
 * "are the vars present" and "is the key a placeholder". Neither asked whether
 * the target database was local, so `pnpm db:seed-auth` created three
 * known-password accounts in production.
 *
 * Two halves, deliberately:
 *
 *   1. BEHAVIOURAL — actually run the script as a subprocess with a NON-LOCAL
 *      target and assert it exits 1 having printed the offending host and
 *      having never entered main(). This is the only honest proof; a unit test
 *      over a helper could pass while the wired-up script still seeds prod.
 *      The host used is fake, and the guard fires before any client is built,
 *      so no network call leaves this machine.
 *
 *      There is no matching positive-direction subprocess test: pointing this
 *      script at 127.0.0.1 would require a running local Supabase and would
 *      write rows, neither of which belongs in the unit suite. The positive
 *      direction is verified by hand (T-31) and by db:seed-with-auth in normal
 *      local use.
 *
 *   2. STRUCTURAL — assert the script reuses isLocalUrl() from tests/env-guard
 *      rather than growing its own notion of "local", that the check precedes
 *      createClient(), and that no bypass variable exists. A second,
 *      subtly-different definition of "local" is exactly how this bug class
 *      returns, and a guard placed after the client is built is not a guard.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { ALLOW_REMOTE_VAR } from '../env-guard';

const repoRoot = resolve(__dirname, '..', '..');
const SCRIPT_ABS = resolve(repoRoot, 'scripts/seed-auth-users.ts');

/**
 * A hosted-looking host we never contact. Deliberately NOT the real project
 * ref: if the guard ever regresses, the worst this test can do is a DNS lookup
 * for a domain that does not exist, never a service-role call to production.
 */
const FAKE_HOSTED_URL = 'https://fake-not-a-real-project.supabase.co';
const FAKE_KEY = 'fake-service-role-key-for-guard-test';

let run: SpawnSyncReturns<string>;
let combined: string;

beforeAll(() => {
  // The child loads .env.local itself (that is the bug's whole mechanism), but
  // dotenv never overwrites a variable already present in the environment it is
  // handed, so these two win. That is also why the fix is testable without
  // touching .env.local — and why nothing here may edit it.
  run = spawnSync(resolve(repoRoot, 'node_modules/.bin/tsx'), [SCRIPT_ABS], {
    cwd: repoRoot,
    encoding: 'utf8',
    timeout: 60_000,
    env: {
      ...process.env,
      NEXT_PUBLIC_SUPABASE_URL: FAKE_HOSTED_URL,
      SUPABASE_SERVICE_ROLE_KEY: FAKE_KEY,
    },
  });
  combined = `${run.stdout ?? ''}${run.stderr ?? ''}`;
}, 90_000);

describe('seed-auth-users refuses a non-local target (T-31)', () => {
  it('exits 1 rather than seeding', () => {
    expect(run.error).toBeUndefined();
    expect(run.status).toBe(1);
  });

  it('names the offending host so the operator knows what it refused', () => {
    expect(combined).toContain('fake-not-a-real-project.supabase.co');
    expect(combined).toContain('REFUSED');
  });

  it('says that .env.local points at production', () => {
    expect(combined).toMatch(/\.env\.local points at the HOSTED PRODUCTION project/);
  });

  it('tells the operator the correct local invocation', () => {
    expect(combined).toContain('http://127.0.0.1:54321');
    expect(combined).toContain('supabase start');
  });

  it('never reaches main(), so no client is built and no user is created', () => {
    // These strings are only ever printed from inside main(), i.e. after
    // createClient. Their absence is the proof that nothing was attempted.
    expect(combined).not.toContain('Seeding 3 demo auth users');
    expect(combined).not.toContain('admin@example.test already exists');
    expect(combined).not.toMatch(/\[seed-auth-users] Created /);
  });
});

describe('seed-auth-users guard is wired the only way that holds (T-31)', () => {
  const src = readFileSync(SCRIPT_ABS, 'utf8');

  it('reuses isLocalUrl from tests/env-guard instead of re-deriving "local"', () => {
    expect(src).toMatch(/import\s*\{[^}]*\bisLocalUrl\b[^}]*\}\s*from\s*'\.\.\/tests\/env-guard'/);
    expect(src).toContain('isLocalUrl(SUPABASE_URL)');
  });

  it('does not hand-roll a host check with a regex or a substring match', () => {
    // The classic reintroduction: `url.includes('localhost')`, which passes for
    // https://localhost.evil-project.supabase.co.
    expect(src).not.toMatch(/includes\(\s*['"](localhost|127\.0\.0\.1)['"]\s*\)/);
    // The other reintroduction: matching the target against a regex literal
    // instead of asking isLocalUrl(). Asserted against the actual call shapes.
    // The first version of this checked for "a slash, 127.0.0.1, a slash"
    // anywhere in the file, which a legitimate
    // postgresql://postgres:postgres@127.0.0.1:54322/postgres example in the
    // docblock also matches — it banned valid prose, not a hand-rolled check.
    expect(src).not.toMatch(/\.test\(\s*SUPABASE_URL\s*\)/);
    expect(src).not.toMatch(/SUPABASE_URL\s*\.\s*(match|search|replace)\s*\(/);
  });

  it('runs the guard BEFORE constructing the service-role client', () => {
    const guardAt = src.indexOf('isLocalUrl(SUPABASE_URL)');
    const clientAt = src.indexOf('createClient(SUPABASE_URL');
    expect(guardAt).toBeGreaterThan(-1);
    expect(clientAt).toBeGreaterThan(-1);
    expect(guardAt).toBeLessThan(clientAt);
  });

  it('keeps the two pre-existing checks rather than replacing them', () => {
    expect(src).toContain('if (!SUPABASE_URL || !SERVICE_ROLE_KEY)');
    expect(src).toContain("SERVICE_ROLE_KEY.includes('placeholder')");
  });

  it('never shows a db:seed-with-auth invocation without DATABASE_URL (T-37)', () => {
    // db:seed-with-auth is `pnpm db:seed-auth && pnpm db:seed`. The guard in
    // this file covers only the first half.
    //
    // The assertion is unchanged, but its reason changed when T-37 landed, and
    // this comment is updated deliberately rather than deleted. Before T-37 the
    // second half was raw `psql $DATABASE_URL -f db/seed.sql`, which no
    // TypeScript guard could reach, so naming DATABASE_URL was the only thing
    // between the operator and a production seed. It is now
    // `tsx scripts/seed-db.ts` (see tests/unit/seed-db-guard.test.ts), which
    // refuses a non-local target outright — an omitted DATABASE_URL is now safe.
    //
    // The assertion still earns its place: in a shell that exports a hosted
    // DATABASE_URL, the second half now REFUSES and the chain exits non-zero
    // with the auth users already created. An invocation this docblock hands
    // the operator without DATABASE_URL therefore hands them a half-finished
    // seed. Naming it keeps the documented command working end to end.
    const lines = src.split('\n');
    const invocations = lines
      .map((line, i) => ({ line, i }))
      .filter(({ line }) => line.includes('pnpm db:seed-with-auth'));

    expect(invocations.length).toBeGreaterThan(0);

    for (const { i } of invocations) {
      // Walk back over the `VAR="..." \` continuation lines forming the prefix.
      const prefix: string[] = [];
      for (let j = i - 1; j >= 0 && /\\\s*$/.test(lines[j]); j--) prefix.unshift(lines[j]);
      expect(prefix.join('\n')).toContain('DATABASE_URL');
    }
  });

  it('offers no bypass variable — not even the one env-guard honours', () => {
    expect(src).not.toContain(ALLOW_REMOTE_VAR);
    expect(src).not.toMatch(/process\.env\.[A-Z_]*(ALLOW|FORCE|SKIP|BYPASS|OVERRIDE)/);
  });
});
