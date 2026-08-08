---
phase: 05-audit-batching
plan: 01
plan_type: execute
wave: 1
type: Summary
about: allergenwise
---

# Phase 05 — Audit-event batching — SUMMARY

## What changed
4 files, activity_events writes only. Loop-of-N-inserts → one batched `insert([...])` per handler/cron invocation, N→1 round-trips.

- `lib/stripe/cert-event-handlers.ts` — new `writeEvents(db, rows[])` batched sibling to `writeEvent`. 6 looping call sites (handleCertFeeSucceeded's pending loop, handleChargeRefunded's eligible loop, handleDisputeCreated's two separate loops kept as two separate batches in original two-phase order, handleDisputeClosed's `won`/`warning_closed` and `lost` branches) now collect rows and batch-insert once. The 5 single-event call sites (canceled/failed/funds_withdrawn/funds_reinstated/subscription_deleted) untouched — no loop to batch.
- `app/api/cron/exam-timeout-sweep/route.ts` — UPDATE loop unchanged (per-row narrowed guard preserved); activity rows collected during the loop, one batched insert after.
- `app/api/cron/expire-certs/route.ts` — the one activity_events loop (post bulk-UPDATE expired-flip) replaced with a single batched insert. `cert_warnings` warning-email loop untouched (different table, out of scope).
- `app/api/cron/purge-stale-pending-certs/route.ts` — restructured: all `cert_purged` events now batch-inserted BEFORE the delete loop starts (previously interleaved one-insert-then-delete per row). This *strengthens* the "audit trail survives" guarantee — every purge candidate's event is durably written before any delete is attempted. Delete loop (per-row, narrowed `WHERE status='pending'` re-check, `purged++`/error accounting) unchanged.

## Ordering fix (the reason this wasn't a pure mechanical find/replace)
Postgres evaluates `now()` once per SQL statement. A multi-row `INSERT ... VALUES (...), (...), ...` relying on the `created_at default now()` column default would give every row in one batch an IDENTICAL timestamp, breaking the `ORDER BY created_at` chronology the `activity_events_certificate_id_idx` partial index query (`WHERE payload->>'certificate_id' = $1 ORDER BY created_at`) depends on. Every batched insert in this change stamps each row with an explicit, strictly-increasing `created_at` (`base = Date.now()`, offset by row index in ms) so insertion order == chronological order, matching pre-batch behavior exactly.

## Verify gate results
- `npx tsc --noEmit`: 19 pre-existing errors, identical before/after (confirmed via `git diff <merge-base>`), **0 in any of the 4 scope files**.
- `eslint` on the 4 files: 0 errors, 5 pre-existing `no-console` warnings (same style used throughout the codebase's cron/webhook handlers).
- `npm run build`: fails on the same pre-existing `activity_events` typed-as-`never` TS error in `app/api/account/me/cancel-deletion-request/route.ts` (and others) that exists identically on the branch base — confirmed unrelated to this change via baseline diff.
- Integration tests: `stripe-cert-events` (17), `cert-payment-happy-path` (6), `cert-refund-path` (4), `cert-dispute-path` (4), `cert-race-conditions` (5), `expire-certs-cron` (4) — **all green**, run against real local Supabase.
- `purge-stale-pending-certs-cron.test.ts`: 1 of 5 tests fails (401 vs 200 expected) — **pre-existing bug in the test file itself, unrelated to this change**. The test never sets `process.env.CRON_SECRET`, so its `makeRequest()` header falls back to a placeholder string while the route's literal `Bearer ${process.env.CRON_SECRET}` reads `Bearer undefined` — mismatch. The sibling `expire-certs-cron.test.ts` has the one-line fix (`process.env.CRON_SECRET = process.env.CRON_SECRET ?? 'placeholder...'`) that this file is missing. Only the one test that asserts `res.status` catches it; the other 3 GET-calling tests pass vacuously (401 = no-op = nothing deleted = "does NOT delete" trivially true). Verified via code inspection, not by touching the working tree. **Out of scope to fix** (test file, not one of the 4 scope-locked files) — flagged for a separate, explicitly-approved fix.
- No exam-timeout-sweep integration test exists in the repo (pre-existing gap, not introduced by this change).

## Review subagent findings (scope-lock check)
Fresh subagent diffed against merge-base `8fd2715`. Result: scope clean (exactly the 4 files changed), all payload/type/ordering/index checks pass, no cross-loop merges, no UPDATE/DELETE statement changes.

One accepted tradeoff surfaced, not a bug: in `exam-timeout-sweep`, a failed batched insert is now atomic across the whole batch (all-or-nothing) rather than independent per attempt as before. This is inherent to batching itself — it's the entire point of trading N round-trips for 1 — and remains non-fatal (never blocks the `exam_attempts` UPDATE, which is the actual state-machine source of truth; only the audit-trail insert is at risk, same as before). Two minor additive-only observations: `expire-certs`/`purge-stale-pending-certs` previously silently swallowed insert errors with no logging at all — the batched versions add a `console.error` (does not touch `errors[]`/`processed`/`ok`); and in `handleCertFeeSucceeded`, PDF fire-and-forget triggers now all fire before the batch event write instead of interleaved with per-cert event writes — no functional impact since PDF generation was already fire-and-forget and the certificates UPDATE (source of truth) is unaffected.

## Incident during apply (resolved)
A concurrent session in the sibling worktree `aw-phase07` (same repo, shared `refs/stash`) ran `git stash` at the same time this loop did, cross-contaminating the working tree — my 4 edited files were briefly reverted and replaced with an unrelated `courses/[moduleId]/[lessonId]/page.tsx` change from that session. Recovered by locating the correct dangling stash commit (`e0a9c591`, verified by diffstat + content match) and restoring the 4 files from it, with explicit user confirmation before touching anything. The stray phase07 file is parked in a stash titled `aw-phase05-recovery-safety` in this worktree for that session to reclaim — **not deleted**. No further `git stash` used for the rest of this loop per user instruction.

## Scope adherence
`git diff --stat` against merge-base `8fd2715` (no path filter): exactly the 4 declared files, nothing else.

## Open items requiring a decision (not part of this scope, flagged only)
1. Pre-existing `CRON_SECRET` bug in `tests/integration/purge-stale-pending-certs-cron.test.ts` — 1-line fix available, needs separate approval since it's outside the scope lock.
2. A stash titled `aw-phase05-recovery-safety` exists in the shared repo containing an aw-phase07 in-progress edit — that session should be told to reclaim it (`git stash pop`) from within `aw-phase07`.
