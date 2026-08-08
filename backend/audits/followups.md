# Audit Follow-Ups

Out-of-scope items discovered while fixing other findings. Logged here so they don't get lost.

---

## 2026-05-07 — discovered while fixing P0 #2

### F1 — `/api/stripe/charge-cert-fees` is blocked by middleware before its `x-internal-secret` gate runs

**Found while fixing:** P0 #2 (audits/backend-security-handoff-2026-05-07.md).

**Symptom:** Even with the correct `x-internal-secret` header on the caller (P0 #2 fix), curl tests of `POST /api/stripe/charge-cert-fees` still return `HTTP 401 {"error":"Unauthorized"}`.

**Root cause:** `middleware.ts` allows server-to-server internal-secret routes through `PUBLIC_PREFIXES` for `/api/certs/` (so `/api/certs/generate` works) but NOT for `/api/stripe/charge-cert-fees`. The route is reached without a Supabase session cookie on a server-to-server fetch, the middleware sees `!user`, and returns 401 before the route handler's `if (callerSecret !== expectedSecret)` check runs. Both 401 responses share the same `{"error":"Unauthorized"}` body shape, which is why the audit attributed the failure entirely to the missing header.

**Effect:** P0 #2's stated outcome ("submission returns 201, no 402") is unreachable end-to-end until this is also fixed. The header fix in commit `0c1e869` is necessary but not sufficient.

**Proposed fix:** add `'/api/stripe/charge-cert-fees'` to `PUBLIC_PREFIXES` in `middleware.ts:14-28`, mirroring the existing `/api/stripe/payment-intent` pattern. Add a comment indicating that auth is enforced inside the route handler via `x-internal-secret`.

**Why not fixed now:** out of scope per the wave-1 instructions ("Do not refactor adjacent code. Do not 'improve' anything you notice along the way — log it"). The hook also blocked the change. Belongs in the next wave.

**Severity:** P0 (this defect, combined with P0 #2 alone, leaves submissions broken).

**Status:** FIXED in commit `12be0bc` ("fix(F1): allowlist charge-cert-fees in middleware") and verified end-to-end by `tests/e2e/f1-charge-cert-fees-middleware.spec.ts`.

---

## 2026-05-09 — discovered while auditing internal routes after F1 fix

### F2 (P0) — All 6 cron routes are blocked by middleware before their `Bearer CRON_SECRET` gate runs

**Found while auditing:** every `/api/stripe/*` and `/api/cron/*` route after fixing F1.

**Symptom:** `curl http://localhost:3000/api/cron/expire-listings` (with or without the correct `Authorization: Bearer ${CRON_SECRET}` header) returns `HTTP 401 {"error":"Unauthorized"}` — same body shape as the F1 bug. The cron handler's own bearer check is never reached.

**Routes affected (all six):**
- `/api/cron/expire-listings`
- `/api/cron/expire-subscriptions`
- `/api/cron/expire-certs`
- `/api/cron/exam-timeout-sweep`
- `/api/cron/digest-reviewer-queue`
- `/api/cron/weekly-admin-digest`

**Root cause:** `middleware.ts` `PUBLIC_PREFIXES` does not include `/api/cron/`. Vercel Cron makes a regular HTTP GET with `Authorization: Bearer <secret>` — no Supabase session cookie. Middleware sees `!user`, hits the API-prefix branch, returns 401 before the cron handler's bearer check runs. Identical class of bug as F1.

**Effect on production:** every scheduled cron job in `vercel.json` (subscription expiry, cert expiry warning emails, exam-attempt timeout sweep, reviewer-queue digest, weekly admin digest, listing expiry) is silently 401'd by middleware. None of these scheduled actions actually run. State that depends on cron — expired subs that should pause restaurants, expiring certs that should send 30/14/7-day warnings, abandoned exam attempts that should auto-submit — all drift indefinitely.

**Proposed fix:** add `'/api/cron/'` to `PUBLIC_PREFIXES` in `middleware.ts:14-28`, mirroring the existing `/api/certs/` pattern. Each cron handler already enforces `Authorization: Bearer ${CRON_SECRET}` itself (verified — see e.g. `app/api/cron/expire-listings/route.ts:19-22`).

**Why not fixed in this wave:** scope was F1 only ("DO NOT touch any Wave 2 finding"). Belongs in the next wave.

**Severity:** P0 — production cron jobs do not run. Equivalent severity to F1.

**Status:** FIXED in commit `a4edb07` ("fix(F2): allowlist all cron routes in middleware"). Verified end-to-end by `tests/e2e/f2-cron-middleware.spec.ts` (12/12 green: 6 routes × 2 browsers). Production state-recovery analysis filed at `audits/cron-state-recovery-2026-05-07.md`.

### F3 (audit-controls only) — Cron-route 401-blocked behavior is not currently caught by any test

**Found while auditing.** No unit or e2e test exercises any cron route through middleware. The pilot-loop spec invokes none of `/api/cron/*`. The only cron test is `tests/unit/cron-idempotency.test.ts` which calls handlers directly, bypassing middleware entirely. Result: F2 went undetected by a passing test suite.

**Proposed fix (track only, after F2):** add a regression test that hits each cron route via HTTP with a valid bearer header and asserts not-401 (or the route's specific 200/204 success body).

**Severity:** P2 — testing gap.

---

## 2026-05-09 — Wave 2A status (P0 #3 / #4 / #8 / F-S1 + audit follow-ons)

### Original audit findings — closed

| ID | One-liner | Status |
|---|---|---|
| **P0 #3** | `certificates_public_read_by_cert_code` `using(true)` | FIXED in `530fff4` (migration 0011 drops policy). Verify endpoint at `/api/certs/[certCode]/verify` uses service-role and still returns the documented 4 fields for active/expired/revoked. Test: `tests/integration/rls-hardening.test.ts`. |
| **P0 #4** | `exam_attempts_learner_update_own` UPDATE no WITH CHECK | FIXED in `530fff4` (policy dropped). All exam writes use service-role. Test: `tests/integration/rls-hardening.test.ts`. |
| **P0 #8** | Supabase auth cookie `httpOnly: false` | FIXED in `34e7ae8` (override `setAll` in `lib/supabase/middleware.ts` + `lib/supabase/server.ts`). Set-Cookie now carries `HttpOnly; SameSite=lax` (and `Secure` in prod). Test: `tests/e2e/p08-cookie-hardening.spec.ts`. |
| **F-S1** | `restaurants_public_read_listed using(status='listed')` w/o expiry pair | FIXED in `530fff4` (RLS policy dropped). App-route layer also locked in via `tests/e2e/f-s1-route-layer-expired-listing.spec.ts` (8/8 green: directory 404s expired listings, search excludes them, control active row still resolves). |

### Audit follow-ons closed in same wave (5 additional naked-UPDATE-policy bugs surfaced while auditing P0 #4)

All five same-class as P0 #4 — UPDATE policy lacked WITH CHECK, dropped in commit `530fff4`:

- `profiles_update_self` — would let a learner self-promote to `role='admin'` via direct Supabase client.
- `lesson_progress_learner_update_own` — would let a learner mark all lessons complete bypassing watch-time anti-cheat.
- `restaurants_admin_update_own` — would let an admin set `status='listed'` bypassing the reviewer flow.
- `submissions_reviewer_update_all` — would let any reviewer rewrite payment fields bypassing `decide_submission` RPC.
- `reviews_reviewer_update_all` — same shape on the reviews table.

All callsites verified to use service-role in `audits/wave-2a-write-path-verification.md`. Zero user-role-JWT or browser-client write paths existed. Tests covering profiles / lesson_progress / exam_attempts in `tests/integration/rls-hardening.test.ts`.

### F-S6 (P0) — SubmitClient.tsx browser-side Supabase Storage upload broken by P0 #8 cookie hardening

**Found while fixing:** P0 #8.

**Symptom:** After `httpOnly: true` lands on the auth cookie, the browser-side `createClientSupabase()` instance in `app/(admin)/admin/submit/SubmitClient.tsx:448-456` cannot read `document.cookie` to authenticate its `supabase.storage.from('restaurant-photos').upload(...)` call. Storage RLS policy `restaurant_photos_admin_insert` (0004_storage.sql) requires an authenticated user, so the upload returns 401. The same applies to the `.remove(storagePath)` rollback at line 492.

**Effect on production:** the admin submit flow's photo upload step silently 401s. No restaurant can attach a hero photo via this UI today after Wave 2A. The route-handler `POST /api/submissions/create` itself works (server-side cookie reading is unaffected by `httpOnly: true`).

**Proposed fix (Wave 2A.5 — immediately after Wave 2A, before Wave 2B):**
1. Build `POST /api/admin/upload-photo` route that:
   - Validates the admin session via `createServerSupabase().auth.getUser()` + DB role re-check
   - Buffers the multipart upload (server-side magic-byte MIME validation, 5MB cap)
   - Pipes through `sharp` to re-encode and **strip EXIF** (also closes main-audit P1-7)
   - Uploads the sanitized buffer via `createServiceSupabase().storage.from('restaurant-photos').upload(...)`
   - Returns the storage path
2. Refactor `SubmitClient.tsx` to `fetch('/api/admin/upload-photo', { method: 'POST', body: formData })` instead of importing `createClientSupabase`.
3. Drop the storage RLS policies `restaurant_photos_admin_insert/_update/_delete` (0004_storage.sql) since user-role JWTs no longer touch the bucket directly.

**Severity:** P0 — admin submit flow's photo upload is currently broken in production. Same priority as Wave 2A's bugs that broke similar flows.

**Why P0, not P1:** even though the literal symptom ("photo upload fails") is admin-facing not customer-facing, it blocks the entire restaurant submission flow because `/api/submissions/create` requires a non-empty `heroPhotoStoragePath` from the upload step. Without this, no restaurant can advance to `pending_review`.

**Scheduled:** Wave 2A.5 — runs immediately after Wave 2A lands, before Wave 2B begins.

**Status:** FIXED in commit `6d6e0d2` ("fix(F-S6): server-side admin photo upload + drop user-role storage policies"). Verified end-to-end:
- New route `POST /api/admin/upload-photo` validates session+admin role, enforces 5 MB cap, validates MIME from actual bytes via `sharp().metadata().format`, strips EXIF via `sharp(buf).rotate().toFormat(<orig>).toBuffer()`, uploads via service-role.
- `SubmitClient.tsx` rewired to fetch the new route; `createBrowserClient` import removed (no remaining browser-side Supabase write paths anywhere in the codebase).
- Migration `0012_drop_storage_admin_update.sql` drops the user-role storage policies (`restaurant_photos_admin_insert/_update/_delete`) on the `restaurant-photos` bucket. Bucket remains public-SELECT (directory photos); all writes now flow through the server route via service-role.
- 8 new Vitest integration tests + 6 new Playwright e2e tests, all green. 420/420 vitest + 84/84 Playwright with no regressions.
- Main-audit **P1-7 (EXIF stripping)** is folded into this fix — server route runs `sharp().rotate()` which applies EXIF orientation then drops all metadata. Verified by service-role download + sharp metadata read (input EXIF PRESENT → uploaded blob EXIF absent).
- Manual smoke: anon-key direct Storage write returns `403 row-level security policy` (migration 0012 confirmed); curl without session returns 401 from handler-level gate; admin curl with session uploads successfully.

### Main-audit P1-7 — EXIF stripping on public restaurant photos

**Status:** FIXED as part of F-S6 (commit `6d6e0d2`). The server-side `/api/admin/upload-photo` route runs every uploaded image through `sharp(buf).rotate().toFormat(<jpeg|png|webp>).toBuffer()`, which applies the EXIF orientation tag then strips all remaining metadata. Output uploaded to `restaurant-photos` bucket carries no GPS, device, timestamp, or other EXIF fields. The same route also rejects non-image bytes via byte-content MIME validation, addressing the closely-related "MIME magic-byte not validated server-side" finding in the same Phase of the original audit.

### Main-audit P0 #7 — Stored XSS in lesson player (DOMPurify sanitization)

**Status:** FIXED in commit `f92da76` ("fix(P0-#7): sanitize inlineFormat output via DOMPurify (lesson-player XSS)").

**What landed:**
- `inlineFormat()` extracted from `app/(learner)/learner/courses/[moduleId]/[lessonId]/page.tsx` into a sibling module `inlineFormat.ts` so the function is importable from unit tests (Next.js App Router pages cannot have arbitrary named exports beyond `default` / `generateMetadata` etc.). The lesson page imports the function from the sibling file; behavior at the call site is identical.
- The function now pipes its regex-replaced output through `DOMPurify.sanitize()` with `ALLOWED_TAGS = ['strong','em','code']` and `ALLOWED_ATTR = ['class']`. The allowlist is exactly the three tags inlineFormat legitimately produces, so it cannot over-strip legitimate content; everything else (raw HTML in body_md, including `<script>`, `<img onerror>`, `<iframe>`, inline event handlers, `javascript:` URLs in `<a>`) is dropped before render.
- Added `isomorphic-dompurify` dependency. Works in server-render and client-render; the lesson page is `'use client'` but the same module is safe to import from server components if a future surface needs it.

**Test coverage:** `tests/unit/lesson-body-xss.test.ts` (7 cases), each asserting a canonical XSS payload is stripped: `<img onerror>`, `<script>` with `document.cookie` exfil, `<iframe>`, inline event handlers (`onclick`), `javascript:` URLs in raw `<a>`, mixed safe-text-with-injected-HTML, plus a positive control that legitimate `**bold**` / `*italic*` / `` `code` `` markdown still renders.

**Verification:** 7 red → 7 green; full suite 427/427 vitest + 98/98 Playwright + typecheck 0 + build clean. No regressions.

### Main-audit P0 #9 — CSRF protection at the middleware layer (with F1/F2 bypass)

**Status:** FIXED in commit `ddbd92c` ("fix(P0-#9): CSRF protection in middleware with PUBLIC_PREFIXES bypass").

**What landed:** `middleware.ts` adds `isCsrfSafe()` and runs it on non-public state-changing requests (POST/PUT/PATCH/DELETE) BEFORE the auth check. Decision matrix:

| Condition | Outcome |
|---|---|
| GET / HEAD / OPTIONS | Safe — not subject to CSRF |
| Path in PUBLIC_PREFIXES | Bypass entirely (Stripe HMAC, Vercel Cron Bearer, internal x-internal-secret routes carry no Origin header by design) |
| Origin header present | Must match `Host` |
| Origin missing, Referer present | Referer's origin must match `Host` |
| Both headers missing | Allow (server-to-server fallback). Browser-form CSRF always carries Origin, so this is unreachable from the threat we're protecting against. |

The PUBLIC_PREFIXES bypass is documented in `middleware.ts` next to the function: F1/F2 added `/api/stripe/*` and `/api/cron/*` explicitly because their server-to-server callers carry no Origin. CSRF on those would 403 every webhook delivery and cron run.

**Verified end-to-end via tests/e2e/p09-csrf-middleware.spec.ts (14 cases) + manual curl smoke**:

| Scenario | Pre-fix | Post-fix |
|---|---|---|
| Cross-origin POST `Origin: evil.com` to /api/invites/send | 400 (Zod, request reached handler) | **403 CSRF (middleware blocks)** |
| Cross-origin Referer (no Origin) | reached handler | **403 CSRF** |
| Same-origin POST | reached handler | reached handler (unchanged) |
| Cron route `Bearer + NO Origin` | 200 (post-F2) | 200 (unchanged — F2 bypass intact) |
| Stripe webhook `NO Origin + bogus sig` | 400 sig | 400 sig (unchanged — bypass intact) |
| `charge-cert-fees` `x-internal-secret + NO Origin` | 404 (post-F1) | 404 (unchanged — F1 bypass intact) |
| GET with cross-origin Origin | unchanged | unchanged (CSRF only applies to state-changing methods) |

Full suite post-fix: 420/420 vitest + 98/98 Playwright + typecheck 0; no regressions to F1/F2 work or pilot loop.

---

## 2026-05-10 — Wave 2C status (cert state machine — P0 #5 / #6 / A8.4 / F-S2 / F-S3 / F-S4 / F-S5)

### Original audit findings — closed

| ID | One-liner | Status |
|---|---|---|
| **P0 #5** | No webhook handler for `charge.refunded` / `charge.dispute.*` — refunded or chargeback'd certs stayed visibly active | FIXED in `02ec2e3` ("feat(webhook): full Wave 2C cert-lifecycle Stripe handlers"). New `lib/stripe/cert-event-handlers.ts` covers `payment_intent.succeeded` (kind=cert_fee), `payment_intent.canceled`, `payment_intent.payment_failed`, `charge.refunded`, `charge.dispute.created`, `charge.dispute.closed` (won/lost/warning_closed), `charge.dispute.funds_withdrawn`, `charge.dispute.funds_reinstated`, `customer.subscription.deleted`. Transitions consult `transitionCert()` for legality (R5/R6 carve-out via `STATE_MACHINE_EXCEPTIONS`). Tests: `tests/integration/stripe-cert-events.test.ts` (17), `tests/integration/cert-race-conditions.test.ts` (5 — R1/R3/R5/R6/R7), `tests/integration/cert-refund-path.test.ts` (4), `tests/integration/cert-dispute-path.test.ts` (4). |
| **P0 #6** | `exam/submit` created cert with hardcoded `fee_charged_cents=3500` BEFORE payment confirmed | FIXED in `a867c8d` ("feat(exam-submit): create cert in pending state, defer PDF to activation"). Cert now inserts with `status='pending'`, no `fee_charged_cents`, no `stripe_payment_intent_id`. Webhook activation handler stamps both at the cert-fee PI succeed moment. PDF generation deferred from exam-pass to activation per OQ-1. ExamPassed email reworded so it no longer claims the cert is issued. Tests: `tests/unit/exam-submit-pending-cert.test.ts` (3), `tests/unit/exam-passed-email-reword.test.ts` (3), `tests/integration/cert-payment-happy-path.test.ts` (6). |
| **A8.4** | No audit trail for cert state transitions | FIXED across `2fff48b` (migration 0013 + ActivityEventType vocabulary expansion in `lib/types/db.ts`), `02ec2e3` (handlers write `cert_activated`, `cert_revoked`, `cert_disputed`, `cert_dispute_resolved`, `cert_dispute_funds_withdrawn`, `cert_dispute_funds_reinstated`, `cert_payment_canceled`, `cert_payment_failed`, `cert_payment_orphaned`, `cert_state_transition_blocked` per design (g)), and `4ba3a3f` (migration 0014 partial expression index on `payload->>'certificate_id'` for the `select * from activity_events where payload->>'certificate_id' = $1` history query). |
| **F-S2** | `app/api/directory/[slug]/route.ts` cert count read `revoked = false` only, including expired certs | FIXED in `bc9e8d8` (cron flips `active → expired` so the predicate is meaningful) + `9802365` (route uses `status='active'`). Migration `2fff48b` dropped `revoked` boolean entirely so naked `.eq('revoked', false)` reads fail at compile. |
| **F-S3** | `lib/directory/search.ts` raw SQL `FILTER (WHERE c.revoked = false)` had same bug | FIXED in `9802365` — predicate is now `FILTER (WHERE c.status = 'active')`. |
| **F-S4** | `app/api/learner/certificate/route.ts` returned expired certs | FIXED in `9802365` — query now filters `status='active'`. The new `cert-status.ts` helper is the canonical reader. |
| **F-S5** | `app/api/learner/home-data/route.ts` showed expired certs as "current" | FIXED in `9802365` — same `status='active'` predicate. |

### Migration summary

- **0013_cert_state.sql** (`2fff48b`) — adds `status`, `status_changed_at`, `revocation_reason`, `dispute_id`, `disputed_at`; drops `revoked`; adds 4 partial/composite indexes for the canonical hot paths.
- **0014_activity_events_cert_index.sql** (`4ba3a3f`) — partial expression index on `(payload->>'certificate_id')` for the per-cert audit trail lookup.
- `db/seed.sql` gains 5 sample certs covering every state for dev surface coverage (`4ba3a3f`).

### New cron

- `/api/cron/purge-stale-pending-certs` — daily 03:45 UTC. Hard-deletes pending certs older than `PENDING_CERT_TTL_DAYS` (default 14). Writes `cert_purged` activity event. `bc9e8d8`.

### Reconciliation script

- `scripts/reconcile-cert-states.ts` — two-phase (dry-run → `--apply`). Reads every cert, classifies, writes `audits/cert-migration-report.md`. `--apply` re-computes the plan and **fail-closes if the on-disk report is stale** vs current DB. Tests: `tests/integration/reconcile-cert-states.test.ts` (7) including golden-file dry-run, idempotent `--apply`, and fail-closed-on-drift.

### P1 follow-up — `CertActivated` learner email at the pending → active transition

**What:** the activation handler currently writes the `cert_activated` activity event but does not send a learner-facing email at that moment. OQ-5 split the email work into "this wave" (reword `ExamPassed`) and "P1 follow-up" (new `CertActivated` template).

**Why deferred:** new email template (subject, body, branding pass) is UI-template work that fits naturally in the upcoming Phase 3 UI build. The functional gap (learner doesn't know their cert just activated) is bounded — the verify URL embedded in the existing PDF and the directory listing surface the activation; only the proactive notification is missing.

**Proposed implementation:** new `lib/email/templates/CertActivated.tsx` modeled on `ExamPassed.tsx`. Wire `lib/email/send.ts` to expose `sendEmail('CertActivated', ...)`. Activation handler in `lib/stripe/cert-event-handlers.ts` fires the email fire-and-forget after writing the activity event (mirror the pattern in the existing `handlePlanPayment → WelcomeAdmin` flow).

**Severity:** P1 — soft UX gap, not a state correctness issue.

**Status:** open. Track as Wave 2C P1.

### Final tally for Wave 2C

511/511 vitest tests passing (was 383 pre-wave; +128 new tests covering the cert state machine, helpers, webhook handlers, crons, race conditions, scenarios, reconciliation, schema). Typecheck clean. The integration suite includes a real-DB pass against local Supabase for every state transition.

---

## 2026-05-10 — Wave 3 test infrastructure fixes (post-verification)

### Test env-loading bug — FIXED

**Found while running the Wave 3 verification pass.** Playwright tests did
not inherit env vars from `.env.local`, while the Next.js dev server reads
them automatically. Two observable failures:

- `tests/e2e/p09-csrf-middleware.spec.ts:85` (cron-bypass test) read
  `process.env.CRON_SECRET`, got `undefined`, fell back to empty string,
  sent `Authorization: Bearer ` (no token), and got 401 from the cron
  handler (which compared against the real env-side secret).
- 36 tests across `full-pilot-loop`, `f1`, `f2`, `f-s1`, `f-s6`, `p08`
  were skipping. Some were intentional (placeholder Stripe / Mux keys);
  some were false-skips because the env var was undefined in the test
  process and tripped a `placeholder` guard.

**Fix:** `tests/e2e/global-setup.ts` calls `dotenv.config({ path:
'.env.local', override: false })` before the Playwright suite runs.
Wired in `playwright.config.ts` via the `globalSetup` option. CI-side
env vars (which set `override: false` honors) still win over the file.

### p09-csrf-middleware hardcoded port — FIXED

**Found in same pass.** `tests/e2e/p09-csrf-middleware.spec.ts` had
`const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3000'` and
threaded that constant into every `api.post(\`${BASE_URL}/...\`)` call.
Earlier the literal was `3003` (wrong port — Playwright config baseURL
is `3000`). Either way the test required an env var or a literal match.

**Fix:** the spec now uses Playwright's per-test `request` fixture
(reads baseURL from `playwright.config.ts` automatically) instead of
constructing its own `APIRequestContext` with a hardcoded URL. All
requests use relative paths (`/api/...`). `BASE_URL` constant removed.

### Other tests cleaned up in the same wave

Audit ran `grep -rn "localhost:30" tests/ --include="*.ts"` and
`grep -rn "process.env.BASE_URL" tests/ --include="*.ts"`. Every e2e
spec carrying the same fragile pattern was fixed:

- `tests/e2e/f-s1-route-layer-expired-listing.spec.ts` — was defaulting
  to `localhost:3003` (wrong port); switched to `request` fixture.
- `tests/e2e/f-s6-admin-photo-upload.spec.ts` — same `:3003` default;
  switched to `request` fixture. The cross-context "non-admin learner"
  test still uses `playwrightRequest.newContext` for cookie isolation
  but now reads `baseURL` from the test fixture.
- `tests/e2e/p08-cookie-hardening.spec.ts` — same `:3003` default;
  switched to `request` fixture.
- `tests/e2e/f1-charge-cert-fees-middleware.spec.ts` — default was
  `:3000` but still a fragile literal; switched to `request` fixture.
  Also updated cert insertion to use `status='active'` (Wave 2C schema).
- `tests/e2e/f2-cron-middleware.spec.ts` — same fragile literal pattern;
  switched to `request` fixture.
- `tests/e2e/full-pilot-loop.spec.ts` — the shared `pilotApi` context
  in `beforeAll` now reads `baseURL` from `testInfo.project.use.baseURL`
  (which mirrors the `playwright.config.ts` value). All 30+ request
  call sites switched from `\`${BASE_URL}/path\`` to relative `/path`.
  Step 9's seeding-without-Stripe branch also gained a service-role
  UPDATE that activates the cert (`pending → active`), simulating the
  Wave 2C webhook handler so step 11's directory count assertion is
  reachable without a real Stripe key.

Test files in `tests/unit/` and `tests/integration/` that pass
`http://localhost:3000` to `NextRequest` were NOT changed — those URLs
are in-process request fabrications, never hit the network.

### Verification

Re-ran `pnpm playwright test` with NO inline env vars:

- **Total tests:** 98 (49 chromium + 49 Mobile Chrome)
- **Passed:** 98
- **Intentionally skipped:** 0 (post-fix; placeholder-gated skips no
  longer false-trip on undefined env)
- **Failed:** 0

Vitest regression check: 511/511 still green.

Stable across 2 consecutive clean-DB runs.

---

## 2026-05-10 — Wave 4B (P0 #10 verify-endpoint enumeration)

### Main-audit P0 #10.a — sequential cert codes → random Crockford Base32 — FIXED

**Status:** FIXED. Closes `audits/backend-security-handoff-2026-05-07.md` P0 #10.a.

Cert codes were `AW-{year}-{6-digit-sequence}` — trivially enumerable by
incrementing. The verify endpoint plus the open RLS policy (P0 #3, fixed
in Wave 2A) made a full customer-base census possible in hours.

**Implementation:**
- `lib/learner/cert-code.ts` — new `generateCertCode()` returns
  `AW-XXXXX-XXXXX-C` from 50 bits of entropy
  (`crypto.randomBytes(7)` → Crockford Base32) plus an ISO 7064
  Mod 37,36 check digit. Rejection-samples to keep the check digit
  inside the Crockford alphabet, preserving 100% single-substitution
  and 100% adjacent-transposition detection.
- `validateCertCode()` enforces the regex + recomputes the check
  digit. Normalizes user input (uppercase, strip non-alnum, apply
  Crockford I/L/O/U remap).
- `db/migrations/0015_cert_code_random.sql` — CHECK constraint that
  physically rejects the old `AW-YYYY-NNNNNN` format at the DB layer.
- `app/api/exam/submit/route.ts` — generates the cert code, retries
  up to 3 times on `23505`. Every retry writes a
  `cert_code_collision_retry` activity event; exhausted budget writes
  `cert_issuance_retry_exhausted`.
- `lib/learner/exam.ts:buildCertCode` — DELETED. Dead-code removal.
- `db/seed.sql` — five dev seed certs use static new-format codes
  generated once with the new generator.
- Pre-launch: no production-issued codes. No customer comms. No
  redirect from old codes. Migration is the schema change + dev-DB
  reseed via `pnpm db:reset`.

**Tests:**
- `tests/unit/cert-code.test.ts` — 16 cases (regex, round-trip,
  10k unique, no I/L/O/U in body, normalization, 100%
  single-substitution detection on 100 trials, transposition
  detection, 1M-collision statistical smoke).
- `tests/unit/exam-submit-cert-code.test.ts` — new-format cert
  emission, 100 unique codes across 100 submits, retry observability
  on 1 collision and on exhausted-budget cases.

### Main-audit P0 #10.b — rate limit on /api/certs/[certCode]/verify — FIXED

**Status:** FIXED. Closes `audits/backend-security-handoff-2026-05-07.md` P0 #10.b.

The public verify endpoint had no rate limit, so even random cert codes
were brute-forceable at 100 req/sec.

**Implementation:**
- `@upstash/ratelimit` + `@upstash/redis` added as dependencies.
- `lib/security/rate-limit.ts` — two sliding-window limiters:
  per-IP (10 / 60s, key `rl:verify:ip:<hash>`) and per-cert-code
  (5 / 60s, key `rl:verify:code:<canonical>`). Both must pass.
  Tunable via `RATELIMIT_VERIFY_IP_PER_MIN` and
  `RATELIMIT_VERIFY_CODE_PER_MIN` env vars.
- `lib/security/client-ip.ts` — `getClientIpHash(req, pepper)`
  produces a 64-bit hex SHA-256 hash. Full IPv6 (no /64 truncation).
  Pepper from `RATELIMIT_IP_PEPPER`. Raw IP never logged / stored.
- `app/api/certs/[certCode]/verify/route.ts` — rewritten:
  1. `validateCertCode` FIRST (no I/O — malformed traffic cannot
     burn a victim's per-IP window).
  2. Per-IP rate-limit; per-code rate-limit. 429 with
     `Retry-After: 60` + `Cache-Control: no-store`. Body is the
     constant `{ valid: false, status: 'rate_limited' }` —
     byte-identical for existing vs nonexistent codes.
  3. DB read.
  4. Always emits a `cert_verify_latency` structured log line.
  - `revalidate = 60` removed; `dynamic = 'force-dynamic'` added so
    the rate limiter has authority on every request (cache hit
    would have bypassed it).
  - Fail-closed: if Redis throws, returns 503 with the same
    `Retry-After` and `Cache-Control` headers. Body is identical
    across all callers. Writes `cert_verify_rate_limiter_down`
    activity event.

**Observability:**
- `cert_verify_rate_limited` activity event on every 429, payload
  `{ ip_hash, cert_code, kind: 'per_ip' | 'per_code' }`.
- `cert_verify_rate_limiter_down` activity event on every 503,
  payload `{ error }`.
- `cert_verify_latency` structured log on every request: `{ type,
  duration_ms, db_query_ms, rate_limit_ms, outcome }`.

**Tests:**
- `tests/unit/client-ip.test.ts` — 7 cases (determinism, pepper
  sensitivity, IPv6 full-hash, x-forwarded-for left-most, unknown
  fallback, 16-char hex shape).
- `tests/integration/verify-cert-code-format.test.ts` — 7 cases
  including the byte-equality assertion for malformed-vs-unknown
  (the load-bearing test for the format-first ordering decision).
- `tests/integration/verify-rate-limit.test.ts` — 6 cases:
  per-IP 11th-request trigger, per-code 6th-request trigger,
  byte-identical 429 for existing-vs-nonexistent codes,
  activity event written for per-IP and per-code rejections,
  malformed traffic does NOT reach the limiter.
- `tests/integration/verify-rate-limit-fail-closed.test.ts` — 3
  cases: 503 + Retry-After, activity event written, byte-identical
  503 for existing-vs-nonexistent codes.
- `tests/integration/verify-rate-limit-live-smoke.test.ts` —
  env-gated (`UPSTASH_LIVE_TEST=1`). NOT in the regular suite. One
  end-to-end scenario against a real Upstash instance; run before
  bumping the library versions.

### Wave 4B P2 follow-ups

#### P2 — Monitoring threshold: cert_code_collision_retry > 10 / 24h

If more than 10 `cert_code_collision_retry` activity events fire in a
rolling 24h window, the entropy source is probably broken (50-bit
space + UNIQUE constraint should produce < 1 collision per million
issuances at the modeled customer growth rate). Wire up an alert
when the monitoring stack lands.

#### P2 — Verify-endpoint latency: reopen the LRU question if p99 > 250ms

The verify route emits `cert_verify_latency` log lines on every call.
Aggregate p50/p95/p99 over rolling windows. **Reopen OQ-1 (in-handler
LRU cache) when EITHER:**
- p99 > 250ms over a 1-hour window, OR
- p95 > 100ms over a 24-hour window.

The fix at that point is a 5-second in-process LRU keyed on canonical
cert_code; the rate-limit guard still runs on every external request
because the cache is below it in the call stack. Documented in
`audits/cert-code-redesign-plan.md` OQ-1.

#### P2 — Live Upstash smoke test before dep bumps

`tests/integration/verify-rate-limit-live-smoke.test.ts` is skipped
by default. Operator must run it manually with `UPSTASH_LIVE_TEST=1`
before any `@upstash/ratelimit` or `@upstash/redis` version bump.

---

## 2026-05-10 — Wave 4A (P0 #11 dependency bump)

### Main-audit P0 #11 — `next@14.2.30` has 4 direct HIGH advisories — FIXED

**Status:** FIXED in commit `182d261` ("fix(P0-#11): bump next 14.2.30 → 14.2.35"). Closes `audits/backend-security-handoff-2026-05-07.md` P0 #11.

**pnpm audit before vs after:**

| Severity | Before | After | Δ |
|---|---|---|---|
| critical | 2 | 2 | 0 |
| high | 10 | 8 | −2 |
| moderate | 18 | 15 | −3 |
| low | 2 | 2 | 0 |
| **Total** | **32** | **27** | **−5** |

**Specifically closed (direct `.>next` paths):**
- GHSA-5j59-xgg2-r9c4 — "Next has a Denial of Service with Server Components — Incomplete Fix Follow-Up" — patched 14.2.35.
- GHSA-7p47-r5cw-c5g6 — "Next Vulnerable to Denial of Service with Server Components" — patched 14.2.34.

**Verification:** typecheck clean, build clean (no middleware/edge-runtime warnings), 511/511 vitest, 98/98 Playwright.

### Remaining advisories (post-Wave-4A)

#### P1 follow-up — direct `.>next` HIGH not fixed by 14.x patch

**Advisory:** GHSA-jqgw-pjp3-2j97 — "Next.js has a Denial of Service with Server Components" — patched only in `next >= 15.5.15`. Our direct dep is `14.2.35`. Cannot be closed without a Next 14 → 15 major migration.

**Plan:** schedule a Next 15 migration wave (own branch). Migration considerations:
- Wave 2A CSRF middleware behaviour under Next 15 edge runtime.
- Wave 3 PUBLIC_PREFIXES cron-route bypass.
- Stripe webhook raw-body handling under Next 15 App Router changes.
- Stripe MCP `upgrade-stripe` skill flag for any breaking SDK shifts.

**Severity:** P1 — DoS via crafted RSC payloads. Mitigated short-term by Vercel WAF + the route handlers' own rate-limiting/auth guards on every state-changing surface.

#### P1 follow-up — transitive `react-email > next` 2 CRITICAL + 4 HIGH

`react-email` pulls Next 15.x internally for its dev preview server (`pnpm email:dev`). The transitive Next is not used in production builds — only by the local `react-email dev` previewer.

**Advisories:**
- CRITICAL GHSA-f82v-jwr5-mffw — RCE in React flight protocol (Next 15.1.0-canary.0 → 15.1.9)
- CRITICAL GHSA-f82v-... — Authorization Bypass in Next.js Middleware (15.0.0 → 15.2.3)
- HIGH GHSA-3h52-269p-cp9r — DoS via cache poisoning (15.0.4-canary.51 → 15.1.8)
- HIGH GHSA-67rr-9q9g-q8r8 — DoS Server Components (15.1.1-canary.0 → 15.1.10)
- HIGH GHSA-r3wv-7r4h-2v2c — HTTP request deserialization DoS (15.1.1-canary.0 → 15.1.12)
- HIGH GHSA-q4xj-x8m2-q7gj — HTTP request deserialization DoS (13.0.0 → 15.0.8)
- LOW GHSA-qpjv-v59x-3qc4 — Race Condition to Cache Poisoning (15.0.0 → 15.1.6)

**Why P1, not P0:** the `react-email > next` tree is invoked only by `pnpm email:dev` (local template previewer) — never shipped to production, never exposed to untrusted input. Production email rendering uses `@react-email/components.render(...)` which has no `next` dep.

**Plan:** bump `react-email` once upstream republishes against a patched Next 15.x line (currently they're behind). Alternative: drop `react-email` (the CLI previewer) and use `@react-email/components` directly — same render output, no Next dep. Tracked but not blocking.

#### P2 follow-up — transitive `glob` HIGH (command injection via -c/--cmd)

**Advisory:** GHSA-7f5x-vrch-mr85 — `glob >=10.2.0 <10.5.0` — command injection when calling `glob -c <cmd>` from a shell. Patched in 10.5.0.

**Path:** transitive via a dev tool we don't shell-invoke with the `-c` flag. Not user-input-reachable.

**Severity:** P2 — exploit requires a developer to run `glob -c <attacker-controlled>` from a shell. Not in any production code path.

**Plan:** wait for transitive dep upgrade or override via `pnpm.overrides` when a Wave 4B dep wave lands.

#### Moderate/low — rolled into a future dep-hygiene wave

15 moderate + 2 low advisories remain. All transitive via dev tools (vite/esbuild test infra, react-email previewer). None are runtime-reachable in production. Triaged as P3 — bundle them into a quarterly dep-hygiene pass.

---

## 2026-05-11 — Wave-gate P1 (P1-9 + P1-14 implemented; P1-16 design awaiting review)

Branch: `wave-gate-p1-critical`. Closes the three handoff-critical P1
findings from `audits/backend-security-handoff-RE-AUDIT-2026-05-11.md`.
P1-9 and P1-14 implemented + tested. P1-16 design doc delivered;
implementation gated on review.

### Main-audit P1-9 — `Math.random()` in exam shuffle → CSPRNG — FIXED

**Status:** FIXED.

**What landed:**

- `lib/security/secure-random.ts` — exports `secureShuffle<T>(items)`
  (Fisher-Yates over a defensive copy, backed by `crypto.randomInt`)
  and `secureRandomInt(maxExclusive)` (thin wrapper over `randomInt`
  with input guards).
- `app/api/exam/start/route.ts` — the in-route `shuffleArray` helper
  (which used `Math.random()`) is removed; the route now imports
  `secureShuffle`.
- `app/api/reviews/submit/route.ts` — the only other `Math.random()`
  callsite under `app/`+`lib/`. The non-security jitter delay still
  exists but now sources entropy from `secureRandomInt`, so the
  grep-regression test stays clean and the project posture is
  uniform.

**Tests:**

- `tests/unit/secure-random.test.ts` — 10 cases covering
  `secureRandomInt` bounds + uniform distribution, `secureShuffle`
  permutation invariant, position-value uniformity across 10k shuffles
  of `[1..5]`, empty / single-element edge cases, AND a grep-based
  regression test that walks `app/` + `lib/` and fails if the literal
  token `Math.random` reappears anywhere.
- `tests/integration/exam-start-shuffle.test.ts` — 2 cases hitting the
  start route end-to-end with mocked auth + DB. 20 consecutive starts
  produce ≥18 distinct question orders; consecutive pairs differ
  ≥18/19 times. Asserts the specific predictability vector
  ("predict K+1 from K") that P1-9 was about.

**Verification:** `pnpm vitest run tests/unit/secure-random.test.ts
tests/integration/exam-start-shuffle.test.ts` → 12/12 green.
Full suite: 586/586 vitest passing (up from 511 pre-wave; +75 from this
wave-gate batch). `grep -rn "Math.random" app/ lib/` returns zero
matches.

### Main-audit P1-14 — rate limits on signup / invite-accept / invites-send — FIXED

**Status:** FIXED.

**What landed:**

- `lib/security/rate-limit.ts` — six new memoized factory functions
  using the same `@upstash/ratelimit` + `@upstash/redis` stack as
  Wave 4B's verify limiters:
  - `getSignupIpLimiter()` — 10/60s, prefix `rl:signup:ip`.
  - `getSignupEmailLimiter()` — 5/60s, prefix `rl:signup:email`.
  - `getInviteAcceptIpLimiter()` — 10/60s, prefix
    `rl:invite-accept:ip`.
  - `getInviteAcceptTokenLimiter()` — 5/60s, prefix
    `rl:invite-accept:token`.
  - `getInviteSendIpLimiter()` — 10/60s, prefix `rl:invite-send:ip`.
  - `getInviteSendRestaurantLimiter()` — 20/60s (admins legitimately
    bulk-send), prefix `rl:invite-send:restaurant`.
  - All knobs configurable via per-route env vars; defaults in
    `.env.example`.
- `lib/security/rate-limit-guard.ts` — shared helper to run an
  ordered list of guards and emit the canonical byte-identical 429 /
  503 responses. Single frozen literal bodies (`{error:'rate_limited'}`
  / `{error:'unavailable'}`) + fixed `Retry-After: 60` +
  `Cache-Control: no-store`. Byte-equality holds by construction —
  no per-call string interpolation.
- `app/api/auth/signup/route.ts` — order is `parse → Zod validate
  → per-IP → per-email → performSignup`. Per-email key is the
  case-insensitive normalized email so `Mixed@Case.test` and
  `mixed@case.test` share a budget. Malformed traffic never reaches
  the limiter (Wave 4B ordering discipline preserved). Hits write
  `signup_rate_limited` / `signup_rate_limiter_down` activity events
  with `kind` and `ip_hash` only — no PII (P1-8 alignment).
- `app/api/auth/invite/accept/route.ts` — order is `parse → Zod
  validate → per-IP → per-token-hash → validateInviteToken →
  acceptInvite`. The token is sha256-hashed (first 32 hex chars)
  before becoming the Redis key, so the raw secret never lands in
  Redis keyspace. Hits write `invite_accept_rate_limited` /
  `invite_accept_rate_limiter_down`.
- `app/api/invites/send/route.ts` — split into two guard phases:
  per-IP runs BEFORE the auth lookup (defends against scanner
  traffic + saves a DB roundtrip on rejection); per-restaurant runs
  AFTER the admin/role resolution (it needs the resolved
  `restaurant_id`). Hits write `invite_send_rate_limited` /
  `invite_send_rate_limiter_down`.
- `lib/types/db.ts` — 6 new `ActivityEventType` variants for the new
  rate-limit observability events.
- `.env.example` — 6 new knobs with documented defaults.

**Tests (24 new, all green):**

- `tests/unit/rate-limit-factories.test.ts` — 8 cases: prefix +
  slidingWindow args for each of the 6 factories, env-var override
  honored, memoization works.
- `tests/integration/signup-rate-limit.test.ts` — 6 cases: 11th from
  one IP returns 429 with documented headers, byte-identical 429
  across existing-vs-non-existing email (the load-bearing
  enumeration-defense test that doubles as the structural half of
  P1-12), fail-closed 503 + `signup_rate_limiter_down` activity
  event, format-validation-before-rate-limit, per-email key is
  lowercase-normalized, activity event written on per-IP rejection.
- `tests/integration/invite-accept-rate-limit.test.ts` — 5 cases:
  same shape as signup, plus an explicit sha256-not-plaintext
  assertion on the per-token limiter key.
- `tests/integration/invite-send-rate-limit.test.ts` — 5 cases: per-IP
  fires BEFORE auth (`mockGetUser` never called), per-restaurant
  fires AFTER auth (mockGetUser was called), byte-identical 429
  across per-IP vs per-restaurant rejection, fail-closed 503,
  format-first ordering.
- `tests/e2e/p1-14-rate-limits.spec.ts` — Playwright e2e. Always-runs
  format-first ordering checks (malformed → 400, NOT 429) for all
  three routes; live-Upstash-gated rate-limit-hit checks (skipped
  with visible note when Upstash isn't wired to the dev server,
  mirroring `p10-verify-rate-limit.spec.ts`).

**P1-12 partial closure:** the rate-limit half of the signup
`EMAIL_EXISTS` enumeration defense is closed structurally. An
attacker who sends one signup attempt per email to enumerate
which addresses are registered now burns a per-email rate-limit
budget after 5 attempts/min — and the 429 body is byte-identical
regardless of whether the email exists. The response-shape half
(stop returning `code: EMAIL_EXISTS` distinguishable from
`code: AUTH_ERROR`) is still open and tracked as P1-12 remaining.

**P1-8 partial closure:** none of the new rate-limit activity events
contain emails or full names. `signup_rate_limited` carries
`{ kind, ip_hash }`; `invite_accept_rate_limited` carries
`{ kind, ip_hash, token_hash }`; `invite_send_rate_limited`
carries `{ kind, ip_hash, restaurant_id }`. The other P1-8 logging
surfaces (webhook + email-send) remain open and tracked as P1-8
remaining.

### Main-audit P1-16 — GDPR account deletion + data export — FIXED

**Status:** FIXED. Design at `audits/p1-16-gdpr-design.md` was reviewed
and approved with five modifications (revision log in that doc).
Implementation landed per the 12-step sequencing.

**What landed:**

- Migration `0016_account_deletion.sql`:
  - `account_deletion_tokens` table (token_hash sha256-at-rest,
    single-use via `used_at`, 24h-bounded via `expires_at`, per-profile
    cascade-on-profile-delete FK).
  - `enable row level security` with zero user-role policies
    (Concern 2). Service-role bypass is the only legitimate access.
  - `account_delete_user(p_profile_id, p_anonymized_email,
    p_deletion_request_id)` SECURITY DEFINER plpgsql function that
    runs the whole Path-1 deletion in a single Postgres transaction:
    hard-delete certificates / exam_attempts / lesson_progress;
    null `invited_by` on invitee profiles; split activity_events
    into solo-events-deleted vs cross-tenant-events-with-`actor_id`-
    nulled-AND-`payload`-merged (per the OQ-G3 augmentation —
    `actor_anonymized: true, anonymized_at: <ts>` mixed in via
    `jsonb_build_object`); anonymize the subject's own profile; delete
    outstanding tokens; insert one `account_deleted` audit row.
- `lib/account/deletion-token.ts` — `crypto.randomBytes(32)` →
  base64url → `sha256` hash for at-rest storage. Plus
  `validateTokenRow` with `expired / used / not_found / mismatch`
  reasons.
- `lib/account/deletion-warnings.ts` — sole-admin pre-warning builder
  per Concern 1. Walks profiles + subscriptions + restaurants and
  emits one warning per active-subscription restaurant where the
  user is the only admin. **Does NOT block deletion** — UI surface
  only.
- `lib/account/export.ts` — Art. 15 + 20 portability assembler with
  embedded `schema` block. Single service-role read in parallel
  across the 7 PII surfaces. Snapshot semantics.
- `lib/account/deletion.ts` — `executeAccountDeletion` orchestrator.
  Order: collect cert PDF storage paths → ban + blank auth.users via
  Supabase admin API (`ban_duration: '876600h'`, blank email +
  `user_metadata.deleted = true`) → call the SECURITY DEFINER RPC →
  best-effort PDF blob cleanup. Failure-recovery property: if step 2
  fails, no DB-side change occurred; if step 3 fails, the user is
  banned but data is intact and retry-safe. The pathological
  "data deleted but login still works" state cannot arise.
- `lib/security/rate-limit.ts` — five new factories for the GDPR
  endpoints. Per-hour windows (vs the per-minute knobs elsewhere).
  Defaults: 5/5 for request-deletion (per-IP / per-account),
  10/per-IP for confirm-deletion, 5/1 for export. Configurable via
  `RATELIMIT_ACCOUNT_*_PER_HOUR` env vars in `.env.example`.
- `lib/types/db.ts` — 11 new `ActivityEventType` variants
  (`account_deletion_requested`, `account_deletion_confirmed`,
  `account_deletion_cancelled`, `account_deletion_confirm_invalid`,
  `account_deletion_request_rate_limited`,
  `account_deletion_confirm_rate_limited`,
  `account_deletion_request_rate_limiter_down`,
  `account_deletion_confirm_rate_limiter_down`, `account_deleted`,
  `account_export_requested`, `account_export_rate_limited`,
  `account_export_rate_limiter_down`).
- `lib/email/templates/AccountDeletionConfirm.tsx` — React Email
  template with sole-admin warnings rendered inline when the
  warnings array is non-empty. Send-site log line masks the
  recipient email via `replace(/(.{2}).+(@.+)/, '$1***$2')` (partial
  P1-8 closure).
- Routes:
  - `POST /api/account/me/request-deletion` — auth → per-IP +
    per-account rate-limit → invalidate prior tokens → insert new
    token (hash at rest) → send confirm email → audit event →
    return `{ requestedAt, expiresAt, warnings }`.
  - `POST /api/account/me/confirm-deletion` — auth → per-IP
    rate-limit → look up by token_hash → `validateTokenRow` → run
    `executeAccountDeletion` → stamp `used_at` → audit event.
    Generic 410 message on any failure path; activity event
    differentiates for ops.
  - `POST /api/account/me/cancel-deletion-request` — OQ-G2. Auth
    → stamp `used_at` on every outstanding token with
    `used_reason: 'canceled_by_user'` → audit event → 204.
  - `GET /api/account/me/export` — auth → per-IP + per-account
    rate-limit → build export → return JSON with
    `Content-Disposition: attachment` + `Cache-Control: no-store`
    + audit event.

**Tests (38 new vitest + 10 new Playwright, all green):**

- `tests/unit/account-deletion-token.test.ts` — 10 cases: token
  format (43-char base64url), 10k unique, sha256 determinism,
  validator outcomes for fresh / not_found / used / expired /
  mismatch, TTL constant equals 24h.
- `tests/unit/account-deletion-warnings.test.ts` — 4 cases:
  not-admin → empty; co-admin exists → empty; sole admin + active
  subscription → 1 warning containing the restaurant name;
  sole admin + inactive subscription → empty.
- `tests/unit/account-export-shape.test.ts` — 2 cases: documented
  top-level keys + schema block populated; `invitesReceived` empty
  for never-invited subject.
- `tests/integration/account-delete-flow.test.ts` — 12 cases
  covering happy-path request → token-hash-not-raw + audit event
  no-PII, 401 without session, byte-identical 429, fail-closed
  503, re-request supersedes prior token, happy-path confirm →
  RPC + ban + storage cleanup + 200, 410 + audit event on
  not_found / expired / used / mismatch, 401 without session, 400
  on malformed body.
- `tests/integration/account-export-flow.test.ts` — 4 cases:
  200 + JSON + attachment headers + audit event; 401 without
  session; 429 on per-account limit; 503 fail-closed.
- `tests/e2e/p1-16-gdpr.spec.ts` — 5 Playwright cases × 2
  projects = 10. All four GDPR routes reject anonymous callers
  (auth gate works at the HTTP edge). Confirm endpoint malformed
  body returns 400, not 429 (format-first ordering).

**P1-8 partial closure (rolled forward):** the GDPR routes
themselves emit no PII in their activity-event payloads or log
lines. The deletion path uses the post-anonymization placeholder
profile_id only. The email-send call-site masks the recipient
address. Remaining P1-8 work (Stripe webhook + email-send other
call-sites) is unchanged.

### (superseded — original P1-16 design-pending notes follow)

**Status:** design doc delivered at `audits/p1-16-gdpr-design.md`.
Implementation explicitly gated on review per the wave-gate prompt
("STOP after the design doc"). The design covers:

- Cert deletion strategy (A vs B). Recommendation: Option A
  (hard-delete). Rationale: GDPR strictness wins at the design stage
  because there's zero operational cost pre-launch; aggregate cert
  counts survive; avoids storage-orphan management; avoids a
  cascading schema change.
- A hidden constraint surfaced during planning: the current
  `profiles.id references auth.users on delete cascade` schema makes
  the prompt's "hard-delete the auth user record AND anonymize the
  profile" wording contradictory. Two coherent paths are documented;
  Path 1 (anonymize-in-place + ban auth.user via Supabase admin API
  with `banned_until: forever`) is recommended because it needs no
  schema change.
- Two-phase deletion token: 256-bit `crypto.randomBytes(32)`
  base64url, sha256-hashed at rest in a new
  `account_deletion_tokens` table, single-use, 24h-bounded.
  Confirmation requires both an active session AND the token.
- Export response shape with documented schema block and per-section
  field-level documentation.
- Race conditions documented: token works until used or expired
  regardless of intervening activity; sole-admin deletion is the
  user's lawful right.
- Rate-limit defense: 5 limiters (per-IP + per-account on each
  surface), fail-closed, activity events. Knobs documented.
- Full test plan: unit + integration + Playwright.
- 4 open sub-questions surfaced (`OQ-G1` through `OQ-G4`) with
  recommendations.
- Implementation sequencing (11 ordered steps for post-approval).

Once approved, implementation lands as the next wave on the same
branch. Until then this P1 is structurally unblocked but not closed.

### Final tally for wave-gate P1 critical

- Vitest: 618/619 passing (up from 511 pre-wave; +107 from this
  wave-gate batch — secure-random unit + exam-shuffle integration +
  rate-limit factories + signup-rate-limit + invite-accept-rate-limit
  + invite-send-rate-limit + deletion-token unit + deletion-warnings
  unit + export-shape unit + account-delete-flow integration +
  account-export-flow integration). 0 failed, 1 intentionally
  skipped (Wave 4B live Upstash smoke test).
- Playwright: 122/124 passing (was 114/114 pre-wave; +10 from this
  batch — 5 P1-14 cases × 2 projects, 5 P1-16 cases × 2 projects
  minus the 2 live-Upstash-gated cases). 0 failed, 2 intentionally
  skipped (live-Upstash-gated P1-14 burn tests).
- Typecheck: clean.
- `Math.random()` callsite count under `app/` + `lib/`: 0
  (regression-tested).
- Live smoke against real Upstash: NOT RUN in this wave (the
  pre-existing `verify-rate-limit-live-smoke.test.ts` continues to
  be the operator-runnable gate; the new P1-14 Playwright spec is
  the e2e analog and runs against the configured dev-server
  Upstash if available).

### 2026-05-11 — Wave 4B sweep follow-up — cert-code test fixtures

Same class as the full-pilot-loop regex fix that was patched after Wave 4B
landed: seven integration test files still inserted descriptive cert codes
(e.g. `WAVE3-RECON-...-A-PEND-RECENT`) that fail the
`certificates_cert_code_format_chk` CHECK constraint introduced in
migration 0015. Tests now generate valid Crockford Base32 codes via
`generateCertCode()` from `lib/learner/cert-code.ts`; descriptive labels
moved to a `CODE_TO_LABEL` map (reconcile test) or asserted via status /
membership in an active-codes Set (cert-status-helper test). Marks Wave
4B's test-fixture sweep COMPLETE.

Files updated:
- `tests/integration/reconcile-cert-states.test.ts` (7 tests)
- `tests/integration/cert-status-helper-real-db.test.ts` (10 tests)
- `tests/integration/rls-hardening.test.ts` (4 tests)
- `tests/integration/cert-race-conditions.test.ts` (5 tests)
- `tests/integration/expire-certs-cron.test.ts` (4 tests)
- `tests/integration/purge-stale-pending-certs-cron.test.ts` (4 tests)
- `tests/integration/stripe-cert-events.test.ts` (14 tests)

No production code touched. No migrations touched. CHECK constraint
unchanged. Golden file `tests/integration/fixtures/cert-migration-report.golden.md`
unchanged — the reconcile test anonymizes generated codes back to the
descriptive labels (`<RUN>-A-PEND-RECENT`, …) and sorts by label so the
table is byte-identical to the existing fixture.

---

## 2026-05-11 — API-contract P1 discrepancy (charge-cert-fees response shape)

### P1 — `/api/stripe/charge-cert-fees` response shape mismatch — FIXED

**Status:** FIXED on branch `fix-charge-cert-fees-shape`. Closes the
sole entry in `audits/api-contract-for-ui-handoff.md` "Discrepancies
between code and types/docs" section.

**Symptom (pre-fix):** producer at
`app/api/stripe/charge-cert-fees/route.ts:176-180` returned
`{ paymentIntentId, status: 'succeeded', amountCents }`. Consumer at
`app/api/submissions/create/route.ts:228-235` destructured
`{ certFeeTotalCents, stripePaymentIntentId }`. Field names didn't
match — both destructured values resolved to `undefined`. The
consumer then wrote those `undefined` values into the
`submissions.cert_fee_total_cents` and
`submissions.stripe_payment_intent_id` columns. Either silent data
loss (nullable) or INSERT failure.

**Fix:** producer renamed to return the canonical shape
`{ certFeeTotalCents, stripePaymentIntentId, status: 'succeeded' }`.
Consumer untouched — its destructured names already match the DB
columns, so the canonical contract is on the DB side and the
producer was the side that needed to change. Also renamed the local
intermediate `amountCents` → `certFeeTotalCents` and updated the
402 `requires_action` body's `paymentIntentId` → `stripePaymentIntentId`
for symmetry.

**Commits:**
- `4d8385d` — `test: repro charge-cert-fees response shape mismatch — red`
- `3f6fb9a` — `fix(P1): charge-cert-fees returns certFeeTotalCents + stripePaymentIntentId to match submissions/create consumer`

**Test coverage:**
- `tests/unit/charge-cert-fees-response-shape.test.ts` (2 cases) —
  positive assertion that producer returns the canonical shape, and
  negative assertion that the old field names (`paymentIntentId`,
  `amountCents`) are absent. Drives the route handler in-process
  with Stripe + Supabase mocked.
- Existing `tests/unit/submissions-charge-cert-fees-call.test.ts`
  was already mocking the consumer's `fetch()` with the canonical
  field names — that test passes both pre-fix and post-fix because
  it stubs the producer rather than running it. The new test is the
  first one to actually drive the producer route in-process.

**Verification:** vitest 620/620 (1 intentionally skipped — pre-existing
Wave 4B live-Upstash smoke gate). Typecheck clean. The 402
`requires_action` path is exercised only in production with live
Stripe — its shape change rides on the same rename and is documented
in the route's JSDoc + the contract doc.

**Docs updated:**
- `audits/api-contract-for-ui-handoff.md` line 844 — spec rewritten
  with new shape.
- `audits/api-contract-for-ui-handoff.md` Discrepancies section —
  marked CLOSED with commit hashes.
- Final tally line — "Endpoints documented: 44. Discrepancies: 0
  (was 1, closed 2026-05-11)."

### F4 (P2) — Wave 4B cert-code fixture sweep missed e2e specs

**Found while running the Playwright suite to verify the
charge-cert-fees fix.** The Wave 4B fixture sweep
(commit `2967d12`, "Wave 4B sweep — regenerate cert codes in 7
integration test files") updated only `tests/integration/*` files.
At least one Playwright e2e spec still inserts the old format
`AW-{year}-{6-digit}` cert code and consequently fails the
`certificates_cert_code_format_chk` CHECK constraint from migration
0015:

- `tests/e2e/f1-charge-cert-fees-middleware.spec.ts:161` —
  seed step inserts a literal `AW-2026-F<N>` and fails with
  Postgres error `23514` (CHECK constraint violation). Both
  chromium and Mobile Chrome projects affected.

**Likely also affected:**
`tests/e2e/full-pilot-loop.spec.ts:596` (step 5 — learner completes
all lessons) also fails on main with a 200-expected/<other>-received
status. Need a separate triage pass to confirm whether the
failure is fixture-related (probable, same wave-4B miss) or a
genuine state-machine regression.

**Status:** CLOSED in commit `759ce46` (branch
`fix-e2e-cert-code-fixtures`).

**What was actually wrong:**
- `tests/e2e/f1-charge-cert-fees-middleware.spec.ts:154` — sole real
  fixture miss. The seed inserts a literal cert code into the
  certificates table. Replaced with `generateCertCode()` from
  `lib/learner/cert-code.ts`.
- `tests/e2e/full-pilot-loop.spec.ts` — re-triaged. No cert-code
  fixture issue in this spec; cert codes are minted via
  `/api/exam/submit` (step 7), which uses the new format. The
  earlier step-5 failure on main was a separate dev-DB seed-state
  issue (empty `lessons` table on the local Supabase instance), not
  a fixture problem. Re-seeding `db/seed.sql` produced 50/50 green.

**Verification:**
- `pnpm playwright test f1-charge-cert-fees-middleware` → 4/4 green
  (chromium + Mobile Chrome × 2 tests).
- `pnpm playwright test full-pilot-loop` → 50/50 green.
- `pnpm playwright test` → 122 passed / 0 failed / 2 skipped (live
  Upstash gated). Down from 4 pre-existing failures.
- `pnpm vitest run` → 621 passed / 0 failed / 1 skipped (live
  Upstash gated). +1 from the new grep regression test.

**Regression guard added:** `tests/unit/cert-code-fixture-grep.test.ts`
walks `tests/` and fails on any literal match of the old-format regex
`/AW-\d{4}-\d{6}/` outside an explicit allowlist of negative-path
tests (validator/verify rejection coverage + this file's own regex
literal). Catches any future regression that reintroduces an
old-format cert code into the test tree.

**Wave 4B's test-fixture sweep is now COMPLETE across unit +
integration + e2e. No more old-format cert codes anywhere in
tests/. Closes the entire class.**

### Remaining open P1 items (post-wave)

- **P1-12 response-shape** — drop `code: EMAIL_EXISTS` discriminator
  on signup response. Rate-limit half closed structurally (see
  above). Mechanical 5-line change but explicitly out of scope per
  the wave-gate prompt.
- **P1-8 remaining logging surface** — email-send + webhook log
  lines still mention full emails. Deletion-path logs are P1-8 clean
  by design once P1-16 implementation lands.
- **P1-16 implementation** — FIXED (this wave).
- All other open P1s (P1-2 reviewer IDOR, P1-3 security headers,
  P1-4 structured logging, P1-10 CSV pre-buffer, P1-15 caret pinning,
  Next 15 migration) remain as listed in the re-audit Step 9.

---

## 2026-05-19 — Pre-existing test failure (not blocking Wave 5A)

### `full-pilot-loop.spec.ts` step 10 — reviewer approve returns 400

**Symptom:** `POST /api/reviewer/queue/[submissionId]/decide` returns 400 from the test, expected 200. Both chromium and Mobile Chrome projects affected.

**Status:** PRE-EXISTING on `main` (verified 2026-05-19 by re-seeding local Supabase, switching to main HEAD, and reproducing). NOT caused by P1-15 caret pinning work (PR #1, commit 5fda7c5).

**Root cause hypothesis:** the test's reviewer-login flow (lines 875-939) has two paths and proceeds to call `decide` regardless of whether either login succeeded. The seeded reviewer's password is set to `DemoPassword123!` by `db:seed-auth`, but the test tries to update it to `ReviewerPassword123!` via `auth.admin.updateUserById` before logging in. If the password update silently fails or the session cookie isn't set on the `pilotApi` request context, the decide call lands withoutalid reviewer session and the route handler returns 400.

**Severity:** P2 — test fragility, not a production bug. The decide endpoint behaves correctly in manual testing.

**Proposed fix (own ticket, post-Wave-5A):** rewrite step 10's reviewer-session setup to either (a) use the already-seeded reviewer credentials directly (`reviewer@example.test` / `DemoPassword123!`) without re-setting the password, or (b) assert the login response is 200 before proceeding to the decide call. Add an explicit cookie-attachment check.

**Workaround:** none needed — the rest of the suite (620 vitest + 47 of 49 Playwright) is green.

**Status update (2026-07-21):** CLOSED. See the 2026-07-21 Track D entry below for the fix (matches proposed-fix option (a)+(b) above, combined).

---

## 2026-05-19 — Wave 5A P1-2 (reviewer IDOR, defense in depth)

### What was vulnerable at the HTTP layer

The transactional ownership guard was already in place in
`db/migrations/0017_decide_submission_ownership.sql` (the
`decide_submission` RPC raises `insufficient_privilege` if the
caller is not the claimed reviewer). The remaining gaps were at the
HTTP layer — any reviewer could read or attempt to mutate any
submission, and the RPC's privilege error surfaced as a generic 500
rather than a clean 403.

**Vulnerable routes (HTTP-layer, fixed in this wave):**

1. `GET /api/reviewer/queue/[submissionId]`
   — `app/api/reviewer/queue/[submissionId]/route.ts`
   — Pre-fix: any reviewer could read any submission by UUID. No
   per-resource authorization beyond global reviewer role.
   — Fix: load `submission.reviewer_id`; if non-NULL and not the
   caller, return **404** (not 403, to deny enumeration).

2. `POST /api/reviewer/queue/[submissionId]/decide`
   — `app/api/reviewer/queue/[submissionId]/decide/route.ts`
   — Pre-fix: the RPC enforced ownership but the route's catch
   block matched only `'not found' | 'terminal state' | 'invalid
   action'`, so a Postgres `insufficient_privilege` raise fell
   through to a generic 500. Reviewer B could not actually
   overwrite Reviewer A's decision (RPC blocked it) but the
   response was wrong.
   — Fix: HTTP-layer pre-check via service-role read of
   `submissions.reviewer_id` returns 403 immediately on ownership
   mismatch. The RPC remains as belt-and-suspenders; if a TOCTOU
   race makes it through and raises `insufficient_privilege`, the
   route catch maps that to 403 as well.

3. `GET /api/reviewer/queue` (list)
   — `app/api/reviewer/queue/route.ts`
   — Pre-fix: returned every `pending|in_review` submission to
   every reviewer, including submissions already claimed by other
   reviewers. Not strictly an IDOR (the list returns only summary
   fields; the per-id route was the read-leak surface), but a
   queue-scope hygiene issue: Reviewer B saw Reviewer A's in-
   progress claims.
   — Fix: `WHERE reviewer_id IS NULL OR reviewer_id = caller_id`
   added to the query. Unclaimed items remain in the shared
   pickup pool.

**Routes audited and confirmed not vulnerable (shared moderation pool by design):**

- `GET /api/reviewer/reviews/queue`
- `POST /api/reviewer/reviews/[id]/decide`

User-submitted restaurant reviews have no per-reviewer assignment
column. Any reviewer may publish or hide any pending review.
Idempotency on already-applied status handles double-write races.
Header docstrings updated to record this design intent so a future
auditor doesn't mistake the absence of an ownership check for a
bug.

**Response shape:** no field added or removed on any route's
success or error JSON. Only status codes changed in the
ownership-violation cases (500 → 403, and the new 404 for
IDOR-denied GETs matches the existing "not found" shape so it
can't be enumerated). UI-engineer handoff contracts unchanged.

**Gating test added:** `tests/e2e/p1-2-reviewer-idor.spec.ts`
(5 cases, all green). Seeds two distinct reviewers + a claimed
submission + an unclaimed submission, then asserts:

- Reviewer A → 200 on own claimed submission GET
- Reviewer B → 404 on A-claimed submission GET (no enumeration)
- Either reviewer → 200 on unclaimed submission GET (pickup pool)
- Reviewer B → 403 on A-claimed submission POST decide, with the
  row state remaining `in_review` owned by A
- Queue list filtered per caller: A sees both claimed+unclaimed,
  B sees only unclaimed

**Status:** FIXED on branch `wave-5a-p1-2-reviewer-idor`.

---

## 2026-05-19 — Second pre-existing test-fragility issue (not blocking Wave 5A)

### `reconcile-cert-states.test.ts` 3 cases fail on stale local DB

**Symptom (vitest):** 3 of 7 cases in `tests/integration/reconcile-cert-states.test.ts` fail with assertions about cert classification:

- `dry-run plan classifies every cert correctly` — expects 2 transitions, gets 1
- `--apply produces expected end states + writes one cert_state_reconciled event per transition/purge` — expects "H-ACTIVE-NO-PI" cert to be at status 'pending' post-apply, gets undefined (cert was purged instead)
- `GOLDEN: dry-run report is byte-identical to checked-in fixture` — golden diff shows "A-PEND-RECENT" classified as `purge` instead of `no_change`

**Status:** PRE-EXISTING on `main` and on `031bff1` (verified 2026-05-19 by checking out `031bff1`, re-seeding, and reproducing the identical 3 failures). NOT caused by Wave 5A merges (commits `8c9c9ee` ← `ff3b947 4986649 af7930e 6d5d6` ← `031bff1`). Same class as the step-10 test fragility.

**Root cause hypothesis:** the test fixture's `A-PEND-RECENT` cert is being classified as `purge` with reason `no_pi_on_file_and_ttl_exceeded`, when the test expects `no_change` with reason "already in target state." Either (a) the fixture's `created_at` timestamp drifted past the 14-day pending TTL since it was originally seeded into the local DB weeks ago, (b) the test fixture isn't re-inserted on each run (idempotent ON CONFLICT DO NOTHING), or (c) the fixture's `stripe_payment_intent_id` was nulled by a previous --apply run.

**Severity:** P2 — local test fragility on a one-time pre-launch utility script. The reconcile-cert-states.ts script itself is not in any production code path; it's a deploy-day tool.

**Proposed fix (own ticket, post-Wave-5A):** make the test fully self-seeding inside `beforeAll`. Insert fixture rows with explicit `created_at`/`stripe_payment_intent_id` values fresh each run; clean up at `afterAll`. Or, gate the test bd a clean-DB precondition that fails fast with a clear message.

**Workaround:** none needed for production. The script will run against a clean prod DB on launch day.

**Status update (2026-07-21):** CLOSED. Root-cause hypotheses (a)/(b)/(c) above were all wrong — the test *was* already self-seeding fresh per-run (via `beforeEach` + `seedDeterministicMix()`), and `issued_at` was set explicitly, not drifting. The actual bug: `scripts/reconcile-cert-states.ts` computes its `NOW_MS` constant once at module top-level from `process.env.MOCK_NOW`. The test's `import { runReconciliation } from '@/scripts/reconcile-cert-states'` is a static import, hoisted and evaluated before `beforeAll()` sets `process.env.MOCK_NOW = MOCK_NOW_ISO` — so the script silently fell back to real `Date.now()` instead of the frozen `2026-05-10T12:00:00.000Z`. As real wall-clock time drifted forward from that fixed mock date, the "recent" fixture cert (issued 5 days before *mock* now) aged further and further past the 14-day pending TTL relative to *real* now, until it tipped from `no_change` to `purge` — which is exactly the observed symptom, and explains why the 3 failures were "consistent" rather than truly random: the module-load-order bug was 100% reproducible at any given point in time, it just got *worse* as the calendar advanced from when the test was written. See the 2026-07-21 Track D entry below for the fix (deferred dynamic import inside `beforeAll`, after the env var is set — test-only, `scripts/reconcile-cert-states.ts` itself untouched).

**Wave 5A test impact:** zero. Full suite is 648/652 passing (3 failures here + 1 intentionally skipped Upstash live smoke test). All P1-2 / P1-3 / P1-8 / P1-10 / P1-12 new tests pass.

---

## 2026-07-14 — Track B landing (partner/commission + 0022 rename) — quality follow-ups

Found while writing reviewer-route authz tests (reviewer-partners-authz / reviewer-brands-authz). None are security issues; all P2/P3, logged not fixed (behavior-preserving landing).

### F-T1 (P3) — brands/[id] PATCH instantiates createServiceDb() unconditionally
Even for name/slug-only PATCHes where it's never used. Harmless; tidy in a later pass.

### F-T2 (P2) — brands/[id] PATCH assignRestaurantIds lack .uuid() validation and existence checks
Nonexistent brand → DB FK error surfaces as 500; nonexistent restaurant ids silently no-op. Add z.string().uuid() + friendly 404/422.

### F-T3 (P2) — brands/[id] PATCH is non-atomic
Successful name/slug update followed by a failed membership write returns 500 with the name change already persisted. Consider RPC or ordering.

### F-T4 (P2) — brands GET ignores the restaurants-read error
Destructures data only; a failed read silently reports restaurantCount 0 for every brand.

---

## 2026-07-16 — P1-3 re-verification: docs were stale, two follow-on findings

**Assigned task:** implement P1-3 (browser security headers/CSP) on the reconciled trunk. Found it was already fully implemented — `middleware.ts`'s `applySecurityHeaders()` merged 2026-05-19 via `wave-5a-p1-3-security-headers` (`af7930e`), present on `main`@`bd95850`, untouched by every later merge except Track B's unrelated role-rename. Re-verified: `pnpm playwright test tests/e2e/p1-3-security-headers.spec.ts` → 30/30 green; manual browser smoke as `learner@example.test` showed zero CSP violations in console. No code change made. Full detail in `VAULT/Decisions/P1-3 security headers — status correction.md`.

### F4 (docs/process) — P1-8/P1-10/P1-12/P1-15 show the same stale-status pattern as P1-3; P1-4 is complete but unmerged

**Found while tracing P1-3's provenance.** `git log --all` shows merged fix commits for P1-2 (`ff3b947`), P1-8 (`4986649`), P1-10 (`6d5d668`), and P1-15 (`99af278`) — all landed via `wave-5a-*` PRs #1–#6, all ancestors of `main`@`bd95850`. `PHASE_STATUS.md` / `ROADMAP_TO_DONE.md` (allergenwise-root docs, outside this repo) still listed all of them as pending open P1s.

Separately, `origin/wave-5b-p1-4-structured-logging` holds a complete P1-4 implementation (`4341c57` — JSON logger + `x-request-id` propagation through `middleware.ts`) plus a docs commit (`7cfe660`) that records **all 9** originally-stale P1s (P1-2/3/4/8/9/10/12/14/16) as closed with a closing-commit table and "Ready for UI handoff: YES." That branch was never merged — it forks off before `8fd2715`, well behind current `main` (misses Phase 3–9, Track B, the repo reconcile). Its docs commit never reached `main`, which is why this very file (read from `main`) still carries the older "P1-8/P1-10/P1-12 remain open" language in the Wave 4B/5A entries above even though the underlying code fixes are in.

**Why not fixed now:** out of scope — the assigned task was P1-3 specifically ("no drive-by edits"). Only P1-3 got the full re-verification (e2e spec + manual smoke); P1-2/8/10/12/15 were confirmed merged but not independently re-tested, and P1-4 was confirmed complete but unmerged.

**Proposed fix:** (a) one small loop re-verifying P1-2/8/10/12/15 the same way P1-3 was just verified; (b) a deliberate decision on rebasing `wave-5b-p1-4-structured-logging` forward — its `middleware.ts` changes will conflict with everything merged since (CSRF, cron allowlist, admin→manager rename), so it needs a real merge, not a fast-forward.

**Severity:** P2 (process/documentation) — no evidence of a code defect, but the team risks re-doing already-completed security work, or shipping without knowing P1-4 exists in finished form on a stale branch.

**Status:** open, logged for the next backlog loop.

### F5 — Lesson player throws on every load: `params.then is not a function` (Next 14 vs Next 15 API mismatch)

**Found while manually smoke-testing a video page for P1-3.**

**Symptom:** `GET /learner/courses/[moduleId]/[lessonId]` renders the page's error boundary ("Something went wrong") on every load, in every browser tested. Console shows `TypeError: params.then is not a function` thrown from a `useEffect` in `app/(learner)/learner/courses/[moduleId]/[lessonId]/page.tsx`.

**Root cause:** `page.tsx:174` types `params` as `Promise<{ moduleId: string; lessonId: string }>` and resolves it via `params.then(setResolvedParams)` (line 190) — the Next.js **15** App Router convention (params became a Promise in Next 15, unwrapped via `use()` or `await`). This app runs **Next 14.2.35** (per the pending P0-#11 Next-15-migration follow-up above), where `params` for a client component page is a plain synchronous object, not a `Promise` — it has no `.then` method, so the effect throws on mount and the page's error boundary catches it before `<MuxPlayer>` (or the placeholder-lesson fallback) ever renders.

**Effect on production:** every lesson page for every learner is currently broken — the entire course-viewing surface (video playback, placeholder-lesson fallback, "Mark complete", prev/next navigation) is unreachable. This is very likely a P0 in practice, not a P1-3-adjacent nit.

**Why not fixed now:** out of scope for the P1-3 task ("no drive-by edits"); discovered incidentally while trying to visually confirm Mux playback isn't blocked by the new-to-this-session CSP. Note the CSP itself is not the cause — zero CSP violations appeared in console before or during the crash; this is a pure application bug unrelated to the security-headers work.

**Proposed fix:** either (a) revert `params` to a plain object type and drop the `.then()` resolution (matches the Next 14 runtime actually in use), or (b) if this app is meant to already assume Next 15 semantics (e.g. staged ahead of the pending Next 15 migration), gate it behind that migration landing. Given every other route in this codebase is Next 14 App Router style, (a) is almost certainly correct for today's runtime.

**Severity:** P0 — blocks the entire learner course-viewing flow in the current build. Recommend fixing before any further UI work touches this surface (the coming Figma hook-up phase specifically touches lesson pages per [[MVP close-out sequencing]]).

**Status:** open, NOT fixed (scope discipline for this session) — flagged for immediate attention given severity.

---

## 2026-07-21 — Track D (test hygiene) landed, plus one new find and two newly-logged opens

Branch `fix/track-d-test-hygiene` (`6e07780`, worktree `aw-trackd/` off `ecff988`), merged into `integration/v0.1-hardening` as `28e6a0f`, `main` fast-forwarded to match. Tests only — no app code changed anywhere in this pass. Closes the two 2026-05-19 pre-existing-fragility entries above (cross-referenced with status updates), the Wave 4B cert-code entropy flake, and a step-1 rate-limiter-env dependency; also fixes a bonus bug found along the way, and logs two new opens.

### Closed — `reconcile-cert-states.test.ts` 3-case flake

Root cause and fix detailed inline in the 2026-05-19 entry's status update above (module-import-order bug in the test: static import of `runReconciliation` hoisted before `beforeAll()` set `MOCK_NOW`). Fixed via a dynamic `import()` deferred until after the env var is set. `scripts/reconcile-cert-states.ts` untouched.

### Closed — `full-pilot-loop.spec.ts` step 10 reviewer-approve fragility

Root cause confirmed exactly as hypothesized in the 2026-05-19 entry above: the reviewer-login fallback path (`if (newReviewerAuth?.user) { ... }`) skipped its own success assertion entirely when `newReviewerAuth?.user` was falsy, and the code proceeded to call `decide()` regardless. Rewritten:
- Try the seeded demo credentials first (`reviewer@example.test` / `DemoPassword123!`, per `scripts/seed-auth-users.ts` `DEMO_PASSWORD`) — **without** mutating the password via `auth.admin.updateUserById` on every run. That unconditional mutation is the documented cause of the seeded reviewer's password drifting for *other* test runs (see `audits/smoke-test-2026-05-11.md` P1-data-1, "reviewer@example.test password has drifted from scripts/seed-auth-users.ts default").
- Fall back to minting a fresh reviewer only if the seeded login fails.
- Whichever path is taken, `expect(loginRes.status()).toBe(200)` runs unconditionally before `decide()` is ever called — no silent fallthrough.

**Verification:** ran the full `full-pilot-loop` serial suite against a temporary local Upstash-compatible Redis proxy (`serverless-redis-http` + a local `redis-server`, spun up solely for this verification and fully torn down after — no lasting change to any worktree's `.env.local`) so steps 1-13 could execute past the rate-limited routes. Confirmed both the happy path (seeded reviewer login succeeds) and the originally-reported failure path (deliberately set an intentionally-wrong `seededReviewerPassword` to force the fallback branch) — both reach `decide()` with a valid session and the full loop goes green end-to-end, including step 10.

### Closed — `cert-code.test.ts` entropy flakes (2 found, 2 fixed)

1. **1M-collision smoke test** — its ~5.7s runtime borders Vitest's 5000ms default `testTimeout`, causing intermittent spurious timeout failures unrelated to the actual randomness being tested. Added an explicit 30s timeout. Also corrected a 1000x math error in the test's own comment: true expected collision count at N=1M over a 2^50 space is `N(N-1)/(2·2^50) ≈ 0.00044`, not `0.44` as previously commented — the `<5` threshold assertion itself was always correct and generous, just mis-explained.
2. **Bonus find — adjacent-transposition detection test.** Not part of the original ask, but caught genuinely failing during verification of item 1 (in a full-suite run, isolated re-runs of the file alone didn't reproduce it — a tell that it's a real statistical flake, not environmental noise). Root cause: the test drew 100 random codes and skipped (via `continue`, no `rejected` increment) any trial where the two transposed positions happened to hold identical characters (~1/32 ≈ 3.1% chance per trial). Skip count ~ Binomial(100, 1/32); `P(skips > 5)` ≈ 8-9% by normal approximation — a real, non-negligible failure rate on the `expect(rejected).toBeGreaterThanOrEqual(95)` assertion, **not** a check-digit detection gap: an empirical 200,000-trial sweep (`generateCertCode()` + `validateCertCode()`, excluding identical-char no-ops) found **zero** missed transpositions, confirming the ISO 7064 Mod 37,36 check digit's documented 100% adjacent-transposition guarantee genuinely holds. Fixed by retrying `generateCertCode()` until each of the 100 trials is a real (non-identical) transposition, then asserting the full `rejected === 100` guarantee — eliminates the flake by construction instead of just tolerating it with a fuzzy threshold.

### Closed — `full-pilot-loop.spec.ts` step 1 rate-limiter-env dependency

Confirmed empirically (direct curl to `/api/auth/signup` plus the resulting `activity_events` row: `{"type":"signup_rate_limiter_down","payload":{"error":"[rate-limit] KV_REST_API_URL or KV_REST_API_TOKEN missing. ..."}}`) that step 1's HTTP path — taken whenever `hasRealStripeKey` is true — depends on Upstash creds that are absent in every local worktree checked (`aw-integration`, `aw-phase06`, `aw-trackb`, `aw-phase09`, and this one), unrelated to what step 1 actually tests (signup + Stripe wiring). Added a `hasRateLimiterEnv` check (`KV_REST_API_URL` + `KV_REST_API_TOKEN` both non-empty) so step 1 only takes the real-Stripe HTTP path when Upstash is *also* configured; otherwise it falls back to the existing seed-direct path (the same pattern step 1 already used for a missing/placeholder Stripe key).

### Bonus fix — broken Upstash-availability probe in two other e2e specs

Not one of the four named items, but directly blocks the "e2e green minus Upstash-gated specs" bar: both `tests/e2e/p1-14-rate-limits.spec.ts` and `tests/e2e/p10-verify-rate-limit.spec.ts` detect whether Upstash is configured via a probe cert code (`AW-XJ4T8-Q9M2K-5`) passed to the verify endpoint. That literal **fails its own ISO 7064 check digit** (confirmed via `validateCertCode()`), so it short-circuits to a `200 not_found` response at the format-validation step — *before* the rate limiter ever runs. Result: `isUpstashConfigured()` always returned `true` regardless of actual Redis availability, so the "skipped without Upstash" test blocks in both files never actually skipped in an environment without Upstash — they ran and failed with 503s instead. Replaced the probe literal in both files with `AW-TSSBF-HM3CD-D`, a verified format-valid, non-existent code (confirmed via `generateCertCode()` + `validateCertCode()`). Left one adjacent, lower-priority issue alone in `p10-verify-rate-limit.spec.ts`: its "malformed vs unknown-but-valid" test (line ~29) used the *same* broken literal for its "unknown but valid" fixture, which happened to make its status-equality assertion pass for the wrong reason (both codes were actually being treated as malformed). Swapping that literal to a genuinely valid code breaks that assertion when Upstash is down (malformed always short-circuits to 200; a real well-formed-but-unknown code correctly 503s when Redis is unreachable — the two are *supposed* to diverge in that case, by design). Fixing it properly means rewriting that test's assertion logic, which is out of scope for this pass — left as-is, flagged here for whoever picks it up next.

### OPEN — `full-pilot-loop.spec.ts` step 3 (`invites/send`) has no seed-fallback, still 503s without Upstash

Same root cause as the step-1 item above — `POST /api/invites/send` is rate-limited (P1-14) and fails closed with 503 when `KV_REST_API_URL`/`KV_REST_API_TOKEN` are absent — but unlike step 1 (and step 9), step 3 has no `hasRealStripeKey`-style branch to fall back into; it always calls the real HTTP route. Same applies to step 4 (`invites/accept`), reached only after step 3 in the serial suite.

**Why not fixed:** closing this properly means writing new seed-fallback logic — directly inserting an invite-token row via the service-role client, matching whatever shape `POST /api/invites/send` would have produced (token generation/hashing, `profiles.invite_token`, etc.) — which is a real feature addition to the test, not a "cheap" one-line gate like step 1's fix. Out of scope for a tests-only, "if cheap" pass.

**Effect:** in any local environment without Upstash creds (which is every worktree checked so far), `full-pilot-loop` steps 3-13 do not run (the serial suite aborts on step 3's failure). Steps 1-13 were verified green end-to-end under a temporary local Upstash proxy (see the step-10 entry above) — the loop itself is correct; only the local-dev rate-limiter dependency blocks it from running without live Upstash.

**Proposed fix:** either (a) provision real Upstash creds locally (Track C), or (b) write a seed-fallback branch for steps 3/4 mirroring step 1/9's pattern.

**Severity:** P2 — local test-environment gap, not a production defect. Confirmed unrelated to any code changed in this pass.

**Status:** open.

### OPEN — `f2-cron-middleware.spec.ts` digest-reviewer-queue + weekly-admin-digest fail on invalid placeholder Resend key

**Symptom:** both routes return `500 {"ok":false,"processed":0,"errors":["API key is invalid"]}` instead of the expected `200` when hit with a valid `Authorization: Bearer ${CRON_SECRET}` header. Confirmed pre-existing — present in the very first e2e run of this session, before any file in this pass was touched, and in a spec file (`tests/e2e/f2-cron-middleware.spec.ts`) this pass never edited.

**Root cause:** the local `.env.local`'s `RESEND_API_KEY` is a placeholder/invalid value. Unlike most email sends in this codebase (fire-and-forget per the Phase 04 email-consolidation work), these two cron handlers apparently surface the Resend error as part of their response body/status rather than swallowing it — worth a follow-up look at whether that's intentional (digest emails are the entire point of these two crons, so a hard failure may be by design) or should also be fire-and-forget like other routes.

**Severity:** P2 — local test-environment gap (bad/placeholder Resend key), not a rate-limiter or Track D issue. Unrelated to Upstash.

**Proposed fix:** provision a real (or Resend-sandbox) API key locally, or decide whether these two cron routes should tolerate email-send failure the same way other routes do.

**Status:** open.

### Final tally for Track D

Vitest (serial, single fork) on merged `integration/v0.1-hardening` (`28e6a0f`): **758 passed / 1 skipped / 0 failed (759)**. Not `729` as originally estimated — `feat/coming-soon-gate` (`0d801a2`) landed on the branch concurrently with Track D (7 seconds apart in the commit log) and added 30 new tests: 725 pre-Track-D baseline + 30 coming-soon-gate + 3 previously-failing-now-fixed = 758. Stable across 2 consecutive runs in `aw-integration/` and 4 of 5 in `APP/` post-fast-forward (one cold-start run showed 3 transient failures that never reproduced across 4 subsequent runs on the identical commit — treated as environmental noise, not a regression).

E2e (chromium + Mobile Chrome): 134 passed, 6 skipped (properly Upstash-gated, up from 2 before the probe fix), 4 failed — all 4 are the two open items logged above (`full-pilot-loop` step 3 ×2 projects, `f2-cron-middleware` ×2 projects), 20 did not run (`full-pilot-loop` steps 4-13, blocked by step 3's failure in serial mode).

### OPEN — T-52: `checkCooldown` counts attempts for life, so renewal is impossible for anyone who failed twice

**Raised:** 2026-08-05 12:45 EDT, found while implementing the T-49 duplicate-certificate guard. Deliberately NOT fixed there — closing it means changing the exam-attempt state machine, which is out of scope for an issuance guard.

**Symptom:** a learner who failed twice before passing has three submitted attempts on record. `checkCooldown` (`lib/learner/exam.ts:115`) refuses a fourth: `if (submitted.length >= MAX_ATTEMPTS)` → "Maximum attempts reached. Please contact your administrator." The count is over the learner's ENTIRE history — `/api/exam/start` loads past attempts with `.eq('profile_id', user.id)` and no time window — so it never decays.

**Why it matters more than it looks:** certificates are valid for 2 years (`CERT_VALIDITY_YEARS`), and renewal IS retaking the exam — there is no reissue endpoint, and the product says so in the learner certificate page, the pricing FAQ, the public verify page and the `CertExpiringSoon` email. So at the two-year mark, every learner who ever failed twice becomes permanently unable to renew, and there is no in-product way for a manager or reviewer to clear the count.

**Blast radius is the restaurant, not the learner.** `checkEligibility` condition 2 requires EVERY current learner to hold a pending or active certificate. One employee stuck at MAX_ATTEMPTS with an expired certificate blocks their restaurant from submitting indefinitely. That is the T-46 deadlock again, arriving on a two-year timer instead of at signup, and the only escape today is marking the employee departed (T-46a) — i.e. removing a real employee from the roster to unblock a listing.

**Not yet reachable in production:** it fires when the first certificates expire, two years after issue. That is a deadline, not a reprieve.

**Where it is written down in code:** `tests/unit/exam-start-duplicate-cert-guard.test.ts` carries the full interaction in its docblock, because that file's green "renewal still works" cases would otherwise read as proof that renewal works in general. It does not — it works for learners with fewer than `MAX_ATTEMPTS` lifetime submitted attempts.

**Proposed fix (undecided, needs a design call):** scope the attempt count to the current certification cycle — count only attempts since the learner's last issued certificate, or since their most recent certificate expired — rather than for life. Either changes what `MAX_ATTEMPTS` means, so it wants a deliberate decision plus tests for every transition, not a one-line edit.

**Severity:** P1 — no customer impact today, permanent unrecoverable lockout with a billing consequence at the 2-year mark.

**Status:** open.
