# API Contract — Agent B: Admin Domain APIs

**Version:** 1.0  
**Author:** Phase 1 Agent B + Phase 1 Finisher Agent  
**Downstream consumers:** Phase 3 UI agents (admin dashboard, roster, invite, billing, submit screens)

All routes are server-side only. Auth enforced at two layers: middleware (role redirect) AND endpoint (re-reads DB, never trusts client-supplied role). All request bodies are JSON unless noted. All responses are JSON.

---

## POST /api/invites/send

### Purpose
Invites a single employee (learner) to the restaurant. Creates auth.users + profiles row + sends invite email.

### Auth
Admin session required. Role re-verified server-side from `profiles.role`.

### Request

```json
{
  "email": "jane@employee.com",      // valid email, required
  "fullName": "Jane Smith",           // string, max 120, required
  "jobRole": "server"                 // string, max 60, optional
}
```

### Response — 201 Created

```json
{
  "inviteId": "uuid",
  "email": "jane@employee.com"
}
```

### Errors

| HTTP | Meaning |
|------|---------|
| 400 | Validation failed |
| 401 | Not authenticated |
| 403 | Not an admin |
| 409 | Email already exists in this restaurant |
| 502 | Resend email delivery failed (invite still created; retry via /resend) |

### Side Effects
- Creates `auth.users` entry with `email_confirm=false`
- Inserts `profiles` row: `role='learner'`, `restaurant_id=admin's restaurant_id`
- Sends `EmployeeInvite` email via Resend
- Inserts `activity_events` row: `type='invite_sent'`

### Idempotency
Not idempotent. Calling twice with the same email returns 409. Use `/api/invites/[id]/resend` to resend.

---

## POST /api/invites/remind

### Purpose
Sends a reminder email to a learner who has not yet accepted their invite.

### Auth
Admin session required.

### Request

```json
{
  "profileId": "uuid"    // UUID of the learner profile to remind
}
```

### Response — 200 OK

```json
{
  "ok": true,
  "email": "jane@employee.com"
}
```

### Errors

| HTTP | Meaning |
|------|---------|
| 400 | Validation failed |
| 401 | Not authenticated |
| 403 | Profile not in admin's restaurant |
| 404 | Profile not found |
| 409 | Learner has already accepted invite (`accepted_at IS NOT NULL`) |
| 502 | Resend delivery failed |

### Side Effects
- Sends `InviteReminder` email via Resend

---

## POST /api/invites/[id]/resend

### Purpose
Regenerates a fresh invite token and resends the invite email for a specific invite (identified by profile UUID in the URL).

### Auth
Admin session required.

### Request
No body. Profile ID comes from URL path.

### Response — 200 OK

```json
{
  "ok": true,
  "email": "jane@employee.com"
}
```

### Errors

| HTTP | Meaning |
|------|---------|
| 401 | Not authenticated |
| 403 | Profile not in admin's restaurant |
| 404 | Profile not found |
| 409 | Learner has already accepted (no resend needed) |

### Side Effects
- Generates fresh invite token (previous token invalidated)
- Updates `profiles.invited_at = now()`
- Sends `EmployeeInvite` email via Resend

---

## POST /api/admin/csv-upload

### Purpose
Parses a CSV roster upload. Two modes:

**Mode 1 (default — parse only):** Returns parsed rows + validation errors. No DB writes.  
**Mode 2 (commit):** URL param `?commit=true&uploadId=<id>`. Reads the saved draft, inserts all profiles, sends invite emails in chunks of 50/sec.

### Auth
Admin session required.

### Request
`Content-Type: multipart/form-data`. Field `file`: CSV with columns `email`, `fullName`, `jobRole`. Max 200 rows.

For commit mode: `POST /api/admin/csv-upload?commit=true&uploadId=<draftId>` (no body — reads saved draft).

### Response — 200 OK (parse mode)

```json
{
  "uploadId": "uuid",
  "validRows": [
    { "email": "alice@bistro.com", "fullName": "Alice", "jobRole": "server" }
  ],
  "errors": [
    { "row": 3, "field": "email", "message": "Invalid email format" }
  ],
  "duplicates": ["bob@bistro.com"]
}
```

### Response — 200 OK (commit mode)

```json
{
  "inserted": 12,
  "emailsSent": 12,
  "errors": []
}
```

### Errors

| HTTP | Meaning |
|------|---------|
| 400 | Missing file / too many rows / unsupported format |
| 401 | Not authenticated |
| 403 | Not an admin |
| 404 | uploadId not found (commit mode) |

---

## GET /api/admin/roster

### Purpose
Returns the full learner roster for the admin's restaurant with progress data.

### Auth
Admin session required.

### Response — 200 OK

```json
{
  "learners": [
    {
      "id": "uuid",
      "fullName": "Jane Smith",
      "email": "jane@bistro.com",
      "jobRole": "server",
      "invitedAt": "2026-01-15T10:00:00Z",
      "acceptedAt": "2026-01-15T11:30:00Z",
      "modulesCompleted": 3,
      "totalModules": 5,
      "status": "in_progress",
      "certCode": null,
      "certIssuedAt": null,
      "certExpiresAt": null,
      "lastActivityAt": "2026-04-29T14:22:00Z"
    }
  ]
}
```

`status` is one of: `"invited"` (not accepted) | `"in_progress"` (accepted, not certified) | `"certified"` (has valid cert).

### Errors

| HTTP | Meaning |
|------|---------|
| 401 | Not authenticated |
| 403 | Not an admin |

---

## GET /api/admin/dashboard-stats

### Purpose
Returns all data needed for the admin dashboard stat cards and recent activity feed.

### Auth
Admin session required.

### Response — 200 OK

```json
{
  "employeesTotal": 8,
  "certifiedCount": 6,
  "inProgressCount": 2,
  "certReadinessPct": 75,
  "daysUntilPlanEnds": 42,
  "pendingInvites": 1,
  "recentActivity": [
    {
      "id": "uuid",
      "type": "exam_passed",
      "actorId": "uuid",
      "actorName": "Alice Chen",
      "payload": { "certCode": "AW-2026-000001" },
      "createdAt": "2026-04-30T10:00:00Z"
    }
  ]
}
```

`daysUntilPlanEnds`: from the latest active `subscriptions` row. `-1` if no active plan.  
`recentActivity`: last 10 `activity_events` for the restaurant, ordered newest-first.

### Errors

| HTTP | Meaning |
|------|---------|
| 401 | Not authenticated |
| 403 | Not an admin |

---

## POST /api/submissions/create

### Purpose
Creates a restaurant certification submission after verifying server-side eligibility.

### Auth
Admin session required. Role **re-read from DB** — never trusts middleware or client-supplied role.

### Request

```json
{
  "cuisine": "italian",
  "allergenSpecialties": ["tree_nut_aware", "gluten_free_menu"],
  "heroPhotoStoragePath": "restaurant-photos/uuid/hero.jpg",
  "about": "Optional restaurant description",
  "hoursJson": {
    "mon": { "open": "11:00", "close": "22:00" },
    "tue": { "open": "11:00", "close": "22:00" }
  }
}
```

`allergenSpecialties`: array of allowed values — `peanut_free | tree_nut_aware | dairy_free | gluten_free_menu | egg_free | soy_free | fish_free | shellfish_free | sesame_free`  
`hoursJson` and `about` are optional.

### Response — 201 Created

```json
{
  "submissionId": "uuid",
  "certFeeTotalCents": 10500,
  "stripePaymentIntentId": "pi_xyz"
}
```

`certFeeTotalCents` = `$35 × certifiedCount` (35 cents × 100).

### Errors

| HTTP | Meaning |
|------|---------|
| 400 | Validation failed (Zod) |
| 401 | Not authenticated |
| 402 | Cert fee charge failed (Stripe) — submission NOT created |
| 403 | Not an admin |
| 404 | Restaurant not found |
| 422 | Not eligible: body includes `{ reasons[], certifiedCount, totalLearners }` |
| 500 | Unexpected server error |

### Eligibility checks (server-side, non-negotiable)
1. All learner profiles have a non-revoked, non-expired certificate.
2. Active subscription exists (`subscriptions.status='active'` AND `ends_at >= today`).
3. No submission currently in `pending | in_review | info_requested` status.

**Rollback guarantee:** If the Stripe charge (step 5) fails, `restaurants.status` is reverted to its previous value and the `submissions` row is NOT inserted. The DB never has a `pending_review` restaurant without a corresponding `submissions` row.

### Side Effects
- Updates `restaurants`: `cuisine`, `allergen_specialties`, `hero_photo_url`, `about`, `hours_json`, `status='pending_review'`
- Calls `POST /api/stripe/charge-cert-fees` server-to-server
- Inserts `submissions` row: `status='pending'`, `cert_fee_total_cents`, `stripe_payment_intent_id`
- Inserts `activity_events`: `type='submission_created'`
- Sends `RestaurantSubmitted` email to `REVIEWER_EMAIL` env var

---

## lib/admin/eligibility.ts

Entry point: `checkEligibility({ restaurantId, supabaseServiceClient }): Promise<EligibilityResult>`

```ts
interface EligibilityResult {
  eligible: boolean;
  reasons: string[];       // empty when eligible
  certifiedCount: number;  // used to compute cert fee
  totalLearners: number;
}
```

Reads DB truth directly — never accepts client claims. Used by `POST /api/submissions/create` and returns structured reasons for UI display.

---

## lib/admin/csv.ts

Entry point: `parseCsvUpload(buffer: Buffer): CsvParseResult`

```ts
interface CsvParseResult {
  validRows: Array<{ email: string; fullName: string; jobRole: string }>;
  errors: Array<{ row: number; field: string; message: string }>;
  duplicateEmails: string[];
}
```

Validates: email format, required fields, max 200 rows. Deduplicates against existing `profiles` for the restaurant (requires a DB call).
