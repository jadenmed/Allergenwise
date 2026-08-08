# P1-16 — GDPR/CCPA Account Deletion + Data Export — Design Doc

**Date:** 2026-05-11
**Wave:** `wave-gate-p1-critical` (closes P1-9, P1-14, P1-16)
**Closes:** P1-16 from `audits/backend-security-handoff-2026-05-07.md` /
`audits/backend-security-handoff-RE-AUDIT-2026-05-11.md`
**Mode:** plan only — no code beyond stubs / SQL migration drafts until
this doc is reviewed and approved.

---

## Context (read before designing)

- AllergenWise is **not yet deployed**. Zero real users in production.
  This is the moment to install GDPR/CCPA primitives cleanly — no
  customer-comms churn, no migration of historical PII.
- Two endpoints are required to unblock EU/CA launch (Article 15 + 17 +
  20 of GDPR; §1798.105 + §1798.110 of CCPA):
  - `DELETE /api/account/me` — right to erasure (Art. 17).
  - `GET /api/account/me/export` — right to data portability +
    right of access (Art. 15 + 20).
- This wave composes with prior fixes:
  - Wave 2A established service-role-backed writes. Deletion + export
    MUST use service-role; user-role-JWT writes have been removed.
  - Wave 4B established the Upstash sliding-window + per-IP-hash
    rate-limit pattern. Deletion and export reuse the same library and
    key shape (no new lib added).
  - Wave 2C introduced the cert state machine. Cert deletion under
    GDPR has to interact with it cleanly — see (a).
- P1-8 (PII in logs) is OPEN. The deletion path is the FIRST surface to
  honor it: deletion logs MUST NOT contain the deleted user's email or
  full_name. The remaining P1-8 work covers the rest of the logging
  surface and is tracked separately.
- The Playwright test gate is 104/104. Anything we add must keep it.

---

## (a) OPEN QUESTION — Certificate deletion strategy

**The core trade-off:** GDPR says a controller must erase personal data
on request. The certificate row contains `profile_id` (PII linkage) and
attests *that a specific person was certified at a specific restaurant*.
The restaurant's audit trail has a legitimate interest in knowing "we
had N certified employees on date D" — but does not need to know *who*.

### Option A — Hard-delete all certificates belonging to this learner

- Delete every `certificates` row where `profile_id = <user>`.
- Aggregate count "this restaurant had N certified employees at time T"
  is **lost** at the row level. Restaurant directory cert counts shift
  by N immediately.
- PDF storage objects (`certificates/...`) are removed via service-role
  Storage delete.
- Every cert's `activity_events` history rows (Wave 2C vocabulary: 14
  cert-lifecycle event types) reference `certificate_id` in the payload,
  not as an FK. Those audit-trail rows survive but become orphans —
  cleanable later via a cron, but not critical because they no longer
  identify a person.
- **GDPR posture:** strict. Aligned with the strongest interpretation of
  Art. 17 ("erasure without undue delay").
- **Audit-trail loss:** real but bounded. The directory-side count of
  "certified employees" no longer reflects the deleted person's tenure.

### Option B — Anonymize `profile_id` on the certificate, retain the cert

- Set `certificates.profile_id` to a sentinel value (NULL is not
  allowed by the current `not null` constraint — would need a migration
  to make it nullable, or set to a fixed "anonymized" profile row).
- Cert row survives with its `cert_code`, `issued_at`, `expires_at`,
  `status`, `restaurant_id`. The verify endpoint continues to work.
- Aggregate count "N certified employees" survives. PDF files survive
  in storage but their `profile_id`-bearing payload contains the
  pre-deletion name, so they'd need to be regenerated with a redacted
  name OR deleted (PDFs are private-bucket signed-URL only, so leaving
  them in place with the old name is also defensible — they're not
  publicly enumerable).
- **GDPR posture:** weaker. The cert proves a person was certified;
  even with `profile_id` blanked, an attacker correlating cert codes
  to learner activity from another vector could re-identify.

### Recommendation: **Option A — hard-delete**

Reasons:

1. **GDPR strictness wins at the design stage.** AllergenWise is not yet
   deployed — there is no operational cost to choosing the strict
   posture now. Loosening later is a code change; tightening later
   requires a backfill + customer comms.
2. **Restaurant audit needs are met in aggregate, not row-level.** The
   restaurant has a legitimate interest in "how many certified
   employees do we have today" — that's `count(certificates where
   restaurant_id = X and status = 'active')` after deletion, which
   still reflects current state correctly. The historical "we had Y
   certified employees in March 2026" is a reporting need, not a
   compliance need, and we can satisfy it with an aggregate snapshot
   table populated by a monthly cron if it ever matters (out of scope
   for P1-16).
3. **Avoids storage-orphan management.** Option B leaves PDF blobs +
   activity_events rows referencing the deleted user; Option A deletes
   them cleanly.
4. **Avoids schema change.** Option B requires making
   `certificates.profile_id` nullable OR inventing a sentinel profile
   row — both have second-order effects (cert state machine assumes
   non-null profile_id; helpers throughout `lib/learner/cert-status.ts`
   assume it; null-handling spreads).
5. **The PDF in the diner's hands is unaffected.** A diner who scanned
   the QR and saved the verify URL still sees the old verify result
   *until* the cert is hard-deleted — and after deletion, the verify
   URL returns `not_found`, which is the right end-state for "this
   certification no longer exists." The verify endpoint never exposed
   the learner's name in the first place (CLAUDE.md non-negotiable —
   "leaks nothing beyond Active/Expired/Revoked + restaurant name +
   issue date"), so no learner-identifying info leaks via the verify
   surface at any point.

### Hidden constraint I surfaced while planning (NEW)

The schema today has `profiles.id uuid primary key references auth.users
on delete cascade` (db/migrations/0001_init.sql:62). And every
PII-bearing table (`exam_attempts`, `lesson_progress`, `certificates`,
`submissions`, `invites`) has `profile_id uuid not null references
profiles` (no `on delete` clause — defaults to `no action`).

**Consequence:** the prompt's stated behavior "hard-delete the auth user
record AND anonymize the profile" is contradictory under the current
schema. Deleting the auth user cascades to delete the profile, so
there's nothing left to anonymize. And the cascade fails (RESTRICT
implicit) if any FK-bearing row (exam_attempts, lesson_progress, certs)
still references the profile.

**Two coherent paths:**

**Path 1 — anonymize-in-place + ban auth user (recommended).** Do NOT
hard-delete `auth.users`. Instead:
- Use Supabase admin API to update `auth.users.email = 'deleted-' +
  uuid + '@deleted.invalid'`, blank `raw_user_meta_data`, set
  `banned_until` to `forever` (effectively dead login).
- Anonymize the `profiles` row in place: `full_name = '[deleted]'`,
  `email = 'deleted-' + uuid + '@deleted.invalid'`. Keep the row so
  the FK chain stays consistent — `exam_attempts`, `lesson_progress`,
  `invites` get hard-deleted (no PII linkage left), `certificates` get
  hard-deleted per Option A above.
- Effect: no PII remains on the user, no login is possible, no
  schema change required, FK chain remains valid.
- GDPR: anonymization satisfies Art. 17 when the data can no longer
  be linked to an identifiable person (Recital 26). The combination
  (blanked auth.email + blanked profile.full_name/email + deleted
  exam_attempts/lesson_progress/invites/certs) meets that bar.

**Path 2 — schema change + true hard-delete.** Migration to make every
`profile_id` FK `on delete set null`, then hard-delete the profile +
auth.user. Side effects: every existing service-role write site that
joins on profile_id needs null-safety review (`lib/learner/cert-status`,
`lib/learner/progress`, `lib/learner/exam`, multiple
`activity_events.actor_id` consumers). Riskier this close to handoff.

**Recommendation: Path 1.** Cheaper, no schema change, GDPR-compliant.
Path 2 is reserved for a future hygiene wave if regulators ever push for
literal row deletion (no European DPA I'm aware of has — Recital 26
anonymization has been accepted in case law).

**Path 1 also closes a chunk of P1-8 by construction:** the deletion
handler does not need to log the deleted user's name or email anywhere
because the only identifier the activity event references is the
post-anonymization placeholder.

---

## (b) Two-phase deletion token

### Why two-phase

A naked `DELETE /api/account/me` is a CSRF-style nightmare even with
the middleware's Origin/Referer check — a determined attacker who
phishes a single session cookie can erase the account. The two-phase
flow forces a confirmation against a possession-bound token sent
out-of-band (email), so the same-session-cookie attack alone is
insufficient.

It also protects against accidental clicks ("I tapped the wrong
button"). 24-hour grace + one explicit confirmation step is the
ServSafe-style discipline AllergenWise's audience expects.

### Token format

- **Algorithm:** `crypto.randomBytes(32)`, base64url-encoded → 43-char
  URL-safe string (256 bits of entropy). Far above any feasible
  brute-force budget against a 24h window.
- **Storage:** new `account_deletion_tokens` table:

```sql
create table if not exists account_deletion_tokens (
  id                uuid primary key default gen_random_uuid(),
  profile_id        uuid not null references profiles on delete cascade,
  token_hash        text not null,            -- sha256 hex of the issued token
  issued_at         timestamptz not null default now(),
  expires_at        timestamptz not null,     -- issued_at + 24h
  used_at           timestamptz,              -- null until confirm-phase consumes it
  ip_hash           text,                     -- requesting IP at issue time (for audit)
  unique (token_hash)
);
create index if not exists idx_deletion_tokens_profile
  on account_deletion_tokens (profile_id) where used_at is null;
```

- **Hashing at rest.** We store `sha256(token)`, not the token. An
  attacker with read-only DB access cannot replay tokens.
- **Single-use.** `used_at` flips on the first valid confirm; subsequent
  confirms with the same token return 410 Gone.
- **Time-bounded.** 24h. After expiry, confirm returns 410 Gone.
- **Per-profile uniqueness on outstanding tokens.** A new request
  invalidates any prior un-used token by stamping `used_at = now()`
  with a `revoked` audit reason — prevents stale tokens from
  accumulating + prevents an attacker who phished a token from
  keeping it warm while the user generates new ones.

### Flow

1. `POST /api/account/me` (request phase) — authenticated. Generates a
   token, inserts the hash, emails the user a `Account Deletion
   Confirmation` link of form `{APP_URL}/account/delete/confirm?token=<raw>`.
   Returns `201 { requestedAt, expiresAt }`. Body never contains the
   raw token (defense against accidental log capture).
2. User clicks the link. The page POSTs `DELETE /api/account/me/confirm`
   with `{ token }` in the body — authenticated session required (so a
   token phished alone, without the session, can't trigger deletion).
3. Confirm handler: hash the token, look up by hash, validate
   `used_at IS NULL`, `expires_at > now()`, `profile_id = current_user`.
   On success: run the deletion sequence in (a) Path 1.

### The "authenticated session required at confirm" decision

The token alone is *not* sufficient — the session must also be valid.
Why: pure-token confirm would mean an attacker who exfils the email
(via mail-server compromise, shoulder-surf, etc.) can delete the
account without ever holding the session. Requiring the session means
the attacker needs *both* (email-channel access AND a live session) —
genuine 2FA discipline for the destructive operation.

---

## (c) Export response shape

### Wrapper

```json
{
  "schema": {
    "version": 1,
    "generatedAt": "2026-05-11T18:42:00Z",
    "subject": {
      "profileId": "uuid",
      "email": "string"
    },
    "fields": { ... see schema fields below ... }
  },
  "profile": { ... },
  "certificates": [ ... ],
  "examAttempts": [ ... ],
  "lessonProgress": [ ... ],
  "invitesSent": [ ... ],
  "invitesReceived": [ ... ],
  "activityEvents": [ ... ]
}
```

Top-level `schema` block exists so the recipient (user or their lawyer)
can interpret the rest without a domain glossary. Treat it as
self-documenting JSON.

### Per-section shapes (each section omitted if no rows)

**`profile`**
```json
{
  "id": "uuid",
  "fullName": "Jane Doe",
  "email": "jane@example.com",
  "role": "learner" | "admin" | "reviewer",
  "jobRole": "server" | null,
  "restaurantId": "uuid" | null,
  "createdAt": "ISO-8601",
  "invitedAt": "ISO-8601" | null,
  "acceptedAt": "ISO-8601" | null
}
```

**`certificates`** (array)
```json
{
  "id": "uuid",
  "certCode": "AW-XXXXX-XXXXX-C",
  "status": "active" | "expired" | "revoked" | "disputed" | "pending",
  "issuedAt": "ISO-8601",
  "expiresAt": "ISO-8601",
  "restaurantId": "uuid",
  "examAttemptId": "uuid" | null,
  "feeCharged_cents": 3500 | null,
  "pdfStoragePath": "certificates/..." | null
}
```

**`examAttempts`** (array)
```json
{
  "id": "uuid",
  "startedAt": "ISO-8601",
  "submittedAt": "ISO-8601" | null,
  "timeLimitSeconds": 1800,
  "scorePercent": 88 | null,
  "passed": true | false | null,
  "answers": [ { "questionId": "uuid", "selectedOptionId": "string" } ] | null
}
```

**`lessonProgress`** (array)
```json
{
  "lessonId": "uuid",
  "status": "not_started" | "in_progress" | "complete",
  "watchedSeconds": 482,
  "completedAt": "ISO-8601" | null
}
```

**`invitesSent`** (array — for admin actors)
```json
{
  "inviteId": "uuid",
  "inviteeEmail": "string",
  "inviteeId": "uuid",
  "sentAt": "ISO-8601",
  "acceptedAt": "ISO-8601" | null
}
```

**`invitesReceived`** (array — populated when this profile was invited
by another)
```json
{
  "invitedAt": "ISO-8601",
  "invitedBy": "uuid",
  "acceptedAt": "ISO-8601" | null
}
```

**`activityEvents`** (array — every event where `actor_id = <user>`)
```json
{
  "id": "uuid",
  "type": "lesson_completed" | "exam_passed" | ... ,
  "payload": { ... event-specific ... },
  "createdAt": "ISO-8601",
  "restaurantId": "uuid" | null
}
```

### Response headers

```
Content-Type: application/json
Content-Disposition: attachment; filename="allergenwise-data-export-2026-05-11.json"
Cache-Control: no-store
```

`no-store` so a shared/family device's browser cache does not retain
the export between users.

---

## (d) Race condition: token in flight while user continues to use the system

**Scenario.** User clicks "Delete my account" at 12:00. Email is in
flight. User then logs in at 12:05, opens a lesson, marks it complete.
Email arrives at 12:10. User clicks the confirm link at 12:11.

**Decision.** The token works until used or expired, **regardless of
intervening activity.** The activity created between request and
confirm is also deleted by the confirm handler — the same SQL block
that wipes exam_attempts / lesson_progress wipes the 12:05 lesson too.
Documented in the email body: "Your account will be permanently
deleted, including any activity after this email was sent."

**Why not invalidate on activity.** Doing so means a phishing attacker
who plants a deletion request can be defeated by the legitimate user's
ordinary continued use of the site — which is *good*, but it's
inconsistent: if the user is on vacation and doesn't log in for 23
hours, no protection. Better to make the rule simple and explicit:
clicking confirm means delete-everything-including-recent-stuff. Users
who change their mind cancel via a separate `POST
/api/account/me/cancel-deletion-request` endpoint OR just let the
token expire after 24h.

**Edge case: user is an admin with active learners.** If an admin
deletes their account while still admin of a restaurant, the
restaurant's other admins / learners are unaffected — only the
deleting admin's profile + their activity disappear. If the deleting
admin is the **only** admin on the restaurant, the restaurant has no
admin role after deletion. Document this in the deletion-confirmation
email body so a sole admin understands the implication before
confirming. Out of scope to *prevent* it — making admins indelible by
fiat is a worse UX than asking them to add a co-admin first; the
deletion is the user's lawful right under GDPR.

---

## (e) Rate-limit defense

Three limiters wrap deletion + export. Reuse the Wave 4B pattern
(`@upstash/ratelimit` + `getClientIpHash`).

| Endpoint | Limiter | Limit | Key | Purpose |
|---|---|---|---|---|
| `POST /api/account/me` (request) | per-IP | 5 / hour | `rl:acct:del:req:ip:<ipHash>` | abuser hammering IPs |
| `POST /api/account/me` (request) | per-account | 5 / hour | `rl:acct:del:req:acct:<profileId>` | a malicious admin spamming deletion requests against their own account, or attacker who phished a single session |
| `DELETE /api/account/me/confirm` | per-IP | 10 / hour | `rl:acct:del:confirm:ip:<ipHash>` | brute-forcing token guesses (academic given 256-bit entropy, but defense in depth) |
| `GET /api/account/me/export` | per-account | 1 / hour | `rl:acct:exp:acct:<profileId>` | heavy query; legitimate use is rare |
| `GET /api/account/me/export` | per-IP | 5 / hour | `rl:acct:exp:ip:<ipHash>` | session-theft burst defense |

**Fail-closed on Redis throw → 503 + `Retry-After: 60`.** Same posture
as Wave 4B's verify endpoint. The cost of a fail-open here would be a
brief window in which deletion-request floods are possible; the
deletion itself still requires the email-channel token + session, so
the worst-case fail-open damage is "user gets 5 confirmation emails
they didn't ask for" — annoying, not catastrophic. Fail-closed
prevents even that.

**Configurable via env vars** (per OQ-7 from the Wave 4B plan —
per-route knobs, not a config blob):
- `RATELIMIT_ACCOUNT_DELETE_REQUEST_IP_PER_HOUR` (default 5)
- `RATELIMIT_ACCOUNT_DELETE_REQUEST_ACCT_PER_HOUR` (default 5)
- `RATELIMIT_ACCOUNT_DELETE_CONFIRM_IP_PER_HOUR` (default 10)
- `RATELIMIT_ACCOUNT_EXPORT_IP_PER_HOUR` (default 5)
- `RATELIMIT_ACCOUNT_EXPORT_ACCT_PER_HOUR` (default 1)

**Rate-limit-hit observability:** new activity event types
`account_deletion_requested`, `account_deletion_request_rate_limited`,
`account_deletion_confirmed`, `account_export_requested`,
`account_export_rate_limited`. Payloads contain `ip_hash` and
`profile_id` (post-anonymization placeholder for the deletion event —
NOT the original email/name; P1-8 alignment).

---

## (f) Test plan

### Unit tests

`tests/unit/account-deletion-token.test.ts`
- Generator produces 43-char base64url string.
- 10,000 successive tokens are unique.
- Hash function is deterministic and matches `sha256(token).hex`.
- `validateToken(rawToken, profileId)` returns `{ ok: true, tokenId }`
  for a fresh issued token, `{ ok: false, reason: 'expired' }` for a
  >24h-old token, `{ ok: false, reason: 'used' }` for a token whose
  `used_at` is set, `{ ok: false, reason: 'mismatch' }` when
  `profile_id` doesn't match.

`tests/unit/account-export-shape.test.ts`
- For a fully populated user, the export JSON validates against a
  schema fixture.
- For a user with no certs / no attempts / no invites, the
  corresponding arrays are present and empty `[]`.
- Top-level `schema` block has the documented fields.

`tests/unit/account-deletion-blast-radius.test.ts`
- Given a fixture user with N certs, M exam_attempts, K lesson_progress
  rows, L invites, the deletion plan (dry-run) identifies all rows
  correctly. (Pure-logic test against a service that lists the deletion
  blast radius before executing.)

### Integration tests

`tests/integration/account-delete-flow.test.ts`
- Happy path: request → token row inserted (hashed), email send invoked,
  confirm with token → all sub-tables wiped, profile anonymized,
  auth.user banned-and-blanked, activity event written *without* the
  deleted user's email or name in payload.
- Confirm with no session → 401.
- Confirm with session but wrong token → 410 + activity event
  `account_deletion_confirm_invalid` (NOT writing the token itself —
  hash already in DB).
- Confirm with expired token → 410.
- Confirm with already-used token → 410 (replay defense).
- Request twice in succession → second request invalidates the first
  token (stamps `used_at` with audit reason `superseded`).
- After deletion: subsequent `GET /api/learner/certificate` for any
  cert that *was* this user's returns 404 (the cert is gone).
- After deletion: the verify endpoint for any of the user's
  pre-deletion cert codes returns `not_found` (cert hard-deleted).
- After deletion: activity_events query by `actor_id = <oldProfileId>`
  returns 0 rows of identifying info; aggregate audit-trail rows
  belonging to the deleted user are wiped (NOT preserved — keeps the
  PII surface minimal).

`tests/integration/account-export-flow.test.ts`
- Happy path: authed user → 200 + correct JSON shape, schema block
  present, every PII section populated from real seed data.
- Empty-state path: brand-new user with only a profile → 200 +
  arrays empty.
- Wrong-user path: user A's session tries to export user B's data —
  there is no such endpoint surface (the export is always `me`), but
  test that authenticated A cannot via any param spoof read B's data.
- Headers: `Content-Disposition: attachment; filename="..."` is set;
  `Cache-Control: no-store` is set.

`tests/integration/account-delete-rate-limit.test.ts`
- 6th delete-request from same IP in 1 hour → 429 with
  `Retry-After: 60`.
- 6th delete-request for same account from 6 different IPs in 1 hour
  → 429.
- Byte-identical 429 for "account exists" vs "no such session" (a
  malformed-auth attempt should be rate-limited the same way).
- Fail-closed: Upstash mocked to throw → 503 + activity event
  `account_deletion_request_rate_limiter_down`.

`tests/integration/account-export-rate-limit.test.ts`
- 2nd export in 1 hour from same account → 429.

### Playwright e2e

`tests/e2e/account-deletion-flow.spec.ts`
- Real-browser end-to-end: signed-in user clicks "Delete account",
  receives email confirmation link (mocked Resend), clicks it, sees
  success page, attempts to log in → fails.
- Real-network 429 path: hammer the request endpoint to exceed the
  hourly cap, assert the UI renders the rate-limit message.

`tests/e2e/account-export-download.spec.ts`
- Real-browser end-to-end: signed-in user clicks "Download my data",
  browser receives a JSON file with the documented schema.

### Regression-guard tests

- Grep test: `account_deletion_*` activity event payloads MUST NOT
  contain raw `email` or `full_name` fields (string assertion against
  the test fixture's logged events).

---

## (g) Open sub-questions for review

### OQ-G1 — Should the deletion email re-confirm with the user's name?

The deletion confirmation email is being sent to a user who is *about
to be erased*. The natural template starts with "Hi {full_name}" so the
user trusts it isn't a phish. But the act of generating the email
constructs a body that contains PII — fine, because email-in-flight is
the user's own channel — but the *log line* the Resend client emits
(if logging the recipient + subject) re-introduces P1-8.

**Recommendation.** Use the full_name in the email body (UX +
phishing-defense win), but pipe through the existing `to:` email-mask
helper at the `send.ts` log site. This stays consistent with the broader
P1-8 fix and doesn't special-case this email.

### OQ-G2 — Cancellation endpoint

Should there be a `POST /api/account/me/cancel-deletion-request`?

**Recommendation.** Yes, lightweight. Authenticated user calls it; it
finds outstanding tokens for `profile_id = current_user`, stamps
`used_at = now()` with audit reason `canceled_by_user`. Returns
204. The UI offers a "Wait, I changed my mind" link on the
confirmation page that posts to it. Cost: one route handler, ~30
lines.

### OQ-G3 — Should the deletion handler null `actor_id` on every
`activity_events` row mentioning the deleted user, or hard-delete those
rows?

Per CLAUDE.md "multi-tenant boundary" + Path 1 rationale: **delete the
rows where `actor_id = <user>` belonging only to that user's actions.**
Where the row has cross-tenant value (e.g., `submission_approved`
where the deleted user was the reviewer, but the submission affected
a restaurant), keep the row but **null the `actor_id`**. Activity
events are admin-dashboard-visible; the row's existence is operationally
useful, but the actor identity is the PII.

Migration to make `activity_events.actor_id` nullable already holds
(`actor_id uuid references profiles` — no `not null`).

**Review modification (approved 2026-05-11):** when nulling `actor_id`
on a retained cross-tenant row, the deletion handler ALSO merges
`{ "actor_anonymized": true, "anonymized_at": "<ISO-8601>" }` into the
existing `payload` jsonb. Keeps the audit trail honest: a dashboard
reader sees "actor null + anonymized=true + timestamp" and understands
the row is post-deletion, not a row that simply never had an actor.
Five-line `jsonb || jsonb_build_object(...)` style update inside the
deletion sequence; covered by a new test in (f) asserting both the
null `actor_id` AND the augmented payload shape on a fixture row.

### OQ-G4 — Storage object deletion

PDFs in the `certificates` private bucket: hard-delete per cert via
service-role `storage.from('certificates').remove([path])` as the same
deletion handler removes the cert row. Storage delete is idempotent
(no-op on already-missing path).

CSV roster uploads in the `roster-uploads` private bucket: scope is
admin-only, and the path embeds `restaurant_id` not `profile_id`.
Decision: leave these in place. The CSV may contain other employees'
names — deleting them would erase data belonging to people who haven't
requested deletion. The restaurant's retention policy applies. Document
this in the deletion-confirmation email body: "Roster CSV uploads you
made remain stored for your restaurant's records."

**Review modification (approved 2026-05-11) — legal framing:** roster
CSV uploads belong to the **restaurant** (data controller), not to the
individual user (data subject). They are governed by the restaurant's
retention policy, not by individual deletion requests under Art. 17.
The user requesting deletion is acting in their personal capacity over
their personal data; CSV roster contents are restaurant-scoped business
records about other identified people. The user has no Art. 17 standing
over data they uploaded ABOUT others on behalf of a controller they did
not own. This framing is the legal basis for non-deletion and is
documented in the email body, the export schema's `schema.fields` notes,
and as a comment in the deletion handler so a future reader (or auditor)
sees the rationale.

---

## (g.bis) Review concerns — approved modifications 2026-05-11

### Concern 1 — Sole-admin pre-warning at request phase

The original draft surfaced the sole-admin implication only in the
confirmation email body. By that point the user is already mid-flow.

**Approved change.** The request-phase response shape grows a
`warnings: string[]` field:

```jsonc
POST /api/account/me/request-deletion → 201
{
  "requestedAt": "2026-05-11T18:42:00Z",
  "expiresAt":   "2026-05-12T18:42:00Z",
  "warnings": [
    "You are the sole admin on Acme Bistro. Deleting your account will leave this restaurant without administrative access."
  ]
}
```

Population rule (executed in the request handler, before the token
email is enqueued):

1. For the requesting profile, list restaurants where the user holds
   role=`admin`.
2. For each such restaurant, count other admins (`profile_id !=
   <user> AND role='admin'`).
3. For each restaurant where the other-admin count is 0 AND the
   restaurant has an active subscription (`subscriptions.status='active'`),
   append one entry to `warnings`.

The UI is expected to render these inline BEFORE submitting the
confirmation form. **Does NOT block the deletion** — GDPR right to
erasure does not bend on internal admin convenience. Just gives the
user real information before they commit.

Test additions (rolled into the existing test plan in (f)):

- Unit test for the warnings-builder helper (`lib/account/deletion-
  warnings.ts`): fixture user with 1 sole-admin restaurant → 1 warning;
  fixture user as co-admin → 0 warnings; fixture user as admin on a
  paused/canceled subscription → 0 warnings.
- Integration test: request handler returns the documented `warnings`
  array shape on a fixture sole-admin user.

### Concern 2 — RLS on `account_deletion_tokens` (deny by default)

Supabase's default RLS posture on a freshly created table is that
RLS is OFF until the migration enables it, but `enable row level
security` without policies = deny-everything-to-user-role. Without
that explicit step, the table inherits the permissive default and an
attacker with an anon JWT could read or insert deletion tokens.

**Approved change.** Migration `0016_account_deletion_tokens.sql` adds:

```sql
alter table account_deletion_tokens enable row level security;

-- No policies are created. Service-role bypasses RLS (the only
-- writer/reader for this table). Every other JWT (anon, learner,
-- admin, reviewer) sees zero rows and cannot insert.
--
-- This mirrors the deny-by-default posture established by
-- 0011_rls_hardening.sql for the other PII-bearing tables.
```

Test additions (rolled into (f) under `tests/integration/rls-
hardening.test.ts` or a sibling spec):

- Anon JWT `select * from account_deletion_tokens` returns 0 rows
  even when service-role has inserted one.
- Learner JWT `insert into account_deletion_tokens (...)` fails with
  RLS violation.
- Admin JWT cannot read any row (even rows pertaining to themselves
  — the only legitimate access is via the route handler, which uses
  service-role).
- Service-role `select` and `insert` both succeed.

### Concern 3 — Route naming (DELETE → POST confirm-deletion)

Approved without modification. The proxy-support reasoning holds.

---

## (h) Implementation sequencing (post-approval)

1. Migration `0016_account_deletion_tokens.sql` (table + index +
   **`enable row level security` with zero user-facing policies** per
   Concern 2). Service-role is the only writer/reader.
2. `lib/account/deletion-token.ts` — generator + hasher + validator.
3. `lib/account/deletion-warnings.ts` — sole-admin warning builder
   per Concern 1.
4. `lib/account/export.ts` — assemble export JSON (single service-role
   read across the 7 tables).
5. `lib/account/deletion.ts` — execute deletion sequence (Path 1).
   - When nulling `actor_id` on retained cross-tenant
     `activity_events` rows, merge
     `{ "actor_anonymized": true, "anonymized_at": "<ISO-8601>" }`
     into `payload` (per Concern-3 modification on OQ-G3).
6. New limiter factories in `lib/security/rate-limit.ts`:
   - `getAccountDeleteRequestIpLimiter()`
   - `getAccountDeleteRequestAcctLimiter()`
   - `getAccountDeleteConfirmIpLimiter()`
   - `getAccountExportIpLimiter()`
   - `getAccountExportAcctLimiter()`
7. New ActivityEventType variants in `lib/types/db.ts`:
   `account_deletion_requested`, `account_deletion_confirmed`,
   `account_deletion_request_rate_limited`,
   `account_deletion_confirm_invalid`,
   `account_deletion_request_rate_limiter_down`,
   `account_export_requested`, `account_export_rate_limited`.
8. New email template `lib/email/templates/AccountDeletionConfirm.tsx`.
   Log-site `to` masked via existing P1-8-aligned helper.
9. Routes:
   - `app/api/account/me/request-deletion/route.ts` — `POST`, returns
     `{ requestedAt, expiresAt, warnings }`.
   - `app/api/account/me/confirm-deletion/route.ts` — `POST`, body
     `{ token }`.
   - `app/api/account/me/cancel-deletion-request/route.ts` — `POST`,
     OQ-G2.
   - `app/api/account/me/export/route.ts` — `GET`.
10. `.env.example` — 5 new env-var defaults.
11. Tests (all listed in (f) + (g.bis) additions for sole-admin
    warnings and RLS deny).
12. Followups update.

**Note on route naming.** I'm deviating from the prompt's literal
`DELETE /api/account/me/confirm` to `POST /api/account/me/confirm-
deletion` because the existing CSRF middleware treats POST/PUT/PATCH/
DELETE identically — using POST keeps semantics + CSRF behavior
uniform, and the body carries the token (DELETE-with-body has
ambiguous fetch + intermediate-proxy support). Same effective shape.
Surfacing explicitly so this can be vetoed during review.

---

## Acceptance criteria

| Requirement | Resolution |
|---|---|
| **Right to erasure (GDPR Art. 17)** | Hard-delete of cert / exam / lesson / invite rows + auth.user banned/blanked + profile anonymized in place. Recital 26 anonymization satisfied. |
| **Right of access + portability (Art. 15 + 20)** | `GET /api/account/me/export` returns structured JSON of all PII, downloadable as attachment, with embedded schema. |
| **Two-phase confirmation against CSRF + accidental click** | 256-bit token, hashed at rest, single-use, 24h-bounded, requires both email-channel possession AND active session at confirm. |
| **Rate-limit defense against abuse** | 5 limiters listed in (e), fail-closed on Redis throw, activity events for every hit, configurable via env. |
| **No PII in deletion logs (partial P1-8 closure)** | Deletion handler logs the post-anonymization placeholder profile_id only. Email-send call-site uses the existing mask helper. |
| **Restaurant audit trail compatibility** | Aggregate cert count survives via the count-at-time-T pattern. Per-row historical reconstruction is intentionally lost — GDPR strictness over restaurant-internal reporting. |
| **Audit-trail honesty post-deletion** | Retained cross-tenant `activity_events` rows have `actor_id = null` AND `payload.actor_anonymized = true` + `payload.anonymized_at = <ISO-8601>` so dashboard readers can distinguish "never had an actor" from "actor was deleted." |
| **Sole-admin pre-warning** | Request-phase response returns `warnings: string[]`; one entry per active-subscription restaurant where the requesting user is the only admin. UI surfaces before the confirmation email is sent. Does not block deletion (GDPR-correct). |
| **`account_deletion_tokens` confidentiality** | RLS enabled with zero user-role policies → deny-by-default. Service-role is the only writer/reader. Mirrors the 0011_rls_hardening.sql posture for PII-bearing tables. |
| **Roster CSV legal framing** | Roster CSVs belong to the restaurant (data controller), not the deleting user (data subject). User has no Art. 17 standing over data they uploaded ABOUT others on behalf of a controller they don't own. Rationale documented in email body + export schema notes + handler comment. |

---

## Revision log — 2026-05-11 (post-review modifications, approved)

Changes applied in place per the wave-gate prompt's review comment:

- **OQ-G1, OQ-G2, OQ-G4** — approved as originally recommended. OQ-G4
  carries an added "Roster CSV uploads belong to the restaurant (data
  controller), not the individual user (data subject)" legal-framing
  note used as the basis for non-deletion.
- **OQ-G3** — augmented: when nulling `actor_id` on a retained
  cross-tenant row, also merge
  `{ actor_anonymized: true, anonymized_at: <ISO-8601> }` into
  `payload`. Test added in (f).
- **Concern 1 — sole-admin pre-warning.** New request-phase response
  field `warnings: string[]` populated per the rule in (g.bis).
  Surfaces in the UI before the confirmation email is sent. Does not
  block the deletion. Tests added in (g.bis).
- **Concern 2 — RLS on `account_deletion_tokens`.** Migration 0016
  must `enable row level security` and create zero user-role
  policies. Service-role bypass is the only legitimate access.
  RLS-deny tests added in (g.bis).
- **Concern 3 — route naming.** Already covered by the original
  `POST /api/account/me/confirm-deletion` proposal. Approved as
  originally written.

Implementation sequencing in (h) updated to reflect all of the above.

---

P1-16 design complete at `audits/p1-16-gdpr-design.md`. Awaiting review
before implementation. P1-9 and P1-14 implementation can begin in
parallel.
