/**
 * scripts/seed-db.ts
 *
 * `pnpm db:seed` — runs db/seed.sql through psql, but only against a database
 * on this machine.
 *
 * WHY THIS FILE EXISTS (T-37, found 2026-07-31)
 *   This script used to be a one-liner in package.json:
 *
 *     "db:seed": "psql $DATABASE_URL -f db/seed.sql"
 *
 *   No TypeScript executed, so none of the guards this repo already has could
 *   reach it: T-24 closed vitest, T-27 closed Playwright, T-31 closed
 *   scripts/seed-auth-users.ts — and this one stayed open behind all three. Any
 *   shell that had run `source .env.local` (which points at the HOSTED
 *   PRODUCTION pooler) turned `pnpm db:seed` into 207 lines of demo
 *   restaurants, profiles, curriculum and reviews landing in production. It was
 *   the last routine command in the repo that could do that by accident.
 *
 * HOW IT IS CLOSED
 *   1. .env.local never gets a vote. This file deliberately does NOT load
 *      dotenv. The target is whatever the *shell* says, or the local default —
 *      nothing is read off disk. (scripts/seed-auth-users.ts must load dotenv,
 *      because it needs the service-role key from there. This script needs no
 *      secret it cannot default, so it takes the stricter option.)
 *   2. The target is judged by isLocalUrl() imported from tests/env-guard —
 *      the same predicate vitest, Playwright and seed-auth-users refuse on.
 *      It is imported, never reimplemented: a second, subtly-different notion
 *      of "local" is exactly how this bug class comes back. new URL() parses
 *      `postgresql://` and returns the hostname, so the predicate needs no
 *      change to cover a libpq URL.
 *   3. A non-local target connects to nothing. The refusal happens before psql
 *      is spawned, so no packet leaves this machine.
 *   4. There is no bypass variable — not even the opt-out sentence
 *      tests/env-guard.ts honours for read-mostly integration runs. Seeding
 *      fixture data into a hosted project has no legitimate use.
 *
 * WHY STILL psql, RATHER THAN A `pg` CLIENT
 *   db/seed.sql line 103 is `\ir seed-curriculum.sql`. That is a psql
 *   meta-command, not SQL; a `pg` client hands it to the server and the server
 *   rejects it. Keeping psql keeps the curriculum half of the seed.
 *
 * A FAILED SEED MUST FAIL LOUDLY (T-37b)
 *   psql's default is to report an error and keep going, exiting 0 at the end.
 *   db/seed-curriculum.sql wraps its work in `begin; … commit;`, so an error
 *   there rolls the whole block back and the command still reports success —
 *   verified, not assumed. `-v ON_ERROR_STOP=1` makes psql abort on the first
 *   error and exit 3, which this script then propagates.
 *
 * THIS SEED DELETES AS WELL AS INSERTS
 *   db/seed-curriculum.sql clears the seeded checkpoint questions and the exam
 *   pool before re-inserting them, and quiz_attempt_answers has ON DELETE
 *   CASCADE against questions. So a re-seed discards recorded quiz answers for
 *   those questions. That is fine on a local fixture database and is precisely
 *   why this must never reach a hosted one.
 *
 * WHAT IS NEVER PRINTED
 *   The resolved URL. It carries a password. Only the host is ever shown — and
 *   psql's own thrown error is never re-printed either, because Node builds
 *   that message out of the full argv, URL included.
 *
 * USAGE
 *   pnpm db:seed
 *     Seeds the local Supabase database at
 *     postgresql://postgres:postgres@127.0.0.1:54322/postgres.
 *
 *   DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:54322/postgres" pnpm db:seed
 *     Same thing, said explicitly. Needed when your shell already exports a
 *     hosted DATABASE_URL — this script refuses that shell value rather than
 *     silently ignoring it.
 */

import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

import { hostOf, isLocalUrl } from '../tests/env-guard';

/**
 * The local Supabase Postgres, as printed by `supabase status`.
 *
 * A default rather than a hard requirement, so the common case — clean shell,
 * running local stack — is a bare `pnpm db:seed`.
 */
const LOCAL_DEFAULT = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

/** Absolute, so the seed does not depend on the caller's working directory. */
const SEED_FILE = resolve(__dirname, '..', 'db', 'seed.sql');

/**
 * An exported-but-empty DATABASE_URL means "unset", not "a nameless database".
 * `??` alone would keep the empty string, and this script would then refuse it
 * as unparseable — a safe outcome reached by a confusing route.
 */
const shellValue = process.env.DATABASE_URL?.trim();
const target = shellValue ? shellValue : LOCAL_DEFAULT;

// ---------------------------------------------------------------------------
// T-37 — refuse any target that is not this machine.
//
// Runs before psql is spawned, so a refused run opens no connection. No bypass
// variable exists, by design.
// ---------------------------------------------------------------------------
if (!isLocalUrl(target)) {
  const host = hostOf(target) ?? '(not a parseable URL)';
  console.error(
    [
      '',
      '='.repeat(74),
      '  REFUSED — db:seed was pointed at a NON-LOCAL database.',
      '',
      `    DATABASE_URL host = ${host}`,
      '    Only localhost / 127.0.0.1 is accepted.',
      '',
      '  WHY THIS IS FATAL',
      '    db/seed.sql inserts 207 lines of fixture data — demo restaurants,',
      '    profiles, the whole curriculum and a demo review — under hard-coded',
      '    UUIDs. Against a hosted project those rows are real, and they carry',
      '    example.test addresses into live tables.',
      '',
      '    It also DELETES. db/seed-curriculum.sql, pulled in by \\ir, drops and',
      '    re-inserts the seeded checkpoint questions and the exam pool on every',
      '    run, and quiz_attempt_answers cascades on that delete. Against a',
      "    hosted project this destroys real learners' recorded answers.",
      '',
      '    .env.local points at the HOSTED PRODUCTION pooler, so any shell that',
      '    had run `source .env.local` used to make `pnpm db:seed` do exactly',
      '    that. This script does not read .env.local at all.',
      '',
      '  HOW TO RUN IT LOCALLY',
      '    1. supabase start',
      '    2. Either open a shell with no DATABASE_URL exported and run:',
      '         pnpm db:seed',
      '       or name the local target explicitly:',
      '         DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:54322/postgres" \\',
      '         pnpm db:seed',
      '',
      '  There is NO override for this check.',
      '='.repeat(74),
      '',
    ].join('\n')
  );
  process.exit(1);
}

try {
  // The URL is an argv entry, never interpolated into a shell string: no shell
  // is involved at all, so nothing in it can be parsed as a command.
  //
  // ON_ERROR_STOP=1 is not optional (T-37b). Without it psql prints each error
  // and carries on, then exits 0 — and db/seed-curriculum.sql:206-393 is a
  // single `begin; … commit;` block, so one error inside it rolls back the
  // whole curriculum half while `pnpm db:seed` still reports success. That is
  // the T-32 shape: a command that seeded nothing and said it worked.
  execFileSync('psql', [target, '-v', 'ON_ERROR_STOP=1', '-f', SEED_FILE], { stdio: 'inherit' });
} catch (err) {
  const { status, code } = err as { status?: number | null; code?: string };

  if (code === 'ENOENT') {
    console.error(
      '[seed-db] psql not found on PATH. Install the Postgres client tools ' +
        '(`brew install libpq`, then put it on PATH, or `brew install postgresql`).'
    );
    process.exit(1);
  }

  // Deliberately not printing the caught error, nor its message: Node builds
  // both from the full argv, which includes the URL and therefore a password.
  // psql has already written its own diagnostics to the inherited stderr.
  console.error(`[seed-db] psql exited ${status ?? 'abnormally'}. Seed did not complete.`);
  process.exit(typeof status === 'number' && status !== 0 ? status : 1);
}
