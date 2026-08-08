# API Contract — Agent F1: Stripe, Cert Generation, Public Verify

**Version:** 1.0  
**Author:** Phase 1 Agent F1 + Phase 1 Finisher Agent  
**Downstream consumers:** Agent B (charge-cert-fees), Agent C (certs/generate), public verify page (Phase 3 Agent A)

---

## POST /api/stripe/webhook

### Purpose
Receives Stripe webhook events. Signature-verified and idempotent via the `stripe_events` table.

### Auth
**No session auth.** Auth is the Stripe signature header (`stripe-signature`). The `STRIPE_WEBHOOK_SECRET` env var is required at startup — the module throws if missing.

### Security: Signature verification
Every request is verified using `stripe.webhooks.constructEvent(rawBody, sig, WEBHOOK_SECRET)`. The raw body (`req.text()`) must be read BEFORE any parsing — Next.js App Router does not auto-parse, which is intentional. If the signature is invalid, the handler returns 400 immediately with no side effects.

### Security: Idempotency (deduplication)
```
Strategy: INSERT BEFORE processing
1. INSERT event.id into stripe_events (ON CONFLICT DO NOTHING).
2. Check returned row count:
   - count = 1 → new event → process side effects.
   - count = 0 → duplicate → skip all processing, return { received: true, duplicate: true }.
3. Unique constraint violation (23505) → same as count = 0.
4. Always return HTTP 200 — Stripe stops retrying.
```
This guarantees at-most-once processing even if Stripe retries the same event multiple times.

### Request
Raw body from Stripe. `Content-Type: application/json`.

Headers:
- `stripe-signature`: Stripe HMAC-SHA256 signature (required)

### Response — 200 OK

```json
{ "received": true }
```

Or for duplicates:

```json
{ "received": true, "duplicate": true }
```

### Errors

| HTTP | Meaning |
|------|---------|
| 400 | Missing `stripe-signature` header OR invalid signature |

**Note:** We never return 5xx to Stripe. On internal errors, we log and return 200 to prevent Stripe from retrying with incorrect data.

### Handled event types

| Event | Metadata | Side effect |
|-------|----------|-------------|
| `payment_intent.succeeded` | `kind='plan'` | Inserts `subscriptions` row; sends `WelcomeAdmin` email |
| `payment_intent.succeeded` | `kind='cert_fee'` | Updates `certificates.stripe_payment_intent_id`; inserts `activity_events` (`type='cert_issued'`) |
| `payment_intent.succeeded` | `kind='submission'` | Updates `submissions.stripe_payment_intent_id` |
| `payment_intent.payment_failed` | any | Inserts `activity_events` (`type='payment_failed'`); future: email admin |
| All other event types | — | Logged; no processing; returns 200 |

### Metadata conventions
Every PaymentIntent created by AllergenWise includes `metadata.kind` and `metadata.restaurant_id`. Webhook uses these to route events without DB lookups.

---

## POST /api/stripe/payment-intent

### Purpose
Creates a Stripe PaymentIntent for one-time charges (plan fee at signup). Off-session charges use `/api/stripe/charge-cert-fees`.

### Auth
Admin session required (for plan charges). Or called internally.

### Request

```json
{
  "kind": "plan",
  "amountCents": 9000,
  "metadata": {
    "restaurant_id": "uuid",
    "plan": "quarterly"
  }
}
```

### Response — 201 Created

```json
{
  "clientSecret": "pi_xyz_secret_abc",
  "paymentIntentId": "pi_xyz"
}
```

### Errors

| HTTP | Meaning |
|------|---------|
| 400 | Validation failed |
| 401 | Not authenticated |
| 502 | Stripe API error |

---

## POST /api/stripe/charge-cert-fees

### Purpose
Charges the restaurant's saved default payment method for certification fees ($35 × certifiedCount). Called server-to-server by `POST /api/submissions/create`. Not a public endpoint.

### Auth
Internal server-to-server call only. No session auth; the call comes from the same process. In production, verify the `APP_URL` prefix matches or use an internal secret header.

### Request

```json
{
  "restaurantId": "uuid",
  "certifiedCount": 3
}
```

### Response — 200 OK

```json
{
  "certFeeTotalCents": 10500,
  "stripePaymentIntentId": "pi_cert_fee_xyz"
}
```

### Errors

| HTTP | Meaning |
|------|---------|
| 400 | Validation failed |
| 402 | Off-session charge failed (no valid payment method, or Stripe declined) |
| 404 | Restaurant not found or no stripe_customer_id |
| 502 | Stripe API error |

### Behavior
1. Looks up `restaurants.stripe_customer_id`.
2. Retrieves default payment method from Stripe customer.
3. Creates PaymentIntent: `confirmation_method='automatic'`, `off_session=true`, `metadata.kind='cert_fee'`.
4. Returns `{ certFeeTotalCents, stripePaymentIntentId }`.

The `payment_intent.succeeded` webhook will fire asynchronously and update the `certificates` row.

---

## POST /api/certs/generate

### Purpose
Renders the certificate PDF and uploads it to Supabase Storage. Called fire-and-forget from `/api/exam/submit`.

### Auth
Internal call only. Protected by `CRON_SECRET` header or called only from within the same process.

### Request

```json
{
  "certCode": "AW-2026-000001"
}
```

### Response — 200 OK

```json
{
  "ok": true,
  "pdfStoragePath": "certificates/AW-2026-000001.pdf",
  "signedUrl": "https://..."
}
```

### Errors

| HTTP | Meaning |
|------|---------|
| 400 | Validation failed |
| 404 | Certificate not found |
| 500 | PDF render or upload failed |

### PDF spec
- Format: Letter landscape (11 × 8.5 in)
- Rendering: `@react-pdf/renderer` → `renderToBuffer`
- QR code: `qrcode` npm, error correction H, teal-700 modules, points to `${APP_URL}/verify/${certCode}`
- Upload path: `certificates/{certCode}.pdf` in Supabase `certificates` bucket
- Returns signed URL with 1-year expiry (matching cert validity)

---

## GET /api/certs/[certCode]/verify

### Purpose
Public anonymous endpoint for certificate verification. Used by QR code scanners and the public `/verify/[certCode]` page.

### Auth
None. Fully public.

### Leak prevention guarantee (non-negotiable per CLAUDE.md)
The response ONLY contains:
- `valid`: boolean
- `status`: `'active' | 'expired' | 'revoked' | 'not_found'`
- `restaurantName`: string (only if cert found)
- `issuedAt`: string ISO (only if cert found)
- `expiresAt`: string ISO (only if cert found)

**The response MUST NOT include:**
- Profile name or any other PII (individuals are not named in the public response)
- Email addresses
- Internal UUIDs (profile_id, restaurant_id, cert UUID)
- Restaurant address, city, lat/lng, phone, website
- Exam scores or attempt data
- Internal flags like `revoked` boolean (surfaced as `status='revoked'` instead)
- PDF paths, Stripe payment IDs, or fee amounts

The DB query selects ONLY `issued_at, expires_at, revoked, restaurants:restaurant_id(name)` — no profile join, no address fields. Enforced at the DB query level, not just at the response serialization level.

### Request
No body. `certCode` in URL path. Must match `/^[A-Z0-9-]{5,30}$/i`.

### Response — 200 OK (active)

```json
{
  "valid": true,
  "status": "active",
  "restaurantName": "The Green Fork",
  "issuedAt": "2026-01-15T10:00:00Z",
  "expiresAt": "2027-01-15T10:00:00Z"
}
```

### Response — 200 OK (expired)

```json
{
  "valid": false,
  "status": "expired",
  "restaurantName": "The Green Fork",
  "issuedAt": "2025-01-15T10:00:00Z",
  "expiresAt": "2026-01-15T10:00:00Z"
}
```

### Response — 200 OK (revoked)

```json
{
  "valid": false,
  "status": "revoked",
  "restaurantName": "The Green Fork",
  "issuedAt": "2026-01-15T10:00:00Z",
  "expiresAt": "2027-01-15T10:00:00Z"
}
```

### Response — 200 OK (not found)

```json
{
  "valid": false,
  "status": "not_found"
}
```

**Note:** All states return HTTP 200 so QR scanner pages don't need HTTP error handling. The `status` field distinguishes all cases.

### Caching
`export const revalidate = 60` — Next.js caches valid lookups for 60 seconds. Revocation propagates within 60 seconds (acceptable for MVP).

### Cert code format
`AW-{year}-{zero-padded-6-digit-seq}` — e.g. `AW-2026-000042`. Sanitized server-side (regex `^[A-Z0-9-]{5,30}$`) before any DB query.

---

## lib/pdf/render.ts

Entry point: `renderCertPdf(props: CertificateProps): Promise<Buffer>`

```ts
type CertificateProps = {
  certCode: string;
  recipientName: string;
  restaurantName: string;
  issuedAt: string;         // formatted date string for display
  expiresAt: string;
  verifyUrl: string;        // used to generate QR code
}
```

Returns a `Buffer` starting with `%PDF`. Throws descriptively on QR or render failure.

## lib/billing/subscription.ts

Key exports:
- `getSubscriptionStatus(sub, nowMs)` — returns `'active' | 'expired' | 'canceled'` (real-time, not DB-cached).
- `isSubscriptionActive(sub, nowMs)` — returns true for genuinely active subs.
- `canTransition(from, to)` — state machine guard.
- `daysUntilSubscriptionEnd(sub, nowMs)` — days remaining (negative if past).
- `isExpiringWithinDays(sub, warningDays, nowMs)` — used by cron warning emails.
