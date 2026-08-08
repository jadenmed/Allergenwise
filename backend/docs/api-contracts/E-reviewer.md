# API Contract — Phase 1 Agent E: Reviewer Decision API

**Owner:** Phase 1 Agent E  
**Built:** 2026-04-30  
**Status:** Complete — backend only. Phase 3 UI agents consume these endpoints.

---

## Authentication

All reviewer endpoints require:
1. An active Supabase session cookie (set by `@supabase/ssr`).
2. The authenticated user's `profiles.role` must equal `'reviewer'`.

Role is checked **twice**: once by `middleware.ts` (route-group guard) and once server-side inside each handler. 403 if not reviewer; 401 if not authenticated.

---

## Endpoints

### GET /api/reviewer/queue

Returns the submission queue (pending + in_review), oldest first.

**Response 200:**
```json
{
  "submissions": [
    {
      "id": "uuid",
      "restaurantId": "uuid",
      "restaurantName": "The Green Fork",
      "restaurantCity": "San Diego",
      "restaurantState": "CA",
      "status": "pending",
      "submittedAt": "2026-04-15T10:00:00Z",
      "daysPending": 15,
      "certifiedCount": 5,
      "certFeeTotalCents": 17500
    }
  ]
}
```

**Notes:**
- `certifiedCount` = count of non-revoked, non-expired certs for that restaurant at time of request.
- Ordered by `submitted_at ASC` (oldest pending first).
- Uses `service_role` for cross-restaurant reads after role check.

---

### GET /api/reviewer/queue/[submissionId]

Full submission detail for review. Never cached — reads fresh from DB.

**Path params:** `submissionId` (UUID, validated with regex)

**Response 200:**
```json
{
  "submission": {
    "id": "uuid",
    "restaurantId": "uuid",
    "submittedBy": "uuid",
    "submittedAt": "2026-04-15T10:00:00Z",
    "status": "pending",
    "reviewerId": null,
    "reviewerNotes": null,
    "decidedAt": null,
    "certFeeTotalCents": 17500,
    "stripePaymentIntentId": "pi_..."
  },
  "restaurant": {
    "id": "uuid",
    "name": "The Green Fork",
    "slug": "the-green-fork-san-diego",
    "cuisine": "American",
    "address": "123 Main St",
    "city": "San Diego",
    "state": "CA",
    "zip": "92101",
    "phone": "619-555-1234",
    "website": "https://thegreenfork.com",
    "about": "...",
    "status": "pending_review",
    "listed_at": null,
    "listing_expires_at": null,
    "created_at": "2026-01-01T00:00:00Z"
  },
  "roster": [
    {
      "profileId": "uuid",
      "fullName": "Jane Smith",
      "email": "jane@restaurant.com",
      "jobRole": "Server",
      "acceptedAt": "2026-02-01T00:00:00Z",
      "cert": {
        "id": "uuid",
        "certCode": "AW-2026-00001",
        "issuedAt": "2026-03-15T00:00:00Z",
        "expiresAt": "2027-03-15T00:00:00Z",
        "scorePercent": 92,
        "passed": true
      }
    }
  ],
  "autoChecks": {
    "allCertified": true,
    "allScoresPass": true,
    "paymentValid": true,
    "noPriorRejection": true
  }
}
```

**Response 400:** `{ "error": "Invalid submissionId" }` — non-UUID path param.  
**Response 404:** `{ "error": "Submission not found" }`

**Auto-checks contract:**
| Field | true when |
|---|---|
| `allCertified` | Every learner profile in the restaurant has a valid (non-revoked, non-expired) certificate |
| `allScoresPass` | Every cert's linked `exam_attempts.score_percent >= 80` AND `passed = true` |
| `paymentValid` | Active subscription exists AND `cert_fee_total_cents = 0` OR `stripe_payment_intent_id` is set |
| `noPriorRejection` | No other `submissions` row for this restaurant has `status = 'rejected'` |

---

### POST /api/reviewer/queue/[submissionId]/decide

The core decision endpoint. Wraps a single Postgres transaction via `decide_submission()` RPC.

**Path params:** `submissionId` (UUID)

**Request body:**
```json
{
  "action": "approve" | "reject" | "request_info",
  "notes": "Optional reviewer notes (max 4000 chars)"
}
```

**Response 200:**
```json
{
  "ok": true,
  "restaurantSlug": "the-green-fork-san-diego",   // only present on approve
  "listingExpiresAt": "2027-04-30T10:00:00Z",      // only present on approve
  "emailQueued": true                               // false if Resend failed
}
```

**Response 400:** validation error or submission in terminal state or invalid action.  
**Response 403/401:** auth failure.  
**Response 500:** internal DB error.

**Atomicity guarantee:**
- `decide_submission()` PL/pgSQL function runs in a single Postgres transaction.
- On `approve`: updates `submissions.status='approved'`, updates `restaurants.status='listed'`,  
  generates `slug` via `unique_slug()`, sets `listed_at` + `listing_expires_at = now() + 12 months`,  
  inserts `activity_events`.
- Email is sent **after** the transaction commits. If email fails, `emailQueued: false` is returned  
  but the decision is **not** rolled back.

**RPC signature (for downstream agents):**
```sql
decide_submission(
  p_submission_id uuid,
  p_reviewer_id   uuid,
  p_action        text,   -- 'approve' | 'reject' | 'request_info'
  p_notes         text    -- may be null
) returns json
```
Callable only by `service_role`. Raises PostgreSQL exceptions on invalid input  
(caught by PostgREST and returned as 400-level errors).

**Do NOT build your own decision logic.** Phase 3 UI agents must call this endpoint only.

---

### GET /api/reviewer/reviews/queue

Returns pending reviews for moderation, oldest first.

**Response 200:**
```json
{
  "reviews": [
    {
      "id": "uuid",
      "restaurantId": "uuid",
      "restaurantName": "The Green Fork",
      "restaurantCity": "San Diego",
      "restaurantState": "CA",
      "restaurantSlug": "the-green-fork-san-diego",
      "authorName": "Jane Doe",
      "authorEmail": "jane@example.com",
      "rating": 4,
      "body": "Great allergen awareness...",
      "allergenContext": "tree_nut",
      "status": "pending",
      "createdAt": "2026-04-20T12:00:00Z",
      "daysPending": 10
    }
  ]
}
```

---

### POST /api/reviewer/reviews/[id]/decide

Publishes or hides a review.

**Path params:** `id` (review UUID)

**Request body:**
```json
{ "action": "publish" | "hide" }
```

**Response 200:**
```json
{ "ok": true, "status": "published" }
```

**Idempotent:** If already in target status, returns 200 without writing.

**Visibility note:** `publish` makes the review immediately visible to anonymous users  
via the `reviews_public_read_published` RLS policy. This is intentional per spec §5.5.

---

## Dependencies

### Must be deployed before this API works:
- `db/migrations/0009_decide_submission_fn.sql` — `decide_submission()` and `unique_slug()` functions.

### Email templates consumed by `/api/reviewer/queue/[id]/decide`:
| Action | Template |
|---|---|
| `approve` | `lib/email/templates/RestaurantApproved.tsx` |
| `reject` | `lib/email/templates/RestaurantRejected.tsx` |
| `request_info` | `lib/email/templates/RestaurantInfoRequested.tsx` |

These are **Agent F's** responsibility (`lib/email/templates/`). If templates don't  
exist, the decision commits but email fails silently (`emailQueued: false`).

---

## Handoff notes for Phase 3 Reviewer UI agent

1. **Queue screen** (`/reviewer/queue`): call `GET /api/reviewer/queue` on load. Refresh  
   on window focus. Sort is server-side (oldest first); no client-side sort needed.

2. **Detail screen** (`/reviewer/queue/[submissionId]`): call `GET /api/reviewer/queue/[submissionId]`.  
   Never cache this page — `cache: 'no-store'` in fetch.

3. **Decision sidebar**: `POST /api/reviewer/queue/[submissionId]/decide`.  
   - Show `notes` textarea (required for reject/request_info, optional for approve).  
   - After success, redirect to queue. Show `emailQueued: false` warning if it surfaces.
   - On 400 with "terminal state" message: show toast "Submission already decided".

4. **Review moderation**: `GET /api/reviewer/reviews/queue` + `POST /api/reviewer/reviews/[id]/decide`.  
   Publishing is immediate — no delay or secondary confirmation needed.

5. **RPC is not callable from client**: all decisions go through the Next.js API routes.  
   Do not call `supabase.rpc('decide_submission')` from client components.
