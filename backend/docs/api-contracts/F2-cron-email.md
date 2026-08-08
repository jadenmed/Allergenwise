# F2 — Cron, Email Templates, Mux Signing, Search SQL

**Owner:** Phase-1 Agent F2  
**Date:** 2026-04-30  
**Status:** Complete

---

## Cron schedule

All cron routes are registered in `vercel.json`. Vercel calls each route via HTTP GET at the scheduled time, with `Authorization: Bearer {CRON_SECRET}` in the request header.

Every route returns `{ ok: boolean, processed: number, errors: string[] }`.

| Route | Schedule (UTC) | Description |
|---|---|---|
| `/api/cron/expire-listings` | `0 3 * * *` — daily 03:00 | Pauses restaurants where `listing_expires_at < now()` and `status='listed'` |
| `/api/cron/expire-certs` | `15 3 * * *` — daily 03:15 | Sends `CertExpiringSoon` email at 30/14/7 days before expiry; idempotent via `cert_warnings` PK |
| `/api/cron/expire-subscriptions` | `30 3 * * *` — daily 03:30 | Expires active subscriptions; pauses restaurant if no active renewal remains |
| `/api/cron/digest-reviewer-queue` | `0 9 * * *` — daily 09:00 | Emails `REVIEWER_EMAIL` with count of submissions pending >24h |
| `/api/cron/weekly-admin-digest` | `0 8 * * 1` — Mondays 08:00 | Emails each admin: cert readiness %, expiring certs (30d), pending invites |
| `/api/cron/exam-timeout-sweep` | `* * * * *` — every minute | Auto-submits expired exam attempts (started > time_limit + 30s ago); LIMIT 100/run |

### Security

All routes check:
```
request.headers.get('authorization') === `Bearer ${process.env.CRON_SECRET}`
```
Returns HTTP 401 if the check fails. `CRON_SECRET` must be set in Vercel project env vars.

---

## Email trigger map

| Template | File | Trigger | Recipient |
|---|---|---|---|
| `EmployeeInvite` | `lib/email/templates/EmployeeInvite.tsx` | Admin invites employee | Learner email |
| `InviteReminder` | `lib/email/templates/InviteReminder.tsx` | Admin clicks "Remind" on roster | Learner email |
| `ExamPassed` | `lib/email/templates/ExamPassed.tsx` | Learner passes exam (cert issued) | Learner email |
| `RestaurantSubmitted` | `lib/email/templates/RestaurantSubmitted.tsx` | Admin submits for certification | `REVIEWER_EMAIL` |
| `RestaurantApproved` | `lib/email/templates/RestaurantApproved.tsx` | Reviewer approves submission | Admin email |
| `RestaurantRejected` | `lib/email/templates/RestaurantRejected.tsx` | Reviewer rejects submission | Admin email |
| `RestaurantInfoRequested` | `lib/email/templates/RestaurantInfoRequested.tsx` | Reviewer requests more info | Admin email |
| `PlanExpiringSoon` | `lib/email/templates/PlanExpiringSoon.tsx` | Cron (14 days before `subscriptions.ends_at`) | Admin email |
| `CertExpiringSoon` | `lib/email/templates/CertExpiringSoon.tsx` | Cron (30/14/7 days before `certificates.expires_at`) | Learner email |
| `ReceiptCertFee` | `lib/email/templates/ReceiptCertFee.tsx` | Stripe `payment_intent.succeeded` | Admin email |
| `WelcomeAdmin` | `lib/email/templates/WelcomeAdmin.tsx` | Stripe webhook: plan payment success | Admin email |

---

## `lib/email/send.ts` interface (for Agents A/B/C/E)

```typescript
import { sendEmail } from '@/lib/email/send';

// Typed — TypeScript infers correct props from template name
const result = await sendEmail('EmployeeInvite', 'jane@example.com', {
  recipientName: 'Jane Smith',
  restaurantName: 'The Green Fork',
  inviteLink: 'https://allergenwise.com/invite/abc123',
});

if (!result.ok) {
  // result.error is a string describing the failure
  // sendEmail never throws — always returns { ok, id?, error? }
}
```

### Template → props type mapping

| Template name | Required props |
|---|---|
| `EmployeeInvite` | `recipientName, restaurantName, inviteLink` |
| `InviteReminder` | `recipientName, restaurantName, inviteLink, sentDaysAgo` |
| `ExamPassed` | `recipientName, restaurantName, certCode, certUrl` |
| `RestaurantSubmitted` | `restaurantName, submissionId, certifiedCount, reviewLink` |
| `RestaurantApproved` | `adminName, restaurantName, listingUrl, listingExpiresAt` |
| `RestaurantRejected` | `adminName, restaurantName, reviewerNotes` |
| `RestaurantInfoRequested` | `adminName, restaurantName, reviewerNotes, resubmitLink` |
| `PlanExpiringSoon` | `adminName, restaurantName, daysRemaining, renewLink` |
| `CertExpiringSoon` | `recipientName, restaurantName, daysRemaining, certCode` |
| `ReceiptCertFee` | `adminName, restaurantName, amountCents, receiptType, paymentIntentId, plan?, certifiedCount?` |
| `WelcomeAdmin` | `adminName, restaurantName, plan, dashboardUrl` |

> **Note:** `WelcomeAdmin` uses `dashboardUrl` (not `dashboardLink` as in early spec). `ReceiptCertFee` uses `receiptType: 'plan' | 'cert_fee' | 'submission'` — the webhook handler sets this based on `metadata.kind`.

---

## Mux signed URL interface (for Agent C)

```typescript
import { signMuxPlaybackUrl } from '@/lib/mux';

// Returns full streaming URL with JWT token — ready for Mux player
const streamUrl = signMuxPlaybackUrl(
  lesson.video_mux_playback_id,  // from lessons table
  user.id,                        // Supabase auth.users UUID
  lesson.id                       // lesson UUID for audit trail
);
// → 'https://stream.mux.com/{playbackId}.m3u8?token={jwt}'
```

JWT claims: `sub=userId, aud='v', kid=MUX_SIGNING_KEY_ID, exp=now+6h, playback_id, lesson_id`  
Algorithm: RS256. Falls back to unsigned URL in dev (no env vars set).

Env vars required:
- `MUX_SIGNING_KEY_ID` — Key ID from Mux dashboard Signing Keys
- `MUX_SIGNING_KEY_PRIVATE` — Base64-encoded RSA private key PEM from Mux

> The legacy `signPlaybackUrl(playbackId, viewerId)` and `getSignedPlaybackUrl(playbackId, viewerId)` still exist for backward compatibility. New code should use `signMuxPlaybackUrl`.

---

## Search SQL canonical file

**Canonical implementation:** `lib/directory/search.ts`  
**Re-export alias:** `lib/search.ts` (re-exports `buildSearchQuery`, `haversineDistance`, `SearchParams`, `SearchRow`, `SqlQuery`, `SearchMode`)

Agent D owns the canonical implementation. Agent F2 writes only the re-export.

Import from either path:
```typescript
import { buildSearchQuery } from '@/lib/directory/search'; // canonical
import { buildSearchQuery } from '@/lib/search';           // alias
```

---

## DB migration

**`db/migrations/0010_cert_warnings.sql`** — creates `cert_warnings` table used by the `expire-certs` cron for idempotency.

```sql
cert_warnings (
  cert_id    uuid references certificates(id),
  threshold  int,   -- 30, 14, or 7
  sent_at    timestamptz,
  primary key (cert_id, threshold)
)
```

RLS enabled; no user-facing policies. Service-role only.

---

## Open questions / handoff notes

1. **WelcomeAdmin trigger:** The cron and webhook handler (Agent F1 / Stripe webhook) should send `WelcomeAdmin` on `payment_intent.succeeded` with `metadata.kind='plan'`. Props: `{ adminName, restaurantName, plan, dashboardUrl }`.

2. **PlanExpiringSoon threshold:** Spec says "14 days before ends_at" but the `expire-certs` cron sends at 30/14/7. The `PlanExpiringSoon` template supports any `daysRemaining`. If Agent F1 wants to send at additional thresholds (e.g. 30 days for plan), use the same pattern as `expire-certs`.

3. **exam-timeout-sweep scoring:** The sweep scores answers stored in `exam_attempts.answers` JSONB (map of question_id → chosen_option_id). If an attempt was started but no answers were saved, score = 0. Does NOT issue certificates — timeout = fail always.

4. **CRON_SECRET env var:** Must be set in Vercel project env vars and locally in `.env.local`. Vercel Cron automatically injects it as the Authorization header on production.
