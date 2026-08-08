/**
 * tests/unit/seed-db-guard.test.ts
 *
 * Regression coverage for the T-37 db:seed guard.
 *
 * The bug: `pnpm db:seed` was `psql $DATABASE_URL -f db/seed.sql` — a raw shell
 * one-liner in package.json. No TypeScript executed, so the T-24 (vitest),
 * T-27 (Playwright) and T-31 (seed-auth-users) guards could not reach it. Any
 * shell that had run `source .env.local` — which points at the HOSTED
 * PRODUCTION pooler — turned that command into 207 lines of demo restaurants,
 * profiles, curriculum and reviews inserted into production. It was the last
 * routine command in the repo that could write there by accident.
 *
 * Three halves, deliberately:
 *
 *   1. BEHAVIOURAL — actually run scripts/seed-db.ts as a subprocess with a
 *      NON-LOCAL target and assert it exits non-zero having printed the
 *      offending host and having never spawned psql. This is the only honest
 *      proof; a unit test over a helper could pass while `pnpm db:seed` still
 *      seeded production. The host is fake and the guard fires before psql is
 *      spawned, so no packet leaves this machine.
 *
 *      There is no matching positive-direction subprocess test: pointing this
 *      script at 127.0.0.1 would require a running local Supabase and would
 *      write 207 lines of fixture rows, neither of which belongs in the unit
 *      suite. Instead the local default is checked structurally below — the
 *      constant is read out of the source and fed to the real isLocalUrl(), so
 *      a bare `pnpm db:seed` provably cannot be refused in a clean shell.
 *      Actual seeding is verified by hand (T-37) with row counts.
 *
 *   2. STRUCTURAL — assert the script reuses isLocalUrl() from tests/env-guard
 *      rather than growing its own notion of "local", that the check precedes
 *      the psql spawn, that no bypass variable exists, that dotenv is never
 *      loaded, and that the URL is never printed or interpolated into a shell
 *      string. A second, subtly-different definition of "local" is exactly how
 *      this bug class returns, and a guard placed after the spawn is not a
 *      guard.
 *
 *   3. WIRING — assert package.json actually routes db:seed through the
 *      wrapper, and that no npm script anywhere reintroduces raw
 *      `psql $DATABASE_URL`. A perfect guard in an unreferenced file is not a
 *      fix.
 *
 * T-37b adds a fourth concern that is not about the target at all: a seed that
 * fails must not report success. psql's default is to log an error and carry on
 * to exit 0, and db/seed-curriculum.sql runs inside `begin; … commit;`, so one
 * error there rolls back the whole curriculum half silently. The
 * `-v ON_ERROR_STOP=1` flag is asserted structurally, and the exit-code path it
 * depends on is asserted behaviourally against a local database that does not
 * exist.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { ALLOW_REMOTE_VAR, isLocalUrl } from '../env-guard';

const repoRoot = resolve(__dirname, '..', '..');
const SCRIPT_ABS = resolve(repoRoot, 'scripts/seed-db.ts');
const TSX = resolve(repoRoot, 'node_modules/.bin/tsx');

/**
 * A hosted-looking libpq URL we never contact. Deliberately NOT the real
 * project ref: if the guard ever regresses, the worst this test can do is a
 * DNS lookup for a domain that does not exist, never an INSERT into
 * production. The password is fake for the same reason.
 */
const FAKE_HOSTED_URL =
  'postgresql://postgres:fake-pw@db.fake-not-a-real-project.supabase.co:5432/postgres';

function runSeedDb(databaseUrl: string): SpawnSyncReturns<string> {
  return spawnSync(TSX, [SCRIPT_ABS], {
    cwd: repoRoot,
    encoding: 'utf8',
    timeout: 60_000,
    env: { ...process.env, DATABASE_URL: databaseUrl },
  });
}

function combine(run: SpawnSyncReturns<string>): string {
  return `${run.stdout ?? ''}${run.stderr ?? ''}`;
}

let hosted: SpawnSyncReturns<string>;
let hostedOut: string;

beforeAll(() => {
  hosted = runSeedDb(FAKE_HOSTED_URL);
  hostedOut = combine(hosted);
}, 90_000);

describe('db:seed refuses a non-local target (T-37)', () => {
  it('exits non-zero rather than seeding', () => {
    expect(hosted.error).toBeUndefined();
    expect(hosted.status).toBe(1);
  });

  it('names the offending host so the operator knows what it refused', () => {
    expect(hostedOut).toContain('db.fake-not-a-real-project.supabase.co');
    expect(hostedOut).toContain('REFUSED');
  });

  it('never prints the resolved URL, which carries a password', () => {
    expect(hostedOut).not.toContain('fake-pw');
    expect(hostedOut).not.toContain(FAKE_HOSTED_URL);
  });

  it('never spawns psql, so no connection is opened', () => {
    // psql announces itself on failure ("psql: error: connection to server
    // ...") and on success (INSERT/COPY tags). Neither may appear.
    expect(hostedOut).not.toMatch(/^psql:/m);
    expect(hostedOut).not.toContain('INSERT 0');
    expect(hostedOut).not.toContain('could not translate host name');
  });

  it('says that .env.local points at production and is not read here', () => {
    expect(hostedOut).toMatch(/\.env\.local points at the HOSTED PRODUCTION pooler/);
    expect(hostedOut).toContain('does not read .env.local');
  });

  it('tells the operator the correct local invocation', () => {
    expect(hostedOut).toContain('127.0.0.1:54322');
    expect(hostedOut).toContain('supabase start');
  });

  it('also refuses a DATABASE_URL that does not parse as a URL', () => {
    const run = runSeedDb('this-is-not-a-url');
    const out = combine(run);
    expect(run.status).toBe(1);
    expect(out).toContain('(not a parseable URL)');
    expect(out).not.toMatch(/^psql:/m);
  }, 90_000);
});

describe('db:seed guard is wired the only way that holds (T-37)', () => {
  const src = readFileSync(SCRIPT_ABS, 'utf8');

  it('reuses isLocalUrl from tests/env-guard instead of re-deriving "local"', () => {
    expect(src).toMatch(/import\s*\{[^}]*\bisLocalUrl\b[^}]*\}\s*from\s*'\.\.\/tests\/env-guard'/);
    expect(src).toContain('isLocalUrl(target)');
  });

  it('does not hand-roll a host check with a regex or a substring match', () => {
    expect(src).not.toMatch(/includes\(\s*['"](localhost|127\.0\.0\.1)['"]\s*\)/);
    expect(src).not.toMatch(/\.test\(\s*target\s*\)/);
    expect(src).not.toMatch(/\btarget\s*\.\s*(match|search|replace)\s*\(/);
  });

  it('runs the guard BEFORE spawning psql', () => {
    const guardAt = src.indexOf('isLocalUrl(target)');
    const spawnAt = src.indexOf('execFileSync(');
    expect(guardAt).toBeGreaterThan(-1);
    expect(spawnAt).toBeGreaterThan(-1);
    expect(guardAt).toBeLessThan(spawnAt);
  });

  it('never loads dotenv, so .env.local gets no vote', () => {
    // The whole point of the fix: .env.local names the production pooler, and
    // scripts/seed-auth-users.ts loading it is how T-31 happened. This script
    // needs no secret from disk, so it reads none.
    expect(src).not.toMatch(/from\s*'dotenv'/);
    expect(src).not.toContain('loadDotenv');
  });

  it('passes the URL as an argv entry, never through a shell', () => {
    expect(src).toMatch(/execFileSync\(\s*'psql'\s*,\s*\[\s*target\s*,/);
    expect(src).not.toContain('execSync(');
    expect(src).not.toMatch(/shell:\s*true/);
  });

  it('never prints the resolved URL — host only', () => {
    expect(src).not.toMatch(/console\.(log|error|warn)\([^)]*\btarget\b/);
    expect(src).not.toMatch(/\$\{\s*target\s*\}/);
    // Node builds execFileSync's error message out of the full argv, so
    // re-printing the caught error would leak the password.
    expect(src).not.toMatch(/console\.error\(\s*err\b/);
    expect(src).not.toMatch(/err\.message/);
  });

  it('offers no bypass variable — not even the one env-guard honours', () => {
    expect(src).not.toContain(ALLOW_REMOTE_VAR);
    expect(src).not.toMatch(/process\.env\.[A-Z_]*(ALLOW|FORCE|SKIP|BYPASS|OVERRIDE)/);
  });

  it('defaults to a target the guard itself accepts', () => {
    // Proves a bare `pnpm db:seed` in a clean shell cannot be refused, without
    // running psql or writing a row: the constant is read out of the source and
    // handed to the same predicate the script uses.
    const match = src.match(/const LOCAL_DEFAULT = '([^']+)'/);
    expect(match).not.toBeNull();
    expect(isLocalUrl(match![1])).toBe(true);
  });

  it('resolves db/seed.sql absolutely, so cwd cannot change what is seeded', () => {
    expect(src).toMatch(/resolve\(__dirname,\s*'\.\.',\s*'db',\s*'seed\.sql'\)/);
  });

  it('runs psql with ON_ERROR_STOP, so a rolled-back seed cannot report success (T-37b)', () => {
    // Without this flag psql prints each error, carries on, and exits 0.
    // db/seed-curriculum.sql:206-393 is one `begin; … commit;` block, so a
    // single error inside it discards the entire curriculum half while the
    // command still succeeds — the T-32 shape, where a reset that seeded
    // nothing printed "successfully". Asserted across the whole argv rather
    // than on the string alone, so the flag cannot drift out of the psql call
    // into a comment while this test still passes.
    expect(src).toMatch(
      /execFileSync\(\s*'psql',\s*\[\s*target,\s*'-v',\s*'ON_ERROR_STOP=1',\s*'-f',\s*SEED_FILE\s*\]/
    );
  });
});

describe('db:seed propagates a psql failure instead of swallowing it (T-37b)', () => {
  /**
   * A local target psql can resolve but cannot open: the host passes
   * isLocalUrl(), so the guard lets the run through and psql itself fails. That
   * is the only way to exercise the failure path from the unit suite without a
   * fixture database — nothing is written either way, because psql never gets
   * as far as a statement.
   *
   * This does not prove ON_ERROR_STOP; that needs a live server with something
   * to roll back. The flag itself is asserted structurally above and verified
   * end-to-end by hand (T-37b). What this proves is that the exit code psql
   * returns actually reaches the caller — so the flag's effect is not thrown
   * away one line later.
   */
  const UNREACHABLE_LOCAL = 'postgresql://postgres:postgres@127.0.0.1:54322/no_such_db_t37b';

  let failed: SpawnSyncReturns<string>;
  let failedOut: string;

  beforeAll(() => {
    failed = runSeedDb(UNREACHABLE_LOCAL);
    failedOut = combine(failed);
  }, 90_000);

  it('exits non-zero when psql does', () => {
    expect(failed.error).toBeUndefined();
    expect(failed.status).toBeGreaterThan(0);
  });

  it('fails through the psql path, not the guard', () => {
    // The guard's own refusal prints REFUSED and exits 1 without ever spawning
    // psql. This message only exists after the spawn returns.
    expect(failedOut).toContain('[seed-db] psql exited');
    expect(failedOut).not.toContain('REFUSED');
  });

  it('still says nothing about the URL while reporting the failure', () => {
    expect(failedOut).not.toContain(UNREACHABLE_LOCAL);
  });
});

describe('package.json routes db:seed through the guard (T-37)', () => {
  const pkg = JSON.parse(readFileSync(resolve(repoRoot, 'package.json'), 'utf8')) as {
    scripts: Record<string, string>;
  };

  it('db:seed runs the wrapper, not psql directly', () => {
    expect(pkg.scripts['db:seed']).toBe('tsx scripts/seed-db.ts');
  });

  it('db:seed-with-auth reaches a guard in both halves', () => {
    // First half is scripts/seed-auth-users.ts (guarded by T-31), second is
    // db:seed (guarded here). Neither may be inlined back into raw psql.
    expect(pkg.scripts['db:seed-with-auth']).toBe('pnpm db:seed-auth && pnpm db:seed');
    expect(pkg.scripts['db:seed-auth']).toBe('tsx scripts/seed-auth-users.ts');
  });

  it('no npm script invokes psql or interpolates DATABASE_URL', () => {
    // db:push is the deliberate exception to "no script may touch a hosted
    // database", and it touches neither of these: it is `supabase db push`,
    // which uses the Supabase CLI's own linked-project config.
    for (const [name, command] of Object.entries(pkg.scripts)) {
      expect(command, `script "${name}" spawns psql directly`).not.toMatch(/\bpsql\b/);
      expect(command, `script "${name}" interpolates DATABASE_URL`).not.toContain('DATABASE_URL');
    }
  });
});
