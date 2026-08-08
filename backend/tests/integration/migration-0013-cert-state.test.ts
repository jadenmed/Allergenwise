/**
 * tests/integration/migration-0013-cert-state.test.ts
 *
 * Schema-level assertions for migration 0013_cert_state.sql.
 *
 * After `supabase db reset` applies migrations, the `certificates` table
 * must have the new state-machine columns + indexes and the legacy
 * `revoked` column is gone. Hits a real local Postgres via psql.
 */

import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import { config } from 'dotenv';
import { hasLocalPostgres } from '../helpers/local-db';

config({ path: '.env.local' });

/**
 * T-25 — this file's guard was not merely weak, it was decorative.
 *
 * It gated on NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, which
 * this suite never uses: every assertion here goes through `psql` on
 * DATABASE_URL. The two questions were unrelated — the flag could be true while
 * DATABASE_URL pointed at a hosted pooler, and false while DATABASE_URL was a
 * perfectly good local socket. It was checking credentials belonging to a
 * client this file does not construct.
 *
 * The DEFAULT was the other half of it: an unset DATABASE_URL silently became a
 * hardcoded local string, so the suite would run against an address nobody had
 * verified. Absent now means skip, not assume.
 */
const DATABASE_URL = process.env.DATABASE_URL ?? '';

/** Run a SQL query via psql, returning each row as an object keyed by column. */
function runSql(query: string): Array<Record<string, string>> {
  const escaped = query.replace(/'/g, "'\\''");
  const out = execSync(`psql '${DATABASE_URL}' -At -F '||' -c '${escaped}'`, { encoding: 'utf8' });
  const lines = out
    .trim()
    .split('\n')
    .filter((l) => l.length > 0);
  if (lines.length === 0) return [];
  // Caller embeds column names as the first row by convention via SELECT.
  return lines.map((line) => {
    const cols = line.split('||');
    return Object.fromEntries(cols.map((v, i) => [String(i), v]));
  });
}

function getColumns(table: string) {
  const rows = runSql(
    `select column_name, data_type, is_nullable, coalesce(column_default, '') ` +
      `from information_schema.columns ` +
      `where table_schema = 'public' and table_name = '${table}' ` +
      `order by ordinal_position`
  );
  return rows.map((r) => ({
    column_name: r['0'],
    data_type: r['1'],
    is_nullable: r['2'],
    column_default: r['3'],
  }));
}

function getIndexes(table: string) {
  const rows = runSql(
    `select indexname, indexdef from pg_indexes ` +
      `where schemaname = 'public' and tablename = '${table}'`
  );
  return rows.map((r) => ({ indexname: r['0'], indexdef: r['1'] }));
}

function getCheckConstraints(table: string) {
  const rows = runSql(
    `select cc.constraint_name, cc.check_clause ` +
      `from information_schema.check_constraints cc ` +
      `join information_schema.constraint_column_usage ccu ` +
      `  on cc.constraint_name = ccu.constraint_name ` +
      `where ccu.table_schema = 'public' and ccu.table_name = '${table}'`
  );
  return rows.map((r) => ({ constraint_name: r['0'], check_clause: r['1'] }));
}

describe.skipIf(!hasLocalPostgres())('Migration 0013 — cert state schema', () => {
  it('certificates.status column exists with NOT NULL DEFAULT pending', () => {
    const cols = getColumns('certificates');
    const status = cols.find((c) => c.column_name === 'status');
    expect(status, 'certificates.status column should exist').toBeDefined();
    expect(status?.is_nullable).toBe('NO');
    expect(status?.column_default).toContain("'pending'");
  });

  it('certificates.status has CHECK constraint covering all 5 states', () => {
    const checks = getCheckConstraints('certificates');
    const statusCheck = checks.find(
      (c) => c.check_clause.includes('status') && c.check_clause.includes('pending')
    );
    expect(statusCheck, 'CHECK constraint on status should exist').toBeDefined();
    const clause = statusCheck!.check_clause;
    for (const state of ['pending', 'active', 'expired', 'revoked', 'disputed']) {
      expect(clause).toContain(state);
    }
  });

  it('certificates.status_changed_at exists, NOT NULL, default now()', () => {
    const cols = getColumns('certificates');
    const col = cols.find((c) => c.column_name === 'status_changed_at');
    expect(col).toBeDefined();
    expect(col?.is_nullable).toBe('NO');
  });

  it('certificates.revocation_reason exists with CHECK including refund/dispute_lost/admin/expired', () => {
    const cols = getColumns('certificates');
    const col = cols.find((c) => c.column_name === 'revocation_reason');
    expect(col).toBeDefined();
    expect(col?.is_nullable).toBe('YES');

    const checks = getCheckConstraints('certificates');
    const reasonCheck = checks.find(
      (c) => c.check_clause.includes('revocation_reason') && c.check_clause.includes('refund')
    );
    expect(reasonCheck).toBeDefined();
    for (const reason of ['refund', 'dispute_lost', 'admin', 'expired']) {
      expect(reasonCheck!.check_clause).toContain(reason);
    }
  });

  it('certificates.dispute_id and disputed_at columns exist', () => {
    const cols = getColumns('certificates');
    expect(cols.find((c) => c.column_name === 'dispute_id')).toBeDefined();
    expect(cols.find((c) => c.column_name === 'disputed_at')).toBeDefined();
  });

  it('certificates.revoked legacy column is DROPPED', () => {
    const cols = getColumns('certificates');
    const revoked = cols.find((c) => c.column_name === 'revoked');
    expect(revoked, 'legacy `revoked` column should be dropped by 0013').toBeUndefined();
  });

  it('partial index certificates_restaurant_status_idx exists (status=active)', () => {
    const idxs = getIndexes('certificates');
    const idx = idxs.find((i) => i.indexname === 'certificates_restaurant_status_idx');
    expect(idx, 'restaurant_status partial index should exist').toBeDefined();
    expect(idx?.indexdef).toContain("status = 'active'");
  });

  it('index certificates_profile_status_issued_at_idx exists', () => {
    const idxs = getIndexes('certificates');
    expect(
      idxs.find((i) => i.indexname === 'certificates_profile_status_issued_at_idx')
    ).toBeDefined();
  });

  it('partial index certificates_pending_issued_at_idx exists (status=pending)', () => {
    const idxs = getIndexes('certificates');
    const idx = idxs.find((i) => i.indexname === 'certificates_pending_issued_at_idx');
    expect(idx).toBeDefined();
    expect(idx?.indexdef).toContain("status = 'pending'");
  });

  it('partial index certificates_stripe_pi_idx exists (pi NOT NULL)', () => {
    const idxs = getIndexes('certificates');
    const idx = idxs.find((i) => i.indexname === 'certificates_stripe_pi_idx');
    expect(idx).toBeDefined();
    expect(idx?.indexdef).toMatch(/stripe_payment_intent_id IS NOT NULL/i);
  });
});
