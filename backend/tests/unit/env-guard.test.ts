/**
 * tests/unit/env-guard.test.ts
 *
 * Regression coverage for the T-24 production-database guard.
 *
 * Two halves:
 *   1. Unit tests over assertLocalDatabaseOnly() using synthetic env objects.
 *      No network, no files — the guard is pure with respect to the env it is
 *      handed.
 *   2. One ambient assertion proving that the env THIS worker is running under
 *      really is local. That is the standing, machine-checked answer to "does
 *      .env.test actually beat .env.local?" — if .env.local ever wins again,
 *      this test fails.
 */

import { describe, it, expect } from 'vitest';
import {
  assertLocalDatabaseOnly,
  isLocalUrl,
  ALLOW_REMOTE_VAR,
  ALLOW_REMOTE_VALUE,
  SHELL_SNAPSHOT_VAR,
} from '../env-guard';

// A stand-in for a hosted project. Not a real host we ever contact.
const HOSTED = 'https://example-project.supabase.co';
const LOCAL = 'http://127.0.0.1:54321';

describe('isLocalUrl', () => {
  it.each([
    ['http://127.0.0.1:54321', true],
    ['http://localhost:54321', true],
    ['http://0.0.0.0:54321', true],
    ['http://[::1]:54321', true],
    ['postgresql://postgres:postgres@127.0.0.1:54322/postgres', true],
    ['https://example-project.supabase.co', false],
    ['postgresql://postgres:pw@db.example-project.supabase.co:5432/postgres', false],
    ['', false],
    ['not-a-url', false],
    // The classic near-miss: a hosted host that merely contains "localhost".
    ['https://localhost.evil.example.com', false],
  ])('%s -> %s', (value, expected) => {
    expect(isLocalUrl(value as string)).toBe(expected);
  });
});

describe('assertLocalDatabaseOnly', () => {
  it('passes when every database target is local', () => {
    expect(() =>
      assertLocalDatabaseOnly({
        NEXT_PUBLIC_SUPABASE_URL: LOCAL,
        DATABASE_URL: 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
      })
    ).not.toThrow();
  });

  it('passes when nothing is set at all', () => {
    expect(() => assertLocalDatabaseOnly({})).not.toThrow();
  });

  it('throws when NEXT_PUBLIC_SUPABASE_URL is hosted', () => {
    expect(() => assertLocalDatabaseOnly({ NEXT_PUBLIC_SUPABASE_URL: HOSTED })).toThrow(
      /TEST RUN ABORTED/
    );
  });

  it('names the offending URL in the error', () => {
    expect(() => assertLocalDatabaseOnly({ NEXT_PUBLIC_SUPABASE_URL: HOSTED })).toThrow(
      new RegExp(HOSTED.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    );
  });

  it('tells the reader how to fix it', () => {
    let message = '';
    try {
      assertLocalDatabaseOnly({ NEXT_PUBLIC_SUPABASE_URL: HOSTED });
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toContain('HOW TO FIX');
    expect(message).toContain('supabase start');
    expect(message).toContain('pnpm test');
  });

  it('also catches a hosted DATABASE_URL', () => {
    expect(() =>
      assertLocalDatabaseOnly({
        NEXT_PUBLIC_SUPABASE_URL: LOCAL,
        DATABASE_URL: 'postgresql://postgres:pw@db.example-project.supabase.co:5432/postgres',
      })
    ).toThrow(/DATABASE_URL/);
  });

  it('also catches a hosted TEST_DATABASE_URL', () => {
    expect(() =>
      assertLocalDatabaseOnly({
        TEST_DATABASE_URL: 'postgresql://postgres:pw@db.example-project.supabase.co:5432/postgres',
      })
    ).toThrow(/TEST_DATABASE_URL/);
  });

  it('catches a poisoned shell even when .env.test already corrected the value', () => {
    // This is the `source .env.local` case: the live value is local because
    // .env.test overrode it, but the shell that spawned us is still aimed at
    // production and still feeds playwright, scripts/ and psql.
    expect(() =>
      assertLocalDatabaseOnly({
        NEXT_PUBLIC_SUPABASE_URL: LOCAL,
        [SHELL_SNAPSHOT_VAR]: HOSTED,
      })
    ).toThrow(/exported by your shell/);
  });

  it('reports every offender at once, not just the first', () => {
    let message = '';
    try {
      assertLocalDatabaseOnly({
        NEXT_PUBLIC_SUPABASE_URL: HOSTED,
        DATABASE_URL: 'postgresql://postgres:pw@db.example-project.supabase.co:5432/postgres',
      });
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toContain('NEXT_PUBLIC_SUPABASE_URL');
    expect(message).toContain('DATABASE_URL');
  });

  describe('the opt-out', () => {
    it('is ignored unless it matches the exact sentence', () => {
      for (const sloppy of ['1', 'true', 'yes', 'TRUE', '', 'i-accept']) {
        expect(() =>
          assertLocalDatabaseOnly({
            NEXT_PUBLIC_SUPABASE_URL: HOSTED,
            [ALLOW_REMOTE_VAR]: sloppy,
          })
        ).toThrow(/TEST RUN ABORTED/);
      }
    });

    it('permits the run when set to the exact sentence', () => {
      expect(() =>
        assertLocalDatabaseOnly({
          NEXT_PUBLIC_SUPABASE_URL: HOSTED,
          [ALLOW_REMOTE_VAR]: ALLOW_REMOTE_VALUE,
        })
      ).not.toThrow();
    });
  });
});

describe('the env this worker is actually running under', () => {
  // Standing proof that .env.test beat .env.local. Fourteen files under
  // tests/integration/ call config({ path: '.env.local' }) at module scope; if
  // any of that ever wins again, or the vitest wiring regresses, this fails.
  it('is local', () => {
    expect(() => assertLocalDatabaseOnly(process.env)).not.toThrow();
  });

  it('points NEXT_PUBLIC_SUPABASE_URL at the local stack', () => {
    expect(process.env.NEXT_PUBLIC_SUPABASE_URL).toBe(LOCAL);
  });
});
