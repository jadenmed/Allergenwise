---
phase: 09-oversized-splits
plan: 03
type: Summary
about: "allergenwise"
---

# 09-03 SUMMARY — exam/submit cert-issuance split (B11)

## Result
DONE. Both tasks executed, qualified PASS.

## Files created
- `lib/learner/issue-certificate.ts` — `issueCertificateForPassedExam()`, verbatim relocation of the pass-branch block (cert-code retry loop, activity events, ExamPassed email)
- `tests/unit/issue-certificate.test.ts` — 4 new isolated unit tests (first-attempt success, one-collision-then-success, three-collisions-exhausted, non-23505 error) calling the function directly, no route/HTTP layer involved

## Files modified
- `app/api/exam/submit/route.ts` — 375 → 239 lines. Removed now-unused `CERT_VALIDITY_YEARS`/`generateCertCode` imports (moved into the new lib file); added `issueCertificateForPassedExam` import.

## Verification
- `pnpm typecheck` — clean
- `pnpm vitest run tests/unit/exam-submit-cert-code.test.ts tests/unit/exam-submit-pending-cert.test.ts tests/unit/exam-passed-email-reword.test.ts tests/unit/issue-certificate.test.ts` — 14/14 passed (all 3 pre-existing route-level test files pass unmodified, confirming the extraction is behavior-preserving through the full request path; the 4 new tests are net-new isolated coverage)
- `pnpm test` (full suite) — 651 passed (+4 from before this plan), 71 skipped, same 1 pre-existing unrelated failure (`reconcile-cert-states.test.ts`, requires real Supabase env)

## Deviations / concerns
None. Route.ts landed at 239 lines vs. the audit's ~150-170 estimate — the difference is auth, body validation, attempt-fetch/ownership/already-submitted/time-limit handling, question loading, scoring, and the fail-branch, none of which were part of B11's declared seam (only the pass-branch cert-issuance block was in scope).

**Recorded collision risk (see STATE.md decision #4):** this file's ExamPassed `resend.emails.send()` call — now living in `lib/learner/issue-certificate.ts` — is also in Phase 04's declared scope (routing direct `resend.emails.send()` calls through `sendEmail()`). Phase 04 is being worked concurrently in `aw-phase04/`. No conflict during this worktree's work; flagged for manual reconciliation at merge time into `integration/v0.1-hardening`.

## AC status
AC-1 PASS, AC-2 PASS, AC-3 PASS, AC-4 PASS (all pre-existing route tests green unmodified).
