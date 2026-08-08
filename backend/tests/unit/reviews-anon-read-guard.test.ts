/**
 * tests/unit/reviews-anon-read-guard.test.ts
 *
 * T-35 acceptance lock, in the manner of tests/unit/coming-soon-flag-guard.test.ts.
 *
 * 0025_drop_reviews_anon_read.sql removes `reviews_public_read_published`, the
 * only genuinely anon-readable policy in the schema. Postgres RLS filters ROWS,
 * never COLUMNS, so a SELECT policy on `reviews` granted every column of every
 * published row — including `reviews.author_email` — to anyone holding the
 * publishable anon key.
 *
 * A migration is not self-enforcing. Nothing stops a later migration from
 * re-creating the policy, and the failure is silent: no test breaks, no page
 * changes, and the leak is live again. So the assertion here is deliberately
 * NOT "0025 contains a DROP" — it is "across the migration set applied in
 * order, the LAST statement naming this policy is a DROP". That survives
 * someone adding 0031 that re-creates it.
 *
 * The mirror risk is over-correction. `reviews` must not end up with zero read
 * policies: the reviewer moderation queue and the manager dashboard both read
 * the table through RLS-scoped policies, and dropping those would break real
 * surfaces while looking like more of the same security work. The three
 * survivors are therefore asserted present by the same state machine.
 *
 * Finally, the reason dropping the policy is safe at all is that every reader
 * of `reviews` holds a service-role client, which bypasses RLS outright. That
 * is a property of the application, not of the database, so it is locked here
 * too — if a future route reads `reviews` with an anon or cookie-session
 * client, it will now fail in CI rather than in production.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve, join, relative } from 'node:path';

const repoRoot = resolve(__dirname, '..', '..');
const MIGRATIONS_DIR = resolve(repoRoot, 'db/migrations');

const DROPPED_POLICY = 'reviews_public_read_published';

/**
 * Policies that must SURVIVE 0025. "No policies on reviews" is a different bug
 * than "an anon policy on reviews", and this suite has to be able to tell them
 * apart.
 */
const SURVIVING_POLICIES = [
  'reviews_manager_read_own_restaurant', // SELECT — 0022_rename_admin_to_manager.sql
  'reviews_reviewer_read_all', // SELECT — 0003_rls.sql
  'reviews_public_insert', // INSERT — 0003_rls.sql (not a read grant)
];

/** Migrations are zero-padded to four digits, so lexical order is apply order. */
function migrationFilesInApplyOrder(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
}

/**
 * Drop whole-line `--` comments before parsing. 0025 quotes the original
 * CREATE POLICY verbatim in its header to explain what it is removing; without
 * this the state machine would read that comment as a live re-creation and the
 * suite would fail on the very migration it exists to verify.
 */
function stripLineComments(sql: string): string {
  return sql
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n');
}

type PolicyState = 'never-mentioned' | 'created' | 'dropped';

/**
 * Replay every migration in apply order and report where a policy lands.
 * Statement-level, not file-level: 0003 drops-then-creates each policy inside
 * one file for its own idempotency, so the last statement has to win, not the
 * last file.
 */
function finalPolicyState(policy: string): PolicyState {
  const createRe = new RegExp(`create\\s+policy\\s+"${policy}"`, 'i');
  const dropRe = new RegExp(`drop\\s+policy\\s+if\\s+exists\\s+"${policy}"`, 'i');

  let state: PolicyState = 'never-mentioned';

  for (const file of migrationFilesInApplyOrder()) {
    const sql = stripLineComments(readFileSync(join(MIGRATIONS_DIR, file), 'utf8'));
    for (const line of sql.split('\n')) {
      if (dropRe.test(line)) state = 'dropped';
      else if (createRe.test(line)) state = 'created';
    }
  }

  return state;
}

describe('T-35: the migration set itself', () => {
  const files = migrationFilesInApplyOrder();

  it('finds the migrations (the reader itself is not broken)', () => {
    // Without this, a bad path would make every assertion below pass over an
    // empty list — the state machine would report 'never-mentioned' for
    // everything, which reads as "policy is gone".
    expect(files.length).toBeGreaterThan(20);
    expect(files).toContain('0003_rls.sql');
    expect(files).toContain('0025_drop_reviews_anon_read.sql');
  });

  it('has no two migrations sharing a numeric prefix', () => {
    // T-35 was originally filed as 0024, which already existed and was applied.
    // Two files with the same prefix apply in an order that depends on the rest
    // of the filename, which is not something anyone reasons about correctly.
    const byPrefix = new Map<string, string[]>();
    for (const f of files) {
      const prefix = f.slice(0, 4);
      byPrefix.set(prefix, [...(byPrefix.get(prefix) ?? []), f]);
    }

    const collisions = [...byPrefix.entries()]
      .filter(([, group]) => group.length > 1)
      .map(([prefix, group]) => `${prefix}: ${group.join(', ')}`);

    expect(collisions).toEqual([]);
  });
});

describe('T-35: the anonymous read policy is dropped and stays dropped', () => {
  it('0025 exists and is idempotent', () => {
    const path = resolve(MIGRATIONS_DIR, '0025_drop_reviews_anon_read.sql');
    expect(existsSync(path)).toBe(true);

    const sql = readFileSync(path, 'utf8');
    // `if exists` is what makes re-running the migration a no-op rather than a
    // 42704 that aborts the whole reset.
    expect(sql).toMatch(
      new RegExp(`drop\\s+policy\\s+if\\s+exists\\s+"${DROPPED_POLICY}"\\s+on\\s+reviews`, 'i')
    );
  });

  it(`the last statement naming ${DROPPED_POLICY} across all migrations is a DROP`, () => {
    // The whole task in one assertion. A later migration re-creating this
    // policy would restore anonymous read of reviews.author_email, and nothing
    // else in this repo would notice.
    expect(finalPolicyState(DROPPED_POLICY)).toBe('dropped');
  });

  it('0003 really did create it (the state machine can see a CREATE at all)', () => {
    // Guards against a typo'd policy name silently reporting 'never-mentioned',
    // which is not 'created' and would let the assertion above pass vacuously.
    const rls = stripLineComments(readFileSync(resolve(MIGRATIONS_DIR, '0003_rls.sql'), 'utf8'));
    expect(rls).toMatch(new RegExp(`create\\s+policy\\s+"${DROPPED_POLICY}"`, 'i'));
  });
});

describe('T-35: reviews does not end up with zero policies', () => {
  it.each(SURVIVING_POLICIES)('%s survives the migration set', (policy) => {
    expect(finalPolicyState(policy)).toBe('created');
  });

  it('reviews still has at least one identity-scoped read policy', () => {
    // Reviewers moderate the queue through RLS. Dropping every SELECT policy
    // would look like more security hardening and would break the queue.
    const readers = ['reviews_manager_read_own_restaurant', 'reviews_reviewer_read_all'].filter(
      (p) => finalPolicyState(p) === 'created'
    );

    expect(readers.length).toBeGreaterThan(0);
  });
});

describe('T-35: nothing reads reviews through an RLS-bound client', () => {
  const APP_DIR = resolve(repoRoot, 'app');

  function walk(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === '.next') continue;
        walk(full, out);
      } else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) {
        out.push(full);
      }
    }
    return out;
  }

  const reviewReaders = walk(APP_DIR).filter((f) =>
    readFileSync(f, 'utf8').includes("from('reviews')")
  );

  it('finds the review call sites (the walker is not broken)', () => {
    expect(reviewReaders.length).toBeGreaterThan(0);
  });

  it('every file touching reviews builds a service-role client', () => {
    // Service-role bypasses RLS, which is why dropping the anon policy changes
    // nothing a visitor can see. A route that reached for the cookie-session
    // client instead would now silently read zero published reviews.
    const offenders = reviewReaders
      .filter((f) => {
        const src = readFileSync(f, 'utf8');
        return !/createServiceSupabase\(|createServiceDb\(/.test(src);
      })
      .map((f) => relative(repoRoot, f));

    expect(offenders, 'these read reviews without a service-role client').toEqual([]);
  });

  it('no browser-side Supabase client module exists to carry the anon key', () => {
    // The anon key only becomes a read credential once something in a browser
    // holds one. Nothing in this codebase constructs such a client.
    expect(existsSync(resolve(repoRoot, 'lib/supabase/client.ts'))).toBe(false);
  });
});

describe('T-35: the public directory surface never selected the email column', () => {
  const ROUTE = resolve(repoRoot, 'app/api/directory/[slug]/route.ts');

  it('selects an explicit column list from reviews, not *', () => {
    const src = readFileSync(ROUTE, 'utf8');
    const match = src.match(/\.from\('reviews'\)\s*\.select\(\s*'([^']*)'/);

    expect(match, 'could not find the reviews .select() in the directory route').not.toBeNull();

    const columns = match![1].split(',').map((c) => c.trim());

    expect(columns).toEqual([
      'id',
      'author_name',
      'rating',
      'body',
      'allergen_context',
      'created_at',
    ]);
    // Named explicitly rather than inferred from the list above: `select('*')`
    // on this table would ship author_email to every visitor, which is the
    // exact exposure 0025 exists to close.
    expect(columns).not.toContain('author_email');
    expect(columns).not.toContain('*');
  });
});
