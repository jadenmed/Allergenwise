/**
 * tests/unit/local-db-guard.test.ts
 *
 * T-25 — regression coverage for tests/helpers/local-db.ts, the predicate that
 * decides whether a real-database suite may run.
 *
 * Four parts, in the order they matter:
 *   1. It REFUSES a hosted target. The constant this replaces did not, which is
 *      the whole reason the file exists.
 *   2. It ACCEPTS every local form we decided to accept, and no others.
 *   3. It FAILS CLOSED on anything it cannot prove — missing, empty, malformed.
 *   4. The negative control: a describe gated on a hosted environment does not
 *      merely return false, it actually SKIPS. A guard nobody has watched
 *      refuse is not a proven guard.
 *
 * Everything here is pure with respect to the env object it is handed. No
 * network, no files, and no spawned runners (T-51 — the suite must not become
 * a process spawner to test itself).
 */

import { describe, it, expect } from 'vitest';
import {
  hasLocalSupabase,
  hasLocalPostgres,
  hasLocalTestPostgres,
  everyDbTargetIsLocal,
  localDbRefusalReason,
  type EnvLike,
} from '../helpers/local-db';

/**
 * Hosted stand-ins. Real SHAPE — a 20-character lowercase project ref on
 * supabase.co, and the session-pooler host — deliberately not this project's
 * real ref, which a committed test is the wrong place to publish. The guard
 * decides on host shape, never on which ref it is.
 */
const HOSTED_REST = 'https://abcdefghijklmnopqrst.supabase.co';
const HOSTED_POOLER =
  'postgresql://postgres.abcdefghijklmnopqrst:pw@aws-0-us-east-1.pooler.supabase.com:6543/postgres';
const HOSTED_DIRECT = 'postgresql://postgres:pw@db.abcdefghijklmnopqrst.supabase.co:5432/postgres';

const LOCAL_REST = 'http://127.0.0.1:54321';
const LOCAL_PG = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

/** A JWT-shaped string. Three segments, no real signature, no secret. */
const GOOD_KEY = 'eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.not-a-real-signature';

/** The env a healthy local run has. Every case below is a mutation of this. */
function localEnv(overrides: Record<string, string | undefined> = {}): EnvLike {
  return {
    NEXT_PUBLIC_SUPABASE_URL: LOCAL_REST,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: GOOD_KEY,
    SUPABASE_SERVICE_ROLE_KEY: GOOD_KEY,
    DATABASE_URL: LOCAL_PG,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 1. It refuses a hosted target
// ---------------------------------------------------------------------------

describe('hasLocalSupabase — refuses hosted targets', () => {
  it('is false for a hosted Supabase REST URL, even with perfectly good keys', () => {
    expect(hasLocalSupabase({ env: localEnv({ NEXT_PUBLIC_SUPABASE_URL: HOSTED_REST }) })).toBe(
      false
    );
  });

  it('is false for the exact input the old constant accepted', () => {
    // The regression, stated as an assertion. Every clause of the old flag was
    // satisfied here: URL non-empty, key non-empty, key has no "placeholder".
    const env = localEnv({ NEXT_PUBLIC_SUPABASE_URL: HOSTED_REST, DATABASE_URL: undefined });
    expect(env.NEXT_PUBLIC_SUPABASE_URL).not.toBe('');
    expect(env.SUPABASE_SERVICE_ROLE_KEY).not.toBe('');
    expect(env.SUPABASE_SERVICE_ROLE_KEY?.includes('placeholder')).toBe(false);
    expect(hasLocalSupabase({ env })).toBe(false);
  });

  it('is false when DATABASE_URL is hosted even though the Supabase URL is local', () => {
    // The both-variables rule: some suites reach Postgres directly, and product
    // code imported by a PostgREST suite can open its own connection.
    expect(hasLocalSupabase({ env: localEnv({ DATABASE_URL: HOSTED_POOLER }) })).toBe(false);
  });

  it('is false when TEST_DATABASE_URL is hosted even though everything else is local', () => {
    expect(hasLocalSupabase({ env: localEnv({ TEST_DATABASE_URL: HOSTED_DIRECT }) })).toBe(false);
  });

  it('is false for host.docker.internal — deliberately not in the accepted set', () => {
    const env = localEnv({ NEXT_PUBLIC_SUPABASE_URL: 'http://host.docker.internal:54321' });
    expect(hasLocalSupabase({ env })).toBe(false);
  });

  it('is false for a hosted host that merely contains "localhost"', () => {
    const env = localEnv({ NEXT_PUBLIC_SUPABASE_URL: 'https://localhost.evil.example.com' });
    expect(hasLocalSupabase({ env })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 2. It accepts every local form we decided to accept
// ---------------------------------------------------------------------------

describe('hasLocalSupabase — accepts the local forms we decided on', () => {
  it.each([
    ['http://localhost:54321'],
    ['http://127.0.0.1:54321'],
    ['http://0.0.0.0:54321'],
    ['http://[::1]:54321'],
  ])('accepts %s', (url) => {
    expect(hasLocalSupabase({ env: localEnv({ NEXT_PUBLIC_SUPABASE_URL: url }) })).toBe(true);
  });

  it('accepts a local Postgres URL in DATABASE_URL alongside a local REST URL', () => {
    expect(hasLocalSupabase({ env: localEnv({ DATABASE_URL: LOCAL_PG }) })).toBe(true);
  });

  it('accepts an unset DATABASE_URL — absent is not a target', () => {
    expect(hasLocalSupabase({ env: localEnv({ DATABASE_URL: undefined }) })).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 3. It fails closed
// ---------------------------------------------------------------------------

describe('hasLocalSupabase — fails closed on anything it cannot prove', () => {
  it.each([
    ['missing', undefined],
    ['empty', ''],
    ['not a URL at all', 'not-a-url'],
    ['a host with no scheme', '127.0.0.1:54321'],
    ['a bare hostname', 'abcdefghijklmnopqrst.supabase.co'],
    ['whitespace', '   '],
  ])('is false when NEXT_PUBLIC_SUPABASE_URL is %s', (_label, value) => {
    expect(hasLocalSupabase({ env: localEnv({ NEXT_PUBLIC_SUPABASE_URL: value }) })).toBe(false);
  });

  it('is false on an empty env — nothing set proves nothing local', () => {
    expect(hasLocalSupabase({ env: {} })).toBe(false);
  });

  it.each([
    ['missing', undefined],
    ['empty', ''],
    ['a placeholder', 'placeholder-service-role-key'],
    ['a placeholder buried mid-string', 'sk_test_placeholder_abc'],
  ])('is false when the service-role key is %s', (_label, value) => {
    expect(hasLocalSupabase({ env: localEnv({ SUPABASE_SERVICE_ROLE_KEY: value }) })).toBe(false);
  });

  it('ignores the anon key unless the suite asks for it', () => {
    const env = localEnv({ NEXT_PUBLIC_SUPABASE_ANON_KEY: undefined });
    expect(hasLocalSupabase({ env })).toBe(true);
    expect(hasLocalSupabase({ env, anonKey: true })).toBe(false);
  });

  it('requires a usable anon key when the suite asks for it', () => {
    const env = localEnv({ NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-placeholder' });
    expect(hasLocalSupabase({ env, anonKey: true })).toBe(false);
    expect(hasLocalSupabase({ env: localEnv(), anonKey: true })).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The direct-Postgres predicates
// ---------------------------------------------------------------------------

describe('hasLocalPostgres', () => {
  it('is true for a local DATABASE_URL', () => {
    expect(hasLocalPostgres({ env: localEnv() })).toBe(true);
  });

  it('is false for a hosted DATABASE_URL', () => {
    expect(hasLocalPostgres({ env: localEnv({ DATABASE_URL: HOSTED_POOLER }) })).toBe(false);
  });

  it('is false when DATABASE_URL is unset — it does not default to a local guess', () => {
    // migration-0013-cert-state.test.ts used to default an unset DATABASE_URL
    // to a hardcoded local string while gating on Supabase credentials it never
    // used. Absent means skip, not assume.
    expect(hasLocalPostgres({ env: localEnv({ DATABASE_URL: undefined }) })).toBe(false);
  });

  it('is false when some OTHER target is hosted', () => {
    expect(hasLocalPostgres({ env: localEnv({ NEXT_PUBLIC_SUPABASE_URL: HOSTED_REST }) })).toBe(
      false
    );
  });
});

describe('hasLocalTestPostgres', () => {
  it('is false when TEST_DATABASE_URL is unset — the live-migration opt-in stays opt-in', () => {
    expect(hasLocalTestPostgres({ env: localEnv() })).toBe(false);
  });

  it('is true for a local TEST_DATABASE_URL', () => {
    const env = localEnv({
      TEST_DATABASE_URL: 'postgresql://postgres@127.0.0.1:55432/allergenwise_test',
    });
    expect(hasLocalTestPostgres({ env })).toBe(true);
  });

  it('is false for a hosted TEST_DATABASE_URL', () => {
    expect(hasLocalTestPostgres({ env: localEnv({ TEST_DATABASE_URL: HOSTED_DIRECT }) })).toBe(
      false
    );
  });
});

describe('everyDbTargetIsLocal', () => {
  it('is true when every set target is local', () => {
    expect(everyDbTargetIsLocal(localEnv())).toBe(true);
  });

  it('is true for an empty env — there is nothing set to be non-local', () => {
    expect(everyDbTargetIsLocal({})).toBe(true);
  });

  it.each([
    ['NEXT_PUBLIC_SUPABASE_URL', HOSTED_REST],
    ['DATABASE_URL', HOSTED_POOLER],
    ['TEST_DATABASE_URL', HOSTED_DIRECT],
  ])('is false when %s is hosted', (varName, value) => {
    expect(everyDbTargetIsLocal(localEnv({ [varName]: value }))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The refusal reason
// ---------------------------------------------------------------------------

describe('localDbRefusalReason', () => {
  it('is null when the environment is usable', () => {
    expect(localDbRefusalReason({ env: localEnv() })).toBeNull();
  });

  it('names the offending variable and the value', () => {
    const env = localEnv({ NEXT_PUBLIC_SUPABASE_URL: HOSTED_REST });
    const reason = localDbRefusalReason({ env });
    expect(reason).toContain('NEXT_PUBLIC_SUPABASE_URL');
    expect(reason).toContain(HOSTED_REST);
  });

  it('names DATABASE_URL when that is what is hosted', () => {
    const reason = localDbRefusalReason({ env: localEnv({ DATABASE_URL: HOSTED_POOLER }) });
    expect(reason).toContain('DATABASE_URL');
  });

  it('describes a missing key without printing key material', () => {
    const env = localEnv({ SUPABASE_SERVICE_ROLE_KEY: undefined });
    expect(localDbRefusalReason({ env })).toContain('SUPABASE_SERVICE_ROLE_KEY');
  });

  it('never echoes the service-role key, even when a key is present', () => {
    const reason = localDbRefusalReason({
      env: localEnv({
        NEXT_PUBLIC_SUPABASE_URL: HOSTED_REST,
        SUPABASE_SERVICE_ROLE_KEY: GOOD_KEY,
      }),
    });
    expect(reason).not.toContain(GOOD_KEY);
  });

  it('says the URL is unset rather than blaming the keys', () => {
    const env = localEnv({ NEXT_PUBLIC_SUPABASE_URL: undefined, DATABASE_URL: undefined });
    expect(localDbRefusalReason({ env })).toContain('not set');
  });
});

// ---------------------------------------------------------------------------
// 4. The negative control — the guard is watched refusing
// ---------------------------------------------------------------------------

/**
 * The exact expression every real-DB suite now gates on, evaluated against a
 * hosted environment. `describe.skipIf(!hasLocalSupabase())` skips when this is
 * false, so proving it false is proving those suites skip.
 *
 * Deliberately NOT written as a committed `describe.skipIf(...)` block here.
 * That would add a permanently-skipped test to the suite, moving the skip count
 * off 8 and making the acceptance number ambiguous for every future run. The
 * end-to-end demonstration — real integration suites reporting `skipped` under
 * a hosted URL — is done live and recorded in the task report instead. Nor does
 * it spawn a runner to check itself (T-51).
 */
const HOSTED_ENV = localEnv({ NEXT_PUBLIC_SUPABASE_URL: HOSTED_REST });

describe('negative control — a suite gated on a hosted environment', () => {
  it('evaluates its gate to false, so describe.skipIf suppresses it', () => {
    expect(hasLocalSupabase({ env: HOSTED_ENV })).toBe(false);
    expect(!hasLocalSupabase({ env: HOSTED_ENV })).toBe(true); // the skipIf argument
  });

  it('is refused for a stated reason', () => {
    expect(localDbRefusalReason({ env: HOSTED_ENV })).toContain('is not local');
  });

  it('refuses every real-DB entry point, not just the PostgREST one', () => {
    expect(hasLocalPostgres({ env: HOSTED_ENV })).toBe(false);
    expect(hasLocalTestPostgres({ env: HOSTED_ENV })).toBe(false);
    expect(everyDbTargetIsLocal(HOSTED_ENV)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The ambient assertion — the env THIS worker runs under
// ---------------------------------------------------------------------------

describe('the env this worker is actually running under', () => {
  it('satisfies the guard, so the real-DB suites run rather than silently skipping', () => {
    // If this fails, the real-DB suites in tests/integration are skipping and a
    // green run means less than it looks like. Check `supabase start`.
    expect(localDbRefusalReason()).toBeNull();
    expect(hasLocalSupabase()).toBe(true);
    expect(hasLocalSupabase({ anonKey: true })).toBe(true);
  });

  it('points DATABASE_URL at local Postgres', () => {
    expect(hasLocalPostgres()).toBe(true);
  });
});
