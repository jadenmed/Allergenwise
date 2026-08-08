# AllergenWise — Functional Smoke Test (Companion to Backend + Security Audit)

> Model: Sonnet — execution against an explicit spec; failures are immediately visible.

This is the **functional verification pass** that runs after the static backend + security audit. The audit proves the code looks correct; this proves the system actually works. Both are required before UI handoff.

Run this against the AllergenWise repo. Read `CONTEXT.md` and `CLAUDE.md` at the project root before starting.

---

## Step 1 — Confirm the dev loop is alive

Before any functional tests, confirm the project can actually run. Report each as PASS / FAIL with the actual command output.

1. `pnpm install` completes without errors.
2. `pnpm typecheck` (or `tsc --noEmit`) passes with zero errors. List any errors with file + line.
3. `pnpm lint` passes (or report what's failing).
4. `pnpm build` (Next.js production build) succeeds. List any build errors.
5. `pnpm dev` starts the Next.js dev server and serves a 200 on `/` within 30 seconds.
6. Supabase environment variables are present and the app can reach the database. Confirm with a trivial query (e.g., `select 1` via the Supabase client) and report the result.
7. Stripe test keys are configured (`STRIPE_SECRET_KEY` starts with `sk_test_`, `STRIPE_WEBHOOK_SECRET` is present).
8. Resend, Mux, and any other external service keys are present (presence only — do not log values).

If any of these fail, **stop and report**. The smoke tests below assume a working dev loop. A broken dev loop is itself a P0 pre-handoff finding.

---

## Step 2 — Run the test suite

1. Run `pnpm vitest run` (or the project's unit test command). Report:
   - Total tests, passed, failed, skipped.
   - Every failure: test name, file, actual error.
   - Every skip: file, reason (look at `.skip` annotations).
2. Run `pnpm playwright test` (or the project's e2e command). Same report format.
3. If either command doesn't exist or isn't wired up, that's a finding — report it and continue.

A passing test suite is necessary but not sufficient. Continue to Step 3 regardless of result, but flag failures as P0.

---

## Step 3 — Functional smoke checks (end-to-end against running app)

Run these against `pnpm dev` (or a deployed preview if one exists). Use real HTTP calls — `curl`, `fetch`, or Playwright. For each check, report **PASS / FAIL** with the actual response, status code, or error.

### Auth & session (covers Learner, Reviewer, Admin roles)

1. **Sign up a new Admin user** via the signup flow. Confirm:
   - Account created in Supabase `auth.users`.
   - Tenant row created and the user is linked as owner/admin.
   - Session cookie set on response; subsequent authenticated request succeeds.
2. **Log out**, then **log back in** with the same credentials. Session reestablished.
3. **Invite token redemption:** generate an invite (Admin flow), log out, redeem the invite as a new Learner. Confirm:
   - Invite token is single-use (re-redemption fails).
   - Invite token is time-bounded (expired token is rejected).
   - Learner is correctly scoped to the inviting tenant.
4. **Cross-tenant isolation:** create Tenant A and Tenant B with separate Admin users. From Tenant A's session, attempt to read Tenant B's:
   - Roster (`GET` whatever the roster endpoint is)
   - Certificates
   - Exam attempts
   - Billing/subscription state
   Each must return 403/404/empty — never Tenant B's data. Report the actual response for each.

### Course + exam flow (Learner side)

5. **Course progression:** as a Learner, complete Module 1 (mark videos/readings as viewed). Confirm progress persists on reload and is scoped to that user only.
6. **Exam attempt — pass path:** submit a 25-question exam with passing answers. Confirm:
   - Exam attempt row created with correct state.
   - Score calculated correctly.
   - Certificate issued (state = Active).
   - Certificate has a QR code and a verifiable public URL.
7. **Exam attempt — fail path:** submit with failing answers. Confirm:
   - Exam attempt marked failed.
   - **No certificate issued.**
   - Retake policy enforced per the spec in `CONTEXT.md` / app code.
8. **Illegal state transitions on exam attempt:** attempt 3 transitions that should be rejected (e.g., resubmit a completed attempt, modify answers after submission, score an attempt that isn't submitted). Each must return an error. Report the response for each.

### Stripe (payments + webhooks)

9. **Checkout flow:** as Admin, purchase a subscription using Stripe test card `4242 4242 4242 4242`. Confirm:
   - `checkout.session.completed` webhook received.
   - Tenant subscription state updated to active.
   - Side effect happens **exactly once** (check audit table or equivalent).
10. **Webhook idempotency:** re-send the same `checkout.session.completed` event using `stripe trigger` or by replaying from the Stripe dashboard. Confirm:
    - Second delivery is recognized as duplicate.
    - **No second side effect** — no duplicate subscription, no duplicate cert, no double-charged anything.
11. **Webhook signature verification:** send a webhook payload with an invalid signature (or no signature). Confirm:
    - Returns 400 (or 401).
    - **No state change.**
12. **Refund flow:** issue a refund via Stripe dashboard / API. Confirm:
    - `charge.refunded` webhook handled.
    - Associated certificate(s) move to the correct state per `CONTEXT.md` policy (likely Revoked).
    - Public verification endpoint reflects the new state within seconds.
13. **Subscription cancellation:** cancel a subscription. Confirm tenant state updates and certificates are handled per policy.

### Public verification endpoint (consumer-facing diner flow)

14. **Active cert lookup:** hit the public verification URL for a known Active certificate. Confirm response contains **only**:
    - Status: `Active`
    - Restaurant name
    - Issue date
    Confirm response **does not** contain: employee names, exam scores, internal IDs, tenant IDs, email addresses, or any PII. Paste the full response.
15. **Expired cert lookup:** repeat for an Expired cert. Status field reads `Expired`. Same shape rules.
16. **Revoked cert lookup:** repeat for a Revoked cert. Status field reads `Revoked`. Same shape rules.
17. **Non-existent cert:** hit the endpoint with a random/invalid ID. Response must:
    - Not leak whether the ID format is valid vs the cert simply doesn't exist (no enumeration).
    - Return a clean "not found" without internal error details.
18. **Rate limiting:** hit the verification endpoint 100 times in 10 seconds from one IP. Confirm rate limiting kicks in (429 or equivalent) before completion. If no rate limiting is configured, **flag as P0** — this endpoint is publicly scrapeable.
19. **QR code round-trip:** generate a certificate PDF, extract the QR code, decode it, and hit the resulting URL. Confirm it lands on the verification page for the correct cert.

### Reviewer flow

20. **Reviewer permissions:** as a Reviewer, attempt to:
    - View a queue of submitted exams (should succeed if scoped correctly).
    - Modify a Learner's roster entry (should fail).
    - Issue a certificate directly (should fail unless Reviewer has that permission per spec).
    - Access another tenant's exam attempts (must fail).
    Report each.

### Data integrity under concurrency

21. **Concurrent cert issuance:** trigger two payment-completion webhooks for the same checkout session simultaneously (replay both at once). Confirm:
    - Exactly one certificate is issued.
    - No duplicate row, no race condition that produces two certs or two subscription rows.
22. **Concurrent exam submissions:** submit the same exam attempt twice in parallel. Confirm one succeeds and one is rejected cleanly.

---

## Step 4 — Report format

Single report at:

```
audits/smoke-test-YYYY-MM-DD.md
```

Containing:

1. **Dev loop status** (Step 1 results).
2. **Test suite results** (Step 2 results, with every failure expanded).
3. **Smoke check results** — table of all 22 checks with PASS/FAIL/BLOCKED and the actual response or error pasted under each.
4. **Findings, prioritized:**
   - **P0** — broken behavior that blocks UI handoff (failed cross-tenant isolation, webhook double-processing, leaking PII on public endpoint, etc.)
   - **P1** — works but fragile (missing rate limiting, slow paths, missing tests for paths that pass smoke)
   - **P2** — nice-to-have
5. **Final line:**
   ```
   System works end-to-end: YES / NO — <one-sentence reason>
   ```

---

## Ground rules

- **Do not fix anything.** Smoke pass is verification-only. Findings flow into the same triage queue as the static audit.
- **Do not invent data.** If you can't run a check because the dev loop is broken, seed data is missing, or a test key isn't configured, mark **BLOCKED** and explain what's missing — don't fake a result.
- **Pair with the static audit.** Cross-reference: if the static audit said "RLS PASS" but the cross-tenant smoke check (#4) leaks data, that's a P0 contradiction that needs both fixes.
- **Real HTTP, real webhooks, real Stripe test events.** No pure mocks for the smoke checks — the whole point is to exercise the running system.
- **Boil the ocean.** Per `CLAUDE.md`: prove every PASS, mark every BLOCKED honestly, ship a complete report.

---

## Last updated

2026-05-07 — Initial authorship as companion to the backend + security audit prompt.
