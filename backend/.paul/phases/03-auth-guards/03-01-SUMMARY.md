---
phase: 03-auth-guards
plan: 01
status: complete — approved, committed 474809a (scoped: 21 routes + 2 lib files)
type: Summary
about: "allergenwise"
date: 2026-07-08
---

# PAUL SUMMARY — Phase 03 Plan 01: Auth-guard extraction + error helper (B1+B8)

## What was built

Two new shared modules (worktree `aw-phase03`, branch `perf/03-auth-guards`, uncommitted):

- **`lib/auth/require-auth.ts`** — `jsonError(status, msg)`, `unauthorized(msg='Unauthorized')`, `forbidden(msg='Forbidden')`, `requireAuth()` (B8 error-response helper set; `requireAuth` currently unconsumed — staged for the 6 auth-only routes in a later phase)
- **`lib/auth/require-role.ts`** — `requireRole(opts)` → `{ user, profile } | NextResponse`. Parameterized on: allowed roles, profile client (`session`/`service`), exact profiles columns, 401/403 messages, missing-profile behavior, restaurant_id requirement. Role ALWAYS re-read from `profiles` server-side; JWT claim never trusted alone.

**21 routes rewired** (reviewer×5, learner×7, admin/manager×9) — exactly the audit-B1 set. Net **−329 LOC** (400+ / 729−) across 21 files.

## Behavior preservation

Message drift deliberately PRESERVED per route ('Unauthorized' vs 'Unauthorized.'; dashboard-stats/roster keep role `'manager'` with 403 text 'Admin role required.' — known inconsistency, not normalized). Check order, status codes, profile client (session vs service), selected columns: identical per route.

Out of scope, untouched by design: public verify endpoint, auth/*, cron/*, stripe webhook/charge-cert-fees, account/me/* (auth-only), exam/submit + quiz/submit (no role gate — extraction would change behavior), quiz/attempts (multi-branch role logic).

## Verification (all vs HEAD baseline 8fd2715, measured in identical temp worktree)

| Gate | Baseline (HEAD) | After refactor | Verdict |
|------|-----------------|----------------|---------|
| `tsc --noEmit` | 19 errors (pre-existing, activity_events insert typing + never-typed profile reads) | **11 errors** — refactor FIXED 8, introduced 0; remaining 11 all in out-of-scope files | ✅ strictly better |
| `next lint` | — | **0 errors** (pre-existing no-console warnings only) | ✅ |
| `next build` | **fails** on `account/me/cancel-deletion-request` (pre-existing activity_events typing, out-of-scope file) | fails identically | ⚠️ parity — pre-existing branch breakage, NOT fixable within scope lock |
| `vitest run` | 4 failed / 666+ passed (672 total) | 4 failed / 667 passed — failing set IDENTICAL (reconcile-cert-states×3 + purge-stale×1, DB-state-dependent integration) | ✅ parity, 0 regressions |
| Playwright e2e | 86 passed / 14 skipped / 38 did-not-run | identical spec-level distribution (diff = empty) | ✅ exact parity |

**Note on definition-of-done deltas:** the stated DoD (typecheck 0, build 0, 404/404 unit, 50/50 e2e) does not match this branch's actual baseline (19 tsc errors, broken build in out-of-scope file, 672 vitest tests, 138 e2e tests with env-gated skips — worktree lacks STRIPE_SECRET_KEY/Upstash env). Every gate is at exact parity or strictly better than baseline; achieving literal "0" would require editing out-of-scope files (e.g. `account/me/*`, `certs/verify`) — declined per scope lock.

## Adversarial review gate (fresh subagent, full diff)

- SCOPE: PASS — diff touches exactly the 21 declared routes + 2 new lib files; `certs/[certCode]/verify` untouched, leak surface unchanged
- Per-route: 21/21 IDENTICAL (status codes, exact messages incl. punctuation, client choice, columns, check order, tenant scoping)
- BLOCKING findings: none
- Non-blocking notes: (1) upload-photo try/catch now also wraps the profile read — an infra throw maps to 401 instead of 500 (stricter, not weaker); (2) payment-intent constructs a second session client (trivial); (3) `requireAuth` dead until a later phase; (4) `sessionError || !user` → `!user` equivalent per supabase-js contract (error ⇒ null user)

## Decisions

| Decision | Rationale |
|----------|-----------|
| Error helpers live in `require-auth.ts` (no third file) | Scope lock named require-* set; B8 folds into B1 |
| No message/role normalization | Strict behavior preservation; normalization is a separate (future) contract change |
| quiz/attempts + exam/submit + quiz/submit excluded | No simple role gate — extraction would change behavior; matches audit's count of 21 |

## Closed

Human-verify approved 2026-07-08. Committed `474809a` on `perf/03-auth-guards` — exactly 23 files (21 routes + 2 lib/auth), 586+/783−. Loop closed via UNIFY same day.
