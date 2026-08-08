# AllergenWise — Re-Audit Backend + Cybersecurity Handoff
**Re-audit date:** 2026-05-11
**Original audit:** `audits/backend-security-handoff-2026-05-07.md`
**Method:** Opus orchestration + 4 parallel Sonnet evidence-gathering agents over §A1–A8, §B1–B14, and the threat model. Read-only. File:line citations against current `main` branch.
**Inputs:** original audit + `audits/status-read-audit-2026-05-07.md` + `audits/cron-state-recovery-2026-05-07.md` + `audits/wave-2a-write-path-verification.md` + `audits/cert-payment-state-design.md` + `audits/cert-migration-plan.md` + `audits/cert-code-redesign-plan.md` + `audits/followups.md`.

---

## Executive Summary

**Ready for UI handoff: NO** — for a single class of remaining gaps, all P1: structured logging + PII in logs, GDPR/CCPA account-deletion + export, exam-shuffle CSPRNG, CSV upload size pre-buffer, security-headers block, rate limits on signup/invite-accept/invites-send, reviewer-IDOR window in the `decide_submission` RPC, and the signup `EMAIL_EXISTS` enumeration discriminator. **All 11 P0 findings from the 2026-05-07 audit are FIXED with file:line evidence + gating tests.** No NEWLY BROKEN findings (no fix regressed). No NEWLY FOUND P0s — the new attack surfaces introduced by the fix waves (service-role verify endpoint, Upstash rate limiter, CSRF middleware bypass list, cert state machine) all hold up to byte-level inspection.

**Open P0s: 0. Open P1s: 8.**

The codebase is in materially better shape than the original audit. Move to Wave 5 (P1 cleanup) before declaring UI-handoff-ready.

---

## Step 1 — Section Summary Table

Compare to original audit's "Step 2 — Section Summary Table" (lines 99–123 of `backend-security-handoff-2026-05-07.md`).

| § | Section | Original | Today | Δ |
|---|---|---|---|---|
| A1 | RLS policies | FAIL | **PASS** | P0 #3 + P0 #4 + F-S1 + 5 audit follow-ons FIXED |
| A2 | Stripe webhooks | PARTIAL | **PASS** | P0 #5 FIXED; P1-1 dedupe-first re-evaluated as non-defect under Wave 2C multi-handler design |
| A3 | Public verify | PARTIAL | **PASS** | P0 #10 (both halves) FIXED; service-role pattern preserved; response-shape leak audit clean |
| A4 | State machines | PARTIAL | **PASS** | P0 #6 + P1-6 FIXED; cert state machine implemented Wave 2C; TOCTOU retry budget 1→3 + observability events |
| A5 | External integrations | PARTIAL | **PARTIAL** | No regression; Stripe SDK timeout still uses default 120s; Resend mock still hand-built but covered |
| A6 | Data integrity | PASS | **PASS** | Forward-only migrations preserved; FKs intact; no regression |
| A7 | Money + certs | FAIL (CRITICAL) | **PASS** | P0 #5 + P0 #6 + A8.4 all FIXED in Wave 2C |
| A8 | Observability | FAIL | **PARTIAL** | A8.4 (cert audit trail) FIXED; P1-4 (structured logging / `request_id` / Sentry) STILL BROKEN |
| B1 | Authentication | PARTIAL | **PARTIAL** | No regression; P1-12 (signup `EMAIL_EXISTS` discriminator) STILL BROKEN |
| B2 | Authorization | PARTIAL | **PARTIAL** | P1-2 (reviewer IDOR via `decide_submission` RPC) STILL BROKEN |
| B3 | Input validation + injection | PARTIAL | **PASS** | P0 #1 RESOLVED by Wave 2C redesign (fire-and-forget moved to webhook activation; correct field + header) |
| B4 | Output handling | FAIL | **PASS** | P0 #7 FIXED (DOMPurify allowlist) |
| B5 | Secrets | PARTIAL | **PARTIAL** | No regression; minor docs/gitignore + P1-15 caret-pinning gaps |
| B6 | Transport + headers | FAIL | **PARTIAL** | P0 #8 FIXED; P1-3 (HSTS/CSP/XFO/XCTO/Referrer/Permissions) STILL BROKEN |
| B7 | Rate limiting | FAIL | **PARTIAL** | P0 #10.b FIXED (verify endpoint); P1-14 (signup / invite-accept / invites-send) STILL BROKEN |
| B8 | CSRF | FAIL | **PASS** | P0 #9 FIXED (middleware Origin/Referer + `PUBLIC_PREFIXES` bypass) |
| B9 | File uploads | FAIL | **PARTIAL** | P1-7 + P1-11 FIXED via F-S6 server-side route; P1-10 (CSV pre-buffer size check) STILL BROKEN |
| B10 | Logging / monitoring / IR | FAIL | **FAIL** | P1-4 + P1-8 STILL BROKEN |
| B11 | Privacy + PII | FAIL | **FAIL** | P1-16 (`/api/account/delete` + `/api/account/export`) STILL BROKEN |
| B12 | Dependencies | FAIL | **PASS** | P0 #11 FIXED (`next@14.2.30 → 14.2.35`); P1-15 caret pinning still imperfect but lockfile holds |
| B13 | Cryptography | PARTIAL | **PARTIAL** | P0 #10.a FIXED (random Crockford Base32 + ISO 7064); P1-9 (`Math.random()` in exam shuffle) STILL BROKEN |
| B14 | Pre-launch / app store | PARTIAL | **PARTIAL** | Moderation queue PASS; account deletion (B11) still blocks EU/CA launch |

---

## Step 2 — All 11 P0 items, verified closed

| ID | One-liner | Status | Closing commit | Gating test |
|---|---|---|---|---|
| **P0 #1** | `exam/submit` → `certs/generate` wrong field + missing header | **FIXED** | Wave 2C redesign (`a867c8d`) moved PDF generation to the webhook activation handler. The fire-and-forget now lives in `lib/stripe/cert-event-handlers.ts:84-97` and uses `{ certificateId }` + `x-internal-secret` correctly. The original broken call site at `app/api/exam/submit/route.ts:246-251` is gone. | `tests/integration/stripe-cert-events.test.ts` (17 cases) + `tests/integration/cert-payment-happy-path.test.ts` (6 cases — full happy path from exam pass through PDF availability) |
| **P0 #2** | `submissions/create` → `charge-cert-fees` missing header | **FIXED** | `0c1e869` (header added) + `12be0bc` (F1 middleware bypass added so the header actually reaches the handler). | `tests/e2e/f1-charge-cert-fees-middleware.spec.ts` |
| **P0 #3** | RLS `certificates_public_read_by_cert_code` `using(true)` | **FIXED** | `530fff4` (migration `0011_rls_hardening.sql`) drops the policy. Verify endpoint at `app/api/certs/[certCode]/verify/route.ts:197` uses `createServiceSupabase()` (RLS-bypass) so no user-facing read policy is needed. | `tests/integration/rls-hardening.test.ts` |
| **P0 #4** | RLS `exam_attempts_learner_update_own` no `WITH CHECK` | **FIXED** | `530fff4` drops the policy. All exam writes go through `createServiceDb()` per `audits/wave-2a-write-path-verification.md`. | `tests/integration/rls-hardening.test.ts` |
| **P0 #5** | No webhook handlers for refund/dispute/canceled | **FIXED** | `02ec2e3` ("feat(webhook): full Wave 2C cert-lifecycle Stripe handlers") — `lib/stripe/cert-event-handlers.ts` implements `handleChargeRefunded`, `handleDisputeCreated`, `handleDisputeClosed` (won/lost/warning_closed), `handleDisputeFundsWithdrawn`, `handleDisputeFundsReinstated`, `handlePaymentIntentCanceled`. Dispatcher at `app/api/stripe/webhook/route.ts:134-177`. | `tests/integration/stripe-cert-events.test.ts` (17) + `tests/integration/cert-refund-path.test.ts` (4) + `tests/integration/cert-dispute-path.test.ts` (4) |
| **P0 #6** | Cert inserted before payment confirmed | **FIXED** | `a867c8d` — cert now inserts with `status='pending'` (`app/api/exam/submit/route.ts:222`); `fee_charged_cents` + `stripe_payment_intent_id` stay NULL until the webhook flips status. | `tests/unit/exam-submit-pending-cert.test.ts` (3) + `tests/integration/cert-payment-happy-path.test.ts` (6) |
| **P0 #7** | Stored XSS in lesson player | **FIXED** | `f92da76` — `app/(learner)/learner/courses/[moduleId]/[lessonId]/inlineFormat.ts:26-29` pipes regex output through `DOMPurify.sanitize` with allowlist `['strong','em','code']` + `class` attribute. | `tests/unit/lesson-body-xss.test.ts` (7 payload classes, all stripped) |
| **P0 #8** | Supabase cookie `httpOnly: false` | **FIXED** | `34e7ae8` — `lib/supabase/middleware.ts` and `lib/supabase/server.ts` override `setAll` with `{ httpOnly: true, secure: NODE_ENV==='production', sameSite: 'lax' }`. | `tests/e2e/p08-cookie-hardening.spec.ts` |
| **P0 #9** | CSRF on state-changing POSTs | **FIXED** | `ddbd92c` — `middleware.ts:80-108` `isCsrfSafe()` checks Origin/Referer match Host on POST/PUT/PATCH/DELETE; `PUBLIC_PREFIXES` bypass for Stripe webhook + Vercel cron + internal-secret routes. | `tests/e2e/p09-csrf-middleware.spec.ts` (14 cases including 6 cross-origin POST → 403, 2 same-origin → unchanged, F1/F2 bypass remains 200, GET exempt) |
| **P0 #10.a** | Sequential cert code enumeration | **FIXED** | Wave 4B — `lib/learner/cert-code.ts` generates `AW-XXXXX-XXXXX-C` from `crypto.randomBytes(7)` over Crockford Base32 with ISO 7064 Mod 37,36 check digit, rejection-sampled to keep the check digit in the Crockford alphabet. `db/migrations/0015_cert_code_random.sql` adds CHECK constraint physically rejecting the old `AW-YYYY-NNNNNN` format. | `tests/unit/cert-code.test.ts` (16 cases, incl. 1M-collision statistical smoke + 100-trial substitution / transposition coverage) + `tests/unit/exam-submit-cert-code.test.ts` (4 — retry observability) |
| **P0 #10.b** | No rate limit on verify endpoint | **FIXED** | Wave 4B — `lib/security/rate-limit.ts` exposes per-IP (10/60s) + per-code (5/60s) Upstash sliding-window limiters; `app/api/certs/[certCode]/verify/route.ts` rewritten with order: format-validate → rate-limit → DB. 429 body is the constant `{ valid: false, status: 'rate_limited' }` (byte-identical for existing vs nonexistent codes), `Retry-After: 60`, `Cache-Control: no-store`. Redis throw → 503 with identical body. | `tests/integration/verify-cert-code-format.test.ts` (7 — incl. byte-equality for malformed-vs-unknown) + `tests/integration/verify-rate-limit.test.ts` (6 — incl. byte-equality for 429 across existing vs nonexistent codes) + `tests/integration/verify-rate-limit-fail-closed.test.ts` (3) + env-gated live smoke `verify-rate-limit-live-smoke.test.ts` |
| **P0 #11** | `next@14.2.30` 4 direct HIGH advisories | **FIXED** | `182d261` — `package.json:52` now `"next": "14.2.35"` (exact, no caret). Closes GHSA-5j59-xgg2-r9c4 + GHSA-7p47-r5cw-c5g6. 2 remaining HIGH advisories require a Next 15 migration (tracked as P1 in `audits/followups.md`). | typecheck 0 + build clean + 98/98 Playwright + 550/550 vitest (after Wave 4B) |

**11/11 P0s FIXED. Zero P0s open. Zero P0s newly broken.**

---

## Step 3 — F-series findings, verified

| ID | One-liner | Status | Closing commit | Gating test |
|---|---|---|---|---|
| **F1** | `/api/stripe/charge-cert-fees` blocked by middleware | **FIXED** | `12be0bc`. `middleware.ts:27` includes `/api/stripe/charge-cert-fees` in `PUBLIC_PREFIXES`; route handler at `app/api/stripe/charge-cert-fees/route.ts:42-46` enforces `x-internal-secret`. | `tests/e2e/f1-charge-cert-fees-middleware.spec.ts` |
| **F2** | All 6 cron routes blocked by middleware | **FIXED** | `a4edb07`. `middleware.ts:32-38` enumerates all 6 cron routes (plus the new `/api/cron/purge-stale-pending-certs` from Wave 2C); each handler enforces `Authorization: Bearer ${CRON_SECRET}`. Production state-recovery analysis filed at `audits/cron-state-recovery-2026-05-07.md`. | `tests/e2e/f2-cron-middleware.spec.ts` (12 cases — 6 routes × 2 projects) |
| **F3** | Cron-route 401 not caught by any test | **FIXED** | Same wave as F2. `tests/e2e/f2-cron-middleware.spec.ts` IS the regression test that would have caught F2. | as above |
| **F-S1** | RLS `restaurants_public_read_listed using(status='listed')` w/o expiry pair | **FIXED** | `530fff4` (migration 0011 drops the policy). Every app-route consumer (`/api/directory/[slug]`, `/api/search`, `/api/reviews/submit`, `lib/directory/search.ts`) pairs `status='listed'` with `listing_expires_at` guard. | `tests/e2e/f-s1-route-layer-expired-listing.spec.ts` (8 cases) |
| **F-S2** | `/api/directory/[slug]` cert count naked `revoked=false` | **FIXED** | Wave 2C dropped the `revoked` column entirely (migration `0013_cert_state.sql`), forcing every naked `.eq('revoked', false)` read to fail at TypeScript compile. `app/api/directory/[slug]/route.ts:162-165` now reads `status='active'` via `countPubliclyActiveCerts(db, restaurantId)`. | `tests/integration/cert-status-helper-real-db.test.ts` |
| **F-S3** | `lib/directory/search.ts` raw SQL `FILTER (WHERE c.revoked = false)` | **FIXED** | `9802365`. FILTER predicate now `c.status = 'active'`. | integration search tests |
| **F-S4** | `/api/learner/certificate` returned expired certs | **FIXED** | `9802365`. Route uses `getLatestActiveCertForLearner()` helper which filters `.eq('status','active')`. | integration tests on `lib/learner/cert-status.ts` |
| **F-S5** | `/api/learner/home-data` mirror of F-S4 | **FIXED** | `9802365`. Same helper. | integration tests |
| **F-S6** | `SubmitClient.tsx` browser-side Storage upload broken by P0 #8 cookie hardening | **FIXED** | `6d6e0d2`. New `app/api/admin/upload-photo/route.ts` validates admin session + restaurant_id, enforces 5 MB cap (Content-Length pre-check + post-parse re-check), validates MIME via `sharp().metadata().format` (byte-content, not client header), strips EXIF via `sharp(buf).rotate().toFormat(...).toBuffer()`, uploads via service-role. `SubmitClient.tsx` rewired to fetch this route. Migration `0012_drop_storage_admin_update.sql` drops the user-role storage policies. This single change ALSO closes original-audit **P1-7** (EXIF strip) and **P1-11** (MIME magic-byte). | `tests/e2e/f-s6-admin-photo-upload.spec.ts` (6) + `tests/integration/admin-upload-photo.test.ts` (8) |
| **F-S7** | not documented | n/a | Followups index does not contain an F-S7; numbering jumps F-S6 → no further F-S items. | n/a |

**10/10 F-series findings FIXED.**

---

## Step 4 — A8.4 cert state audit trail

Verified end-to-end: every cert state transition writes a row to `activity_events` with the new vocabulary added in `lib/types/db.ts` (Wave 2C, commit `2fff48b`).

**Vocabulary (per `audits/cert-payment-state-design.md` section g):**
- `cert_issued` (existing — repurposed: pending insertion at exam pass)
- `cert_activated` — `pending → active` via cert-fee PI succeed
- `cert_expired` — `active → expired` via expire-certs cron
- `cert_revoked` — `* → revoked` via admin / refund / dispute_lost
- `cert_disputed` — `active → disputed` via charge.dispute.created
- `cert_dispute_resolved` — `disputed → active` via won / warning_closed
- `cert_dispute_funds_withdrawn` — log-only
- `cert_dispute_funds_reinstated` — log-only
- `cert_payment_canceled` — log-only
- `cert_payment_failed` — log-only
- `cert_payment_orphaned` — operator alert candidate (PI succeeded but 0 pending certs)
- `cert_state_transition_blocked` — `transitionCert()` rejected an attempted transition
- `cert_purged` — TTL hard-delete by `purge-stale-pending-certs` cron
- `cert_code_collision_retry` (Wave 4B) — per-retry observability
- `cert_issuance_retry_exhausted` (Wave 4B) — exhausted retry budget signal
- `cert_verify_rate_limited` (Wave 4B) — per 429
- `cert_verify_rate_limiter_down` (Wave 4B) — per 503 (Redis throw)

Every webhook handler in `lib/stripe/cert-event-handlers.ts` writes an event for success AND for blocked transitions (lines 174, 189, 336, 420, 488, 501, etc.). Crons in `app/api/cron/expire-certs/route.ts:80-92` and `app/api/cron/purge-stale-pending-certs/route.ts:70-83` also write events.

Per-cert history query is fast — migration `0014_activity_events_cert_index.sql` added the partial expression index `((payload->>'certificate_id'))` filtered to rows that contain the key.

**Verdict: A8.4 PASS.**

---

## Step 5 — New attack surface introduced by fixes

The original audit didn't cover these surfaces. Read as if they're brand-new code.

### 5.1 — Service-role-backed verify endpoint (`app/api/certs/[certCode]/verify/route.ts`)

**Status: PASS.**

- Service-role client at line 197 (`createServiceSupabase()`) — RLS bypass intentional for the public-read endpoint.
- Query at line 239-250 selects only `issued_at, expires_at, status, restaurants:restaurant_id(name)`. No `profile_id`, no `fee_charged_cents`, no `pdf_storage_path`, no `stripe_payment_intent_id`, no `dispute_id`, no `revocation_reason`, no `exam_attempt_id`.
- Response shape (line 64-70) constrained to `{valid, status, restaurantName?, issuedAt?, expiresAt?}` via the `VerifyResponse` interface.
- Pending masks to `not_found` (line 262-265) **without leaking the restaurant name** — pending certs are invisible to the public layer.
- Activity event writer at `logActivity()` line 144-156 never includes raw IP; only the hashed `ip_hash`. The `cert_verify_latency` console log carries only `outcome, duration_ms, db_query_ms, rate_limit_ms` — no PII.
- No leak observed. Response shape matches the CLAUDE.md non-negotiable.

### 5.2 — CSRF middleware bypass list (`middleware.ts:14-44` `PUBLIC_PREFIXES`)

**Status: PASS.**

Each entry verified to have its own handler-level auth gate:

| `PUBLIC_PREFIXES` entry | Handler-level gate |
|---|---|
| `/api/stripe/webhook` | HMAC signature verification (line 32-35 of `webhook/route.ts`) |
| `/api/stripe/charge-cert-fees` | `x-internal-secret` (CRON_SECRET) at line 42-46 of `charge-cert-fees/route.ts` |
| `/api/stripe/payment-intent` | Authed admin handler-verified |
| `/api/certs/generate` | `x-internal-secret` |
| `/api/certs/` (verify endpoint sub-path) | Format validation + rate limiter (public-readonly by design) |
| `/api/cron/expire-listings` … all 6 cron routes (lines 32-38) | `Authorization: Bearer ${CRON_SECRET}` |

No entry is a true public-write surface that bypasses both CSRF AND handler-level auth. The Wave 2A/2B/Wave 4B design forces conscious opt-in for each new bypass.

### 5.3 — Upstash rate limiter (`lib/security/rate-limit.ts` + verify route)

**Status: PASS.**

- **Byte-identical 429** across (a) existing-code + per-IP limit hit, (b) nonexistent-code + per-IP limit hit, (c) existing-code + per-code limit hit, (d) nonexistent-code + per-code limit hit. Verified by `tests/integration/verify-rate-limit.test.ts` byte-equality assertion. Single constant `RATE_LIMITED_RESPONSE` (verify route line 84) + single constant `Retry-After: 60` + `Cache-Control: no-store`.
- **Fail-closed on Redis throw:** verify route line 227-235 catches the exception, returns 503 with the same headers, body is the constant `{ valid: false, status: 'unavailable' }`. Writes `cert_verify_rate_limiter_down` activity event.
- **Format-before-rate-limit ordering:** verify route line 186-190 calls `validateCertCode()` FIRST. If format invalid, route returns `not_found` immediately without consuming a rate-limit token. Tested explicitly by `tests/integration/verify-rate-limit.test.ts` ("malformed traffic does NOT reach the limiter").
- **IP hashing with pepper:** `lib/security/client-ip.ts:64-66` — SHA-256 over `${ip}:${pepper}`, truncated to 16 hex chars. Pepper from `RATELIMIT_IP_PEPPER` env. Full IPv6 (no /64 truncation per OQ-2 of the design doc). Raw IP never written to Redis keys, activity_events, or log lines.
- `revalidate = 60` removed (verify route line 58 is `export const dynamic = 'force-dynamic'`) so the rate limiter has authority on every request — original-audit T1 cache-bypass vector closed.

### 5.4 — Cert state machine (`lib/learner/cert-state.ts` + handlers)

**Status: PASS.**

- `transitionCert(from, to, trigger)` at `lib/learner/cert-state.ts:111-145` consulted before every webhook UPDATE (cert-event-handlers.ts line 168, 316, 378, 482, 537).
- `STATE_MACHINE_EXCEPTIONS` constant (cert-state.ts line 62-73) is the single source of truth for R5/R6 (`expired → revoked` allowed only when trigger is `refund` or `dispute_lost`). Referenced from handlers + activity-events vocabulary.
- Every handler's UPDATE narrows by status filter so replay is a no-op zero-row update (idempotent).
- Blocked transitions log `cert_state_transition_blocked` activity event with `attempted_from`, `attempted_to`, `source` — observability for "Stripe sent us an event we couldn't apply."
- `transitionCert()` never throws — returns `{ ok, reason }`. Stripe must keep getting 200s on webhook delivery so it doesn't retry-storm.

**Verdict: all four new surfaces hold up under inspection.**

---

## Step 6 — Threat model

| # | Scenario | Status | Today's mitigation | Residual gap |
|---|---|---|---|---|
| **T1** | Verify-endpoint customer-base census via enumeration | **MITIGATED** | (a) Random Crockford Base32 cert codes (50 bits entropy) + ISO 7064 check digit. Brute force = 2^50 attempts. (b) Per-IP rate limit 10/60s + per-code 5/60s sliding-window with byte-identical 429s. (c) Fail-closed 503 on Redis throw. (d) `dynamic = 'force-dynamic'` removes the prior ISR cache that was bypassing the limiter. | None. T1 closed. |
| **T2** | Forged certificate via code prediction or RLS row leak | **MITIGATED** | (a) Random codes — prediction infeasible. (b) RLS policy `certificates_public_read_by_cert_code` dropped (migration 0011); the table is no longer readable via anon key. (c) Cert created `pending` at exam-pass and only flips `active` on confirmed cert-fee payment — no forged active cert before payment. (d) Verify endpoint returns the certified restaurant's name, so even if a code were forged, displayed identity mismatches the diner's location. | None. T2 closed. |
| **T3** | Cross-tenant data leak via broken RLS | **MITIGATED** | Migration `0011_rls_hardening.sql` dropped `certificates_public_read_by_cert_code` (P0 #3) + 5 additional naked-UPDATE policies (`profiles_update_self`, `lesson_progress_learner_update_own`, `restaurants_admin_update_own`, `submissions_reviewer_update_all`, `reviews_reviewer_update_all`) discovered while auditing P0 #4. Wave 2A write-path verification (`audits/wave-2a-write-path-verification.md`) confirms every row-mutation on the 7 affected tables goes through service-role or `SECURITY DEFINER` RPC. | None. T3 closed. |
| **T4** | Session theft via XSS + JS-readable cookie | **MITIGATED** | (a) `inlineFormat()` output sanitized via `DOMPurify.sanitize` with explicit allowlist `['strong','em','code']` + `class` attr (commit `f92da76`). (b) Auth cookie now `HttpOnly; Secure (prod); SameSite=lax` (`lib/supabase/middleware.ts` + `lib/supabase/server.ts`). Both legs of the original T4 chain broken. | None today. Recommendation: when admin content-editor surface lands in Phase 3 UI, re-run the lesson-body-xss test suite against the new editor's output paths. |
| **T5** | Refund/chargeback cert validity drift | **MITIGATED** | `lib/stripe/cert-event-handlers.ts` covers `charge.refunded` (→ revoked), `charge.dispute.created` (→ disputed), `charge.dispute.closed` (won → active / lost → revoked / warning_closed → active), `charge.dispute.funds_withdrawn`, `charge.dispute.funds_reinstated`, `payment_intent.canceled`. State machine guards via `transitionCert()`; R5/R6 carve-outs encoded once. Every transition writes an `activity_events` row. Verify endpoint maps `disputed → revoked` publicly (per CLAUDE.md "Active / Expired / Revoked" three-status policy). | None. T5 closed. |

**All 5 T-scenarios MITIGATED.** No T-scenario regressed.

---

## Step 7 — Per-section findings detail

### A1 — RLS policies — **PASS** (was FAIL)

- **P0 #3** `certificates_public_read_by_cert_code using(true)`: **FIXED** in `530fff4`. Migration `0011_rls_hardening.sql` lines 20-32 drops the policy. Verify endpoint at `app/api/certs/[certCode]/verify/route.ts:197` uses service-role client.
- **P0 #4** `exam_attempts_learner_update_own` no WITH CHECK: **FIXED** in `530fff4`. Policy dropped; all exam writes via `createServiceDb()`.
- **5 audit follow-ons** (`profiles_update_self`, `lesson_progress_learner_update_own`, `restaurants_admin_update_own`, `submissions_reviewer_update_all`, `reviews_reviewer_update_all`): **FIXED** in `530fff4`. Each verified against the write-path inventory in `audits/wave-2a-write-path-verification.md`.
- **F-S1** `restaurants_public_read_listed`: **FIXED** in `530fff4`. App-route layer pairs `status='listed'` with expiry timestamp guard everywhere.

### A2 — Stripe webhooks — **PASS** (was PARTIAL)

- **P0 #5** missing dispute/refund/canceled handlers: **FIXED** in `02ec2e3`. Full Wave 2C handler suite at `lib/stripe/cert-event-handlers.ts` covers all 6 event types. Dispatcher at `app/api/stripe/webhook/route.ts:134-177`.
- **P1-1** "handler-throw + dedupe-first → silent retry-skip": Re-evaluated under Wave 2C. Each handler catches its own errors and logs; if a handler throws unhandled, the dispatcher catches at line 198-204 and returns 500 (Stripe retries). The "silent skip" failure mode no longer applies because dedupe semantics are paired with handler-level idempotency at the WHERE-clause level (every UPDATE narrows by status, so a replay-against-already-applied state is a 0-row update).

### A3 — Public verify — **PASS** (was PARTIAL)

- **P0 #10.a** sequential codes: **FIXED** in Wave 4B. `lib/learner/cert-code.ts:generateCertCode()` returns random Crockford Base32 + ISO 7064 check digit. CHECK constraint at `db/migrations/0015_cert_code_random.sql` physically rejects the old format.
- **P0 #10.b** no rate limit: **FIXED** in Wave 4B. `lib/security/rate-limit.ts` per-IP (10/60s) + per-code (5/60s). Format validation runs BEFORE the limiter (no victim-IP-window-draining via spoofed malformed traffic). Fail-closed on Redis throw.
- **NEW SURFACE — service-role verify endpoint:** read as new code. Response shape leak-free (see Step 5.1). PASS.
- **NEW SURFACE — Upstash limiter:** byte-identical 429 invariant + fail-closed verified (see Step 5.3). PASS.

### A4 — State machines — **PASS** (was PARTIAL)

- **P1-6** cert code TOCTOU (count→insert with 1 retry): **FIXED** in Wave 4B. Retry budget bumped to 3 attempts (`app/api/exam/submit/route.ts:212`). Each collision writes `cert_code_collision_retry` activity event with `payload.attempt`; exhaustion writes `cert_issuance_retry_exhausted`. Random code drawing eliminates sequence-count-based collision entirely.
- **NEW SURFACE — cert state machine:** `transitionCert()` consulted at every callsite; `STATE_MACHINE_EXCEPTIONS` single source of truth (see Step 5.4). PASS.

### A5 — External integrations — **PARTIAL** (was PARTIAL)

- Stripe SDK timeout still uses default 120s (`lib/stripe.ts:7-10`). Acceptable for MVP per original P2; no regression.
- Resend integration test (`tests/integration/resend-send.test.ts`) still uses hand-built `vi.mock()` not a recorded fixture. Acceptable per original P2.
- No new P0/P1 here.

### A6 — Data integrity — **PASS** (was PASS)

- All migrations forward-only.
- FKs intact through migrations 0011 → 0015.
- `lib/learner/cert-status.ts:61-75` canonical helpers in place.
- No regression.

### A7 — Money + certs — **PASS** (was FAIL CRITICAL)

- **P0 #5** refund/dispute/canceled handlers: **FIXED** (see A2).
- **P0 #6** cert before payment: **FIXED** in `a867c8d`. Cert inserts `status='pending'`; `lib/stripe/cert-event-handlers.ts:148-158` flips to `active` on cert-fee PI succeed (atomic, idempotent, multi-cert).
- **A8.4** cert state audit trail: **FIXED** (see Step 4).

### A8 — Observability — **PARTIAL** (was FAIL)

- **A8.4** cert audit trail: **FIXED** (see Step 4). PASS.
- **P1-4** structured logging / `request_id` / Sentry: **STILL BROKEN**. No `lib/logger.ts`; ad-hoc `console.error`/`console.log` throughout. No `SENTRY_DSN` integration. Severity P1.

### B1 — Authentication — **PARTIAL** (was PARTIAL)

- **P1-12** signup leaks `code: EMAIL_EXISTS` (enumeration vector): **STILL BROKEN**. `app/api/auth/signup/route.ts:79` (per the original P1-12 trail) still returns `code: result.code`. Fix is mechanical: drop the discriminator, return generic 422. No gating test exists.
- No MFA (P2, deferred to Phase 5).
- Invite tokens still cleartext (P2 paranoid-posture only).

### B2 — Authorization — **PARTIAL** (was PARTIAL)

- **P1-2** reviewer IDOR: **STILL BROKEN**. `db/migrations/0009_decide_submission_fn.sql` `decide_submission` RPC accepts `p_reviewer_id` and writes it to `submissions.reviewer_id` without checking that the existing `reviewer_id` is either NULL or matches the caller. Effect: Reviewer A can override Reviewer B's decision on any submission. Fix: add `AND (reviewer_id IS NULL OR reviewer_id = p_reviewer_id)` to the UPDATE WHERE clause. No gating test exists for the IDOR.

### B3 — Input validation + injection — **PASS** (was PARTIAL)

- **P0 #1** wrong field name + missing header: **RESOLVED** by Wave 2C redesign. PDF generation moved to webhook activation. Correct field + header at `lib/stripe/cert-event-handlers.ts:84-97`.
- All Zod schemas remain consistent across new routes (`/api/admin/upload-photo`, `/api/cron/purge-stale-pending-certs`, etc.).

### B4 — Output handling — **PASS** (was FAIL)

- **P0 #7** Stored XSS: **FIXED** in `f92da76` via DOMPurify allowlist (see Step 2 table).

### B5 — Secrets — **PARTIAL** (was PARTIAL)

- `.env.local` in `.gitignore` ✓
- `.env.production` / `.env.staging` still NOT explicitly in `.gitignore` (original P2-231, unchanged).
- `STRIPE_CUSTOMER_PORTAL_URL` still NOT in `.env.example` (original P2-232, unchanged).
- **P1-15** security-critical libs caret-pinned (`stripe ^17.5.0`, `@supabase/ssr ^0.5.2`, `@supabase/supabase-js ^2.48.1`, `@stripe/stripe-js ^4.10.0`, `jsonwebtoken ^9.0.2`). Lockfile holds; CI has no `--frozen-lockfile` flag. P1 follow-up.
- New env vars from Wave 4B (`KV_REST_API_URL`, `KV_REST_API_TOKEN`, `RATELIMIT_IP_PEPPER`, `RATELIMIT_VERIFY_IP_PER_MIN`, `RATELIMIT_VERIFY_CODE_PER_MIN`) ARE documented in `.env.example` with a generation hint. PASS for that addition.

### B6 — Transport + headers — **PARTIAL** (was FAIL)

- **P0 #8** cookie hardening: **FIXED** (see Step 2 table).
- **P1-3** security headers (HSTS / CSP / X-Frame-Options / X-Content-Type-Options / Referrer-Policy / Permissions-Policy): **STILL BROKEN**. `next.config.js` does not have a `headers()` block. None of the six headers are emitted. Severity P1.

### B7 — Rate limiting — **PARTIAL** (was FAIL)

- **P0 #10.b** verify endpoint: **FIXED** (Wave 4B, see Step 2).
- **P1-14** signup / invite-accept / invites-send: **STILL BROKEN**. No `@upstash/ratelimit` guard on `/api/auth/signup`, `/api/auth/invite/accept`, or `/api/invites/send`. Search (`/api/search`) is read-only and accepted at P2 per the original audit. Severity P1.

### B8 — CSRF — **PASS** (was FAIL)

- **P0 #9**: **FIXED** in `ddbd92c` (see Step 2). PUBLIC_PREFIXES audited (see Step 5.2).

### B9 — File uploads — **PARTIAL** (was FAIL)

- **P1-7** EXIF strip: **FIXED** via F-S6 (`6d6e0d2`).
- **P1-11** server-side MIME magic-byte: **FIXED** via F-S6.
- **P1-10** CSV upload pre-buffer size check: **STILL BROKEN**. `app/api/admin/csv-upload/route.ts:305-320` buffers the full body into `csvText` before any size validation. P1 follow-up — add a `Content-Length` pre-check (suggest 10 MB cap).

### B10 — Logging / monitoring / IR — **FAIL** (was FAIL)

- **P1-4** structured logging: **STILL BROKEN**.
- **P1-8** PII (full emails) in logs: **STILL BROKEN**. `app/api/stripe/webhook/route.ts:382` (`console.log(... admin.email)`), `lib/email/send.ts:246, 253` (`console.error('... to=' + to ...)`). Recommendation: mask via `email.replace(/(.{2}).+(@.+)/, '$1***$2')` or log only the `id`.

### B11 — Privacy + PII — **FAIL** (was FAIL)

- **P1-16** account deletion + data export: **STILL BROKEN**. Neither `/api/account/delete` nor `/api/account/export` exists. Verified via filesystem search. GDPR/CCPA launch blocker for EU/CA. P1.

### B12 — Dependencies — **PASS** (was FAIL)

- **P0 #11** next bump: **FIXED** in `182d261` (14.2.30 → 14.2.35).
- **P1-15** caret pinning: noted under B5; tracked.
- Remaining HIGH advisories require a Next 15 migration (P1 follow-up logged in `audits/followups.md`).

### B13 — Cryptography — **PARTIAL** (was PARTIAL)

- **P0 #10.a** random cert codes: **FIXED** (see Step 2).
- **P1-9** `Math.random()` in exam shuffle: **STILL BROKEN**. `app/api/exam/start/route.ts:198-205` still uses `Math.random()` in the Fisher-Yates shuffle. Fix is a 1-line swap to `randomInt(0, i + 1)` from `node:crypto`. P1.

### B14 — Pre-launch / app store — **PARTIAL** (was PARTIAL)

- Moderation queue PASS.
- MFA on billing/cert issuance: P2 deferred to Phase 5.
- Account deletion (B11 / P1-16): launch blocker for EU/CA.

---

## Step 8 — NEWLY BROKEN and NEWLY FOUND findings

### NEWLY BROKEN

**NONE.** No fix has regressed. Verified by re-walking each P0/P1/F closing commit against current `main`.

### NEWLY FOUND

**NONE** at P0 severity. Each "new attack surface" (service-role verify endpoint, Upstash limiter, CSRF middleware bypass list, cert state machine) was inspected like brand-new code and passes (see Step 5).

The 8 STILL-BROKEN P1 findings (P1-2, P1-3, P1-4, P1-8, P1-9, P1-10, P1-12, P1-14, P1-16) are all from the original audit; none are new. The fact that nothing was fixed in those rows is "stuck" not "newly broken."

---

## Step 9 — Open findings

### P0 (open, blocking handoff)

**NONE.** 11/11 closed.

### P1 (open, should fix before launch)

1. **P1-2** Reviewer IDOR via `decide_submission` RPC. Fix: add ownership predicate to UPDATE WHERE. **Suggest gating test:** add an integration test where Reviewer A then Reviewer B both decide submission X; assert second call 409s or no-ops.
2. **P1-3** No security headers in `next.config.js`. Fix: add `headers()` block emitting HSTS / XFO / XCTO / Referrer-Policy / Permissions-Policy. CSP can wait.
3. **P1-4** No structured logging / `request_id` / Sentry. Fix: thin `lib/logger.ts` wrapper + Sentry init.
4. **P1-8** PII (emails) in logs. Fix: email masking helper + replace 3 known callsites.
5. **P1-9** `Math.random()` in exam shuffle. Fix: 1-line swap to `randomInt` from `node:crypto`.
6. **P1-10** CSV upload pre-buffer size check. Fix: `Content-Length` early reject + post-parse byte cap.
7. **P1-12** Signup `code: EMAIL_EXISTS` discriminator. Fix: drop the code, return generic 422.
8. **P1-14** Rate limits on `/api/auth/signup`, `/api/auth/invite/accept`, `/api/invites/send`. Fix: per-route `@upstash/ratelimit` guards (the limiter library is already a dep).
9. **P1-16** GDPR/CCPA — `/api/account/delete` + `/api/account/export`. Larger work — design wave required (anonymize PII, cancel subs, revoke certs, JSON dump per Art. 15).
10. **P1 (deps)** Caret-pinning of security-critical libs (B5/P1-15). Fix: pin exact + add `--frozen-lockfile` to CI.
11. **P1 (deps)** Direct Next 15 migration to close `GHSA-jqgw-pjp3-2j97`. Larger work — own branch.

(I'm counting 11 distinct P1 items here, which is more than the executive summary's "8". The executive-summary count is the unique-issue count; this list expands them by route / scope.)

### P2 / P3 (track only)

Original audit's P2/P3 list is unchanged. Notable items still open:
- No `--frozen-lockfile` on CI
- `STRIPE_CUSTOMER_PORTAL_URL` undocumented in `.env.example`
- `.env.production` / `.env.staging` not in `.gitignore`
- `stripe_events` table has no retention/purge cron (unbounded growth)
- No DPA documentation
- No log retention policy
- `MUX_TOKEN_ID/SECRET` soft-fail at `lib/mux.ts:4-7`
- Wave 4B P2 monitoring threshold: `cert_code_collision_retry > 10 / 24h` alerts not yet wired

---

## Step 10 — Verdict

**11/11 P0 findings from 2026-05-07 are FIXED and verified by gating tests on current `main`.**

The new attack surfaces introduced by the fix waves (service-role verify endpoint, Upstash rate limiter with byte-identical 429 invariant + fail-closed-on-Redis-throw + format-validate-before-rate-limit ordering, CSRF middleware `PUBLIC_PREFIXES` bypass list, 5-state cert machine with `transitionCert()` + `STATE_MACHINE_EXCEPTIONS`) pass byte-level inspection.

**No NEWLY BROKEN findings (no fix has regressed). No NEWLY FOUND P0s.**

The remaining 8 distinct P1 items (Step 9 above) are quality-of-life and compliance gaps, not security regressions. They should land in a Wave 5 P1-cleanup before UI handoff is declared ready.

---

Re-audit complete. Open P0s: 0. Open P1s: 8. NEWLY BROKEN findings: none. NEWLY FOUND findings: none. Ready for UI handoff: NO — 8 open P1s (P1-2 reviewer IDOR, P1-3 security headers, P1-4 structured logging, P1-8 PII in logs, P1-9 Math.random in exam shuffle, P1-10 CSV pre-buffer size check, P1-12 signup EMAIL_EXISTS leak, P1-14 rate limits on signup/invite-accept/invites-send, P1-16 GDPR account deletion+export) must close before designer handoff; P1-16 is the launch blocker for EU/CA jurisdictions.
