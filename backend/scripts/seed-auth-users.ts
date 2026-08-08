/**
 * scripts/seed-auth-users.ts
 *
 * Pre-seed script for db/seed.sql.
 *
 * db/seed.sql inserts profiles with hard-coded UUIDs (b1000000-*) that FK to
 * auth.users. Auth users don't exist by default in a fresh local Supabase, so
 * the seed fails with a foreign-key violation unless we create matching
 * auth.users entries first.
 *
 * This script uses the Supabase Admin API (service-role key) to upsert the
 * three demo auth users with UUIDs that match db/seed.sql lines 51–97:
 *
 *   admin@example.test     → b1000000-0000-0000-0000-000000000001
 *   reviewer@example.test  → b1000000-0000-0000-0000-000000000002
 *   learner@example.test   → b1000000-0000-0000-0000-000000000003
 *
 * All three get the same demo password (DemoPassword123!) for easy login.
 *
 * Idempotent: if a user already exists with that ID, we skip it without
 * error. Safe to re-run.
 *
 * LOCAL DATABASES ONLY (T-31, found 2026-07-31)
 *   This script builds a SERVICE-ROLE client — RLS does not apply — and creates
 *   three accounts whose password is a constant in this file. Against a hosted
 *   project that is three known-password logins in production, and it used to be
 *   reachable by typing `pnpm db:seed-auth`, because the dotenv load below reads
 *   .env.local and .env.local points at the HOSTED project.
 *
 *   The guard below refuses any target that is not this machine, using the same
 *   isLocalUrl() predicate vitest (T-24) and Playwright (T-27) refuse on. There
 *   is deliberately no bypass.
 *
 * Usage (both forms require an explicitly local target — see the guard below):
 *   NEXT_PUBLIC_SUPABASE_URL="http://127.0.0.1:54321" \
 *   SUPABASE_SERVICE_ROLE_KEY="<local key from `supabase status`>" \
 *   pnpm db:seed-auth          # this script alone
 *
 *   NEXT_PUBLIC_SUPABASE_URL="http://127.0.0.1:54321" \
 *   SUPABASE_SERVICE_ROLE_KEY="<local key from `supabase status`>" \
 *   DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
 *   pnpm db:seed-with-auth     # this script then db/seed.sql
 *
 *   That third variable no longer holds a safety property open — T-37 closed
 *   that — but it is still the right thing to type. db:seed-with-auth is
 *   `pnpm db:seed-auth && pnpm db:seed`, and its second half used to be
 *   `psql $DATABASE_URL -f db/seed.sql`: raw psql, no TypeScript, so no guard
 *   in this repo could reach it. The first two variables aim THIS script at
 *   local and said nothing about where psql went, so in a shell that had run
 *   `source .env.local` the guard below passed, && proceeded, and db/seed.sql's
 *   207 lines of demo data landed in the hosted production pooler.
 *
 *   db:seed is now `tsx scripts/seed-db.ts`, which refuses any non-local
 *   DATABASE_URL on the same isLocalUrl() predicate used here, and defaults to
 *   the local database when the variable is unset. An omitted DATABASE_URL can
 *   therefore no longer seed production — but in a shell that exports a hosted
 *   one, the second half REFUSES and the chain exits non-zero. Naming the local
 *   target keeps that from happening, and says out loud where the rows go.
 *
 *   The prefix wins over .env.local without anyone editing that file: dotenv
 *   never overwrites a variable that is already present in process.env.
 *
 * Required env vars (read from .env.local via dotenv unless already set):
 *   NEXT_PUBLIC_SUPABASE_URL        must resolve to localhost / 127.0.0.1
 *   SUPABASE_SERVICE_ROLE_KEY       the LOCAL service-role key
 */

import { createClient } from '@supabase/supabase-js';
import { config as loadDotenv } from 'dotenv';
import { resolve } from 'path';

import { hostOf, isLocalUrl } from '../tests/env-guard';

// Load .env.local from repo root regardless of cwd
loadDotenv({ path: resolve(__dirname, '..', '.env.local') });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error(
    '[seed-auth-users] Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local'
  );
  process.exit(1);
}

// ---------------------------------------------------------------------------
// T-31 — refuse to seed known-password accounts into a non-local database.
//
// This runs AFTER the dotenv load above has resolved the target and BEFORE
// createClient below, so a non-local run constructs no client and makes no
// network call. It is the third and last Node-side path from a routine command
// to production: T-24 closed vitest, T-27 closed Playwright, this closes here.
//
// isLocalUrl() is imported, not reimplemented. vitest.config.ts,
// playwright.config.ts, tests/unit/setup.ts and the e2e specs all refuse on
// that exact predicate; a second, subtly-different notion of "local" is how
// this bug class comes back.
//
// There is no bypass variable — not even the opt-out sentence tests/env-guard.ts
// honours for read-mostly integration runs. Seeding a password that is a
// published constant into a hosted project has no legitimate use.
// ---------------------------------------------------------------------------
if (!isLocalUrl(SUPABASE_URL)) {
  const host = hostOf(SUPABASE_URL) ?? '(not a parseable URL)';
  console.error(
    [
      '',
      '='.repeat(74),
      '  REFUSED — seed-auth-users was pointed at a NON-LOCAL database.',
      '',
      `    NEXT_PUBLIC_SUPABASE_URL host = ${host}`,
      '    Only localhost / 127.0.0.1 is accepted.',
      '',
      '  WHY THIS IS FATAL',
      '    This script uses the SERVICE-ROLE key, which bypasses every RLS',
      '    policy, and creates admin@example.test, reviewer@example.test and',
      '    learner@example.test with the password DemoPassword123! — a constant',
      '    committed to this repo. Against a hosted project those are three real',
      '    known-password logins in production.',
      '',
      '    Note that .env.local points at the HOSTED PRODUCTION project, and this',
      '    script loads it. So a bare `pnpm db:seed-auth` targets production.',
      '',
      '  HOW TO RUN IT LOCALLY',
      '    1. supabase start',
      '    2. Read the local service-role key out of `supabase status`.',
      '    3. Name the target explicitly (dotenv will not overwrite it, so this',
      '       beats .env.local — do NOT edit that file):',
      '         NEXT_PUBLIC_SUPABASE_URL="http://127.0.0.1:54321" \\',
      '         SUPABASE_SERVICE_ROLE_KEY="<local service-role key>" \\',
      '         pnpm db:seed-auth',
      '',
      '  There is NO override for this check.',
      '='.repeat(74),
      '',
    ].join('\n')
  );
  process.exit(1);
}

if (SERVICE_ROLE_KEY.includes('placeholder')) {
  console.error(
    '[seed-auth-users] SUPABASE_SERVICE_ROLE_KEY is a placeholder. Run `supabase start` and use the local service-role key from `supabase status`.'
  );
  process.exit(1);
}

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const DEMO_PASSWORD = 'DemoPassword123!';

const DEMO_USERS = [
  {
    id: 'b1000000-0000-0000-0000-000000000001',
    email: 'admin@example.test',
    role: 'manager',
  },
  {
    id: 'b1000000-0000-0000-0000-000000000002',
    email: 'reviewer@example.test',
    role: 'reviewer',
  },
  {
    id: 'b1000000-0000-0000-0000-000000000003',
    email: 'learner@example.test',
    role: 'learner',
  },
] as const;

async function upsertUser(user: (typeof DEMO_USERS)[number]) {
  // Check if a user with this UUID already exists
  const { data: existing, error: getErr } = await admin.auth.admin.getUserById(user.id);

  if (getErr && getErr.status !== 404) {
    throw new Error(`getUserById failed for ${user.email}: ${getErr.message}`);
  }

  if (existing?.user) {
    console.log(`[seed-auth-users] ${user.email} already exists (${user.id}) — skipping`);
    return { created: false };
  }

  // Supabase admin.createUser auto-generates a UUID — to pin a specific UUID,
  // we use the lower-level approach: createUser then check the returned ID.
  // For deterministic UUIDs we use the `id` field which IS supported by the
  // Admin API (it's just under-documented).
  const { error: createErr } = await admin.auth.admin.createUser({
    id: user.id,
    email: user.email,
    password: DEMO_PASSWORD,
    email_confirm: true,
    user_metadata: { seeded: true, role: user.role },
  } as any); // `id` field requires Supabase JS v2.50+; cast to any for older versions

  if (createErr) {
    throw new Error(`createUser failed for ${user.email}: ${createErr.message}`);
  }

  console.log(`[seed-auth-users] Created ${user.email} (${user.id})`);
  return { created: true };
}

async function main() {
  console.log('[seed-auth-users] Seeding 3 demo auth users...');
  console.log(`[seed-auth-users] Supabase URL: ${SUPABASE_URL}`);
  console.log(`[seed-auth-users] Demo password: ${DEMO_PASSWORD}\n`);

  let created = 0;
  let skipped = 0;

  for (const user of DEMO_USERS) {
    const result = await upsertUser(user);
    if (result.created) created++;
    else skipped++;
  }

  console.log(`\n[seed-auth-users] Done. Created: ${created}, Skipped: ${skipped}`);
  console.log('[seed-auth-users] Demo logins:');
  for (const user of DEMO_USERS) {
    console.log(`  ${user.role.padEnd(8)} → ${user.email} / ${DEMO_PASSWORD}`);
  }
}

main().catch((err) => {
  console.error('[seed-auth-users] FATAL:', err);
  process.exit(1);
});
