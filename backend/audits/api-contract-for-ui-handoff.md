# AllergenWise — API Contract for UI Handoff

**Date:** 2026-05-11
**Source of truth:** handler code on `main` (not docstrings or planning docs).
**Scope:** every HTTP route under `app/api/**`.
**Audience:** the designer/UI engineer building the four role surfaces.
**Companion docs:**
- `CONTEXT.md` — product + design-system orientation
- `design-system/allergenwise/MASTER.md` — locked design system
- `audits/backend-security-handoff-RE-AUDIT-2026-05-11.md` — backend audit
- `audits/cert-payment-state-design.md` — cert state machine (Wave 2C)
- `audits/cert-code-redesign-plan.md` — cert-code format (Wave 4B)
- `audits/p1-16-gdpr-design.md` — GDPR deletion + export design

> This is the API as of **2026-05-11**. New endpoints or shape changes need
> explicit coordination, not improvisation.

---

## Designer onboarding

### 1. Design system is locked

`design-system/allergenwise/MASTER.md` is the source of truth for tokens,
typography, colors, spacing, severity language, and the six allergen-UX
rules. **Read it before drafting any surface.** `tailwind.config.ts` is the
implementation copy.

### 2. Teal-only color rule (CONTEXT.md non-negotiable)

All UI work defaults to teal palettes — Tailwind `teal-50 → teal-900` or
hex `#14b8a6` / `#0d9488` / `#0f766e`. **Do not** propose cyan, emerald,
blue, or hospitality-flavored palettes. Only deviate when explicitly asked.

### 3. `ui-ux-pro-max` skill usage rules

- ✅ Use **domain searches** for pattern lookup:
  `python3 .claude/skills/ui-ux-pro-max/scripts/search.py "<query>" --domain ux|style|landing|chart`
- ❌ **Never run `--design-system --persist`.** That will overwrite the
  locked MASTER and lose every AllergenWise-specific rule.
- ❌ Never use the skill on **legal / disclaimer / regulatory copy**
  (verify-page disclaimers, certificate legal text, "may contain" allergen
  labeling). Those need domain research, not pattern search.

### 4. Cert code format (Wave 4B)

- Format: `AW-XXXXX-XXXXX-C` (14 chars including the two `-` separators).
- Body: 10 Crockford Base32 chars (`0–9 A–Z`, omitting `I L O U`).
- Check digit: ISO 7064 Mod 37,36, single character.
- 50 bits of entropy. Backed by `crypto.randomBytes(7)`.
- **Input is case-insensitive.** Lowercase + spaces/hyphens-as-separators
  normalize to the canonical form before validation: `aw xj4t8 q9m2k 5`
  → `AW-XJ4T8-Q9M2K-5`.
- Validation lives in `lib/learner/cert-code.ts:validateCertCode`. Reuse it
  if you build any client-side input field.

### 5. Cert states (Wave 2C)

Internal table = **5 states**: `pending`, `active`, `expired`, `revoked`,
`disputed`. Public verify endpoint = **4 visible statuses + 1 throttle
state** (see `Public verification endpoint` section). `disputed` maps to
`revoked` publicly — never surface "disputed" to a diner.

| State | Public verify | Diner sees | Admin/learner sees |
|---|---|---|---|
| `pending` | `not_found` | nothing | "Awaiting payment by admin" |
| `active` | `active` | green badge | full cert + PDF |
| `expired` | `expired` | "Expired" | "Retake to renew" |
| `revoked` | `revoked` | "Revoked" | reason: refund/dispute_lost/admin |
| `disputed` | `revoked` *(masked)* | "Revoked" | "Disputed — under review" |

### 6. GDPR deletion + export flow shape

- **Deletion is two-phase:** `request-deletion` (issues a 24h single-use
  token, emails the user a confirm link) → `confirm-deletion` (requires
  both the live session AND the token).
- **Token TTL:** 24 hours. Single-use. After use or expiry: every confirm
  attempt returns **410 Gone** with a generic message that does NOT reveal
  whether the token was expired, used, or never existed.
- **Cancel:** `cancel-deletion-request` voids all outstanding tokens for
  the caller's account.
- **Export:** `GET /api/account/me/export` returns a JSON blob (Art. 15 +
  20) with `Content-Disposition: attachment` and a self-documenting
  `schema` block.
- **Sole-admin warning:** the request-phase response carries a
  `warnings: string[]` field. UI must surface these inline *before*
  the user submits the confirmation form. They do NOT block deletion.

### 7. Rate-limit conventions (shared across endpoints)

Every rate-limited endpoint returns a **byte-identical** 429 body:
```json
{ "error": "rate_limited" }
```
…or, on the verify endpoint:
```json
{ "valid": false, "status": "rate_limited" }
```
Headers: `Retry-After: 60`, `Cache-Control: no-store`. On Redis outage:
**fail-closed 503** with the same headers + a `{ "error": "unavailable" }`
or `{ "valid": false, "status": "unavailable" }` body. The UI should
treat 429 and 503 identically from the user's perspective: "Try again in
a minute." Do not surface internal limit shapes (per-IP vs per-account
etc.) to the user — that's an enumeration leak.

---

## Conventions

- All bodies are JSON unless noted (`/api/admin/csv-upload` dry-run is
  `multipart/form-data`; `/api/admin/upload-photo` is `multipart/form-data`).
- All responses are JSON unless noted (`/api/account/me/export` is also
  JSON but with `Content-Disposition: attachment`).
- All authenticated routes verify the session via
  `createServerSupabase().auth.getUser()` AND re-read role from
  `profiles` (never trust JWT claims alone).
- Service-role DB writes everywhere row-mutating; user-role-JWT
  writes have been retired (Wave 2A).
- Validation is Zod where the body is structured.
- All cron routes are `GET` + `Authorization: Bearer ${CRON_SECRET}`.
- All Stripe-internal server-to-server routes use `x-internal-secret:
  ${CRON_SECRET}` (NOT a bearer header).
- The Stripe webhook uses `Stripe-Signature` HMAC.
- 4xx error bodies all have the shape `{ error: string, ...optional }`.
- The IP hashing pepper `RATELIMIT_IP_PEPPER` is global — same value
  feeds every per-IP limiter across endpoints.

---

## Learner surface

### `POST /api/exam/start`
- **Auth:** authenticated, `role='learner'`
- **Body:** none
- **200 success:**
  ```ts
  {
    attemptId: string;         // uuid
    questions: Array<{
      id: string;              // uuid
      question: string;
      options: Array<{ id: string; text: string }>;   // no `correct` field
    }>;
    startedAt: string;         // ISO-8601
    timeLimitSeconds: 1800;    // 30 minutes
    attemptNumber: number;
  }
  ```
- **Errors:**
  - `401 { error: 'Unauthorized' }`
  - `403 { error: 'Forbidden: learner role required' }`
  - `403 { error: 'You must complete all 5 modules before taking the exam.' }`
  - `409 { error: 'You already have an active exam attempt.', attemptId }`
  - `403 { error, retryAvailableAt? }` (cooldown / max-attempts)
  - `500 { error: 'Failed to start exam attempt' }`
- **Rate limit:** none (anti-cheat covered by cooldown logic).
- **Consumed by:** learner.

### `POST /api/exam/submit`
- **Auth:** authenticated, `role='learner'`
- **Body:**
  ```ts
  { attemptId: string; answers: { [questionId: string]: optionId } }
  ```
- **200 success:**
  ```ts
  {
    passed: boolean;
    scorePercent: number;        // 0–100, integer
    certCode?: string;           // present on pass (AW-XXXXX-XXXXX-C)
    retryAvailableAt?: string;   // ISO-8601, present on fail
  }
  ```
  On pass, cert is inserted in `status='pending'` (NOT yet visible to
  the public verify endpoint). PDF is rendered later by the cert-fee
  payment webhook.
- **Errors:** 400 invalid body • 401 • 403 (not your attempt) • 404
  (attempt or profile not found) • 409 (already submitted) • 500
- **Rate limit:** none (server enforces cooldown, time-limit, single
  active attempt).
- **Consumed by:** learner.

### `GET /api/lesson/[lessonId]`
- **Auth:** authenticated, `role` ∈ `{learner, admin}`
- **Path params:** `lessonId` uuid
- **200 success:**
  ```ts
  {
    lesson: {
      id, title, bodyMd, muxPlaybackId,
      videoDurationSeconds, moduleId, orderIndex,
      quickCheckQuestion, quickCheckOptions
    };
    module: { id, title, orderIndex, estimatedMinutes };
    lessons: Array<{ id, title, orderIndex, status }>;  // outline
    progress: { status, watchedSeconds } | null;
    prevLessonId: string | null;
    nextLessonId: string | null;
  }
  ```
- **Errors:** 400 invalid uuid • 401 • 403 (locked module / wrong role)
  • 404 (lesson/module not found)
- **Consumed by:** learner.

### `POST /api/lesson/[lessonId]/complete`
- **Auth:** authenticated, `role` ∈ `{learner, admin}`
- **Path params:** `lessonId` uuid
- **Body:** none
- **200 success:** `{ ok: true, status: 'complete', justCompleted: boolean }`
- **Errors:** 400 • 401 • 403 (role / locked module) • 404 (lesson / module)
  • 500
- **Notes:** hard-mark (no anti-cheat watch-time check). Lock-check still
  applies.
- **Consumed by:** learner.

### `POST /api/lesson/progress`
- **Auth:** authenticated, `role='learner'`
- **Body:**
  ```ts
  { lessonId: string /* uuid */; watchedSeconds: number /* 0..86400 */ }
  ```
- **200 success:**
  ```ts
  { ok: true; status: LessonStatus; watchedSeconds: number; justCompleted: boolean }
  ```
- **Errors:** 400 • 401 • 403 (role / locked module) • 404
  • **422** `{ error: 'Watch time exceeds elapsed time. Possible cheat attempt rejected.' }`
  • 500
- **Notes:** monotonic — `watched_seconds = max(existing, body)`. Auto-marks
  `complete` at ≥90% of `video_duration_seconds`.
- **Consumed by:** learner.

### `GET /api/learner/certificate`
- **Auth:** authenticated, `role='learner'`
- **200 success:**
  ```ts
  {
    certCode: string;       // AW-XXXXX-XXXXX-C
    issuedAt: string;       // ISO-8601
    expiresAt: string;      // ISO-8601
    pdfUrl: string | null;  // 1-hour signed URL
    profileName: string;
    restaurantName: string;
  }
  ```
- **Errors:** 401 • 403 (not learner) • **404** `{ error: 'No certificate found' }`
  (no `status='active'` cert exists — could mean none earned, or only
  pending/expired/revoked) • 500
- **Notes:** returns the most recent **active** cert only. Pending /
  expired / revoked / disputed do not surface here.
- **Consumed by:** learner.

### `GET /api/learner/home-data`
- **Auth:** authenticated, `role='learner'`
- **200 success:**
  ```ts
  {
    modules: Array<{
      id; title; orderIndex; estimatedMinutes;
      lessons: Array<{
        id; title; orderIndex;
        status: 'locked' | LessonStatus;
        watchedSeconds; totalSeconds;
      }>;
      status: 'locked' | 'not_started' | 'in_progress' | 'complete';
      completedCount; totalCount;
    }>;
    examUnlocked: boolean;
    certificate?: {                // only when an active cert exists
      certCode; issuedAt; expiresAt; pdfUrl: string | null;
    };
  }
  ```
- **Errors:** 401 • 403 • 500
- **Notes:** the page should distinguish "cert in pending state" from
  "no cert" itself by reading exam-attempt history — this route only
  shows publicly-active certs.
- **Consumed by:** learner.

---

## Admin surface

### `POST /api/admin/upload-photo`
- **Auth:** authenticated, `role='admin'`, must have `restaurant_id`
- **Body:** `multipart/form-data` with one file field named `photo`
- **Limits:** 5 MB. Content-Length pre-check + post-buffer recheck. MIME
  validated from actual bytes via `sharp().metadata()`. Accepts
  `jpeg / png / webp` only. EXIF stripped via `sharp(...).rotate()`.
- **200 success:** `{ storagePath: string; contentType: string; bytes: number }`
- **Errors:**
  - `400 { error: 'Invalid multipart body' | 'Missing photo field' }`
  - `401 { error: 'Unauthorized' }`
  - `403 { error: 'Forbidden: admin role required' }`
  - `413 { error: 'Payload too large', maxBytes: 5242880 }`
  - `415 { error: 'Unsupported media type' }`
  - `422 { error: 'Invalid image', detail? }`
  - `500 { error: 'Upload failed', detail? }`
- **Consumed by:** admin (restaurant submission flow).

### `POST /api/admin/csv-upload`
- **Auth:** authenticated, `role='admin'`, must have `restaurant_id`
- **Modes (query):**
  - default (no `commit`): **dry-run**. Body = `multipart/form-data` with
    `file` (CSV). Parses, validates, dedupes, stores draft for 1 hour.
  - `?commit=true&uploadId=<uuid>`: **commit**. Body = JSON / empty.
    Creates auth users + profiles + invite tokens, sends emails in
    chunks of 50/sec.
- **CSV columns:** `email`, `fullName` (or `full_name` / `full name`),
  `jobRole` (or `job_role` / `job role`). ≤200 rows.
- **200 success (dry-run):**
  ```ts
  {
    uploadId: string | null;          // null when 0 validRows
    validRows: Array<{ email; fullName; jobRole }>;
    errors: Array<{ row; column?; message }>;
    duplicatesSkipped: number;
    totalParsed: number;
  }
  ```
- **422 (dry-run, structural errors):** same shape but `validRows: []`.
- **200 success (commit):**
  ```ts
  {
    committed: number;
    failed: Array<{ email; error }>;
    uploadId: string;
  }
  ```
- **Errors:** 400 (invalid uploadId, missing file, parse failure) • 401
  • 403 • **404** (draft not found / expired-via-DB) • **410** (draft
  expired by 1h TTL — `?commit` only) • 500
- **Rate limit:** none beyond the 50/sec self-throttle on Resend.
  ⚠️ **P1-10 still open:** body is buffered before size check.
- **Consumed by:** admin.

### `GET /api/admin/dashboard-stats`
- **Auth:** authenticated, `role='admin'`, must have `restaurant_id`
- **200 success:**
  ```ts
  {
    employeesTotal: number;
    certifiedCount: number;       // status='active' AND expires_at > now
    inProgressCount: number;      // accepted_at set, not certified
    daysUntilPlanEnds: number | null;
    certReadinessPct: number;     // 0–100
    pendingInvites: number;
    recentActivity: Array<{
      id: string;
      type: string;               // activity_events.type vocabulary
      actorId: string | null;
      actorName: string | null;
      payload: Record<string, unknown> | null;
      createdAt: string;
    }>;                           // last 10
  }
  ```
- **Errors:** 401 • 403 • 500
- **Consumed by:** admin.

### `GET /api/admin/roster`
- **Auth:** authenticated, `role='admin'`, must have `restaurant_id`
- **200 success:**
  ```ts
  {
    roster: Array<{
      profileId; fullName; email; jobRole;
      modulesComplete; totalModules;
      status: 'invited' | 'in_progress' | 'certified';
      startedAt: string | null;
      certCode: string | null;        // only when active cert
      lastActivityAt: string | null;
      invitedAt: string | null;
      acceptedAt: string | null;
    }>;
  }
  ```
- **Errors:** 401 • 403 • 500
- **Consumed by:** admin.

### `POST /api/invites/send`
- **Auth:** authenticated, `role='admin'`, must have `restaurant_id`
- **Body:**
  ```ts
  { email: string; fullName: string /* 1..200 */; jobRole: string /* 1..100 */ }
  ```
- **201 success:**
  ```ts
  { inviteId: string; email: string; warning?: string }
  ```
- **Errors:** 400 (invalid body) • 401 • 403 (role) •
  **409** `{ error: 'An invite for this email is already pending. Use /api/invites/remind to resend.' }` •
  **409** `{ error: 'An employee with this email has already accepted their invitation.' }` •
  500
- **Rate limit (P1-14):**
  - Per-IP: 10/min, runs **before** auth.
  - Per-restaurant: 20/min, runs **after** auth.
  - 429 + `Retry-After: 60` + `Cache-Control: no-store` with body
    `{ error: 'rate_limited' }`.
  - 503 fail-closed on Redis throw, body `{ error: 'unavailable' }`.
- **Consumed by:** admin.

### `POST /api/invites/remind`
- **Auth:** authenticated, `role='admin'`, must have `restaurant_id`
- **Body:** `{ profileId: string /* uuid */ }`
- **200 success:** `{ ok: true }`
- **Errors:** 400 (invalid body / target not learner) • 401 • 403 (role
  / cross-restaurant) • 404 (employee not found) •
  **409** (already accepted • or no pending token — caller should use
  `/api/invites/[id]/resend`) • 500
- **Notes:** does NOT generate a new token. Uses the existing
  `profiles.invite_token`.
- **Consumed by:** admin.

### `POST /api/invites/[id]/resend`
- **Auth:** authenticated, `role='admin'`, must have `restaurant_id`
- **Path params:** `id` = target profile uuid
- **Body:** none
- **200 success:** `{ ok: true }`
- **Errors:** 400 (invalid uuid / not learner) • 401 • 403 (role /
  cross-restaurant) • 404 • 409 (already accepted) • 500
- **Notes:** **rotates** `invite_token` and `invited_at`. Use this when
  the original link was lost or compromised.
- **Consumed by:** admin.

### `POST /api/submissions/create`
- **Auth:** authenticated, `role='admin'`, must have `restaurant_id`
- **Body:**
  ```ts
  {
    cuisine: string;                                       // 1..60
    allergenSpecialties: AllergenSpecialty[];              // see below
    heroPhotoStoragePath: string;                          // 1..500 — from /api/admin/upload-photo
    about?: string;                                        // ≤2000
    hoursJson?: Partial<Record<'mon'|...|'sun', { open: 'HH:MM'; close: 'HH:MM' }>>;
  }
  ```
  `AllergenSpecialty` ∈ `peanut_free | tree_nut_aware | dairy_free |
  gluten_free_menu | egg_free | soy_free | fish_free | shellfish_free |
  sesame_free`.
- **201 success:**
  ```ts
  { submissionId: string; certFeeTotalCents: number; stripePaymentIntentId: string }
  ```
- **Errors:** 400 (body / no associated restaurant) • 401 • 403 (role)
  • **402** (cert-fee charge failed — restaurant status rolled back) •
  **422** `{ error, reasons, certifiedCount, totalLearners }` (eligibility)
  • 404 (restaurant not found) • 500
- **Notes:** triggers a server-to-server `POST /api/stripe/charge-cert-fees`
  for `$35 × certifiedCount`. Rolls back `restaurants.status` on charge
  failure. **Discrepancy: see "Discrepancies" section.**
- **Consumed by:** admin.

---

## Reviewer surface

### `GET /api/reviewer/queue`
- **Auth:** authenticated, `role='reviewer'`
- **200 success:**
  ```ts
  {
    submissions: Array<{
      id; restaurantId; restaurantName; restaurantCity; restaurantState;
      status: 'pending' | 'in_review';
      submittedAt: string;
      daysPending: number;
      certifiedCount: number;
      certFeeTotalCents: number | null;
    }>;
  }
  ```
- **Errors:** 401 • 403 • 500
- **Consumed by:** reviewer.

### `GET /api/reviewer/queue/[submissionId]`
- **Auth:** authenticated, `role='reviewer'`
- **Path params:** `submissionId` uuid
- **200 success:**
  ```ts
  {
    submission: {
      id; restaurantId; submittedBy; submittedAt; status;
      reviewerId; reviewerNotes; decidedAt;
      certFeeTotalCents; stripePaymentIntentId;
    };
    restaurant: { id, name, slug, cuisine, address, city, state, zip,
                  phone, website, about, status, listed_at,
                  listing_expires_at, created_at };
    roster: Array<{
      profileId; fullName; email; jobRole; acceptedAt;
      cert: { id; certCode; issuedAt; expiresAt;
              scorePercent: number | null; passed: boolean | null } | null;
    }>;
    autoChecks: { allCertified; allScoresPass; paymentValid; noPriorRejection };
  }
  ```
- **Errors:** 400 (invalid uuid) • 401 • 403 • 404 • 500
- **Consumed by:** reviewer.

### `POST /api/reviewer/queue/[submissionId]/decide`
- **Auth:** authenticated, `role='reviewer'`
- **Path params:** `submissionId` uuid
- **Body:**
  ```ts
  { action: 'approve' | 'reject' | 'request_info'; notes?: string /* ≤4000 */ }
  ```
- **200 success:** shape from `lib/reviewer/decide.ts:decideSubmission`,
  includes `emailQueued: boolean` so the UI can warn on send failure.
- **Errors:** 400 (invalid uuid / body / "not found" / "terminal state"
  / "invalid action") • 401 • 403 • 500
- **Notes:** ⚠️ **P1-2 still open** — RPC accepts `p_reviewer_id` without
  asserting the existing `reviewer_id` is NULL or matches the caller.
  Designer note: do not build UI affordances that imply "claim →
  exclusive lock" semantics until P1-2 closes.
- **Consumed by:** reviewer.

### `GET /api/reviewer/reviews/queue`
- **Auth:** authenticated, `role='reviewer'`
- **200 success:**
  ```ts
  {
    reviews: Array<{
      id; restaurantId; restaurantName; restaurantCity; restaurantState;
      restaurantSlug; authorName; authorEmail: string | null;
      rating: 1..5; body; allergenContext: string | null;
      status: 'pending'; createdAt; daysPending;
    }>;
  }
  ```
- **Errors:** 401 • 403 • 500
- **Consumed by:** reviewer.

### `POST /api/reviewer/reviews/[id]/decide`
- **Auth:** authenticated, `role='reviewer'`
- **Path params:** `id` = review uuid
- **Body:** `{ action: 'publish' | 'hide' }`
- **200 success:** `{ ok: true; status: 'published' | 'hidden' }`
- **Errors:** 400 (invalid uuid / body) • 401 • 403 • 404 • 500
- **Notes:** idempotent — re-decision to same status is a no-op.
- **Consumed by:** reviewer.

---

## Public / anonymous surface

### `GET /api/certs/[certCode]/verify`
*Documented in detail in the "Public verification endpoint" section
below — that section is **the** locked spec.*

### `GET /api/directory/[slug]`
- **Auth:** none (anonymous)
- **Path params:** `slug` (regex `^[a-z0-9-]+$`, 1..120)
- **200 success:**
  ```ts
  {
    id; slug; name; cuisine; address; city; state; zip; lat; lng;
    phone; website; heroPhotoUrl; about;
    hoursJson: Record<string, { open: string; close: string }> | null;
    allergenSpecialties: string[] | null;
    listedAt; listingExpiresAt;
    certifiedCount: number;          // status='active' only
    totalEmployees: number;          // role='learner' only
    avgRating: number | null;
    reviewCount: number;
    reviews: Array<{                 // up to 50 most recent published
      id; authorName; rating: 1..5; body;
      allergenContext: string | null; createdAt;
    }>;
  }
  ```
- **Errors:** **404** `{ error: 'Not found' }` (invalid slug, not listed,
  or listing expired) • 500 `{ error: 'Failed to fetch restaurant' }`
- **Cache:** `Cache-Control: public, s-maxage=60, stale-while-revalidate=300`
- **Consumed by:** public diner.

### `GET /api/search`
- **Auth:** none (anonymous)
- **Query params (all optional):**
  - `q` ≤200 chars (FTS first, ilike fallback if 0 hits)
  - `allergen[]` repeated up to 10 (e.g. `?allergen[]=peanut_free`)
  - `cuisine` ≤50
  - `zip` 5 digits (resolved via Mapbox if `NEXT_PUBLIC_MAPBOX_TOKEN` set;
    silently degrades to no geo filter otherwise)
  - `radiusMi` 1..100, default 25
- **200 success:** array of
  ```ts
  {
    slug; name; cuisine; city; state; lat; lng; heroPhotoUrl;
    allergenSpecialties: string[] | null;
    certifiedCount: number;       // status='active' only
    totalEmployees: number;       // role='learner' only
    listedAt: string | null;
    distanceMi: number | null;    // null when no geo
    avgRating: number | null;
    reviewCount: number;
  }
  ```
- **Errors:** 400 `{ error: 'Invalid search parameters', details }` •
  500 `{ error: 'Search temporarily unavailable' }`
- **Cache:** `Cache-Control: public, s-maxage=60, stale-while-revalidate=300`
- **Rate limit:** none today (read-only, no side-effect). Future P2.
- **Consumed by:** public diner.

### `POST /api/reviews/submit`
- **Auth:** none (anonymous)
- **Body:**
  ```ts
  {
    restaurantSlug: string;                 // ^[a-z0-9-]+$, 1..120
    authorName: string;                     // 1..100, trimmed
    authorEmail?: string;                   // optional, ≤255
    rating: 1..5;                           // integer
    body: string;                           // 50..2000, trimmed
    allergenContext?: string;               // ≤50
    hpField?: string;                       // honeypot — MUST be empty
  }
  ```
- **200 success:** `{ message: 'Your review is pending moderation' }`
- **Errors:** 400 (`Invalid JSON body` / `Validation failed`) • **404**
  `{ error: 'Restaurant not found' }` (slug not listed) • 500
- **Side-effects:** honeypot trip and rate-limit hit BOTH return
  **silent 200** with the identical "pending moderation" body. This is
  deliberate — UI must not surface a different message for these states.
- **Rate limit:** 1 review per IP per restaurant per 24h (table-backed,
  not Upstash). Silent-200 on hit.
- **Jitter:** 100–300ms random delay applied to all responses (timing
  oracle defense).
- **Consumed by:** public diner.

---

## Auth surface

### `POST /api/auth/signup`
- **Auth:** none (creates the account)
- **Body:**
  ```ts
  {
    restaurant: { name; address; city; state /* 2-letter */;
                  zip /* 5 or 9 digit */; phone; cuisine };
    admin: { fullName; email; password /* 8..72 */ };
    plan: 'quarterly' | 'semiannual';
  }
  ```
- **201 success:**
  ```ts
  { clientSecret: string; customerId: string;
    restaurantId: string; paymentIntentId: string }
  ```
- **Errors:** 400 (body / validation) • **409** `{ error, code:'EMAIL_EXISTS' }`
  ⚠️ **P1-12 still open — this discriminator leaks email-registered state.**
  • 422 `{ error, code:'AUTH_ERROR' }` • 502 `{ error, code:'STRIPE_ERROR' }`
  • 500
- **Rate limit (P1-14):**
  - Per-IP 10/min + per-email 5/min (key = `email.toLowerCase()`).
  - Format-validate before rate-limit (malformed traffic does not burn
    the victim's IP budget).
  - Byte-identical 429: `{ error: 'rate_limited' }` + `Retry-After: 60`
    + `Cache-Control: no-store`.
  - 503 fail-closed on Redis throw.
- **Consumed by:** public (signup form) → admin onboarding.

### `POST /api/auth/login`
- **Auth:** none
- **Body:** `{ email: string; password: string /* 1..72 */ }`
- **200 success:**
  ```ts
  {
    user: { id; email };
    role: 'learner' | 'admin' | 'reviewer';
    restaurantId: string | null;
  }
  ```
- **Errors:** 400 (`{ error: 'Invalid credentials.' }` — generic; no
  field-level hints) • 401 (generic) • 403 (`{ error: 'Account setup
  incomplete. Contact support.' }`) • 429 (Supabase Auth upstream
  brute-force throttle, surfaced faithfully)
- **Notes:** Supabase Auth manages the session cookie via `@supabase/ssr`.
  `HttpOnly; Secure (prod); SameSite=lax` enforced (P0 #8 fixed).
- **Consumed by:** all roles (admin/reviewer/learner).

### `POST /api/auth/logout`
- **Auth:** none required (session cookie cleared if present)
- **Body:** none
- **200:** `{ ok: true }` • **500:** `{ ok: false }`
- **Consumed by:** all roles.

### `GET /api/auth/session`
- **Auth:** session cookie required
- **200 success:**
  ```ts
  { user: { id; email; fullName };
    role: 'learner' | 'admin' | 'reviewer';
    restaurantId: string | null }
  ```
- **Errors:** 401 (`Not authenticated.`) • 403 (`Profile not found.`)
- **Consumed by:** all roles — client-side bootstrap for UI role state.

### `POST /api/auth/invite/accept`
- **Auth:** none — the token IS the auth
- **Body:**
  ```ts
  { token: string /* 1..100 */; password: string /* 8..72 */ }
  ```
- **200 success:** `{ redirectUrl: string }`
- **Errors:** 400 (invalid body) • **404** `{ error: 'Invite link is invalid.', code: 'not_found' }`
  • **410** `{ error, code: 'expired' | 'already_accepted' }`
- **Rate limit (P1-14):**
  - Per-IP 10/min + per-token-hash 5/min.
  - Token hashed (sha256, first 32 hex chars) before becoming the
    Redis key — raw token never lands in Redis keyspace.
  - Byte-identical 429 / 503 same as `signup`.
- **Consumed by:** invited learner.

---

## Account / GDPR surface (authenticated)

### `POST /api/account/me/request-deletion`
- **Auth:** authenticated (any role)
- **Body:** ignored (may be empty `{}` or absent)
- **201 success:**
  ```ts
  {
    requestedAt: string;          // ISO-8601
    expiresAt: string;            // ISO-8601, +24h
    warnings: string[];           // ONE entry per restaurant where this
                                  // user is sole admin AND that
                                  // restaurant has an active subscription
  }
  ```
- **Errors:** 401 • 404 (`{ error: 'Profile not found.' }`) •
  500 (token issuance failure)
- **Rate limit:** per-IP 5/hr + per-account 5/hr. Byte-identical 429 /
  503 (`Retry-After: 60`, `Cache-Control: no-store`).
- **Notes:** invalidates any prior outstanding deletion token for this
  account (stamps `used_at` with reason `superseded`). Always sends a
  fresh email with a fresh raw token.
- **Consumed by:** all roles (settings / profile UI).

### `POST /api/account/me/confirm-deletion`
- **Auth:** authenticated AND token must match this account
- **Body:** `{ token: string /* 1..200 */ }`
- **200 success:** `{ ok: true; deletedAt: string }`
- **Errors:** 400 (invalid JSON / body) • 401 • **410** `{ error: 'This
  confirmation link is invalid or has expired.' }` for ANY token failure
  (not_found / expired / used / mismatch — all map to the same generic
  message) • 500 (`Account deletion failed.`)
- **Rate limit:** per-IP 10/hr. Byte-identical 429 / 503.
- **Side-effects (one atomic Postgres tx):** hard-deletes the user's
  certificates / exam_attempts / lesson_progress / invites; nulls
  `invited_by` on invitees; nulls `actor_id` on retained cross-tenant
  `activity_events` rows and merges `{ actor_anonymized: true,
  anonymized_at }` into `payload`; anonymizes the user's `profiles` row;
  bans + blanks `auth.users` via the Supabase admin API; deletes the
  user's cert PDFs from Storage.
- **Consumed by:** all roles.

### `POST /api/account/me/cancel-deletion-request`
- **Auth:** authenticated
- **Body:** none
- **204 No Content** (always — idempotent).
- **Errors:** 401
- **Notes:** stamps `used_at` + `used_reason='canceled_by_user'` on every
  unused token row for this profile. Safe to call repeatedly.
- **Consumed by:** all roles.

### `GET /api/account/me/export`
- **Auth:** authenticated (any role)
- **200 success:** JSON body (Art. 15 + 20 portability blob) — see shape
  below. Headers:
  ```
  Content-Type: application/json; charset=utf-8
  Content-Disposition: attachment; filename="allergenwise-data-export-YYYY-MM-DD.json"
  Cache-Control: no-store
  ```
- **Errors:** 401
- **Rate limit:** per-IP 5/hr + per-account **1/hr** (heavy query).
  Byte-identical 429 / 503.
- **Body shape:**
  ```ts
  {
    schema: {
      version: 1;
      generatedAt: string;
      subject: { profileId: string; email: string };
      fields: { ... };               // self-documenting field notes
    };
    profile: { ... };
    certificates: Array<{
      id; certCode; status;          // 5-state internal
      issuedAt; expiresAt;
      restaurantId; examAttemptId;
      feeCharged_cents: number | null;
      pdfStoragePath: string | null;
    }>;
    examAttempts: Array<{
      id; startedAt; submittedAt; timeLimitSeconds;
      scorePercent; passed;
      answers: Array<{ questionId; selectedOptionId }> | null;
    }>;
    lessonProgress: Array<{ lessonId; status; watchedSeconds; completedAt }>;
    invitesSent: Array<{ inviteId; inviteeEmail; inviteeId; sentAt; acceptedAt }>;
    invitesReceived: Array<{ invitedAt; invitedBy; acceptedAt }>;
    activityEvents: Array<{ id; type; payload; createdAt; restaurantId }>;
  }
  ```
- **Consumed by:** all roles.

---

## Stripe / internal server-to-server

### `POST /api/stripe/payment-intent`
- **Auth:** authenticated `role='admin'`, must have `restaurant_id`. The
  body's `customerId` is cross-checked against the admin's restaurant's
  `stripe_customer_id` — mismatch returns 403.
- **Body:**
  ```ts
  {
    kind: 'plan' | 'cert_fee' | 'submission';
    amountCents: number;             // positive integer
    metadata?: Record<string, string>;
    customerId: string;              // must equal admin's restaurant's stripe_customer_id
  }
  ```
- **200 success (kind=plan):** `{ clientSecret; paymentIntentId }`
- **200 success (kind=cert_fee | submission):** `{ paymentIntentId; status }`
- **Errors:** 400 • 401 • 403 (role / customer mismatch) • **402**
  (no default PM / `requires_action` / customer deleted) • 500
- **Consumed by:** admin (Stripe Elements flow). UI may surface
  the 402 detail messages verbatim.

### `POST /api/stripe/charge-cert-fees` *(internal — not browser-callable)*
- **Auth:** `x-internal-secret: ${CRON_SECRET}` header
- **Body:**
  ```ts
  { restaurantId: string /* uuid */; certifiedCount: number /* ≥1 */;
    submissionId?: string /* uuid */ }
  ```
- **200 success:**
  ```ts
  { certFeeTotalCents: number; stripePaymentIntentId: string; status: 'succeeded' }
  ```
- **Errors:** 400 • 401 • 402 (no PM / deleted customer / requires_action
  / charge failed) • 404 (restaurant) • 502 (Stripe retrieve threw)
- **Consumed by:** `/api/submissions/create` (server-to-server only). The
  UI does NOT call this directly. Field names match the `submissions`
  columns (`cert_fee_total_cents`, `stripe_payment_intent_id`) the
  consumer writes them into.

### `POST /api/certs/generate` *(internal — not browser-callable)*
- **Auth:** `x-internal-secret: ${CRON_SECRET}` header
- **Body:** `{ certificateId: string /* uuid */ }`
- **200 success:** `{ pdfStoragePath; signedUrl: string | null; cached: boolean; warning? }`
- **Errors:** 400 • 401 • 404 (cert) • 500 (PDF / storage / missing
  joined data)
- **Consumed by:** webhook activation handler, not the UI.

### `POST /api/stripe/webhook` *(Stripe-only)*
- **Auth:** `Stripe-Signature` HMAC (verified against
  `STRIPE_WEBHOOK_SECRET`).
- **Body:** raw Stripe event (NOT JSON-parsed before signature check).
- **200:** `{ received: true, duplicate?: true }`
- **Errors:** 400 (missing/invalid signature) • 500 (DB write / unhandled
  exception in handler — Stripe retries)
- **Idempotency:** `stripe_events` table insert ON CONFLICT DO NOTHING
  before any side-effect.
- **Handles:** `payment_intent.succeeded | .payment_failed | .canceled`,
  `charge.refunded`, `charge.dispute.created | .closed | .funds_withdrawn
  | .funds_reinstated`, `customer.subscription.deleted`,
  `customer.updated`. Cert state transitions go through
  `lib/learner/cert-state.ts:transitionCert` with the R5/R6 carve-out in
  `STATE_MACHINE_EXCEPTIONS`.
- **Consumed by:** Stripe only.

---

## Cron surface (Vercel Cron only)

All cron routes are:
- **Method:** `GET`
- **Auth header:** `Authorization: Bearer ${CRON_SECRET}`
- **401 body:** `{ error: 'Unauthorized' }` for any failure of that
  header.
- **Success body:** `{ ok: true; processed: number; errors: string[] }`
  (or a variant with extra counters; see notes).
- **Error body:** `{ ok: false; processed: 0; errors: string[] }` with
  status 500.

Routes (all under `/api/cron/`):

| Route | Frequency | What it does |
|---|---|---|
| `digest-reviewer-queue` | daily 09:00 UTC | Counts pending+in_review submissions older than 24h; emails REVIEWER_EMAIL. |
| `exam-timeout-sweep` | every minute | Auto-fails abandoned exam attempts (started_at + time_limit + 30s grace < now). Batch 100. |
| `expire-certs` | daily 03:15 UTC | Flips `active → expired` for certs past `expires_at`; emits 30/14/7-day warning emails via `cert_warnings` dedupe table. |
| `expire-listings` | daily 03:00 UTC | Flips `restaurants.status='listed' → 'paused'` when `listing_expires_at < now`. |
| `expire-subscriptions` | daily 03:30 UTC | Flips `subscriptions.status='active' → 'expired'` and pauses restaurants with no other active subs. |
| `purge-stale-pending-certs` | daily 03:45 UTC | Hard-deletes pending certs older than `PENDING_CERT_TTL_DAYS` (default 14). |
| `weekly-admin-digest` | Mon 08:00 UTC | Per-admin cert-readiness + expiring-in-30 + pending-invites email. |

Consumed by: Vercel Cron. **Not** UI-visible — but the UI consumes the
**output** of these state transitions (`status='expired'`,
`status='paused'`, etc.).

---

## Public verification endpoint

> This is the **locked** spec for `/api/certs/[certCode]/verify`. The
> response shape MUST NOT grow without explicit coordination. The
> non-negotiable in `CLAUDE.md` reads: *"Public verification endpoint
> leaks nothing beyond Active/Expired/Revoked + restaurant name + issue
> date."*

### `GET /api/certs/[certCode]/verify`
- **Auth:** none (public anonymous). RLS bypassed via service-role
  client; the endpoint is the only legitimate public reader.
- **Path params:** `certCode` — case-insensitive on input, normalized to
  the canonical `AW-XXXXX-XXXXX-C` before validation.

### Locked response shape

The handler returns ONLY these five fields, never more:

```ts
{
  valid: boolean;
  status: 'active' | 'expired' | 'revoked' | 'not_found' | 'rate_limited';
  restaurantName?: string;     // present only on active/expired/revoked
  issuedAt?: string;            // ISO-8601, same
  expiresAt?: string;           // ISO-8601, same
}
```

**The response MUST NOT include:**
- profile name, profile id
- restaurant address / lat / lng / phone / city / state
- internal cert UUID, exam attempt id, exam scores
- `dispute_id`, `revocation_reason`, `fee_charged_cents`,
  `pdf_storage_path`, `stripe_payment_intent_id`
- whether the cert is `pending` or `disputed` internally

### Five public-visible statuses

| Status | Cause | Diner UI signal |
|---|---|---|
| `active` | internal `active` | green badge, certified |
| `expired` | internal `expired` | grey badge, "expired on …" |
| `revoked` | internal `revoked` OR `disputed` *(masked)* | red badge, "revoked" |
| `not_found` | unknown code, malformed format, OR internal `pending` *(masked)* | "Certificate not found." |
| `rate_limited` | per-IP (10/min) or per-code (5/min) hit | "Too many verifications. Try again in a minute." |

**`disputed` is INTERNAL-ONLY.** It exists for the admin dashboard
("Disputed — under review") but the public verify endpoint
deliberately maps it to `revoked` to protect the diner trust signal
during the Stripe dispute window. If the dispute resolves `won` /
`warning_closed`, the cert flips back to `active` and the same QR
URL is once again `active` — no PDF re-issuance, no customer comms.

**`pending` is also INTERNAL-ONLY.** Pending certs return
`not_found` from the verify endpoint (and zero restaurant name) so
that a learner who passed but whose admin hasn't paid is not yet
publicly discoverable.

### HTTP shapes

- **Active:** `200 { valid: true, status: 'active', restaurantName, issuedAt, expiresAt }`
- **Expired:** `200 { valid: false, status: 'expired', restaurantName, issuedAt, expiresAt }`
- **Revoked (or internally disputed):** `200 { valid: false, status: 'revoked', restaurantName, issuedAt, expiresAt }`
- **Not found (or malformed format, or pending):** `200 { valid: false, status: 'not_found' }`
- **Rate limited:**
  ```
  429 Too Many Requests
  Retry-After: 60
  Cache-Control: no-store

  { "valid": false, "status": "rate_limited" }
  ```
- **Rate limiter unreachable (fail-closed):**
  ```
  503 Service Unavailable
  Retry-After: 60
  Cache-Control: no-store

  { "valid": false, "status": "unavailable" }
  ```
  (Note: `"unavailable"` is the only status string that does NOT appear
  in the `VerifyStatus` union — it's only emitted on Redis-throw 503s.
  Client should treat it like `rate_limited` for UX purposes.)

### Caching

`export const dynamic = 'force-dynamic'` — the rate limiter has
authority on every external request. No CDN / ISR caching at this layer.

### Order of operations (load-bearing)

1. Format-validate via `validateCertCode` (no I/O — malformed traffic
   cannot drain the victim's per-IP window).
2. Per-IP rate-limit (10 / 60s sliding window over
   `sha256(ip + RATELIMIT_IP_PEPPER)[:16]`).
3. Per-code rate-limit (5 / 60s sliding window over the canonical
   cert code).
4. Service-role DB read.
5. Emit `cert_verify_latency` structured log line.

---

## Discrepancies between code and types/docs

> Each entry below is a real mismatch between the handler code and either
> its own docstring/types or another route's expectation. Flagged here so
> the designer doesn't build against a phantom contract, and so the next
> backend wave can close the issue.

1. **`/api/submissions/create` consumes a non-existent shape from
   `/api/stripe/charge-cert-fees`.** — **CLOSED 2026-05-11**
   - Was: `app/api/submissions/create/route.ts:228-235` read
     `chargeData.certFeeTotalCents` and `chargeData.stripePaymentIntentId`
     but the producer returned
     `{ paymentIntentId, status: 'succeeded', amountCents }`.
   - Fix: producer renamed to return the canonical
     `{ certFeeTotalCents, stripePaymentIntentId, status: 'succeeded' }`
     in commit `3f6fb9a` ("fix(P1): charge-cert-fees returns
     certFeeTotalCents + stripePaymentIntentId to match
     submissions/create consumer"). Red repro added in commit `4d8385d`.
     Producer-side rename only — consumer code unchanged because its
     destructured names already match the DB columns
     (`cert_fee_total_cents`, `stripe_payment_intent_id`).
   - Test: `tests/unit/charge-cert-fees-response-shape.test.ts` drives
     the route handler in-process and pins the new shape (positive
     assertion + negative assertion that the old field names are
     absent).

**Endpoints scanned with zero handler-vs-type discrepancy:** every other
route file. The widespread use of `as any` and `as unknown as T` casts in
this codebase is a TypeScript ergonomics workaround for a missing
`__InternalSupabase` declaration in `lib/types/db.ts`; the casts do not
indicate runtime mismatches against the documented contracts above.

---

API contract complete at audits/api-contract-for-ui-handoff.md. Endpoints documented: 44. Discrepancies: 0 (was 1, closed 2026-05-11).
