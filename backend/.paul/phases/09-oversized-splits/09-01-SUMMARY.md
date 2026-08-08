---
phase: 09-oversized-splits
plan: 01
type: Summary
about: "allergenwise"
---

# 09-01 SUMMARY — Reviewer submission-detail split (B9)

## Result
DONE. Both tasks executed, qualified PASS.

## Files created
- `app/(reviewer)/reviewer/queue/[submissionId]/types.ts` — `SubmissionDetail`, `RestaurantDetail`, `CertInfo`, `RosterMember`, `AutoChecks`, `DetailResponse`
- `app/(reviewer)/reviewer/queue/[submissionId]/AutoCheckRow.tsx`
- `app/(reviewer)/reviewer/queue/[submissionId]/CertCell.tsx`
- `app/(reviewer)/reviewer/queue/[submissionId]/DecisionDialog.tsx` — unified approve/reject/request_info dialog, branched on `type` prop
- `app/(reviewer)/reviewer/queue/[submissionId]/useSubmissionDetail.ts`

## Files modified
- `app/(reviewer)/reviewer/queue/[submissionId]/page.tsx` — 990 → 651 lines

## Deviation from estimate
Audit estimated page.tsx would land at ~300 lines. Actual: 651. The declared split seams (AutoCheckRow, CertCell, DecisionDialog, useSubmissionDetail) were extracted exactly as specified — the remaining bulk (~450 lines) is the restaurant-info card, auto-checks card, and staff roster `<table>` markup, none of which were named as extraction targets in the audit or this plan. Not extracted further per scope discipline (plan boundaries: "no new abstractions beyond what's declared"). Flagging as informational — not a gap against AC-1 through AC-4, all of which are satisfied.

## Verification
- `pnpm typecheck` — clean
- `pnpm test` (full vitest suite) — 647 passed, 71 skipped, 1 pre-existing failure (`tests/integration/reconcile-cert-states.test.ts`, requires real `SUPABASE_URL`/`SERVICE_KEY` env — unrelated to this change, fails identically on unmodified `main`)
- No test in the suite directly renders this page component (no RTL/jsdom test target); coverage is via `lib/reviewer/auto-checks.ts` and `lib/reviewer/decide.ts` unit tests (API-side, untouched) plus e2e specs (`tests/e2e/p1-2-reviewer-idor.spec.ts`, `tests/e2e/full-pilot-loop.spec.ts`) not run in this pass — flagged for the phase-level human-verify checkpoint (manual `pnpm dev` walkthrough of approve/reject/request-info)

## Deviations / concerns
None. No boundary violations. `app/api/reviewer/queue/[submissionId]/*` and `lib/reviewer/*` untouched.

## AC status
AC-1 PASS, AC-2 PASS, AC-3 PASS, AC-4 pending final manual confirmation at phase-level human-verify checkpoint (deferred per user instruction to pause once at end of full phase 09 loop, not per-plan).
