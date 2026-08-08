# API Contract — Agent A: Auth + Signup

**Version:** 1.0  
**Author:** Phase 1 Agent A  
**Downstream consumers:** Phase 3 UI agents (signup form, login form, invite-accept page, client session hook)

All routes are server-side only. No client-side secrets. All request bodies are JSON. All responses are JSON.

---

## POST /api/auth/signup

### Purpose
Creates a new restaurant admin account end-to-end: auth user, restaurant row, admin profile, Stripe Customer, and a PaymentIntent for the plan fee. Returns the Stripe client secret for the frontend to complete payment via Stripe Elements.

Does NOT create the `subscriptions` row — that happens in the Stripe webhook (Agent F, `payment_intent.succeeded`).

### Auth
None required (public endpoint).

### Request

```json
{
  "restaurant": {
    "name": "The Bistro",           // string, max 120, required
    "address": "123 Main St",        // string, max 200, required
    "city": "San Diego",             // string, max 100, required
    "state": "CA",                   // string, exactly 2 chars, required
    "zip": "92101",                  // string, regex /^\d{5}(-\d{4})?$/, required
    "phone": "619-555-0100",         // string, 7–20 chars, required
    "cuisine": "american"            // string, max 60, required
  },
  "admin": {
    "fullName": "Jane Admin",        // string, max 120, required
    "email": "jane@bistro.com",      // valid email, required
    "password": "SecurePass123!"     // string, 8–72 chars, required
  },
  "plan": "quarterly"               // "quarterly" | "semiannual"
}
```

### Response — 201 Created

```json
{
  "clientSecret": "pi_xyz_secret_abc",
  "customerId": "cus_abc123",
  "restaurantId": "uuid",
  "paymentIntentId": "pi_xyz789"
}
```

**Usage:** pass `clientSecret` to Stripe Elements `confirmPayment()`.

### Errors

| HTTP | code | Meaning |
|------|------|---------|
| 400 | — | Validation failed; body includes `{ error, issues }` field map |
| 409 | `EMAIL_EXISTS` | An account with this email already exists |
| 422 | `AUTH_ERROR` | Supabase Auth rejected the credentials |
| 502 | `STRIPE_ERROR` | Stripe API unavailable |
| 500 | `UNEXPECTED_ERROR` | Unexpected failure; all created rows rolled back |

On any error, all previously created rows (auth.users, restaurants, profiles) are deleted, and the Stripe Customer is deleted. The response will never leave orphaned data.

### Idempotency
Stripe calls use idempotency keys scoped to `authUserId`. Retrying with the same email will return `EMAIL_EXISTS` (409) on the second attempt.

---

## POST /api/auth/login

### Purpose
Authenticates an admin or reviewer with email + password. Sets a session cookie via Supabase SSR. Returns user identity and role for client routing.

### Auth
None required (public endpoint).

### Request

```json
{
  "email": "jane@bistro.com",
  "password": "SecurePass123!"
}
```

### Response — 200 OK

```json
{
  "user": {
    "id": "uuid",
    "email": "jane@bistro.com"
  },
  "role": "admin",
  "restaurantId": "uuid-or-null"
}
```

`restaurantId` is `null` for reviewers.

### Errors

| HTTP | Meaning |
|------|---------|
| 400 | Malformed body (generic message — no field hints to prevent enumeration) |
| 401 | Invalid credentials (always generic message: "Invalid credentials.") |
| 429 | Rate limited by Supabase Auth |
| 403 | Account exists but profile not found (incomplete setup) |

**Security note:** error messages never reveal which field (email or password) is incorrect.

---

## POST /api/auth/invite/accept

### Purpose
Accepts an employee invite: validates the token, sets the user's password, marks `accepted_at`, clears the invite token (single-use enforcement), and returns a role-based redirect URL.

### Auth
None required — the invite token IS the authentication.

### Request

```json
{
  "token": "base64url-token",        // the token from the invite link URL
  "password": "NewPassword123!"      // 8–72 characters
}
```

### Response — 200 OK

```json
{
  "redirectUrl": "/learner/courses"
}
```

Redirect URLs by role:
- `learner` → `/learner/courses`
- `admin` → `/admin/dashboard`
- `reviewer` → `/reviewer/queue`

### Errors

| HTTP | code | Meaning |
|------|------|---------|
| 400 | — | Validation failed |
| 404 | `not_found` | Token does not exist |
| 410 | `expired` | Token expired (> 7 days from invite) |
| 410 | `already_accepted` | Token has already been used |

**Security:** tokens are 256-bit cryptographically random (base64url). Not guessable by enumeration.

---

## GET /api/auth/session

### Purpose
Returns the current authenticated user's identity. Used by client components to determine role-based UI state without re-fetching from Supabase.

### Auth
Session cookie required (set by login or signup flow). Returns 401 if not authenticated.

### Request
No body. Session cookie read automatically.

### Response — 200 OK

```json
{
  "user": {
    "id": "uuid",
    "email": "jane@bistro.com",
    "fullName": "Jane Admin"
  },
  "role": "admin",
  "restaurantId": "uuid-or-null"
}
```

### Errors

| HTTP | Meaning |
|------|---------|
| 401 | Not authenticated (no valid session cookie) |
| 403 | Authenticated but profile not found |

### Caching
`export const dynamic = 'force-dynamic'` — always reads the live session, never cached. Safe to call on every page render to gate role-based UI.

---

## DB: Migration 0005_invite_tokens.sql

**Guillermo must run this migration before `/api/invites/send` (Agent B) goes live.**

Adds to `profiles`:
- `invite_token text` — unique where not null
- `profiles_invite_token_unique` index (partial, `WHERE invite_token IS NOT NULL`)

Existing rows default to `invite_token = NULL` — no backfill needed.

---

## lib/auth/signup.ts — Orchestration helper

Entry point: `performSignup(input: SignupInput): Promise<SignupResult>`

Steps (with rollback):
1. `auth.admin.createUser` — creates Supabase Auth user with email_confirm=true
2. `restaurants.insert` — status='unlisted', slug generated from name (collision-safe)
3. `profiles.insert` — role='admin', restaurant_id set
4. `stripe.customers.create` — metadata: `{ restaurantId, adminId }`; idempotency key: `signup-customer-{userId}`
5. `stripe.paymentIntents.create` — amount: 9000 (quarterly) or 12000 (semiannual); setup_future_usage: 'off_session'; idempotency key: `signup-pi-{userId}-{plan}`

On any failure: all created resources deleted in reverse order.

## lib/auth/invite.ts — Token helpers

- `generateInviteToken()` — `crypto.randomBytes(32).toString('base64url')`. Pure, no DB.
- `validateInviteToken(token)` — DB lookup, checks `accepted_at IS NULL` + `invited_at + 7d > now()`.
- `acceptInvite(profile, password)` — sets Supabase Auth password, marks `accepted_at`, clears `invite_token`, returns `{ redirectUrl }`.
