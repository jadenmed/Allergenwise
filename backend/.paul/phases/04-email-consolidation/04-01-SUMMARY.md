---
phase: 04-email-consolidation
plan: 01
status: complete — committed 8d9659e (+ formatting fixup 8c3cd37)
type: Summary
about: "allergenwise"
date: 2026-07-18
---

# PAUL SUMMARY — Phase 04 Plan 01: sendEmail() consolidation, part 1 (B3 safe half)

## What was built

Worktree `aw-phase04`, branch `perf/04-email-consolidation`.

- `lib/email/send.ts`: `AccountDeletionConfirm` added to `TemplateName`/`TemplateProps`/`buildEmail()`, appended (no reordering of existing members).
- 5 routes migrated off `renderEmail()` + manual `resend.emails.send()` onto `sendEmail()`, same props per route, same error-handling shape (`result.ok`/`result.error` in place of the old `{error}` destructure):
  - `app/api/admin/csv-upload/route.ts` → `sendEmail('EmployeeInvite', ...)`
  - `app/api/invites/send/route.ts` → `sendEmail('EmployeeInvite', ...)`
  - `app/api/invites/remind/route.ts` → `sendEmail('InviteReminder', ...)` (500-on-failure behavior preserved, unchanged — fire-and-forget is 04-03's job)
  - `app/api/invites/[id]/resend/route.ts` → `sendEmail('EmployeeInvite', ...)` (500-on-failure behavior preserved, unchanged)
  - `app/api/account/me/request-deletion/route.ts` → `sendEmail('AccountDeletionConfirm', ...)`
- `lib/email/render.ts` deleted — confirmed zero remaining importers.
- 3 test files' mocks updated to match (`account-delete-flow`, `csv-upload-prebuffer-cap`, `invite-send-rate-limit`).

## Behavior preservation

No recipient/HTML/prop changes — pure send-mechanism swap. `invites/remind` and `invites/[id]/resend` explicitly kept their current 500-on-email-failure response (scope-limited per plan; 04-03 owns the fire-and-forget conversion). `requireRole(...)` auth blocks and activity-event/audit-log code untouched.

## Verification (this session, against HEAD of this branch)

| Gate | Result |
|------|--------|
| `pnpm tsc --noEmit` | clean, 0 errors |
| `pnpm build` | succeeds |
| `grep -rn "renderEmail\|email/render" app/ lib/ tests/` | 0 hits |
| `vitest run` (3 targeted integration files: account-delete-flow, csv-upload-prebuffer-cap, invite-send-rate-limit) | 23/23 passed |

## Note

The applying session that produced commit `8d9659e` died before writing this SUMMARY.md or committing a stray prettier-formatting diff left in the working tree (trailing-comma/wrap changes on `lib/email/send.ts`, es5 trailingComma config — no behavior change). Both loose ends closed this session: formatting isolated into `8c3cd37`, this SUMMARY backfilled, verification re-run fresh against current HEAD before proceeding to 04-02.

## Closed

All 3 acceptance criteria met. Proceeding to 04-02 (remaining B3 half: new templates + exam/submit, stripe/webhook, 2 crons).
