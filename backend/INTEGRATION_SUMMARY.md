# INTEGRATION_SUMMARY — integration/v0.1-hardening

_2026-07-09. Seven branches merged into `integration/v0.1-hardening` (base `8fd2715`). Do not push; main untouched._

## Merge order and results

| # | Branch | Merge | Conflicts |
|---|--------|-------|-----------|
| 1 | `fix/00-supabase-types` | clean | none |
| 2 | `fix/00b-seed-role-check` | clean | none |
| 3 | `fix/00c-manager-scrub` | clean | none |
| 4 | `perf/03-auth-guards` | conflicts | 3 files (below) |
| 5 | `perf/05-audit-batching` | clean | none |
| 6 | `perf/07-optimistic-lesson` | clean | none |
| 7 | `perf/08-directory-static` | clean | none |

Plus one coupled fix (own commit `5eac806`): `tests/integration/partner-attribution-rls.test.ts` seeded role `'manager'` → `'admin'`, consistent with 00b's constraint and the branch vocabulary.

## Conflicts resolved (perf/03 merge, commit `9164624`)

1. **`app/api/admin/roster/route.ts`** — perf/03 replaced the inline profile-fetch/role-check block with `requireRole(...)`; fix/00c had corrected the inline literal to `'admin'`. Resolution: kept perf/03's guard, removed the inline block, and corrected the guard's `roles: ['manager']` → `roles: ['admin']` (the guard was extracted before 00c's scrub, so it had faithfully preserved the bug).
2. **`app/api/admin/dashboard-stats/route.ts`** — identical situation, identical resolution.
3. **`app/api/invites/send/route.ts`** — `logEvent` signature: fix/00 typed `type: ActivityEventType`; perf/03 had `type: string`. Kept fix/00's stronger type (import already present).

Post-resolution sweep: zero `'manager'` role literals remain anywhere in `app/` or `lib/`.

## Verification (each step re-verified after every merge)

- `pnpm typecheck` → 0 errors (note: requires `pnpm install` after the fix/00 merge — `@supabase/ssr` bumped to 0.9.0; stale node_modules produces 22 phantom `never` errors)
- `pnpm build` → succeeds (exit 0, "Compiled successfully")
- Unit + integration (deterministic sequential run, `--no-file-parallelism`): **668 passed / 3 failed / 1 skipped**
- e2e: **129–132 passed / 2 skipped**; all failures itemized below

## Remaining failures — all verified pre-existing at base `8fd2715` (reproduced there directly)

1. **`reconcile-cert-states` ×3** — the documented Track D fixture-drift flake. Identical assertions at base.
2. **`cert-code.test.ts` entropy test** — statistical flake, ~1/10 runs (threshold 95/100). Also failed at base. Track D candidate: raise trials or seed the RNG.
3. **e2e `full-pilot-loop` step 1 (×2 browsers) + 12 serial steps each "did not run"** — signup returns 503 because the rate limiter is fail-closed and `KV_REST_API_URL`/`KV_REST_API_TOKEN` are unset. Reproduced at base. Config (Track C: real Upstash creds), not code.
4. **e2e rate-limit specs (p1-14, p10, ×2 browsers)** — same KV root cause; their Upstash skip-probe misdetects and they run into 503s.
5. Occasional load-induced flakes under parallel runs (`exam-submit-cert-code` 5s timeouts, "Request context disposed" in e2e) — pass deterministically in isolation/sequential runs; disappear on a quiet machine.

## Environment notes (added to this worktree's `.env.local` only)

- `RESEND_API_KEY=re_placeholder_local_build` — `lib/email/client.ts` throws at module load without it (pre-existing at base); placeholder keeps demo mode.
- `CRON_SECRET=placeholder_cron_secret_build_only` — cron-route tests need it. 🔴 **CORRECTED 2026-07-29 (T-27):** the old instruction here said to run `set -a && source .env.local && set +a` before testing. **Do NOT do that — `.env.local` points at the PRODUCTION project.** As of T-24 vitest loads the committed `.env.test` with `override:true` and `tests/env-guard.ts` hard-fails a non-local target; as of T-27 Playwright does the same and pins the dev server's env too. `CRON_SECRET` is defaulted for e2e in `playwright.config.ts`. Nothing needs sourcing — run `pnpm test` or `pnpm test:e2e` in a clean shell.

## What "fully green" still needs (out of scope here)

- Track C keys: Upstash (KV_*), real Resend, Mapbox, Mux.
- Track D: reconcile fixture idempotent re-seeding, entropy-test determinism.
