/**
 * tests/e2e/global-setup.ts
 *
 * Playwright globalSetup — loads .env.test so the test process and the app
 * under test see the SAME local database, and refuses the run if they don't.
 *
 * Wired in playwright.config.ts via the `globalSetup` option.
 *
 * T-27 (found 2026-07-29): this file used to load `.env.local`, which points at
 * the hosted production project. tests/e2e/*.spec.ts read
 * SUPABASE_SERVICE_ROLE_KEY from here and perform service-role .insert/.update
 * on profiles, restaurants, certificates and submissions — service-role bypasses
 * every RLS policy, so against a hosted project those writes are real.
 *
 * Two things to know about the placement:
 *
 *   1. This is the BACKSTOP, not the abort point. Playwright runs plugin setup
 *      (which starts webServer: `pnpm dev`) BEFORE globalSetup, so a guard here
 *      would fire only after the app had already booted against .env.local. The
 *      load + assertion that actually aborts a bad run lives at module scope in
 *      playwright.config.ts. This call is the equivalent of tests/unit/setup.ts
 *      in the vitest path: it catches anything that reached the runner without
 *      going through the config.
 *
 *   2. override:true, deliberately — matching vitest.config.ts. Nothing in the
 *      ambient environment gets to redirect the suite; a shell that exported
 *      production values is refused by the guard rather than quietly corrected,
 *      because playwright.config.ts snapshotted the pre-override value into
 *      SHELL_SNAPSHOT_VAR. (CI does not run Playwright today —
 *      .github/workflows/ci.yml is typecheck + install only — so this takes no
 *      CI-provided env away from anyone.)
 */

import { config as loadDotenv } from 'dotenv';
import { resolve } from 'path';
import { assertLocalDatabaseOnly } from '../env-guard';

async function globalSetup(): Promise<void> {
  loadDotenv({
    path: resolve(__dirname, '..', '..', '.env.test'),
    override: true,
  });

  assertLocalDatabaseOnly();
}

export default globalSetup;
