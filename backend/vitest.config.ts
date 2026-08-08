import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';
import { config as loadEnv } from 'dotenv';
import { assertLocalDatabaseOnly, SHELL_SNAPSHOT_VAR } from './tests/env-guard';

// ---------------------------------------------------------------------------
// T-24 — the test suite must never be able to reach a hosted database.
//
// Order matters, and each step is load-bearing:
//
//   1. Snapshot whatever NEXT_PUBLIC_SUPABASE_URL the shell handed us, BEFORE
//      .env.test overwrites it. Overwriting alone would silently paper over a
//      shell that ran `source .env.local`, and that same shell still feeds
//      playwright, scripts/ and psql, none of which read .env.test. We would
//      rather refuse the run than quietly correct it.
//   2. Load .env.test with override:true so it beats both the shell and the
//      fourteen tests/integration/ files that call
//      `config({ path: '.env.local' })` at module scope. dotenv never
//      overwrites an already-set var, so winning here means winning outright.
//   3. Assert every database target is local. This runs in the main process
//      before a single worker is spawned, so a bad run dies immediately with
//      one message instead of once per test file.
// ---------------------------------------------------------------------------
const shellSupabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
if (shellSupabaseUrl) {
  process.env[SHELL_SNAPSHOT_VAR] = shellSupabaseUrl;
}

loadEnv({ path: resolve(__dirname, '.env.test'), override: true });

assertLocalDatabaseOnly();

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./tests/unit/setup.ts'],
    globals: true,
    // Hand the resolved, guard-approved values to every worker explicitly.
    // Workers inherit a copy of process.env, but being explicit means the
    // snapshot and the local credentials cannot be lost to a pool change.
    env: {
      NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
      SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
      DATABASE_URL: process.env.DATABASE_URL ?? '',
      [SHELL_SNAPSHOT_VAR]: process.env[SHELL_SNAPSHOT_VAR] ?? '',
    },
    exclude: ['node_modules/**', '.next/**', 'tests/e2e/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/**',
        '.next/**',
        'tests/e2e/**',
        '**/*.d.ts',
        '**/*.config.*',
        '**/types/**',
      ],
    },
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, '.'),
      // Stub 'server-only' in test environments — it's a Next.js runtime guard,
      // not a real module, so we alias it to a no-op empty module.
      'server-only': resolve(__dirname, 'tests/__mocks__/server-only.ts'),
    },
  },
});
