import { defineConfig, devices } from '@playwright/test';
import { execFileSync } from 'child_process';
import { config as loadEnv } from 'dotenv';
import { resolve } from 'path';
import { assertLocalDatabaseOnly, isLocalUrl, SHELL_SNAPSHOT_VAR } from './tests/env-guard';

// ---------------------------------------------------------------------------
// T-27 — the e2e suite must never be able to reach a hosted database.
//
// T-24 closed this door for vitest (vitest.config.ts + tests/unit/setup.ts).
// Playwright reads NEITHER of those, and had TWO independent routes to
// production. Both are closed here. Fixing only the first would have been
// worse than fixing nothing: it looks safe and isn't.
//
//   ROUTE 1 — the TEST process.
//     tests/e2e/global-setup.ts used to load .env.local, and
//     tests/e2e/*.spec.ts then build a SERVICE-ROLE Supabase client from it and
//     .insert/.update profiles, restaurants, certificates and more. Service-role
//     bypasses every RLS policy. That file now loads .env.test.
//
//   ROUTE 2 — the APP under test.
//     webServer.command starts `pnpm dev`, a SEPARATE process. Next.js
//     auto-loads .env.local into it (verified: @next/env 14.2.35 loadEnvConfig
//     reads `.env.development.local`, `.env.local`, `.env.development`, `.env`
//     for `next dev` — never `.env.test`). The specs drive the app over HTTP,
//     so the app's own Supabase client would write to production even with the
//     test process pointed somewhere safe. webServer.env below hands the dev
//     server explicit local values instead.
//
// WHY THE GUARD IS AT MODULE SCOPE AND NOT IN globalSetup
//   Playwright starts the web server in a PLUGIN, and plugin setup runs before
//   globalSetup: runner/tasks.js createGlobalSetupTasks() spreads
//   createPluginSetupTasks(config) ahead of config.globalSetups.map(...).
//   A guard in globalSetup would therefore fire only AFTER `pnpm dev` had
//   already booted against .env.local. Module scope of this file is evaluated
//   before any task runs at all, so this is the only placement that aborts the
//   run before a web server or a browser exists.
//
// ORDER BELOW IS LOAD-BEARING, and mirrors vitest.config.ts step for step:
//   1. Snapshot whatever NEXT_PUBLIC_SUPABASE_URL the shell handed us BEFORE
//      .env.test overwrites it. Silently correcting a shell that ran
//      `source .env.local` is not good enough — that same shell still feeds
//      scripts/ and psql. We refuse the run instead.
//   2. Load .env.test with override:true so it beats the shell and anything
//      .env.local says. dotenv never overwrites an already-set var, so winning
//      here means winning outright.
//   3. Assert every database target is local, in this process.
//   4. Assert the values we are about to hand the dev server are local too —
//      the app's env is a separate surface and gets its own assertion.
// ---------------------------------------------------------------------------
const shellSupabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
if (shellSupabaseUrl) {
  process.env[SHELL_SNAPSHOT_VAR] = shellSupabaseUrl;
}

loadEnv({ path: resolve(__dirname, '.env.test'), override: true });

assertLocalDatabaseOnly();

/**
 * Shared secrets that the specs compare against the SERVER's copy, defaulted
 * here so the two processes cannot disagree.
 *
 * These are not credentials for anything — they are strings that must simply
 * match on both sides:
 *   CRON_SECRET           — Authorization: Bearer <x> on /api/cron/*
 *   STRIPE_WEBHOOK_SECRET — signs a locally-generated webhook payload via
 *                           Stripe.webhooks.generateTestHeaderString
 *
 * Why this is set on process.env and not only in webServer.env: before T-27 the
 * test process got these from .env.local, so both sides matched by accident.
 * .env.test does not define them, and the specs' own fallbacks DISAGREE with
 * each other — full-pilot-loop.spec.ts:167 falls back to
 * 'whsec_test_placeholder' while p09-csrf-middleware.spec.ts:56 falls back to
 * ''. Defaulting them in webServer.env alone therefore fixed one spec and broke
 * another (p09 #3 sent `Bearer ` and got 401). Setting them HERE, before any
 * spec or the web server reads them, is the only placement where every reader
 * sees the same value.
 *
 * Ideally these would live in the committed .env.test next to the local
 * Supabase values; they are here because that keeps the whole e2e env contract
 * in one file the guard already owns.
 */
const E2E_SHARED_SECRET_DEFAULTS: Record<string, string> = {
  CRON_SECRET: 'placeholder_cron_secret_build_only',
  STRIPE_WEBHOOK_SECRET: 'whsec_test_placeholder',
};
for (const [key, fallback] of Object.entries(E2E_SHARED_SECRET_DEFAULTS)) {
  if (!process.env[key]) process.env[key] = fallback;
}

/**
 * Where the specs send their requests.
 *
 * BASE_URL is a third route to production and gets its own check: point it at
 * a deployed environment and the specs drive THAT app, whose Supabase client
 * is the hosted one, no matter how local this process and the dev server are.
 */
const baseURL = process.env.BASE_URL || 'http://localhost:3000';
if (!isLocalUrl(baseURL)) {
  throw new Error(
    [
      '',
      '='.repeat(74),
      '  E2E RUN ABORTED — BASE_URL is not on this machine.',
      '',
      `    BASE_URL = ${baseURL}`,
      '',
      '  The specs perform service-role writes and drive the app through its',
      '  own API. Against a deployed target those writes are real. Unset',
      '  BASE_URL to use http://localhost:3000.',
      '='.repeat(74),
      '',
    ].join('\n')
  );
}

/**
 * The environment handed to `pnpm dev` — this is what closes ROUTE 2.
 *
 * Playwright merges these over the inherited environment
 * (webServerPlugin: `{ ...DEFAULT_ENVIRONMENT_VARIABLES, ...process.env,
 * ...options.env }`), and @next/env's processEnv only fills keys whose
 * inherited value is `undefined` — so every key set here is final and
 * .env.local cannot reach the dev server's Supabase client.
 *
 * Every database target is set UNCONDITIONALLY, including to '' — an empty
 * string is still "defined", so it blocks .env.local while failing visibly
 * rather than silently falling back to hosted credentials.
 *
 * Non-database integrations (Stripe keys, Mux, Mapbox, Upstash) are
 * deliberately NOT pinned here: they are not a route to the production
 * database, and forcing them empty would break app boot on routes that
 * construct their clients at module scope. They keep whatever the dev server
 * would otherwise resolve.
 *
 * RESEND_API_KEY was in that list until T-33 and is now the exception — the
 * reasoning is at its entry below.
 *
 * CRON_SECRET and STRIPE_WEBHOOK_SECRET are the exception: they are compared
 * for equality across the two processes, so both sides must see the SAME
 * value. They are read straight off process.env, which
 * E2E_SHARED_SECRET_DEFAULTS above has already populated — one value, both
 * processes, no per-spec fallback in play.
 */
const webServerEnv: Record<string, string> = {
  // Database targets — pinned local, always set.
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
  DATABASE_URL: process.env.DATABASE_URL ?? '',
  TEST_DATABASE_URL: process.env.TEST_DATABASE_URL ?? '',
  // Shared secrets the specs compare against the server's copy — already
  // defaulted onto process.env above, so these two lines cannot drift from
  // what the specs read.
  CRON_SECRET: process.env.CRON_SECRET ?? '',
  STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET ?? '',
  // T-33 — the suite must never hold real Resend credentials.
  //
  // .env.local carries a LIVE key and `next dev` loads it, so until this line
  // existed the e2e run authenticated against the real account. Measured on a
  // full baseline run at 16e14d8: 6 POSTs to api.resend.com, every one HTTP
  // 200 — accepted for delivery, quota spent. Every seeded recipient is
  // unroutable (`@example.test` is an IANA-reserved TLD, `.local` is reserved
  // for mDNS), so each accepted message hard-bounces, and hard bounces degrade
  // the sending reputation of the very domain that delivers real restaurant
  // invites.
  //
  // Pinned to junk rather than unset: lib/email/client.ts:3 throws at MODULE
  // SCOPE when RESEND_API_KEY is missing, which would break app boot on every
  // route that imports it. A junk value keeps the client constructible while
  // making the account unreachable.
  //
  // What this does NOT do: stop the HTTP request. lib/email/send.ts has no
  // guard and calls Resend unconditionally, so the SDK still POSTs and gets
  // 401 back. What it stops is the call being AUTHENTICATED — no 2xx, no 429,
  // nothing accepted for delivery, no quota consumed. That is the property
  // that protects the account.
  RESEND_API_KEY: 'PLACEHOLDER-NOT-A-REAL-KEY-e2e-must-never-send-mail',
  // Keep the dev server on whatever port baseURL says.
  PORT: new URL(baseURL).port || '3000',
};

// The app's environment is asserted on its own terms, not inferred from ours.
assertLocalDatabaseOnly(webServerEnv);

/**
 * True in the top-level runner process, false when this config is being
 * re-evaluated inside a test worker.
 *
 * This distinction is load-bearing for the port probe below and nothing else.
 * Playwright loads this config again in EVERY worker, by which point the web
 * server the runner legitimately started IS listening — so an ungated probe
 * throws in every worker and fails the entire suite. (Measured: 118 failed /
 * 46 did not run.) The assertions above are safe to repeat and are left to run
 * in workers as a backstop.
 *
 * TEST_WORKER_INDEX is set in the WorkerMain constructor
 * (playwright/lib/worker/workerMain.js:60), which runs before the worker loads
 * this file, so it is reliably present here.
 */
const isWorkerProcess = process.env.TEST_WORKER_INDEX !== undefined;

/**
 * True when something is already listening on the baseURL port.
 *
 * Synchronous on purpose: this has to run during module evaluation, before
 * Playwright's plugin tasks start. Uses a short-lived `node -e` TCP probe
 * rather than lsof/netstat so it behaves the same on macOS and CI Linux.
 */
function somethingIsListening(url: string): boolean {
  const parsed = new URL(url);
  const host = parsed.hostname.replace(/^\[|\]$/g, ''); // net.connect wants ::1, not [::1]
  const port = Number(parsed.port || (parsed.protocol === 'https:' ? 443 : 80));
  const probe = [
    "const s = require('net').connect(",
    `  { host: ${JSON.stringify(host)}, port: ${port} },`,
    '  () => { s.destroy(); process.exit(0); }',
    ');',
    's.setTimeout(1500, () => { s.destroy(); process.exit(1); });',
    "s.on('error', () => process.exit(1));",
  ].join('\n');

  try {
    execFileSync(process.execPath, ['-e', probe], { timeout: 5000, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// A dev server that is ALREADY RUNNING defeats webServer.env completely.
//
// `reuseExistingServer` used to be `!process.env.CI`, so a `pnpm dev` left over
// from an earlier shell was silently reused — and a reused process keeps the
// env it was started with, which is .env.local, which is production. Nothing in
// webServer.env applies to a process Playwright did not spawn.
//
// So: reuse is off unconditionally (below), and the run detects the case here
// with an explanation instead of leaving the user to decode Playwright's
// generic "port is already used" error. The cost is real and accepted — you can
// no longer keep `pnpm dev` running while you run the e2e suite.
//
// Runner only: in a worker the server is up because WE started it.
// ---------------------------------------------------------------------------
if (!isWorkerProcess && somethingIsListening(baseURL)) {
  throw new Error(
    [
      '',
      '='.repeat(74),
      '  E2E RUN ABORTED — something is already listening on the test URL.',
      '',
      `    ${baseURL}`,
      '',
      '  WHY THIS IS FATAL',
      '    Playwright can only control the environment of a server IT starts.',
      '    A dev server you started earlier keeps the env it was booted with —',
      '    and `next dev` loads .env.local, which points at the HOSTED project.',
      '    Reusing it would hand the whole suite, including its service-role',
      '    writes, to production while every guard in this file reported green.',
      '',
      '  HOW TO FIX',
      '    Stop it, then re-run the suite:',
      `      lsof -ti :${new URL(baseURL).port || '3000'} | xargs kill`,
      '      pnpm test:e2e',
      '='.repeat(74),
      '',
    ].join('\n')
  );
}

export default defineConfig({
  testDir: './tests/e2e',
  globalSetup: require.resolve('./tests/e2e/global-setup'),
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'Mobile Chrome',
      use: { ...devices['Pixel 5'] },
    },
  ],
  webServer: {
    command: 'pnpm dev',
    url: baseURL,
    // NEVER true — see the block above. A reused server ignores `env`.
    reuseExistingServer: false,
    env: webServerEnv,
  },
});
