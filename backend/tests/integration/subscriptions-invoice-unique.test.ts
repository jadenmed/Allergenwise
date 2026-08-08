/**
 * tests/integration/subscriptions-invoice-unique.test.ts
 *
 * Proves the constraint behind defect 3 (audit 2026-07-26): after migration
 * 0023, subscriptions.stripe_invoice_id is UNIQUE, so a second INSERT of the
 * same PaymentIntent is rejected by Postgres with 23505 — the guarantee
 * handlePlanPayment now leans on instead of its old SELECT-then-INSERT.
 *
 * Two layers, because the live layer needs a database:
 *
 *   A. STATIC (always runs) — the DDL is present in 0023 and 0001 was not
 *      edited. Cheap, but only proves the text exists.
 *
 *   B. LIVE (runs when TEST_DATABASE_URL is set) — applies 0001 + 0023 to a
 *      real Postgres via psql and asserts the double INSERT actually fails with
 *      23505, plus that NULL invoice ids stay exempt (comped subscriptions) and
 *      that the migration is re-runnable.
 *
 * Run layer B against a throwaway cluster (TCP — a unix socket path under a
 * temp dir usually blows past Postgres' 103-byte limit):
 *
 *   initdb -D /tmp/awpg -U postgres --auth=trust
 *   pg_ctl -D /tmp/awpg -l /tmp/awpg/server.log \
 *     -o "-p 55432 -c listen_addresses=127.0.0.1 -c unix_socket_directories=''" start
 *   createdb -h 127.0.0.1 -p 55432 -U postgres allergenwise_test
 *   TEST_DATABASE_URL='postgresql://postgres@127.0.0.1:55432/allergenwise_test' pnpm test
 *
 * Never point TEST_DATABASE_URL at a real environment — this file writes rows.
 *
 * Layer B is skipped without TEST_DATABASE_URL — loudly, via the always-running
 * guard test below, so a green suite never silently means "constraint unproven".
 */

import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { hasLocalTestPostgres } from '../helpers/local-db';

const MIGRATIONS = resolve(__dirname, '../../db/migrations');
const M0001 = join(MIGRATIONS, '0001_init.sql');
const M0023 = join(MIGRATIONS, '0023_webhook_retryability.sql');

const TEST_DB = process.env.TEST_DATABASE_URL;

/**
 * T-25 — Layer B used to run on the mere PRESENCE of TEST_DATABASE_URL, and the
 * file header carries a comment reading "Never point TEST_DATABASE_URL at a
 * real environment". That is a comment doing a guard's job: this layer applies
 * migrations and writes rows through psql, so a hosted value would have been
 * obeyed, not questioned.
 *
 * The opt-in is unchanged — unset still means skip, so the seven Layer B tests
 * skip exactly as they did before. What is new is that a value which is set but
 * NOT local also means skip, instead of meaning go.
 */
const canRunLive = hasLocalTestPostgres();

// ─── Layer A: static ──────────────────────────────────────────────────────────

describe('0023 migration — static shape', () => {
  it('declares the UNIQUE index on subscriptions.stripe_invoice_id', () => {
    const sql = readFileSync(M0023, 'utf8');
    expect(sql).toMatch(
      /create unique index if not exists\s+subscriptions_stripe_invoice_id_key\s+on subscriptions \(stripe_invoice_id\)/i
    );
  });

  it('pre-flights for pre-existing duplicates instead of dying on a bare 23505', () => {
    const sql = readFileSync(M0023, 'utf8');
    expect(sql).toMatch(/having count\(\*\) > 1/i);
    expect(sql).toMatch(/raise exception/i);
    // Billing rows must never be auto-removed by a migration.
    expect(sql).not.toMatch(/delete\s+from\s+subscriptions/i);
  });

  it('leaves 0001_init.sql untouched — subscriptions there is still un-uniqued', () => {
    const sql = readFileSync(M0001, 'utf8');
    expect(sql).toMatch(/stripe_invoice_id\s+text,/);
    expect(sql).not.toMatch(/stripe_invoice_id\s+text unique/);
  });

  it('reports when the live constraint check is not running', () => {
    if (!canRunLive) {
      const why = TEST_DB
        ? `TEST_DATABASE_URL is set but is not a local database — refused`
        : 'TEST_DATABASE_URL not set';
      console.warn(
        `\n[subscriptions-invoice-unique] ${why} — the LIVE ` +
          'UNIQUE-constraint check did NOT run. Only the static DDL text was ' +
          'verified. See this file header for the psql setup.\n'
      );
    }
    expect(true).toBe(true);
  });
});

// ─── Layer B: live Postgres ───────────────────────────────────────────────────

function psql(sql: string, opts: { expectFailure?: boolean } = {}): string {
  const dir = mkdtempSync(join(tmpdir(), 'awsql-'));
  const file = join(dir, 'script.sql');
  writeFileSync(file, sql, 'utf8');
  try {
    return execFileSync('psql', [TEST_DB!, '-v', 'ON_ERROR_STOP=1', '-f', file], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (err) {
    if (opts.expectFailure) {
      const e = err as { stdout?: string; stderr?: string };
      return `${e.stdout ?? ''}${e.stderr ?? ''}`;
    }
    throw err;
  }
}

function psqlFile(path: string): string {
  return execFileSync('psql', [TEST_DB!, '-v', 'ON_ERROR_STOP=1', '-f', path], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

describe.runIf(canRunLive)('0023 migration — live Postgres', () => {
  it('applies 0001 + 0023 (auth.users stubbed; Supabase owns it in prod)', () => {
    psql(`
      create schema if not exists auth;
      create table if not exists auth.users (id uuid primary key);
    `);
    psqlFile(M0001);
    psqlFile(M0023);

    const idx = psql(`
      select 1 from pg_indexes
       where tablename = 'subscriptions'
         and indexname = 'subscriptions_stripe_invoice_id_key';
    `);
    expect(idx).toContain('(1 row)');
  });

  it('is idempotent — re-running 0023 is a no-op', () => {
    expect(() => psqlFile(M0023)).not.toThrow();
  });

  it('rejects a second subscription with the same stripe_invoice_id (23505)', () => {
    const out = psql(
      `
      begin;
      insert into restaurants (slug, name) values ('dup-test', 'Dup Test');
      insert into subscriptions (restaurant_id, plan, starts_at, ends_at, amount_cents, status, stripe_invoice_id)
        select id, 'quarterly', current_date, current_date + 90, 9000, 'active', 'pi_double_insert'
          from restaurants where slug = 'dup-test';
      insert into subscriptions (restaurant_id, plan, starts_at, ends_at, amount_cents, status, stripe_invoice_id)
        select id, 'quarterly', current_date, current_date + 90, 9000, 'active', 'pi_double_insert'
          from restaurants where slug = 'dup-test';
      rollback;
      `,
      { expectFailure: true }
    );

    expect(out).toMatch(/duplicate key value violates unique constraint/i);
    expect(out).toMatch(/subscriptions_stripe_invoice_id_key/);
  });

  it('still allows many NULL stripe_invoice_id rows (comped subscriptions)', () => {
    const out = psql(`
      begin;
      insert into restaurants (slug, name) values ('null-test', 'Null Test');
      insert into subscriptions (restaurant_id, plan, starts_at, ends_at, amount_cents, status, stripe_invoice_id)
        select id, 'quarterly', current_date, current_date + 90, 0, 'active', null
          from restaurants where slug = 'null-test';
      insert into subscriptions (restaurant_id, plan, starts_at, ends_at, amount_cents, status, stripe_invoice_id)
        select id, 'semiannual', current_date, current_date + 180, 0, 'active', null
          from restaurants where slug = 'null-test';
      select count(*) as comped from subscriptions where stripe_invoice_id is null;
      rollback;
    `);
    expect(out).toMatch(/\n\s+2\n/);
  });

  it('stripe_events.processed_at no longer defaults to now() — insert leaves it NULL', () => {
    const out = psql(`
      begin;
      insert into stripe_events (id, type) values ('evt_marker_probe', 'payment_intent.succeeded');
      select status, (processed_at is null) as unprocessed
        from stripe_events where id = 'evt_marker_probe';
      rollback;
    `);
    expect(out).toMatch(/pending\s*\|\s*t/);
  });

  it('stripe_events.status rejects a value outside the enum', () => {
    const out = psql(
      `insert into stripe_events (id, type, status) values ('evt_bad_status', 'x', 'processing');`,
      { expectFailure: true }
    );
    expect(out).toMatch(/stripe_events_status_check/);
  });

  it('pre-flight blocks the index when duplicates already exist', () => {
    // Drop the index, plant a duplicate, then re-run 0023: it must abort with a
    // readable message naming the invoice id rather than a bare 23505.
    psql(`
      drop index if exists subscriptions_stripe_invoice_id_key;
      insert into restaurants (slug, name) values ('preflight-test', 'Preflight Test')
        on conflict (slug) do nothing;
      insert into subscriptions (restaurant_id, plan, starts_at, ends_at, amount_cents, status, stripe_invoice_id)
        select id, 'quarterly', current_date, current_date + 90, 9000, 'active', 'pi_preexisting_dup'
          from restaurants where slug = 'preflight-test';
      insert into subscriptions (restaurant_id, plan, starts_at, ends_at, amount_cents, status, stripe_invoice_id)
        select id, 'quarterly', current_date, current_date + 90, 9000, 'active', 'pi_preexisting_dup'
          from restaurants where slug = 'preflight-test';
    `);

    let failure = '';
    try {
      psqlFile(M0023);
    } catch (err) {
      const e = err as { stdout?: string; stderr?: string };
      failure = `${e.stdout ?? ''}${e.stderr ?? ''}`;
    }

    expect(failure, '0023 created the index despite duplicates').toMatch(
      /cannot add UNIQUE\(subscriptions\.stripe_invoice_id\)/
    );
    expect(failure).toContain('pi_preexisting_dup (x2)');
    expect(failure).toMatch(/Do NOT bulk-delete billing rows/);

    // Clean up so the suite can be re-run against the same database.
    psql(`
      delete from subscriptions where stripe_invoice_id = 'pi_preexisting_dup';
      delete from restaurants where slug = 'preflight-test';
    `);
    psqlFile(M0023);
  });
});
