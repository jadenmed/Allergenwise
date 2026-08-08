/**
 * tests/integration/migration-0027-duplicate-cert-preflight.test.ts
 *
 * T-49 — migration 0027 is a REPORT, not a repair, and not a constraint.
 *
 * Every case here runs the real 0027_duplicate_cert_preflight.sql text against
 * real local Postgres, inside a transaction that always ROLLS BACK. Nothing
 * this file seeds outlives the connection, so it needs no fixture teardown.
 *
 * What is proved:
 *   1. It passes silently on a clean database.
 *   2. It RAISES on a seeded duplicate, naming the learner and both certificate
 *      codes — the whole point of a pre-flight is that whoever reads the failure
 *      can find the rows.
 *   3. It leaves the rows alone. A migration that "fixed" duplicate
 *      certificates would be deleting billing records for money a restaurant
 *      has already been charged.
 *   4. It does NOT fire on the shapes that are correct data: a learner's
 *      history of expired certificates (that is the renewal flow), a revoked
 *      one held alongside a current one, or two certificates held by two
 *      different people.
 *
 * There is deliberately no unique index to assert on. `unique (profile_id)
 * where status='active'` would break the cert-fee webhook, whose activation
 * UPDATE is a single statement over every pending certificate at a restaurant —
 * one 23505 aborts the whole statement, so nobody who paid gets activated and
 * Stripe retries into the same wall forever. The migration header carries the
 * full reasoning.
 */

import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// NOTE: .env.local is deliberately NOT loaded here — it points at the hosted
// project. vitest.config.ts loads the committed .env.test with override: true,
// and the fallback below is the standard local Supabase port.
const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const hasLocalSupabase =
  SUPABASE_URL !== '' && SERVICE_KEY !== '' && !SERVICE_KEY.includes('placeholder');

// db/migrations is the real, git-tracked directory; supabase/migrations is a
// symlink to it. Read through the canonical path so this does not depend on how
// a given checkout materialises symlinks.
const MIGRATION_PATH = resolve(
  __dirname,
  '..',
  '..',
  'db/migrations/0027_duplicate_cert_preflight.sql'
);
const MIGRATION_SQL = readFileSync(MIGRATION_PATH, 'utf8');

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const LEARNER_A = '9f000000-0000-4000-8000-0000000000a1';
const LEARNER_B = '9f000000-0000-4000-8000-0000000000b1';
const RESTAURANT = '9f000000-0000-4000-8000-0000000000c1';

// cert_code must satisfy certificates_cert_code_format_chk (0015):
// AW-XXXXX-XXXXX-C over Crockford Base32 minus I/L/O/U.
const CODE_1 = 'AW-T49AA-BBBB1-2';
const CODE_2 = 'AW-T49AA-BBBB2-3';
const CODE_3 = 'AW-T49AA-BBBB3-4';

interface SqlResult {
  ok: boolean;
  output: string;
}

/**
 * Runs SQL through psql. `continueOnError` swaps ON_ERROR_STOP for psql's
 * implicit-savepoint mode, which is how a case can let the pre-flight raise and
 * then still query the table afterwards in the same transaction.
 */
function runSql(sql: string, continueOnError = false): SqlResult {
  const flags = continueOnError ? `-v ON_ERROR_ROLLBACK=on` : `-v ON_ERROR_STOP=1`;
  try {
    const out = execSync(`psql '${DATABASE_URL}' ${flags} -f -`, {
      input: sql,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { ok: true, output: out };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string };
    return { ok: false, output: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
}

/** The tenant and two learners every seeded case needs. FK parents, nothing more. */
const SEED_PARENTS = `
  insert into auth.users (id, email) values
    ('${LEARNER_A}', 't49-a@example.test'),
    ('${LEARNER_B}', 't49-b@example.test');

  insert into restaurants (id, slug, name)
    values ('${RESTAURANT}', 't49-preflight-bistro', 'T49 Preflight Bistro');

  insert into profiles (id, full_name, email, role, restaurant_id) values
    ('${LEARNER_A}', 'Learner A', 't49-a@example.test', 'learner', '${RESTAURANT}'),
    ('${LEARNER_B}', 'Learner B', 't49-b@example.test', 'learner', '${RESTAURANT}');
`;

function cert(code: string, learner: string, status: string, expiresInterval: string) {
  return `insert into certificates (cert_code, profile_id, restaurant_id, expires_at, status)
            values ('${code}', '${learner}', '${RESTAURANT}', now() + interval '${expiresInterval}', '${status}');\n`;
}

/** begin → seed → run the real migration → rollback. */
function runPreflightWith(seed: string, continueOnError = false): SqlResult {
  return runSql(`begin;\n${seed}\n${MIGRATION_SQL}\nrollback;\n`, continueOnError);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe.skipIf(!hasLocalSupabase)(
  'migration 0027 — duplicate current certificate pre-flight',
  () => {
    it('passes on a clean database', () => {
      const result = runSql(MIGRATION_SQL);
      expect(result.ok, result.output).toBe(true);
    });

    it('RAISES when one learner holds two current certificates', () => {
      const result = runPreflightWith(
        SEED_PARENTS +
          cert(CODE_1, LEARNER_A, 'pending', '2 years') +
          cert(CODE_2, LEARNER_A, 'pending', '2 years')
      );

      expect(result.ok, 'the pre-flight must refuse to pass over a duplicate').toBe(false);
      expect(result.output).toContain('migration 0027');
    });

    it('NAMES the learner and both certificate codes in the failure', () => {
      // A pre-flight that only says "duplicates exist" leaves whoever reads it
      // writing their own query. The rows have to be in the message.
      const result = runPreflightWith(
        SEED_PARENTS +
          cert(CODE_1, LEARNER_A, 'pending', '2 years') +
          cert(CODE_2, LEARNER_A, 'active', '2 years')
      );

      expect(result.ok).toBe(false);
      expect(result.output).toContain(LEARNER_A);
      expect(result.output).toContain(CODE_1);
      expect(result.output).toContain(CODE_2);
      expect(result.output).toMatch(/1 learner\(s\) hold more than one current certificate/);
      expect(result.output).toMatch(/2 rows total/);
    });

    it('tells the reader to resolve it by hand and NOT to delete the rows', () => {
      // They are billing records. The hint is the difference between a refund
      // and a silently vanished charge.
      const result = runPreflightWith(
        SEED_PARENTS +
          cert(CODE_1, LEARNER_A, 'pending', '2 years') +
          cert(CODE_2, LEARNER_A, 'pending', '2 years')
      );

      expect(result.output).toMatch(/Do NOT delete certificate rows/i);
      expect(result.output).toMatch(/refund or credit/i);
    });

    it('deletes nothing — both rows survive the raise', () => {
      const probe = runSql(
        `begin;
         ${SEED_PARENTS}
         ${cert(CODE_1, LEARNER_A, 'pending', '2 years')}
         ${cert(CODE_2, LEARNER_A, 'pending', '2 years')}
         ${MIGRATION_SQL}
         select 'surviving=' || count(*) from certificates where profile_id = '${LEARNER_A}';
         rollback;`,
        true // let the raise happen, then keep querying
      );

      expect(probe.output).toContain('surviving=2');
    });

    it('contains no DML — it cannot modify or delete anything, by construction', () => {
      // The structural half. The runtime case above proves this run did not
      // delete; this one proves no future edit can quietly add a "cleanup" step.
      // Matched as STATEMENTS, not bare words — the hint text deliberately
      // contains "Do NOT delete certificate rows", which is guidance, not DML.
      const withoutComments = MIGRATION_SQL.replace(/^\s*--.*$/gm, '');
      expect(withoutComments).not.toMatch(/\bdelete\s+from\b/i);
      expect(withoutComments).not.toMatch(/\btruncate\s+(table\s+)?\w/i);
      expect(withoutComments).not.toMatch(/\bdrop\s+(table|index|column|constraint)\b/i);
      expect(withoutComments).not.toMatch(/\binsert\s+into\b/i);
      expect(withoutComments).not.toMatch(/\bupdate\s+\w+\s+set\b/i);
      // And no index, which is the decision this migration is built around.
      expect(withoutComments).not.toMatch(/create\s+(unique\s+)?index/i);
    });
  }
);

describe.skipIf(!hasLocalSupabase)('migration 0027 — the shapes that are CORRECT data', () => {
  it('does not fire on a learner whose extra certificates are EXPIRED', () => {
    // This is the renewal flow's footprint: retaking the exam is how a
    // certificate is renewed, so a long-serving employee accumulates lapsed
    // certificates alongside one current one. Reporting that as a duplicate
    // would make the pre-flight cry wolf on every renewal.
    const result = runPreflightWith(
      SEED_PARENTS +
        cert(CODE_1, LEARNER_A, 'expired', '-2 years') +
        cert(CODE_2, LEARNER_A, 'expired', '-1 years') +
        cert(CODE_3, LEARNER_A, 'active', '2 years')
    );

    expect(result.ok, result.output).toBe(true);
  });

  it('does not fire on a REVOKED certificate held alongside a current one', () => {
    const result = runPreflightWith(
      SEED_PARENTS +
        cert(CODE_1, LEARNER_A, 'revoked', '2 years') +
        cert(CODE_2, LEARNER_A, 'active', '2 years')
    );

    expect(result.ok, result.output).toBe(true);
  });

  it('does not fire on two certificates held by two DIFFERENT learners', () => {
    // The obvious false positive: a restaurant with two certified employees is
    // the normal case, and $70 is the correct price for it.
    const result = runPreflightWith(
      SEED_PARENTS +
        cert(CODE_1, LEARNER_A, 'pending', '2 years') +
        cert(CODE_2, LEARNER_B, 'pending', '2 years')
    );

    expect(result.ok, result.output).toBe(true);
  });
});
