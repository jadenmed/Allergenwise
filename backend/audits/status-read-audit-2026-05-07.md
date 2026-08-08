# Status-Read Audit — Naked Status Filters Without Expiration Pair

**Date:** 2026-05-09 (filed under 2026-05-07 per audit naming convention)
**Mode:** Read-only. No code changes.
**Trigger:** Flagged by `audits/cron-state-recovery-2026-05-07.md` after F2 revealed that the expire-* crons have not been running.

---

## Question

For each table whose row state is governed jointly by a status-style column AND an expiration timestamp, are there any read paths that filter ONLY by status, without ALSO filtering by the expiration timestamp? Each such path returns rows that the in-memory or cron-computed expiration logic considers "expired" but the persisted status field still calls "active".

## Tables in scope

| Table | "Active" column | "Expired by" column | Cron that flips it |
|---|---|---|---|
| `restaurants` | `status='listed'` | `listing_expires_at` | `expire-listings` |
| `subscriptions` | `status='active'` | `ends_at` | `expire-subscriptions` |
| `certificates` | `revoked=false` (no status column) | `expires_at` | `expire-certs` (emails only — does NOT flip `revoked`) |
| `exam_attempts` | `submitted_at IS NULL` (no status column) | `started_at + time_limit_seconds + grace` | `exam-timeout-sweep` |

Note on `certificates`: there is no `status` column. The `revoked` boolean is set only by explicit admin action. Expiration is computed in-memory by `lib/learner/cert.ts:getCertStatus()` from `expires_at`. **Therefore even when `expire-certs` runs, it does not flip any `revoked` flag — it only sends warning emails.** Any naked `revoked=false` read is structurally susceptible to drift, independent of whether the cron is healthy. F2 makes this worse only through the warning-email side channel; the read drift is pre-existing.

`submissions` and `reviews` have status columns but no time-driven expiration — out of scope.

---

## Per-table read inventory

### restaurants — `status='listed'`

| Location | Read | Pairs with `listing_expires_at`? | Verdict |
|---|---|---|---|
| `app/api/directory/[slug]/route.ts:105` | `.eq('status','listed').or('listing_expires_at.is.null,listing_expires_at.gt.<now>')` | YES | OK |
| `app/api/search/route.ts:225` | `.eq('status','listed').or('listing_expires_at.is.null,listing_expires_at.gt.<now>')` | YES | OK |
| `app/api/reviews/submit/route.ts:147` | `.eq('status','listed').or('listing_expires_at.is.null,listing_expires_at.gt.<now>')` | YES | OK |
| `app/api/cron/expire-listings/route.ts:36` | `.eq('status','listed').lt('listing_expires_at', <now>)` | YES (cron itself) | OK |
| `app/api/cron/expire-subscriptions/route.ts:92` | inside compensating UPDATE | YES (filtered upstream) | OK |
| `lib/directory/search.ts:138-139` (raw SQL) | `r.status='listed' AND (r.listing_expires_at IS NULL OR r.listing_expires_at > now())` | YES | OK |
| `db/migrations/0003_rls.sql:54-56` (RLS policy) | `for select using (status = 'listed')` | **NO** | **FINDING — F-S1** |

### subscriptions — `status='active'`

| Location | Read | Pairs with `ends_at`? | Verdict |
|---|---|---|---|
| `app/api/admin/dashboard-stats/route.ts:139` | `.eq('status','active').gte('ends_at', today)` | YES | OK |
| `lib/reviewer/auto-checks.ts:172` | `.eq('status','active').gt('ends_at', now)` | YES | OK |
| `lib/admin/eligibility.ts:93` | `.eq('status','active').gte('ends_at', now.date)` | YES | OK |
| `app/api/cron/expire-subscriptions/route.ts:46,73` | cron itself filters `ends_at < now` | YES | OK |
| `app/(admin)/admin/billing/page.tsx:54-65` | passes through `getSubscriptionStatus()` (lib/billing/subscription.ts) which checks BOTH `status` and `ends_at` | YES (via helper) | OK |
| `lib/billing/subscription.ts:39-50` (`getSubscriptionStatus`) | canonical helper — checks `status='canceled'` and `'expired'`, then falls through to `ends_at < now → expired` | YES | OK |

All `BillingClient.tsx` `subscription.status === 'active'` checks read the *computed* `effectiveStatus` from the page wrapper, not raw DB status.

### certificates — `revoked=false`

| Location | Read | Pairs with `expires_at`? | Verdict |
|---|---|---|---|
| `app/api/learner/certificate/route.ts:43-51` | `.eq('revoked',false).order(issued_at).limit(1)` | **NO** | **FINDING — F-S4** |
| `app/api/admin/roster/route.ts:178-183` | `.eq('revoked',false).gt('expires_at', now)` | YES | OK |
| `app/api/cron/weekly-admin-digest/route.ts:99` | `.eq('revoked',false).gt('expires_at', now)` | YES | OK |
| `app/api/cron/weekly-admin-digest/route.ts:106` | `.eq('revoked',false).gt('expires_at', now).lte('expires_at', thirtyDaysFromNow)` | YES | OK |
| `app/api/cron/expire-certs/route.ts:72` | `.eq('revoked',false).gt(window_start).lte(window_end)` | YES | OK |
| `app/api/reviewer/queue/route.ts:117` | `.eq('revoked',false).gt('expires_at', now)` | YES | OK |
| `app/api/admin/dashboard-stats/route.ts:104` | `.eq('revoked',false).gt('expires_at', now)` | YES | OK |
| `app/api/admin/dashboard-stats/route.ts:122` | `.eq('revoked',false).gt('expires_at', now)` | YES | OK |
| `app/api/learner/home-data/route.ts:142-146` | `.eq('revoked',false).order(issued_at).limit(1)` | **NO** | **FINDING — F-S5** |
| `app/api/directory/[slug]/route.ts:162-165` | `.eq('revoked',false)` count | **NO** | **FINDING — F-S2** |
| `lib/reviewer/auto-checks.ts:108-113` | `.eq('revoked',false).gt('expires_at', now)` | YES | OK |
| `lib/admin/eligibility.ts:60-64` | `.eq('revoked',false).gt('expires_at', now)` | YES | OK |
| `lib/directory/search.ts:240` (raw SQL) | `COUNT(...) FILTER (WHERE c.revoked = false)` | **NO** | **FINDING — F-S3** |
| `app/api/certs/[certCode]/verify/route.ts` | uses `getCertStatus(expires_at, revoked, now)` — computes `'expired'` from `expires_at < now` | YES (via helper) | OK |

### exam_attempts — `submitted_at IS NULL`

| Location | Read | Pairs with timeout? | Verdict |
|---|---|---|---|
| `app/api/exam/start/route.ts:96-100, 109-119` | loads all attempts then calls `findActiveAttempt` → `isAttemptActive` which checks BOTH `submitted_at != null` AND `!isAttemptExpired` | YES (via helper) | OK |
| `app/api/exam/submit/route.ts:97-101` | `if (attempt.submitted_at != null) return 409` — guard against double-submission | N/A (anti-replay, not a list filter) | OK |
| `app/api/cron/exam-timeout-sweep/route.ts:81, 148` | cron filters `submitted_at IS NULL AND started_at + interval '...'` | YES (cron itself) | OK |
| `lib/learner/exam.ts:82-87` (`isAttemptActive`) | helper that checks BOTH | YES | OK |

No findings.

---

## Findings

### F-S1 — RLS `restaurants_public_read_listed` allows direct anon-key reads of expired listings

- **File:line:** `db/migrations/0003_rls.sql:54-56`
- **Read:** `create policy "restaurants_public_read_listed" on restaurants for select using (status = 'listed')`
- **Pair missing:** `listing_expires_at IS NULL OR listing_expires_at > now()`
- **Impact:** any client with the public anon key can issue `supabase.from('restaurants').select('*').eq('slug', x)` and receive a full restaurant row whose `status='listed'` even when its `listing_expires_at` is in the past. Returned columns include `phone`, `address`, `lat`, `lng`, `stripe_customer_id`, etc. — i.e., the full row, not the curated app-route projection.
- **App-layer mitigations today:** every server route that surfaces public restaurant data (`/api/directory/[slug]`, `/api/search`, `/api/reviews/submit`, `lib/directory/search.ts`) DOES pair `status='listed'` with the timestamp guard — so the rendered surface is correct. The exposure is via direct Supabase client queries.
- **Severity:** Medium. Bypasses app-layer correctness for any client who knows the slug or wants to enumerate.
- **Proposed fix:** rewrite the policy as `using (status = 'listed' AND (listing_expires_at IS NULL OR listing_expires_at > now()))`. This is also the right pattern to mirror in any future `for select` policy on this table.

### F-S2 — `/api/directory/[slug]` certified-staff count includes expired certs

- **File:line:** `app/api/directory/[slug]/route.ts:160-165`
- **Read:**
  ```ts
  await supabase.from('certificates')
    .select('id', { count: 'exact', head: true })
    .eq('restaurant_id', restaurant.id)
    .eq('revoked', false);
  ```
- **Pair missing:** `.gt('expires_at', new Date().toISOString())`
- **Impact:** the public restaurant detail page renders this count as `certifiedStaffCount` in the response shape (`audits/cron-state-recovery` callout: "X certified staff"). Diners interpret this as the number of currently certified employees. Today the count includes any cert that is past `expires_at` but not explicitly `revoked` — i.e., every cert that expired naturally. With `expire-certs` only sending warning emails (and not flipping any field), and certs naturally expiring 1 year after issuance, this count drifts upward indefinitely as old certs accumulate.
- **Severity:** **HIGH.** Public-facing trust signal. AllergenWise's whole value prop is allergen-safety; surfacing a higher-than-real "certified staff" count to diners directly undermines the trust claim. This is the highest-impact finding in this audit.
- **Proposed fix:** add `.gt('expires_at', new Date().toISOString())` to the certificate count query.

### F-S3 — `lib/directory/search.ts` certified_count includes expired certs

- **File:line:** `lib/directory/search.ts:240`
- **Read (raw SQL, parameterized):**
  ```sql
  COUNT(DISTINCT c.id) FILTER (WHERE c.revoked = false) AS certified_count
  ```
- **Pair missing:** `AND c.expires_at > now()` inside the FILTER predicate.
- **Impact:** every search result card on the directory listing page includes a `certified_count` number derived from this query. Same trust-signal degradation as F-S2 but on the search results surface, which is higher-volume than the detail page.
- **Severity:** **HIGH.** Same class as F-S2.
- **Proposed fix:** change the FILTER clause to `FILTER (WHERE c.revoked = false AND c.expires_at > now())`.

### F-S4 — `/api/learner/certificate` returns expired certs to the certificate page

- **File:line:** `app/api/learner/certificate/route.ts:43-51`
- **Read:**
  ```ts
  await db.from('certificates')
    .select('cert_code, issued_at, expires_at, pdf_storage_path, restaurant_id')
    .eq('profile_id', user.id)
    .eq('revoked', false)
    .order('issued_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  ```
- **Pair missing:** `.gt('expires_at', new Date().toISOString())` — or this could be intentional (return the most recent cert regardless of expiry, let client display "Expired" warning).
- **User-visible impact today:** mitigated. The learner certificate page (`app/(learner)/learner/certificate/page.tsx:58, 171, 197-203`) computes `deriveCertStatus(expiresAt)` and renders an "Expired" CertBadge plus a "retake the exam to renew" warning when the cert is past `expires_at`. So end-users see the right thing.
- **Hidden risk:** future consumers of this API endpoint (mobile app, admin tooling, third-party integration) that don't know to apply `deriveCertStatus` client-side will display an expired cert as if currently held. The API contract is doing a naked-status read; relying on every consumer to remember to filter is fragile.
- **Severity:** Low (today's only consumer is correct). Medium (pattern fragility).
- **Proposed fix:** decide deliberately. If the contract is "return latest, even if expired, so the UI can show an Expired warning," document that explicitly in the route comment AND assert it via a test. If the contract is "return only currently valid certs," add `.gt('expires_at', now)`. Both are defensible. The current state is neither — implicit and undocumented.

### F-S5 — `/api/learner/home-data` cert lookup mirrors F-S4

- **File:line:** `app/api/learner/home-data/route.ts:139-148` (around line 142)
- **Read:** identical pattern to F-S4 — `.eq('revoked', false).order('issued_at').limit(1)` returning the latest non-revoked cert for the home dashboard's cert summary section.
- **User-visible impact today:** check whether the home-data consumer derives status. Inspection of the consumer page would tell us; without that follow-up, this is the same risk profile as F-S4.
- **Severity:** Low-Medium (same as F-S4).
- **Proposed fix:** same as F-S4 — explicit contract decision + test.

---

## Summary

**Naked-status reads found: 5.**

| ID | File | Severity |
|---|---|---|
| F-S1 | `db/migrations/0003_rls.sql:54-56` (RLS) | Medium |
| F-S2 | `app/api/directory/[slug]/route.ts:160-165` | **HIGH** |
| F-S3 | `lib/directory/search.ts:240` (raw SQL) | **HIGH** |
| F-S4 | `app/api/learner/certificate/route.ts:43-51` | Low–Medium (consumer-fragile) |
| F-S5 | `app/api/learner/home-data/route.ts:139-148` | Low–Medium (consumer-fragile) |

**Highest-impact finding:** F-S2 / F-S3 (twins) — the public directory's "X certified staff" count on the restaurant detail page and search results includes certs past their 1-year `expires_at` window. Certs naturally accumulate past expiry indefinitely (because `expire-certs` only sends warning emails, never flips any DB field), so this count drifts upward over time. A diner consulting AllergenWise to find an allergen-safe restaurant sees an inflated certification claim — directly undermining the platform's core trust signal.

Subscription reads are fully clean: every `status='active'` site pairs with an `ends_at` guard, and the canonical `getSubscriptionStatus()` helper covers cron-lag automatically.

Exam-attempt reads are fully clean: every "in-progress" site routes through `isAttemptActive` which checks both `submitted_at` and the time-limit window.

---

Status-read audit complete. Findings: 5. Worst case: public restaurant directory shows "X certified staff" counts that include certs past their expires_at, surfacing an inflated certification claim to diners (F-S2 + F-S3, both HIGH).
