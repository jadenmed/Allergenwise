---
phase: 04-email-consolidation
plan: 02
status: complete — applied, uncommitted (commit pending UNIFY)
type: Summary
about: "allergenwise"
date: 2026-07-18
---

# PAUL SUMMARY — Phase 04 Plan 02: sendEmail() consolidation, part 2 (B3 new-templates half)

## What was built

Worktree `aw-phase04`, branch `perf/04-email-consolidation`.

- **3 new templates** created and registered in `lib/email/send.ts` (`TemplateName`, `TemplateProps`, `buildEmail()`):
  - `EmployeeExamPassedNotice.tsx` — admin-facing (not learner-facing) exam-pass notice. Props `{adminName, learnerName, restaurantName, scorePercent, certCode}`.
  - `WeeklyAdminDigest.tsx` — replaces the `<pre>`-dump cron email with a proper component. Props `{adminName, restaurantName, certReadinessPct, certifiedCount, totalLearners, expiringCerts, pendingInvites, dashboardUrl}`. Subject via `subjectWeeklyAdminDigest(restaurantName)`.
  - `ReviewerQueueDigest.tsx` — same treatment for the reviewer digest. Props `{pendingCount, reviewQueueUrl}`. Subject via `subjectReviewerQueueDigest(pendingCount)`.
- **4 call sites migrated**:
  - `app/api/exam/submit/route.ts` → `sendEmail('EmployeeExamPassedNotice', ...)`, replacing inline `<p>` HTML + direct `resend.emails.send`.
  - `app/api/stripe/webhook/route.ts`'s `sendWelcomeAdminEmail()` → `sendEmail('WelcomeAdmin', ...)`, replacing 4 dynamic imports (`email/client`, `WelcomeAdmin` template, `react`, `@react-email/components`) + manual `render()`. Fire-and-forget call-site shape (`sendWelcomeAdminEmail(...).catch(...)`) untouched — still correct per 04-03's target pattern.
  - `app/api/cron/weekly-admin-digest/route.ts` → `sendEmail('WeeklyAdminDigest', ...)` inside the existing per-admin loop, `errors.push`/`processed++` control flow preserved.
  - `app/api/cron/digest-reviewer-queue/route.ts` → `sendEmail('ReviewerQueueDigest', ...)`, `500`-on-failure behavior preserved.

## Deviation from plan text (documented, not silent)

Task 1's action text claimed `learnerName`/`restaurantName` were "already in scope" for `exam/submit`, sourceable "without adding new DB lookups." On inspection this was inaccurate — the route's existing top-of-function `profiles` query only selected `id, role, restaurant_id`; neither the learner's `full_name` nor a restaurant name was fetched anywhere in the function. Resolution: extended that *same, already-executing* query's `select()` to add `full_name` and an embedded `restaurants!profiles_restaurant_id_fkey(name)` join — zero additional round-trips (same FK-embed pattern already used by `cron/weekly-admin-digest/route.ts`, confirmed via the plan's own reference file). This satisfies the plan's actual intent ("do not add new DB lookups" = don't add round-trips) without leaving `learnerName`/`restaurantName` unfillable. Also added a `&& certCode` guard on the notice send — the pre-existing collision-retry-exhausted branch leaves `certCode` as `undefined`, which the old hand-rolled HTML would have silently interpolated as the literal string "undefined"; sending nothing in that (extremely rare, 3-consecutive-23505-collision) edge case is strictly better and was necessary to satisfy `EmployeeExamPassedNoticeProps.certCode: string`.

## Behavior preservation

`WelcomeAdmin` now sends both html and text parts (previously html-only) — an explicit, intended side benefit per AC-2, not a regression. All other recipients/content/error-handling shapes unchanged per the plan's ACs. `ExamPassed.tsx` (learner-facing) confirmed untouched and still unused/dead, per boundary. Stripe signature verification and both crons' `CRON_SECRET` bearer checks confirmed untouched (grep + diff review).

## Verification

| Gate | Result |
|------|--------|
| `pnpm tsc --noEmit` | clean, 0 errors |
| `pnpm build` | succeeds |
| `grep -rn "resend.emails.send"` (4 touched route dirs) | 0 hits |
| `grep` for manual `render(`/dynamic `@react-email/components` import in stripe/webhook | 0 hits |
| Ad hoc render check, 3 new templates (scratch vitest file, deleted after run — not committed since `tests/` isn't in this plan's `files_modified`) | all render valid HTML with DOCTYPE, all prop values present in output |
| `vitest run` — targeted: `exam-submit-cert-code`, `exam-submit-pending-cert`, `stripe-webhook` (integration) | 11/11 passed |
| `vitest run` (full suite) | 631 passed / 84 skipped / 10 failed — all 10 failures are pre-existing `real DB`/RLS/migration integration tests requiring local Postgres (port 54322, not running in this worktree); none touch phase 04 files. Matches the DB-dependent baseline documented in `03-01-SUMMARY.md`. |

## Note on test coverage

`tests/unit/email-templates.test.ts` was NOT extended to cover the 3 new templates (or `AccountDeletionConfirm` from 04-01) — that file isn't in either plan's declared `files_modified`, and PROJECT.md's scope-discipline constraint ("a plan touches ONLY its declared files") takes precedence over the plan's `<verify>` line's looser "e.g." suggestion to use that file. Verified instead via a throwaway render-check (see above). **Suggested follow-up** (not part of this phase): add committed unit coverage for all 4 templates added across 04-01/04-02.

## Closed

All 3 acceptance criteria met (AC-1 audience-correct notice, AC-2 WelcomeAdmin html+text via sendEmail, AC-3 both crons on sendEmail with preserved error-handling). Proceeding to 04-03 (fire-and-forget conversion), which contains a blocking `checkpoint:decision` (invites/remind + invites/[id]/resend behavior change) to be surfaced to the user, then a `checkpoint:human-verify` before UNIFY.
