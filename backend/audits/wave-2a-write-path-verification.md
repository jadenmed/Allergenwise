# Wave 2A Write-Path Verification — gate before migration `0011_rls_hardening.sql`

**Date:** 2026-05-09
**Mode:** Read-only verification.
**Purpose:** Prove that every callsite mutating one of the 7 tables affected by Wave 2A's RLS-policy drops uses a service-role Supabase client. RLS is bypassed by service-role; therefore dropping the user-role-grant RLS policies cannot 401 any production write path.

If any callsite uses `createBrowserClient` / `createClientSupabase` for a write to one of the 7 tables, OR a non-service-role server client, this doc instructs **STOP — do not run the migration**.

## Tables in scope

`certificates`, `restaurants`, `exam_attempts`, `profiles`, `lesson_progress`, `submissions`, `reviews`.

## Methodology

For each table:
1. `grep` for `from('<table>')` in all `.ts` / `.tsx` under `app/`, `lib/`, `components/`, `scripts/` (excluding `tests/`).
2. For each match within 4 lines of `.insert(`, `.update(`, `.upsert(`, or `.delete(`, record file:line, verb, and the client constructor used in that file (read from the `import` and the local-`const` initializer).
3. For each handler with both a user-role client (`createServerSupabase`) and a service-role client (`createServiceDb` / `createServiceSupabase`) imported, confirm the user-role client is used only for `auth.getUser()` and not for the mutation.

Audit also re-greps for `createBrowserClient` and `createClientSupabase` invocations anywhere under `app/(admin)/**/*.tsx` and `components/**/*.tsx`, in case a UI surface introduced a direct row write.

## Per-table inventory

### certificates

| File:Line | Verb | Client used | Auth gate | Verdict |
|---|---|---|---|---|
| `app/api/certs/generate/route.ts:192-193` | UPDATE pdf_storage_path | `createServiceSupabase()` | `x-internal-secret` (CRON_SECRET) | OK |
| `app/api/exam/submit/route.ts:214-220` | INSERT new cert (primary) | `createServiceDb()` | learner session via `createServerSupabase().auth.getUser()` | OK |
| `app/api/exam/submit/route.ts:235-240` | INSERT new cert (retry path) | `createServiceDb()` | same | OK |
| `app/api/stripe/webhook/route.ts:322-330` | UPDATE on cert-fee payment confirmation | `createServiceSupabase()` | Stripe HMAC signature | OK |

### restaurants

| File:Line | Verb | Client | Auth gate | Verdict |
|---|---|---|---|---|
| `app/api/submissions/create/route.ts:179-188` | UPDATE cuisine/specialties/status | `createServiceDb()` | admin session + DB role re-check | OK |
| `app/api/submissions/create/route.ts:217-220` | UPDATE rollback (status reset) | `createServiceDb()` | same | OK |
| `app/api/submissions/create/route.ts:239-242` | UPDATE rollback (status reset, catch path) | `createServiceDb()` | same | OK |
| `app/api/cron/expire-listings/route.ts:34-37` | UPDATE status='paused' | `createServiceSupabase()` | Bearer CRON_SECRET | OK |
| `app/api/cron/expire-subscriptions/route.ts:89-92` | UPDATE status='paused' (cascading) | `createServiceSupabase()` | Bearer CRON_SECRET | OK |
| `app/api/stripe/webhook/route.ts:445-447` | UPDATE stripe_customer_id (customer.updated event) | `createServiceSupabase()` | Stripe HMAC signature | OK |
| `lib/auth/signup.ts:148-156` | INSERT during org signup | `createServiceSupabase()` (passed in) | `/api/auth/signup` route enforces public flow + Stripe-pi-creation gating | OK |
| `lib/auth/signup.ts:174-176` | DELETE rollback if signup fails | `createServiceSupabase()` | same | OK |
| `lib/auth/signup.ts:221-223` | UPDATE stripe_customer_id post-signup | `createServiceSupabase()` | same | OK |
| `db/migrations/0009_decide_submission_fn.sql` (RPC `decide_submission`) | UPDATE on reviewer approve | SECURITY DEFINER (runs as table owner = postgres = bypasses RLS) | reviewer session via `lib/reviewer/decide.ts:30` | OK |

### exam_attempts

| File:Line | Verb | Client | Auth gate | Verdict |
|---|---|---|---|---|
| `app/api/exam/start/route.ts:168-180` | INSERT new attempt | `createServiceDb()` | learner session via `createServerSupabase().auth.getUser()` | OK |
| `app/api/exam/submit/route.ts:110-117` | UPDATE auto-submit on time-expiry | `createServiceDb()` | same | OK |
| `app/api/exam/submit/route.ts:176-183` | UPDATE submitted_at + score + passed | `createServiceDb()` | same | OK |
| `app/api/cron/exam-timeout-sweep/route.ts:140-150` | UPDATE auto-submit abandoned | `createServiceSupabase()` | Bearer CRON_SECRET | OK |

### profiles

| File:Line | Verb | Client | Auth gate | Verdict |
|---|---|---|---|---|
| `app/api/admin/csv-upload/route.ts:232-240` | INSERT bulk learner profiles | `createServiceDb()` (via `verifyAdmin` → `serviceClient`) | admin session + DB role re-check | OK |
| `app/api/invites/send/route.ts:173-180` | INSERT learner profile (single invite) | `createServiceDb()` | admin session + DB role re-check | OK |
| `app/api/invites/[id]/resend/route.ts:110-115` | UPDATE invite_token + invited_at | `createServiceDb()` | admin session + DB role re-check | OK |
| `lib/auth/invite.ts:119-125` | UPDATE on accept (clear token, set accepted_at, set name) | `createServiceSupabase()` | invite-token validation (CSPRNG token) | OK |
| `lib/auth/signup.ts:181-198` | INSERT admin profile during org signup | `createServiceSupabase()` | public signup flow | OK |
| `lib/auth/signup.ts:200-202` | DELETE rollback | `createServiceSupabase()` | same | OK |

### lesson_progress

| File:Line | Verb | Client | Auth gate | Verdict |
|---|---|---|---|---|
| `app/api/lesson/progress/route.ts:206-208` | UPSERT (watched_seconds + status) | `createServiceDb()` | learner session via `createServerSupabase().auth.getUser()` + handler-level watched_seconds anti-cheat | OK |
| `app/api/lesson/[lessonId]/complete/route.ts:120-130` | UPSERT mark complete | `createServiceDb()` | learner/admin session + module-lock check | OK |

### submissions

| File:Line | Verb | Client | Auth gate | Verdict |
|---|---|---|---|---|
| `app/api/submissions/create/route.ts:250-260` | INSERT submission | `createServiceDb()` | admin session + eligibility check + Stripe charge confirmation | OK |
| `app/api/stripe/webhook/route.ts:361-365` | UPDATE stripe_payment_intent_id (payment confirmation) | `createServiceSupabase()` | Stripe HMAC signature | OK |
| `db/migrations/0009_decide_submission_fn.sql` (RPC `decide_submission`) | UPDATE on reviewer approve/reject/info_requested | SECURITY DEFINER | reviewer session via `lib/reviewer/decide.ts:30` | OK |

### reviews

| File:Line | Verb | Client | Auth gate | Verdict |
|---|---|---|---|---|
| `app/api/reviews/submit/route.ts:199-205` | INSERT pending review (public submit) | `createServiceDb()` | rate-limit table + honeypot field check (no session — public endpoint, intentional) | OK |
| `app/api/reviewer/reviews/[id]/decide/route.ts:127-130` | UPDATE status='published'\|'hidden' | `createServiceSupabase()` (line 64 falls through after session-auth-check on `createServerSupabase()`) | reviewer session + role check | OK |

## Browser-side `createBrowserClient` / `createClientSupabase` audit

The only file in the entire codebase that imports `createClientSupabase`:

- `app/(admin)/admin/submit/SubmitClient.tsx:32, 448, 492` — used **only** for `supabase.storage.from('restaurant-photos').upload(...)` and `.remove(...)`. **Does NOT touch any of the 7 tables.** No row INSERT/UPDATE/UPSERT/DELETE.

The Storage upload does rely on the auth cookie being JS-readable (RLS on `storage.objects` requires authenticated user). After P0 #8 cookie hardening (httpOnly), this upload will silently 401 the next time the form submits a new photo. **This is the F-S6 follow-up logged in `audits/followups.md`. It does NOT affect the seven tables in this wave's RLS migration.**

## Anywhere else?

`grep -rn "createBrowserClient\|createClientSupabase" app/ components/ lib/ --include="*.ts" --include="*.tsx"` — single match in `SubmitClient.tsx`, plus the export site `lib/supabase/client.ts:9`. No other consumers.

## RPC inventory

`grep -rnE "\.rpc\(['\"]"`:

- `lib/reviewer/decide.ts:130-138` — `supabase.rpc('decide_submission', ...)` — service-role caller, RPC is SECURITY DEFINER which bypasses RLS by design.
- `lib/directory/search.ts:112` — references `'search_restaurants'` RPC in a comment (not an active call); the active code uses Supabase JS query builder (`.from('restaurants')` chains in `app/api/search/route.ts`).

No RPC paths exposed to user-role JWTs that could rely on dropped policies.

## Verdict

**SAFE TO PROCEED with the migration.** Every row-mutation path on the 7 affected tables uses a service-role client (or a SECURITY DEFINER RPC). Zero callsites use `createBrowserClient` / `createClientSupabase` for row mutations. Dropping the user-role-grant RLS UPDATE policies and the `using(true)`/`using(status='listed')` SELECT policies cannot 401 any production write path.

**One known follow-on consequence (already accepted):** SubmitClient.tsx's browser-side Supabase Storage upload will 401 after P0 #8 cookie hardening. Not a row-table issue. Logged as F-S6 (P0) in `audits/followups.md` and scheduled for Wave 2A.5 immediately after this wave.
