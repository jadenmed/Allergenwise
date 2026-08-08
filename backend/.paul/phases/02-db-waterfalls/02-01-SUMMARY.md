---
phase: 02-db-waterfalls
plan: 01
subsystem: api
tags: [performance, supabase, promise-all, waterfall, n-plus-one]
requires: []
provides:
  - "Parallelized independent DB reads across 6 hot-path handlers"
  - "dashboard-stats redundant certificates query removed"
tech-stack:
  added: []
  patterns: ["Promise.all batches with ordered post-batch error checks (preserves throw precedence)"]
key-files:
  created: []
  modified:
    - "lib/admin/eligibility.ts"
    - "app/api/admin/roster/route.ts"
    - "app/api/admin/dashboard-stats/route.ts"
    - "lib/reviewer/auto-checks.ts"
    - "app/api/directory/[slug]/route.ts"
    - "app/api/reviewer/queue/[submissionId]/route.ts"
key-decisions:
  - "Supabase builders resolve {data,error} (never throw) → Promise.all + ordered checks = identical error precedence"
  - "dashboard certifiedCount kept as raw row count (rows.length), NOT distinct, to preserve exact value"
  - "reviewer/queue: computeAutoChecks wrapped (.then/.catch) so empErr is still reported before an auto-checks throw"
patterns-established:
  - "Parallelize only reads keyed on an already-known id with no cross-consumption; gate/security/dependent reads stay sequential"
duration: ~25min
started: 2026-06-28T22:05:00Z
completed: 2026-06-28T22:23:00Z
description: "Parallelized provably-independent DB read waterfalls across 6 hot paths; killed 1 redundant query"
type: Summary
about: allergenwise
---

# Phase 02 Plan 01: DB Waterfalls (B2) Summary

**Converted sequential, provably-independent `await supabase...` reads into `Promise.all` batches across 6 hot-path handlers and removed one redundant certificates query in dashboard-stats. Behavior-preserving: identical data, identical error precedence; all dependent/security-gated reads left sequential.**

## Performance

| Metric | Value |
|--------|-------|
| Duration | ~25 min |
| Tasks | 6 auto + 1 checkpoint |
| Files modified | 6 |
| Serial round-trips removed | eligibility 4→1, roster 5→1, dashboard 4→1 (+1 dup query killed), auto-checks 3→1, directory 3→1, reviewer/queue 2→1 |

## Acceptance Criteria Results

| Criterion | Status | Notes |
|-----------|--------|-------|
| AC-1: Independent reads parallelized, dependent reads untouched | Pass | Sequential-left list honored in all 6 files |
| AC-2: Error precedence preserved | Pass | Post-batch error checks in original order; reviewer/queue wraps computeAutoChecks to keep empErr first |
| AC-3: dashboard redundant query removed without semantic change | Pass | One `select('profile_id')`; certifiedCount = rows.length (= old raw count), certifiedSet = distinct |
| AC-4: Typecheck + tests green | Pass | 0 new tsc errors (19 pre-existing, proven via stash); unit 480 pass; auto-checks 15/15 |

## Files Modified

| File | Change | Parallelized | Left sequential |
|------|--------|--------------|-----------------|
| `lib/admin/eligibility.ts` | reads batched | learners, certs, subs, openSubmissions (4) | — |
| `app/api/admin/roster/route.ts` | reads batched | modules, progress, lessons, activity, certs (5) | learners fetch (gate) |
| `app/api/admin/dashboard-stats/route.ts` | dup killed + batched | merged-certs, subs, activity (3) | learners (gate); actorNames (needs activity) |
| `lib/reviewer/auto-checks.ts` | independents batched | subs, submission, rejectedCount (3) | profiles→certs→exam_attempts chain |
| `app/api/directory/[slug]/route.ts` | reads batched | reviews, certCount, employees (3) | restaurant fetch (404 gate) |
| `app/api/reviewer/queue/[submissionId]/route.ts` | reads batched | employees, computeAutoChecks (2) | submission load + IDOR gate |

## Decisions Made

| Decision | Rationale | Impact |
|----------|-----------|--------|
| Ordered post-batch error checks | Supabase builders resolve {data,error}; checking in original order preserves exact throw/HTTP precedence | Byte-identical failure behavior |
| dashboard certifiedCount = rows.length | Old code used a raw count that could double-count multi-cert learners; deriving from distinct would change the value | Value-identical, not just close |
| Wrap computeAutoChecks in reviewer/queue | It can throw; unwrapped it would pre-empt the empErr check on double-failure | "Failed to load employee roster" still wins over "Internal server error" |

## Deviations from Plan

None — plan executed exactly as written.

## Verification Results

- `git diff --stat` → exactly the 6 target files (247 insertions, 221 deletions).
- `npx tsc --noEmit` → no errors in any of the 6 files. 19 total tsc errors are pre-existing branch WIP (admin→manager rename); identical count with the 6 files stashed.
- `pnpm vitest run tests/unit` → 480 passed / 1 failed. The 1 failure (`exam-passed-email-reword.test.ts`) asserts copy in `lib/email/templates/ExamPassed.tsx` — branch WIP, not touched by this phase.
- `tests/unit/auto-checks.test.ts` → 15/15 pass.
- Integration tests (cert/rls/directory) need a live DB; not run in this environment.

## Issues Encountered

Pre-existing branch noise only (19 tsc errors + 1 unit failure + integration tests needing a DB) — all confirmed independent of this phase's changes via stash comparison.

## Next Phase Readiness

**Ready:** Phase 03 (auth-guard extraction, B1+B8) is the next candidate but touches invite/exam/submissions routes; per the audit collision rule it must not run concurrently with Phase 04 (email). Awaits explicit user pick.

**Concerns:** Scoped pathspec commit performed for the 6 files only (per user request); branch wave-6 + partner-attribution WIP remains staged and uncommitted.

**Blockers:** None.

---
*Phase: 02-db-waterfalls, Plan: 01*
*Completed: 2026-06-28*
