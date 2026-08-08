/**
 * Vitest global test setup.
 * Imported before every test file via vitest.config.ts setupFiles.
 */
import { vi } from 'vitest';
import { assertLocalDatabaseOnly } from '../env-guard';

// T-24 — refuse to run against anything but a local database.
//
// This is the per-worker enforcement point. vitest.config.ts already ran the
// same assertion in the main process, which is what normally aborts the run;
// this call is the backstop for anything that bypasses the config (a custom
// --config, a var injected after config load, a worker started with a
// different env). setupFiles execute before the worker imports its test
// module, so throwing here means no test body ever runs.
//
// Anything this rejects is explained, with the offending URL and the fix, by
// the message tests/env-guard.ts builds.
assertLocalDatabaseOnly();

// Mock 'server-only' to prevent runtime errors in unit tests
// (server-only throws when imported outside Next.js server context)
vi.mock('server-only', () => ({}));
