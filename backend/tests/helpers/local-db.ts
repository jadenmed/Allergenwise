/**
 * tests/helpers/local-db.ts
 *
 * T-25 — the predicate that decides whether a real-database suite may run.
 *
 * WHY THIS EXISTS
 * ---------------
 * Every real-DB suite gated itself on a module-scope constant that looked like
 * this:
 *
 *   const hasLocalSupabase =
 *     SUPABASE_URL !== '' && SERVICE_KEY !== '' && !SERVICE_KEY.includes('placeholder');
 *
 * That asks two questions — "are the vars set" and "is the key literally the
 * string placeholder" — and never asks the one its name promises: *is this
 * database on my machine*. A hosted URL satisfied it. Twenty-two suites carried
 * a copy, several of which INSERT, UPDATE and DELETE through the service-role
 * client, which bypasses every RLS policy.
 *
 * T-24 already stops the common case: `assertLocalDatabaseOnly` runs at module
 * scope in vitest.config.ts and playwright.config.ts and aborts the whole run.
 * That is the guard. This file fixes the *second* layer — the per-file flag —
 * so that a path which reaches a suite without going through either config (a
 * direct tsx/node import, a custom --config, a future runner) still refuses,
 * and so that the constant's name stops lying to the next reader.
 *
 * THE FOUR RULES THIS FILE IMPLEMENTS
 * -----------------------------------
 * 1. LOCALITY IS DECIDED IN ONE PLACE, AND IT IS NOT THIS ONE.
 *    `isLocalUrl` and the LOCAL_HOSTS set live in tests/env-guard.ts. This file
 *    imports them. A second host list would be a second answer to "what counts
 *    as local", and the two would drift — the exact failure T-46a's single
 *    `lib/staff/membership.ts` was written to avoid.
 *
 * 2. FAIL CLOSED, ALWAYS.
 *    Missing var, empty string, a value that does not parse as a URL, a URL
 *    whose host cannot be read — every one of them returns false and the suite
 *    skips. A guard that runs when it is unsure is worse than no guard, because
 *    it reads as protection.
 *
 * 3. EVERY DATABASE TARGET THAT IS SET MUST BE LOCAL — NOT JUST THE ONE THIS
 *    SUITE HAPPENS TO USE.
 *    Suites reach Postgres two ways: through PostgREST
 *    (NEXT_PUBLIC_SUPABASE_URL) and directly via psql (DATABASE_URL,
 *    TEST_DATABASE_URL). A suite that talks PostgREST can still import product
 *    code that opens a direct connection, so validating only the Supabase URL
 *    leaves the direct path open. Any target that is set and non-local refuses
 *    the whole run. A target that is unset is not a target — it is only
 *    required when the suite actually needs it (see `hasLocalPostgres`).
 *
 * 4. CREDENTIALS ARE CHECKED AFTER LOCALITY, NEVER INSTEAD OF IT.
 *    The old constant checked credentials only. Key checks stay — a placeholder
 *    key against a local stack is still a broken run — but they are the second
 *    question, never the first.
 *
 * WHAT COUNTS AS LOCAL
 * --------------------
 * Exactly LOCAL_HOSTS in tests/env-guard.ts: localhost, 127.0.0.1, 0.0.0.0,
 * ::1 and [::1].
 *
 * `host.docker.internal` is deliberately NOT accepted. It names the *host of
 * the container asking*, which is not the same claim as "this is my throwaway
 * database" — from inside a container it resolves to whatever that machine is
 * running, and on a developer box that has ever run `source .env.local` the
 * answer can be a tunnel to something real. Nothing in this repository runs the
 * suite inside a container, so accepting it would buy nothing and widen T-24's
 * process-level guard at the same time, since both read the same set. If a
 * containerised runner is ever needed, add it to LOCAL_HOSTS in env-guard.ts
 * with its own justification — one set, one decision, one place.
 *
 * This module reads environment variables and never prints key material.
 */

import { isLocalUrl } from '../env-guard';

/**
 * Every variable that can aim a test at a database.
 *
 * Same list, same order, as DB_TARGET_VARS in tests/env-guard.ts. Kept as its
 * own const rather than imported because the two answer different questions:
 * env-guard aborts the process, this decides whether one suite runs.
 */
const DB_TARGET_VARS = ['NEXT_PUBLIC_SUPABASE_URL', 'DATABASE_URL', 'TEST_DATABASE_URL'] as const;

/**
 * What this module needs from an environment: string lookups, nothing more.
 * Deliberately not NodeJS.ProcessEnv — see the note on EnvLike in env-guard.ts.
 */
export type EnvLike = Readonly<Record<string, string | undefined>>;

export interface LocalDbOptions {
  /** Environment to inspect. Defaults to process.env. */
  env?: EnvLike;
  /**
   * Require a usable NEXT_PUBLIC_SUPABASE_ANON_KEY as well as the service key.
   * Set by the four RLS suites that drive an anon client to prove a policy
   * denies something — without the anon key those suites cannot make their
   * assertion at all, so running them would be worse than skipping.
   */
  anonKey?: boolean;
}

/**
 * A key we can actually authenticate with.
 *
 * The `placeholder` substring check is inherited from the constant this file
 * replaces: .env.example and several CI stubs ship keys spelled
 * `...placeholder...`, and a run holding one produces authentication failures
 * that read as product bugs. Kept as the second question, never the first.
 */
function isUsableKey(value: string | undefined): boolean {
  return typeof value === 'string' && value !== '' && !value.includes('placeholder');
}

/** True when `value` is set, parses as a URL, and its host is this machine. */
function isSetAndLocal(value: string | undefined): boolean {
  if (value === undefined || value === '') return false;
  return isLocalUrl(value);
}

/**
 * Rule 3: no database target that is SET may point off this machine.
 *
 * Unset targets pass — a suite that never touches TEST_DATABASE_URL should not
 * be blocked because it is absent. A suite that DOES need one asks for it
 * explicitly through `hasLocalPostgres` / `hasLocalTestPostgres`, which require
 * it to be both set and local.
 *
 * Exported because it is the honest answer to "is this whole environment safe",
 * independent of which credentials any one suite needs.
 */
export function everyDbTargetIsLocal(env: EnvLike = process.env): boolean {
  for (const varName of DB_TARGET_VARS) {
    const value = env[varName];
    if (value === undefined || value === '') continue;
    if (!isLocalUrl(value)) return false;
  }
  return true;
}

/**
 * May this suite talk to Supabase (PostgREST) with the service-role key?
 *
 * True only when every set database target is local, NEXT_PUBLIC_SUPABASE_URL
 * is itself set and local, and the service-role key is usable. Add
 * `{ anonKey: true }` when the suite also drives an anon client.
 */
export function hasLocalSupabase(options: LocalDbOptions = {}): boolean {
  const env = options.env ?? process.env;

  if (!everyDbTargetIsLocal(env)) return false;
  if (!isSetAndLocal(env.NEXT_PUBLIC_SUPABASE_URL)) return false;
  if (!isUsableKey(env.SUPABASE_SERVICE_ROLE_KEY)) return false;
  if (options.anonKey && !isUsableKey(env.NEXT_PUBLIC_SUPABASE_ANON_KEY)) return false;

  return true;
}

/**
 * May this suite open a direct psql connection on DATABASE_URL?
 *
 * For suites that bypass PostgREST entirely. DATABASE_URL must be set and
 * local — there is no default. A suite that defaults an unset DATABASE_URL to a
 * hardcoded local string is guessing about where it is about to write.
 */
export function hasLocalPostgres(options: LocalDbOptions = {}): boolean {
  const env = options.env ?? process.env;
  if (!everyDbTargetIsLocal(env)) return false;
  return isSetAndLocal(env.DATABASE_URL);
}

/**
 * May this suite open a direct psql connection on TEST_DATABASE_URL?
 *
 * TEST_DATABASE_URL is deliberately unset by .env.test — setting it opts a
 * live-migration suite in. This predicate keeps that opt-in but adds the
 * locality requirement the bare presence check never had.
 */
export function hasLocalTestPostgres(options: LocalDbOptions = {}): boolean {
  const env = options.env ?? process.env;
  if (!everyDbTargetIsLocal(env)) return false;
  return isSetAndLocal(env.TEST_DATABASE_URL);
}

/**
 * Why a suite is about to skip, or null when nothing is wrong.
 *
 * A silent `describe.skipIf` is indistinguishable from a suite nobody wrote.
 * This turns "0 tests ran" into an attributable sentence, and it is what the
 * negative-control test asserts on: proving the guard refuses is worth more
 * when it can also say what it refused and why.
 *
 * Never includes key material — keys are described, never printed.
 */
export function localDbRefusalReason(options: LocalDbOptions = {}): string | null {
  const env = options.env ?? process.env;

  for (const varName of DB_TARGET_VARS) {
    const value = env[varName];
    if (value === undefined || value === '') continue;
    if (!isLocalUrl(value)) {
      return `${varName} is not local (${value}) — refusing to run a real-database suite against it`;
    }
  }

  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  if (url === undefined || url === '') {
    return 'NEXT_PUBLIC_SUPABASE_URL is not set — cannot prove the target is local';
  }
  if (!isUsableKey(env.SUPABASE_SERVICE_ROLE_KEY)) {
    return 'SUPABASE_SERVICE_ROLE_KEY is missing or a placeholder';
  }
  if (options.anonKey && !isUsableKey(env.NEXT_PUBLIC_SUPABASE_ANON_KEY)) {
    return 'NEXT_PUBLIC_SUPABASE_ANON_KEY is missing or a placeholder';
  }

  return null;
}
