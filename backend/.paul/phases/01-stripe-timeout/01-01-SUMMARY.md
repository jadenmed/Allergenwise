---
phase: 01-stripe-timeout
plan: 01
subsystem: payments
tags: [stripe, timeout, resilience, sdk-config]
requires: []
provides:
  - "Stripe SDK client with 10s network timeout + 2 network retries"
tech-stack:
  added: []
  patterns: ["fast-fail timeout on external SDK clients"]
key-files:
  created: []
  modified: ["lib/stripe.ts"]
key-decisions:
  - "10s timeout (down from SDK 80s default) on user-facing payment paths"
  - "maxNetworkRetries:2 (up from SDK default 1) for transient-blip recovery"
patterns-established:
  - "External SDK clients get explicit timeout + retry config, not SDK defaults"
duration: ~5min
started: 2026-06-28T21:50:00Z
completed: 2026-06-28T21:56:00Z
description: "Capped Stripe SDK network timeout 80s→10s and set maxNetworkRetries:2"
type: Summary
about: allergenwise
---

# Phase 01 Plan 01: Stripe Timeout Summary

**Capped the Stripe SDK network timeout from its 80,000ms default to 10s and raised network retries 1→2, fast-failing hung Stripe sockets on every user-facing payment path. Behavior-preserving — callers, return shapes, and idempotency keys untouched.**

## Performance

| Metric | Value |
|--------|-------|
| Duration | ~5 min |
| Started | 2026-06-28T21:50:00Z |
| Completed | 2026-06-28T21:56:00Z |
| Tasks | 1 auto + 1 checkpoint completed |
| Files modified | 1 (lib/stripe.ts) |

## Acceptance Criteria Results

| Criterion | Status | Notes |
|-----------|--------|-------|
| AC-1: Timeout + retries configured | Pass | `timeout:10000` + `maxNetworkRetries:2` present; `apiVersion`/`typescript` unchanged |
| AC-2: Behavior-preserving (callers unchanged) | Pass | No caller modified; `npx tsc --noEmit` clean for stripe.ts; 74 Stripe-touching unit tests green |

## Accomplishments

- Single-file, 2-line config change eliminates the 80s worst-case hang on signup payment, payment-intent, and charge-cert-fees paths.
- Verified behavior-preserving via 9 Stripe-touching unit test files (74 tests, all pass) + typecheck.

## Files Created/Modified

| File | Change | Purpose |
|------|--------|---------|
| `lib/stripe.ts` | Modified (+2 lines) | Added `timeout:10000`, `maxNetworkRetries:2` to Stripe constructor |

## Decisions Made

| Decision | Rationale | Impact |
|----------|-----------|--------|
| 10s timeout | 80s default can block a user request on a hung socket; 10s fast-fails | Faster failure surfacing on payment paths |
| maxNetworkRetries:2 | SDK default is 1; transient network blips recover without user-visible error | Slightly more resilient writes (Stripe retries are idempotent via the SDK) |

## Deviations from Plan

| Type | Count | Impact |
|------|-------|--------|
| Auto-fixed | 0 | — |
| Scope additions | 0 | — |
| Deferred | 0 | — |

**Total impact:** None — plan executed exactly as written.

## Verification Results

- `git diff lib/stripe.ts` → exactly 2 added lines.
- `npx tsc --noEmit` → no `stripe.ts` type errors.
- `pnpm vitest run` on 9 Stripe-touching files → **74 passed (74)**.

## Issues Encountered

None.

## Next Phase Readiness

**Ready:** Phase 02 (DB waterfall parallelization, audit B2) is the next candidate, file-disjoint from this change. Awaits explicit user pick.

**Concerns:** None. `git commit` intentionally NOT run this loop (user has not requested; branch carries unrelated pre-existing wave-6 + partner-attribution changes that must not be swept in).

**Blockers:** None.

---
*Phase: 01-stripe-timeout, Plan: 01*
*Completed: 2026-06-28*
