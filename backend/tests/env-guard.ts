/**
 * tests/env-guard.ts
 *
 * Refuses to let the test suite talk to a database that is not on this machine.
 *
 * Why this exists (T-24, found 2026-07-28):
 *   ~20 files under tests/integration/ call the real service-role Supabase
 *   client. Service-role bypasses every RLS policy, and several of those files
 *   INSERT, UPDATE and DELETE. Fourteen of them additionally call
 *   `config({ path: '.env.local' })` at module scope, so they load whatever
 *   .env.local says *without anyone sourcing anything* — and .env.local points
 *   at the hosted production project.
 *
 * This module is the single source of truth for "is the run pointed somewhere
 * safe". It is called from two places:
 *   1. vitest.config.ts — runs once, in the main process, before any worker is
 *      spawned. This is what actually aborts the run.
 *   2. tests/unit/setup.ts — runs inside every worker before that worker
 *      imports its test module, so nothing that bypasses the config (a custom
 *      --config, a var injected later) can slip through.
 *
 * It reads environment variables only. It never prints key material.
 */

/**
 * Hosts that are unambiguously this machine.
 *
 * Note `[::1]`, in brackets: URL.hostname preserves the brackets on an IPv6
 * literal rather than stripping them. Both spellings are listed so the set is
 * correct regardless.
 */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1', '[::1]']);

/**
 * The opt-out. Deliberately not a boolean.
 *
 *  - The name says "tests" and "remote db", so it cannot be mistaken for a
 *    product feature flag, and the ALLERGENWISE_ prefix means no CI provider,
 *    framework or tool will ever set it by accident.
 *  - It must equal an exact first-person sentence. `=1`, `=true` and `=yes`
 *    are all rejected, so muscle memory cannot enable it and neither can an
 *    agent pattern-matching on "set the flag to 1".
 *  - The sentence is greppable: one search finds every place it is used, and
 *    it shows up verbatim in shell history and CI logs as an attributable
 *    decision by a named person.
 *  - Even when honoured, the guard prints a banner. The bypass is never quiet.
 */
export const ALLOW_REMOTE_VAR = 'ALLERGENWISE_ALLOW_TESTS_AGAINST_REMOTE_DB';
export const ALLOW_REMOTE_VALUE = 'i-accept-tests-may-destroy-this-database';

/**
 * vitest.config.ts stashes the pre-override shell value of
 * NEXT_PUBLIC_SUPABASE_URL here before .env.test overwrites it, so the guard
 * can still refuse a poisoned shell. Overriding the value is not enough on its
 * own: the same shell also feeds playwright, scripts/ and psql, none of which
 * read .env.test.
 */
export const SHELL_SNAPSHOT_VAR = 'ALLERGENWISE_TEST_SHELL_SUPABASE_URL';

interface Offender {
  varName: string;
  value: string;
  note: string;
}

/**
 * What the guard needs from an environment: string lookups, nothing more.
 *
 * Deliberately NOT NodeJS.ProcessEnv — Next.js augments that type to make
 * NODE_ENV required, which would force every caller to pad out a synthetic env
 * with fields the guard never reads. process.env satisfies this.
 */
export type EnvLike = Readonly<Record<string, string | undefined>>;

/**
 * Hostname of a URL-ish string, or null if it does not parse as a URL.
 *
 * Exported so a caller that must NAME the offending host in its own refusal
 * message (scripts/seed-auth-users.ts, T-31) does not grow a second copy of
 * "how do I get a host out of this string". One implementation, one answer.
 */
export function hostOf(value: string): string | null {
  try {
    return new URL(value).hostname;
  } catch {
    return null;
  }
}

/** True only when the value parses as a URL whose host is this machine. */
export function isLocalUrl(value: string): boolean {
  const host = hostOf(value);
  if (host === null) return false;
  return LOCAL_HOSTS.has(host);
}

function describeOffender(varName: string, value: string): Offender {
  const host = hostOf(value);
  const note =
    host === null
      ? 'does not parse as a URL, so it cannot be proven local'
      : `host "${host}" is not localhost/127.0.0.1`;
  return { varName, value, note };
}

/** Every var that can aim a test at a database, in the order we report them. */
const DB_TARGET_VARS = ['NEXT_PUBLIC_SUPABASE_URL', 'DATABASE_URL', 'TEST_DATABASE_URL'] as const;

function collectOffenders(env: EnvLike): Offender[] {
  const offenders: Offender[] = [];

  for (const varName of DB_TARGET_VARS) {
    const value = env[varName];
    if (!value) continue;
    if (isLocalUrl(value)) continue;
    offenders.push(describeOffender(varName, value));
  }

  const shellValue = env[SHELL_SNAPSHOT_VAR];
  if (shellValue && !isLocalUrl(shellValue)) {
    const o = describeOffender('NEXT_PUBLIC_SUPABASE_URL', shellValue);
    offenders.push({
      ...o,
      varName: `${o.varName} (exported by your shell, before .env.test overrode it)`,
    });
  }

  return offenders;
}

function banner(text: string): string {
  const rule = '='.repeat(74);
  return `\n${rule}\n${text}\n${rule}\n`;
}

function buildFailureMessage(offenders: Offender[]): string {
  const lines = offenders
    .map((o) => `    ${o.varName}\n      = ${o.value}\n      ${o.note}`)
    .join('\n\n');

  return banner(
    [
      '  TEST RUN ABORTED — the suite was pointed at a NON-LOCAL database.',
      '',
      lines,
      '',
      '  WHY THIS IS FATAL',
      '    ~20 files in tests/integration/ use the SERVICE-ROLE Supabase client,',
      '    which bypasses every RLS policy, and several of them INSERT, UPDATE and',
      '    DELETE. Fourteen of them load .env.local themselves at import time, so no',
      '    `source` is needed for this to happen. Against a hosted project those',
      '    writes are real.',
      '',
      '  HOW TO FIX',
      '    1. Start the local stack:',
      '         supabase start',
      '    2. Run the suite with NO env preamble at all:',
      '         pnpm test',
      '       The committed .env.test supplies the local URL and the public demo',
      '       keys. It is loaded by vitest.config.ts with override:true, so it beats',
      '       anything .env.local says.',
      '    3. If your shell already exports Supabase vars — e.g. you ran',
      '       `source .env.local` — clear them, or just open a new shell:',
      '         unset NEXT_PUBLIC_SUPABASE_URL NEXT_PUBLIC_SUPABASE_ANON_KEY \\',
      '               SUPABASE_SERVICE_ROLE_KEY DATABASE_URL TEST_DATABASE_URL',
      '',
      '  DELIBERATE OVERRIDE (you almost certainly do not want this)',
      `    ${ALLOW_REMOTE_VAR}=${ALLOW_REMOTE_VALUE}`,
    ].join('\n')
  );
}

function buildBypassMessage(offenders: Offender[]): string {
  const targets = offenders.map((o) => `    ${o.varName} = ${o.value}`).join('\n');
  return banner(
    [
      `  ${ALLOW_REMOTE_VAR} IS SET.`,
      '  The non-local database guard is DISABLED for this run. Tests that use the',
      '  service-role client may INSERT, UPDATE and DELETE against:',
      '',
      targets,
    ].join('\n')
  );
}

/**
 * Hard-fail the run unless every database target is on this machine.
 *
 * @param env  Environment to inspect. Defaults to process.env.
 * @throws     Error naming every offending variable and how to fix it.
 */
export function assertLocalDatabaseOnly(env: EnvLike = process.env): void {
  const offenders = collectOffenders(env);
  if (offenders.length === 0) return;

  if (env[ALLOW_REMOTE_VAR] === ALLOW_REMOTE_VALUE) {
    process.stderr.write(buildBypassMessage(offenders));
    return;
  }

  const message = buildFailureMessage(offenders);
  // Write to stderr as well as throwing: vitest renders a thrown setup error
  // once per worker and can truncate it, and this message must always be
  // readable in full.
  process.stderr.write(message);
  throw new Error(message);
}
