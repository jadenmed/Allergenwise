---
phase: 04-email-consolidation
plan: 03
status: complete — human-verify approved 2026-07-20, committed
type: Summary
about: "allergenwise"
date: 2026-07-18
---

# PAUL SUMMARY — Phase 04 Plan 03: fire-and-forget conversion (B4)

## What was built

Worktree `aw-phase04`, branch `perf/04-email-consolidation`.

- **Task 1 — always fire-and-forget** (no behavior-contract change, latency only):
  - `app/api/exam/submit/route.ts`: `EmployeeExamPassedNotice` send no longer awaited; wrapping `try/catch` replaced with `.catch()` on the un-awaited call. `adminRes` DB lookup itself stays awaited (per plan). `certCode` narrowing guard kept from 04-02.
  - `app/api/submissions/create/route.ts`: dropped `await` on the already-`.catch()`-guarded `RestaurantSubmitted` send.
  - `app/api/account/me/request-deletion/route.ts`: `AccountDeletionConfirm` send no longer awaited; `try/catch` collapsed to `.catch()`, PII-masked logging preserved verbatim.
- **Task 2 — `invites/send`**: dropped `await`, added the `.catch()` it previously lacked. The response's conditional `warning: 'Invite created but email delivery failed...'` field is removed — see Deviation below.
- **Checkpoint:decision — resolved by user**: "Fire-and-forget (recommended)" selected for `invites/remind` + `invites/[id]/resend`. Logged to `STATE.md` Decisions table (#3).
- **Task 3 — applied the chosen behavior**:
  - `app/api/invites/remind/route.ts`: removed `await` + the `if (!sendResult.ok) return 500` branch; now `.catch()`-logs and always returns `{ ok: true }` once DB work succeeds.
  - `app/api/invites/[id]/resend/route.ts`: same conversion. This was the sharper case flagged in the plan — previously a Resend outage produced a misleading `500` *after* the invite token had already been rotated in the DB; now the (already-succeeded) mutation and the response agree.

## Deviation from plan text (documented, not silent)

`invites/send`'s response previously included a conditional `warning` field computed from the synchronous `sendResult.ok` check. The plan's Task 2 action didn't mention this field, only "delete the now-dead `if (result.error) console.error(...)` branch." Making the send genuinely fire-and-forget means `result.ok` is no longer knowable before the response is built, so the field is structurally unfillable — removed it (route still always returns `201`). This is a strictly smaller change than the `invites/remind`/`invites/[id]/resend` case (no status-code change, just an advisory string disappearing) and is the direct, necessary consequence of AC-2's own stated intent ("returns immediately... independent of email delivery"), so it did not warrant its own checkpoint.

## Test-suite fix (documented, file not in this plan's `files_modified`)

`tests/integration/account-delete-flow.test.ts`'s happy-path test synchronously asserted `resendSend` was called once immediately after `POST()` resolved. Making the email fire-and-forget means the actual `resend.emails.send()` call now lands a microtask tick *after* the response is built (it's behind `sendEmail()`'s internal `await Promise.all([render, render])`), so the synchronous assertion started failing — not because behavior regressed, but because the test's timing assumption was invalidated by the plan's own mandated change. Fixed by replacing the synchronous assertion with `await vi.waitFor(() => expect(resendSend).toHaveBeenCalledTimes(1))`. Confirmed no other test file in the repo makes a similar synchronous assertion against any of the 6 routes touched by this plan (grepped for `toHaveBeenCalledTimes`/`resendSend`/`sendEmailSpy` co-occurring with the route paths).

## Test coverage gap (pre-existing, not introduced here)

Neither `invites/remind` nor `invites/[id]/resend` has any dedicated unit, integration, or e2e test file (grepped `tests/` including `tests/e2e/`) — the API-contract change approved above (500 → always-200) is therefore unverified by the automated suite. This is a pre-existing gap, not something this plan broke. **Flagged for the human-verify step below and as a suggested follow-up.**

## Verification

| Gate | Result |
|------|--------|
| `pnpm tsc --noEmit` | clean, 0 errors |
| `pnpm build` | succeeds |
| `grep -rn "await sendEmail("` across all 6 declared files | 0 hits |
| `vitest run` — targeted (6 files: exam-submit×2, account-delete-flow, invite-send-rate-limit, csv-upload-prebuffer-cap, stripe-webhook), run in isolation | 34/34 passed |
| `vitest run` (full suite), run twice | Non-deterministic extra failures under full-parallel-worker load (different test each run — `exam-submit-cert-code`'s 100-iteration timing test one run, unrelated `cert-code.test.ts` entropy-distribution test the next), all of which pass cleanly when run in isolation. Confirmed pre-existing CPU-contention flakiness, not a regression — none of the flaky tests share files with this plan's changes except `exam-submit-cert-code.test.ts`, which passes 4/4 in isolation. The 10 consistently-failing `real DB`/RLS/migration tests (documented in 04-02-SUMMARY.md) are the actual deterministic baseline. |

## Closed

All 3 acceptance criteria met (AC-1 three always-fire-and-forget routes, AC-2 invites/send gets its missing `.catch()`, AC-3 decision made + applied for invites/remind + invites/[id]/resend). Human-verify approved 2026-07-20 with scope notes:
- Verification items 3-4 (real Resend email delivery across all 6 flows + measured latency drop) deferred to step 14 per `PROMPT_PLAN.md`, when Resend keys land — already logged in the plan, not a gap introduced here.
- Item 5 (`invites/remind` + `invites/[id]/resend` now return `{ok:true}` instead of `500` on email failure) verified both manually and via authenticated API calls: both routes confirmed returning `{ok:true}` with the send failure logged (masked recipient, template name, and error captured) — closing the pre-existing test-coverage gap noted above at the manual-verification level, though no automated test was added for these two routes in this plan.

Committed. Phase 04 (B3 + B4, all 3 plans) complete on `perf/04-email-consolidation`. Per explicit user instruction, this branch is **not** merged into `integration/v0.1-hardening` — phase 09 moves `exam/submit`'s cert-issuance logic into `lib/learner/issue-certificate.ts`, so merge order and the resulting call-site reconcile are coordinated as a separate step.
