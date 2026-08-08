# AllergenWise — Pre-Handoff Backend + Cybersecurity Audit
**Date:** 2026-05-07
**Auditor:** Opus orchestration + 5 parallel Sonnet evidence-gathering agents
**Scope:** Full backend surface + 22 security sections (A1–A8, B1–B14) + threat model
**Method:** Audit-only. No code changes. File:line citations against current `main` branch state at audit time.

---

## Executive Summary

**Ready for UI handoff: NO** — Two production-blocking functional defects (no learner ever receives a cert PDF; no restaurant can ever submit for review) plus a chargeback/refund handler gap that directly violates a non-negotiable from CLAUDE.md. Six additional security issues are P1 (cookie hardening, CSRF, XSS, RLS policy errors, dependency vulns, enumeration vector). Backend is **not** yet in a state where a UI designer can safely build against it without rework.

**Punch line:** Phase 4 closed the loop on sign-out, PDF font, and dead-code cleanup, but the cross-route fire-and-forget plumbing was never tested end-to-end against a real key. The cert-issuance happy path is broken in two distinct ways. RLS has two open scopes that bypass the multi-tenant boundary. The Stripe handler covers only 3 of the 6 events the policy requires.

---

## Step 1 — Surface Map

### API Routes (`app/api/**`)

| Path | Method | Auth |
|---|---|---|
| `/api/auth/login` | POST | Public |
| `/api/auth/logout` | POST | Public (no-op if no session) |
| `/api/auth/signup` | POST | Public |
| `/api/auth/session` | GET | Public |
| `/api/auth/invite/accept` | POST | Public (token is auth) |
| `/api/admin/csv-upload` | POST/GET/DELETE | Admin (DB-verified) |
| `/api/admin/dashboard-stats` | GET | Admin |
| `/api/admin/roster` | GET | Admin (DB-verified) |
| `/api/certs/[certCode]/verify` | GET | Public |
| `/api/certs/generate` | POST | `x-internal-secret` (CRON_SECRET) |
| `/api/cron/digest-reviewer-queue` | GET | Bearer CRON_SECRET |
| `/api/cron/exam-timeout-sweep` | GET | Bearer CRON_SECRET |
| `/api/cron/expire-certs` | GET | Bearer CRON_SECRET |
| `/api/cron/expire-listings` | GET | Bearer CRON_SECRET |
| `/api/cron/expire-subscriptions` | GET | Bearer CRON_SECRET |
| `/api/cron/weekly-admin-digest` | GET | Bearer CRON_SECRET |
| `/api/directory/[slug]` | GET | Public |
| `/api/exam/start` | POST | Learner session |
| `/api/exam/submit` | POST | Learner session |
| `/api/invites/[id]/resend` | POST | Admin |
| `/api/invites/remind` | POST | Admin |
| `/api/invites/send` | POST | Admin (DB-verified) |
| `/api/learner/certificate` | GET | Learner |
| `/api/learner/home-data` | GET | Learner |
| `/api/lesson/[lessonId]/complete` | POST | Learner/Admin |
| `/api/lesson/[lessonId]` | GET | Learner |
| `/api/lesson/progress` | GET/POST | Learner |
| `/api/reviewer/queue/[submissionId]/decide` | POST | Reviewer (DB-verified) |
| `/api/reviewer/queue/[submissionId]` | GET | Reviewer |
| `/api/reviewer/queue` | GET | Reviewer |
| `/api/reviewer/reviews/[id]/decide` | POST | Reviewer |
| `/api/reviewer/reviews/queue` | GET | Reviewer |
| `/api/reviews/submit` | POST | Public (honeypot only) |
| `/api/search` | GET | Public |
| `/api/stripe/charge-cert-fees` | POST | `x-internal-secret` |
| `/api/stripe/payment-intent` | POST | Authed admin (handler-verified) |
| `/api/stripe/webhook` | POST | Stripe HMAC signature |
| `/api/submissions/create` | POST | Admin (DB-verified) |

### Database — 16 tables across 10 migrations
`restaurants`, `profiles`, `subscriptions`, `modules`, `lessons`, `exam_questions`, `lesson_progress`, `exam_attempts`, `certificates`, `submissions`, `reviews`, `activity_events`, `stripe_events`, `csv_upload_drafts`, `review_rate_limits`, `cert_warnings`. RLS enabled on all 16. Storage buckets: `restaurant-photos` (public), `roster-uploads` (private), `certificates` (private signed URL).

### Webhooks + Cron
- **Stripe webhook**: handles `payment_intent.succeeded` (kind: plan/cert_fee/submission), `payment_intent.payment_failed`, `customer.updated`. **Does NOT handle** `charge.dispute.*`, `charge.refunded`, `payment_intent.canceled`.
- **Cron (Vercel)**: `expire-listings` (daily 03:00), `expire-subscriptions` (03:30), `expire-certs` (03:15 — emails only, does not actually transition state), `exam-timeout-sweep` (every minute), `digest-reviewer-queue` (daily 09:00), `weekly-admin-digest` (Mon 08:00).
- **Background fire-and-forget**: `exam/submit → /api/certs/generate` (broken — see P0-1), `submissions/create → /api/stripe/charge-cert-fees` (broken — see P0-2).

### External integrations
Supabase (Auth + DB + Storage), Stripe (PaymentIntents), Resend (transactional email), Mux (signed RS256 playback URLs), Mapbox (geocoding), `@react-pdf/renderer` (cert PDFs).

### State machines
- **Certificate**: `valid` → `expired` (cron) | `valid` → `revoked` (manual) — terminal.
- **Exam attempt**: `started` → `submitted` | `started` → `auto_submitted_timeout` (cron).
- **Subscription**: `active` → `expired` (cron) | `active` → `canceled` — terminal.
- **Restaurant listing**: `unlisted` → `pending_review` → `in_review` → `listed` | `rejected` | `info_requested` → `pending_review`. Decided via `decide_submission` SECURITY DEFINER RPC with `FOR UPDATE` row lock.

### Secrets read
| Var | File:Line | Behavior if missing |
|---|---|---|
| `STRIPE_SECRET_KEY` | `lib/stripe.ts:3-4` | throws at import |
| `STRIPE_WEBHOOK_SECRET` | `app/api/stripe/webhook/route.ts:32-35` | throws at module load |
| `SUPABASE_SERVICE_ROLE_KEY` | `lib/supabase/server.ts:43-47` | throws at call |
| `RESEND_API_KEY` | `lib/email/client.ts:3-4` | throws at import |
| `MUX_TOKEN_ID` / `MUX_TOKEN_SECRET` | `lib/mux.ts:4-7` | **`console.warn` (soft fail)** |
| `MUX_SIGNING_KEY_ID` / `MUX_SIGNING_KEY_PRIVATE` | `lib/mux.ts:24-25, 90-91` | throws at call |
| `CRON_SECRET` | all cron + internal routes | returns 401 |
| `NEXT_PUBLIC_SUPABASE_URL` / `_ANON_KEY` | `lib/supabase/{server,client}.ts` | throws at call |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | `app/(auth)/signup/SignupForm.tsx:68` | client undefined |
| `NEXT_PUBLIC_MAPBOX_TOKEN` | `lib/directory/geocode.ts` | search degrades |
| `STRIPE_CUSTOMER_PORTAL_URL` | `app/(admin)/admin/billing/page.tsx:88` | undocumented in `.env.example` |
| `APP_URL` | route handlers | falls back to `localhost:3000` |

---

## Step 2 — Section Summary Table

| § | Section | Status | Severity | Notes |
|---|---|---|---|---|
| A1 | RLS | **FAIL** | HIGH | 2 broken policies — `certificates using(true)` + `exam_attempts` no `WITH CHECK` |
| A2 | Stripe webhooks | **PARTIAL** | HIGH | Sig + dedupe correct; handler-throw + dedupe-first creates silent retry-skip; missing `payment_intent.canceled` |
| A3 | Public verify | **PARTIAL** | MEDIUM | Response shape clean; no rate limit; sequential cert codes enumerable |
| A4 | State machines | **PARTIAL** | MEDIUM | Models correct; cert-code count→insert TOCTOU has only 1 retry |
| A5 | External integrations | **PARTIAL** | MEDIUM | Hand-built fixtures (not recorded) for Stripe/Resend; no Stripe SDK timeouts |
| A6 | Data integrity | **PASS** | — | Schema enforces all FKs; soft-delete consistent; migrations forward-only |
| A7 | Money + certs | **FAIL** | CRITICAL | No refund/chargeback handler; cert created before any payment confirmed |
| A8 | Observability | **FAIL** | HIGH | No structured logging, no `request_id`, no cert state audit trail |
| B1 | Authentication | **PARTIAL** | HIGH | Logout works; no MFA; signup leaks `EMAIL_EXISTS`; invite tokens stored cleartext |
| B2 | Authorization | **PARTIAL** | MEDIUM | Role checks consistent; reviewer can decide any submission (no assignment check) |
| B3 | Input validation + injection | **PARTIAL** | HIGH | Zod consistent; **but cross-route call sends wrong field name** |
| B4 | Output handling | **FAIL** | HIGH | Stored XSS in lesson player via `dangerouslySetInnerHTML` + custom `inlineFormat` |
| B5 | Secrets | **PARTIAL** | LOW | Git history clean; minor docs gaps |
| B6 | Transport + headers | **FAIL** | HIGH | No HSTS, CSP, X-Frame-Options, X-Content-Type-Options; `httpOnly: false` on auth cookie |
| B7 | Rate limiting | **FAIL** | HIGH | No rate limits on signup, invite-accept, verify, search, /invites/send |
| B8 | CSRF | **FAIL** | HIGH | SameSite=Lax + no Origin check + no Content-Type guard |
| B9 | File uploads | **FAIL** | MEDIUM | No EXIF strip on public photos; no MIME magic-byte check; CSV buffers before size check |
| B10 | Logging / monitoring / IR | **FAIL** | MEDIUM | No alerting infra; PII (full emails) in logs |
| B11 | Privacy + PII | **FAIL** | HIGH | No account deletion / data export — GDPR/CCPA blocker |
| B12 | Dependencies | **FAIL** | HIGH | 4 direct `next@14.2.30` HIGH advisories; security-critical libs unpinned |
| B13 | Cryptography | **PARTIAL** | LOW | `Math.random()` in exam shuffle; cert code sequential (enumerable) |
| B14 | Pre-launch / app store | **PARTIAL** | LOW | Web-only; no account deletion (B11); moderation queue PASS |

---

## Step 3 — Prioritized Fix List

### P0 — Blocks handoff (11 items)

**Functional defects (will be discovered the first time anyone runs the happy path with real keys):**

**P0-1** — `exam/submit` → `certs/generate` is doubly broken: wrong field name + missing auth header.
- `app/api/exam/submit/route.ts:246-251` sends `body: JSON.stringify({ certCode })`, no `x-internal-secret` header.
- `app/api/certs/generate/route.ts:29-30` validates `{ certificateId: z.string().uuid() }` and `app/api/certs/generate/route.ts:58-62` requires `x-internal-secret`.
- **Effect:** every passing learner's PDF generation silently 401s. `certificates.pdf_storage_path` always NULL. `GET /api/learner/certificate` returns `pdfUrl: null` for all learners.
- **Fix:** select the inserted cert's UUID, call with `{ certificateId: newCert.id }` and header `x-internal-secret: process.env.CRON_SECRET`.

**P0-2** — `submissions/create` → `charge-cert-fees` missing `x-internal-secret` header.
- `app/api/submissions/create/route.ts:202-209` does not include the header.
- `app/api/stripe/charge-cert-fees/route.ts:42-46` requires it; returns 401 otherwise.
- **Effect:** every restaurant submission fails with 402 to the admin; no restaurant can ever advance to `pending_review`. The full pilot loop's "step 9 — admin submits restaurant for directory listing" passes in e2e only because the e2e environment uses placeholder Stripe — with real keys the route bails earlier.
- **Fix:** add `'x-internal-secret': process.env.CRON_SECRET ?? ''` to the fetch headers.

**P0-3** — RLS `certificates_public_read_by_cert_code` uses `using (true)`.
- `db/migrations/0003_rls.sql:252-254`: `create policy ... for select using (true);`
- **Effect:** any caller (anon JWT included) can `SELECT * FROM certificates` with no filter, harvesting `profile_id`, `restaurant_id`, `stripe_payment_intent_id`, `pdf_storage_path`, `fee_charged_cents` for every cert in the system. Violates the multi-tenant non-negotiable.
- **Fix:** drop the policy. The verify endpoint at `app/api/certs/[certCode]/verify/route.ts:82` already uses the service-role client (`createServiceSupabase()`), which bypasses RLS — no user-facing read policy is needed.

**P0-4** — RLS `exam_attempts_learner_update_own` has no `WITH CHECK`.
- `db/migrations/0003_rls.sql:207-210`: `create policy ... for update using (profile_id = auth.uid());` — no `WITH CHECK`.
- **Effect:** a learner can call Supabase client directly to set `passed=true, score_percent=100, submitted_at=now()` on their own attempt, then trigger cert issuance via a follow-up flow. Server-side scoring in `exam/submit` re-scores, but the learner-controllable row still gates business logic in adjacent code paths.
- **Fix:** drop this policy entirely. Exam attempts should only be written via service-role server-side handlers; learners never need direct UPDATE access.

**P0-5** — No webhook handler for refunds, disputes, or PI cancellations.
- `app/api/stripe/webhook/route.ts:98-119`: switch handles only `payment_intent.succeeded`, `payment_intent.payment_failed`, `customer.updated`.
- **Effect:** Stripe fires `charge.dispute.created` on chargeback → falls to `default:` → logs and returns 200. Cert remains `revoked: false` indefinitely. **Directly violates CONTEXT.md policy** ("Refunds / chargebacks / cancellations invalidate certs"). No cron sweep exists to catch missed events.
- **Fix:** add handlers for `charge.dispute.created`, `charge.dispute.funds_withdrawn`, `charge.refunded`, `payment_intent.canceled`. On chargeback/refund, set `certificates.revoked = true` for all certs whose `stripe_payment_intent_id` matches the disputed PI; insert `cert_revoked` activity event with `revoked_reason`.

**P0-6** — Cert row inserted at exam pass *before* any payment confirmation.
- `app/api/exam/submit/route.ts:211-219`: cert insert with hardcoded `fee_charged_cents: 3500` and no `stripe_payment_intent_id`. The actual charge happens later via `submissions/create` (which is itself broken — see P0-2).
- **Effect:** cert exists and verifies as `status: active` with no payment ever collected. If admin never submits or submission charge fails, the cert is permanently active.
- **Fix:** either (a) insert cert with `status='pending'` and only flip to active when the webhook confirms cert-fee payment, or (b) document and accept that "exam pass = cert active; payment happens at restaurant submission time" — but if (b), do not write `fee_charged_cents` until the webhook confirms it. Recommend (a).

**Security criticals:**

**P0-7** — Stored XSS in lesson player.
- `app/(learner)/learner/courses/[moduleId]/[lessonId]/page.tsx:102, 136`: `dangerouslySetInnerHTML={{ __html: inlineFormat(item) }}`.
- `inlineFormat()` at lines 146-151 does not escape HTML before applying markdown-like regex replacements. Input `**<img src=x onerror=alert(1)>**` becomes `<strong><img src=x onerror=alert(1)></strong>`.
- Today the source `lesson.bodyMd` is seeded from `content/curriculum/*.json` (not user-writable), but if any admin-side body editor lands in the future this becomes stored XSS. Combined with `httpOnly: false` cookies (P0-8), an attacker who lands content in `lesson.bodyMd` exfils session.
- **Fix:** replace custom renderer with `react-markdown` (already noted as TODO in code), or wrap output in `DOMPurify.sanitize()`.

**P0-8** — Supabase auth cookie `httpOnly: false`.
- `@supabase/ssr` default; not overridden in `lib/supabase/middleware.ts` or `lib/supabase/server.ts`.
- **Effect:** any XSS (P0-7 today; future content surfaces tomorrow) reads `document.cookie` and exfils the session token. Multi-tenant data is then accessible across the whole system as the victim.
- **Fix:** in both `setAll` callbacks, override options: `{ ...options, httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax' }`.

**P0-9** — CSRF on all state-changing POST endpoints.
- `SameSite=Lax` is sent on top-level cross-site form POSTs. No route validates `Origin` / `Referer`. No route enforces `Content-Type: application/json`.
- Most exposed: `/api/admin/csv-upload`, `/api/invites/send`, `/api/exam/submit`, `/api/submissions/create`. An attacker page with `<form action="https://allergenwise.com/api/...">` rides the victim's session.
- **Fix:** add a shared guard at the top of every state-changing handler: reject if `Origin` is set and does not match `Host`. Also add `Content-Type: application/json` enforcement on all JSON-body routes.

**P0-10** — Verify endpoint enumeration.
- `app/api/certs/[certCode]/verify/route.ts` — no rate limit. Cert code format `AW-{YYYY}-{NNNNNN}` is sequential (`lib/learner/exam.ts:163`).
- **Effect:** any actor iterates `AW-2026-000001..999999` and harvests the entire customer base (restaurant name, issue date, expiry date) — a market-research-grade leak. Fully iterable in <3 hours at 100 req/sec.
- **Fix:** (a) replace sequential suffix with `crypto.randomBytes(6).toString('hex')`, retain DB unique constraint, (b) add IP rate limit (60/min) on the verify route.

**P0-11** — `next@14.2.30` has 4 direct HIGH advisories.
- GHSA-mwv6-3258-q52c (DoS Server Components — patched in 14.2.34)
- GHSA-5j59-xgg2-r9c4 (DoS Server Components incomplete-fix follow-up — patched 14.2.35)
- GHSA-h25m-26qc-wcjf (HTTP request deserialization DoS — only fixed in 15.0.8+)
- GHSA-q4gf-8mx6-v5v3 (DoS with Server Components — only fixed in 15.5.15+)
- **Fix:** immediate `pnpm add next@14.2.35` to clear the 14.x-fixable highs + 3 14.x moderates. Plan a Next 15 migration for the remaining items.

---

### P1 — Fix this week (16 items)

| ID | Issue | File:Line | Fix sketch |
|---|---|---|---|
| P1-1 | Stripe handler-throw + dedupe-first → retry silently skipped | `app/api/stripe/webhook/route.ts:78-94` (insert) + `:97/123` (try/catch) | Move dedupe insert to after handler success, or return 200 on handler error and rely on per-handler idempotency keys. |
| P1-2 | IDOR — any reviewer can read/decide any submission | `app/api/reviewer/queue/[submissionId]/route.ts:120-164`, `.../decide/route.ts:68-85` | Add `eq('reviewer_id', reviewerId).or('reviewer_id.is.null')` guard or enforce in `decide_submission` RPC. |
| P1-3 | No security headers (HSTS/CSP/XFO/XCTO/Referrer-Policy/Permissions-Policy) | `next.config.js` (no `headers()`) | Add `headers()` block per the security headers list. |
| P1-4 | No structured logging / `request_id` / Sentry | all `console.error` calls in `app/api/**` | Wrap a `lib/logger.ts` and replace; configure `SENTRY_DSN` (env stub already present in `.env.local`). |
| P1-5 | No cert state-transition audit trail | `db/migrations/*` (no trigger), `app/api/cron/expire-certs/*` (warning emails only) | Add `AFTER UPDATE` trigger on `certificates` to log `revoked` / `expires_at` deltas to `activity_events`. |
| P1-6 | Cert code TOCTOU race (count→insert) with single-retry only | `app/api/exam/submit/route.ts:199-235` | Replace with Postgres sequence or wrap insert in retry loop bumping sequence each time. |
| P1-7 | EXIF not stripped on public restaurant photos | `app/(admin)/admin/submit/SubmitClient.tsx:448-456` (client-side direct upload) | Build server route that uses `sharp(buf).rotate().withMetadata(false).jpeg(...).toBuffer()` then uploads. |
| P1-8 | PII (full emails) in logs | `app/api/stripe/webhook/route.ts:302`, `lib/email/send.ts:246, 253` | Mask: `email.replace(/(.{2}).+(@.+)/, '$1***$2')` or log `id` only. |
| P1-9 | `Math.random()` in exam shuffle | `app/api/exam/start/route.ts:198-205` | `import { randomInt } from 'crypto'` and `randomInt(i + 1)`. |
| P1-10 | CSV upload buffers full body before size check | `app/api/admin/csv-upload/route.ts:305-319` | Reject if `request.headers.get('content-length') > N`; or guard `csvText.length > 10MB`. |
| P1-11 | MIME not validated server-side on photo uploads | `app/(admin)/admin/submit/SubmitClient.tsx:301-304` (client only) | Magic-byte check via `sharp` before upload (overlap with P1-7 fix). |
| P1-12 | Signup leaks `code: EMAIL_EXISTS` (enumeration) | `app/api/auth/signup/route.ts:72-76`, `lib/auth/signup.ts:133-138` | Drop `code` discriminator; return generic 422 with no field-level hint. |
| P1-13 | Restaurant name → email subject without newline sanitization | `lib/email/send.ts` send call sites | `subject.replace(/[\r\n\0]/g, ' ')` before passing to Resend. |
| P1-14 | No rate limit on signup / invite-accept / search / /invites/send | `app/api/auth/signup/route.ts`, `.../invite/accept/route.ts`, `.../search/route.ts`, `.../invites/send/route.ts` | Add `@upstash/ratelimit` per-IP rate limit at each handler. |
| P1-15 | Security-critical libs unpinned (caret on `stripe`, `@supabase/ssr`, `@supabase/supabase-js`, `@stripe/stripe-js`, `jsonwebtoken`) | `package.json:43-49` (approx) | Pin exact versions; add `--frozen-lockfile` to CI. |
| P1-16 | Account deletion + data export endpoints absent (GDPR/CCPA) | none exist | `POST /api/account/delete` (anonymize PII, cancel subs, revoke certs), `GET /api/account/export` (JSON dump). |

---

### P2 — Track only (16 items)

- No MFA on billing/cert issuance — document as Phase 5 item.
- Lesson route doesn't gate on active subscription — `app/api/lesson/[lessonId]/route.ts:53`.
- Missing `payment_intent.canceled` handler (separate from refund/dispute coverage in P0-5).
- No CAPTCHA on signup/login/review submission.
- No alerting infrastructure (Sentry, log drains).
- No DPA documentation for Stripe/Resend/Mux/Mapbox/Supabase.
- No log retention policy documented.
- `reviews.allergen_context` may be GDPR Article 9 special-category health data — needs consent + retention policy at EU launch.
- AV/content scanning absent on uploads.
- `stripe_events` lacks `restaurant_id` — can't answer "which restaurant's webhook fired?" without joining via PI metadata.
- `.env.production` / `.env.staging` not in `.gitignore`.
- `STRIPE_CUSTOMER_PORTAL_URL` undocumented in `.env.example`.
- `MUX_TOKEN_ID/SECRET` soft-fail (`console.warn` instead of `throw`) at `lib/mux.ts:4-7`.
- Per-environment webhook-secret docs gap in `.env.example`.
- Old `signPlaybackUrl` helper at `lib/mux.ts:23-50` has wrong `sub` claim; deprecate or remove.
- No timeout on Stripe SDK calls in `charge-cert-fees` and `payment-intent`.
- Stripe SDK auth-error returns 402 instead of 500 (operator confusion).
- PDF download Supabase signed URL lacks `Content-Disposition: attachment` (UX, not security).
- `stripe_events` table no retention/purge cron — unbounded growth.
- Resend integration test uses invented mock, not recorded fixture.
- CSP unset (separate from B6.2 P1 — CSP requires its own tuning pass for Stripe/Supabase/Mux/Mapbox origins).
- Invite tokens stored cleartext (vs hashed) — acceptable for short-lived service tokens, flag for paranoid posture.
- No `request.headers.origin` check on JSON POSTs — overlaps with P0-9.

---

## Step 4 — Threat Model Summary

### T1 — Verify-endpoint customer-base census
**Scenario:** Attacker iterates `AW-2026-000001..999999` against `/api/certs/[certCode]/verify`, harvesting every certified restaurant's name + dates + status. Sequential format = trivial enumeration; in <3 hours at 100 req/sec full census is complete.
**Actor:** Competing certification platform, market research firm, journalist. Motivation: market intelligence, growth-rate tracking, targeted outreach to expiry-soon restaurants.
**Today:** ISR cache (`revalidate=60`) reduces DB load. Response shape minimal (no PII beyond business name). RLS policy `certificates using(true)` (P0-3) is even worse — enables direct table scan via Supabase anon key, bypassing the verify route entirely.
**Gap:** No rate limit. Sequential enumerable cert format. Cf. P0-3, P0-10.

### T2 — Forged certificate via cert-code prediction or RLS row leak
**Scenario:** (a) Restaurant predicts `AW-2026-000047` will be issued to them, prints the QR code in advance, displays it before paying. Once issued, scans verify as active even though no payment was completed. (b) Attacker reads the full `certificates` table via the broken RLS policy, harvests valid cert codes belonging to other restaurants, prints them and displays them in an uncertified location.
**Actor:** Restaurant unwilling to pay for full training. Motivation: cost reduction, competitive advantage in directory.
**Today:** DB unique constraint on `cert_code`, server-side ownership check on `exam_attempts.profile_id`. Verify endpoint shows the certified restaurant's name, so a forged display would only verify against another restaurant's identity.
**Gap:** Sequential predictability + the cert-issued-before-payment defect (P0-6) means a cert can exist as active with no payment trail. The display-the-wrong-name issue is the only mitigation today, and depends on the diner actually checking the verify page.

### T3 — Cross-tenant data leak via the broken RLS policy
**Scenario:** Authenticated user (any tenant) calls `supabase.from('certificates').select('*')` from the browser. Receives every cert row in the system: profile UUIDs, restaurant UUIDs, Stripe PI IDs, PDF storage paths, fee amounts. Joins against `profiles` and `restaurants` to reconstruct the full customer + employee map.
**Actor:** Malicious admin / former employee with stale credentials. Motivation: exfiltrate competitor employee lists, reverse-engineer pricing, harvest Stripe metadata for chargeback fraud.
**Today:** None for the `certificates` table specifically — `using (true)` makes this query return all rows. Other tenant tables have correct policies.
**Gap:** P0-3. The policy must be deleted; the verify route already uses service-role and doesn't need it.

### T4 — Session theft via XSS + no `httpOnly` cookie
**Scenario:** Stored XSS lands in `lesson.bodyMd` (today's vector requires DB write access; tomorrow's vector lands when an admin content editor is built). Payload reads `document.cookie`, exfils Supabase auth token, attacker assumes the victim's session.
**Actor:** Insider with content-write access (today); external attacker after a future admin content surface ships (tomorrow).
**Today:** `lesson.bodyMd` is seeded from JSON files in repo, not user-writable. So today the attack requires a malicious commit. The XSS sink (`dangerouslySetInnerHTML` + custom non-escaping `inlineFormat`) is real and the cookie is JS-readable.
**Gap:** P0-7 (sanitize) + P0-8 (HttpOnly). Both must land before any user-content surface goes live.

### T5 — Refund-driven cert validity drift
**Scenario:** Restaurant pays, gets certified, files a chargeback with their bank 30 days later. Stripe fires `charge.dispute.created`. Webhook hits `default:` case, returns 200 with no state change. Cert remains active. Restaurant continues displaying it; verify endpoint confirms `status: active`. Stripe pulls the funds; restaurant has paid $0 and remains certified indefinitely.
**Actor:** Restaurant operator gaming the system. Motivation: keep the certification badge without the payment.
**Today:** Nothing. The webhook ignores all dispute and refund events. No reconciliation cron exists.
**Gap:** P0-5. Directly violates a non-negotiable from CLAUDE.md ("Refunds / chargebacks / cancellations invalidate certs").

---

## Step 5 — Verdict

**Ready for UI handoff: NO** — backend has 11 P0 items including 2 production-blocking functional defects (no learner ever receives a cert PDF; no restaurant can ever submit for review), 2 broken RLS policies, a missing-by-policy chargeback handler, and CSRF/XSS/cookie-hardening gaps that will compound the moment any user-content surface ships. Fix the P0 list, retest the full pilot loop end-to-end with real Stripe + Resend keys, then re-run this audit before designer handoff.
