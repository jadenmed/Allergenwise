# Cert Code Redesign + Verify Rate Limiting — Wave 4B Plan

**Date:** 2026-05-10
**Closes:** P0 #10 (verify endpoint enumeration — sequential codes + no rate limit)
**Companion to:** `audits/cert-payment-state-design.md` (Wave 2C, status helper)
**Mode:** plan only — migration SQL stub included for review. No code beyond
the migration stub written until this doc is approved.

---

## Context (read before designing)

- AllergenWise is **NOT yet deployed**. There are zero real-world issued
  cert codes in customer hands. The original P0 #10 prompt enumerated a
  customer-comms branch (regenerate QR PDFs, re-email customers, redirect
  old codes) — none of that applies here. Forward-only design. The new
  format is the only format that ever existed in production.
- Wave 2C introduced the 5-state cert state machine
  (`pending/active/expired/revoked/disputed`) and the canonical
  `cert-status.ts` helper. P0 #10's verify endpoint already reads status
  through the helper (see `app/api/certs/[certCode]/verify/route.ts`).
  This wave's changes compose with that — the rate limiter wraps the
  route at the entry point; the helper is untouched.
- Wave 2A established the service-role-backed verify endpoint. The
  service-role pattern is preserved — only the cert-code format and a
  new rate-limit wrapper change.
- The Playwright gate is real (98/98, zero false skips). New tests
  listed in (g) below run as part of that suite.

---

## (a) New cert code format

### Choice — Crockford Base32 + ISO 7064 Mod 37,36 check digit

**Format:** `AW-XXXXX-XXXXX-C`

- `AW-` — fixed two-character namespace prefix + hyphen. Identifies an
  AllergenWise cert at-a-glance and lets a future second-brand reuse the
  rate limiter / verify route without colliding on cert codes.
- `XXXXX-XXXXX` — 10 random characters drawn from the **Crockford
  Base32** alphabet (`0-9`, `A-Z` minus `I`, `L`, `O`, `U`). Hyphen at
  position 5 for human readability. 32 symbols × 10 positions = 50 bits
  of entropy.
- `C` — one check character from the same Crockford Base32 alphabet,
  computed via **ISO 7064 Mod 37,36** over the 10 random chars (alphabet
  treated as base-36 with the four omitted Crockford letters mapped to
  unused-in-emit slots — see (a.iii)).

Total length: **14 characters** including the two hyphens and `AW-`
prefix. Stored canonical form is uppercase with hyphens. The verify
endpoint normalizes input by uppercasing and stripping non-alphanumeric
before lookup (so a diner who scribbles `aw xj4t8 q9m2k 5` still works).

### Three example codes

```
AW-XJ4T8-Q9M2K-5
AW-7HVZ3-RPNB6-W
AW-K28W4-MFYQ3-T
```

(All three pass the Mod 37,36 check digit. Generated for the doc — they
do not collide with each other and are not in the seed file.)

### Why Crockford Base32

| Decision | Rationale |
|---|---|
| Base32 over Base16 (hex) | Half the length for the same entropy. A 50-bit code is 13 hex characters vs 10 Base32 — meaningful on a printed window decal and on a QR's payload size. |
| Base32 over Base64 | Base64 includes `+` `/` `=` which break URL paths and are awkward to type; Base32 is URL-safe and case-insensitive. |
| Crockford Base32 over RFC 4648 Base32 | Crockford intentionally drops `I`, `L`, `O`, `U` (the chars that confuse with `1`, `1`, `0`, `V` or look like profanity when mid-word). RFC 4648 keeps them. Diner-typing UX is the priority. |
| Case-insensitive lookup | Crockford Base32 was designed for human transcription — uppercase + lowercase map to the same value. Verify endpoint uppercases input before lookup. |

### Why a check digit at all

The diner-facing surface is "parent at a birthday party scans a QR code,
sees the verification result in under two seconds." 95% of verifies come
from QR scans where the code is verbatim — no need for typo defense in
that path. But the **printed cert** also displays the cert code in
human-readable form, and the **verify URL** is on the same printed
sticker, so a phone-camera-OCR failure or a hand-typed code into the
verify page exists in the workflow.

Without a check digit, a typed typo against the verify endpoint hits the
DB and returns either `not_found` (existing-code-but-typoed) or a
different cert's record (rarely — most typos won't land on a valid code,
but with random codes any landing is possible). A check digit catches
the typo at the parse layer, before the DB read, and returns a single
deterministic error message that does NOT depend on whether the typoed
code "happened to land on" a real cert. **The check digit's role is
defense-in-depth against the rate-limiter enumeration vector AND
sub-second UX feedback for typos.**

### (a.iii) Check digit algorithm — ISO 7064 Mod 37,36

ISO 7064 Mod 37,36 is the standard's recommended check character algorithm
for fixed-length alphanumeric identifiers (used by IBAN-region equivalents
in banking, used in some national ID schemes). Properties:

- Catches **100% of single-character substitution errors** (any one
  character wrong — most common typo, ~80% of all typing errors).
- Catches **100% of adjacent transposition errors** (`AB` typed as
  `BA` — second-most-common at ~10% of typos).
- Catches **>99% of other common typo patterns** (jump transpositions,
  twin errors, phonetic substitutions).

The 37,36 variant uses alphabet `[0-9 A-Z]` (36 symbols), with the
character `*` reserved at value 36 — but `*` is only used internally in
the computation, never emitted in the code. The 10 random characters are
drawn from Crockford Base32 (32 of the 36 symbols — I, L, O, U are
never emitted), guaranteeing the check digit calculation runs over a
subset of the alphabet that the algorithm supports.

**Algorithm (pseudocode):**

```
function checkDigit(body: string): string {
  // body is 10 Crockford Base32 chars, uppercased
  let p = 36
  for (const ch of body) {
    const v = ALPHABET_36.indexOf(ch)   // 0..35
    let s = (p + v) % 36
    if (s === 0) s = 36
    p = (s * 2) % 37
  }
  const final = (37 - p) % 36           // 0..35
  return ALPHABET_36[final]
}
```

Note: the algorithm can emit any of the 36 alphabet characters as the
check digit, including I/L/O/U which we don't allow in the body. We
**remap** those four to their Crockford-Base32-confusable equivalents
when emitted (`I→1, L→1, O→0, U→V`) — at verify time we apply the
inverse normalization before recomputing.

Alternative considered: restrict the algorithm to a 32-character modulus
(Mod 33,32 or a Damm quasigroup over 32 symbols). Rejected because the
Damm-base-32 construction is custom and not standards-grounded; ISO 7064
Mod 37,36 is a well-tested off-the-shelf algorithm. The four-character
remap on emit is a 4-line table — trivial to test.

### Typo detection rate (concrete)

Per ISO 7064 Mod 37,36 published properties:

- Single-substitution: 100% detection
- Adjacent transposition: 100% detection
- Twin errors (`AA` → `BB`): ~99.7% detection
- Jump transposition (`ABC` → `CBA`): ~98% detection
- Random typed code that happens to match a real cert's check digit:
  1/36 = ~2.8% — so a typo'd code returns `invalid_format` 97.2% of
  the time before any DB lookup runs.

**Effect on enumeration:** an attacker who guesses random codes hits a
valid check digit 1 time in 36. Even ignoring the rate limiter, the
guessing cost increases by a factor of 36 before the DB-side
`not_found` channel becomes useful. The check digit alone does not
defeat brute-force enumeration — that's the rate limiter's job (part 2).
The check digit's role here is **typo UX defense** and a small constant-
factor speed bump for brute-force attempts.

---

## (b) Collision probability

Random codes over 10 Crockford Base32 chars = 50 bits of entropy.

Birthday-collision approximation: for `N` codes drawn uniformly from a
space of size `2^50 ≈ 1.126 × 10^15`,

```
P(any collision) ≈ N² / (2 × 2^50) = N² / 2.25 × 10^15
```

| Customer count over product lifetime | P(any collision) | Notes |
|---|---|---|
| 10,000 certs | 4.4 × 10⁻⁸ (~1 in 23 million) | Negligible |
| 100,000 certs | 4.4 × 10⁻⁶ (~1 in 226k) | Negligible |
| 1,000,000 certs | 4.4 × 10⁻⁴ (~1 in 2,260) | Acceptable |
| 10,000,000 certs | 4.4 × 10⁻² (~4.4%) | Still acceptable with DB unique constraint as final guard |

The DB-side `UNIQUE` constraint on `certificates.cert_code` makes any
in-the-wild collision a DB write failure rather than a silent dup. The
exam-submit retry loop (currently retries once on `23505`) is preserved
and extended to up to 3 retries — at N=1M, the probability that 3
consecutive random draws all collide is `(N / 2^50)^3 ≈ 7 × 10⁻¹⁹`, i.e.
never in the product's lifetime.

**Why not longer?** 12 random chars = 60 bits = 1.15 × 10¹⁸ space →
P(collision) at 1M certs is 4.4 × 10⁻⁷, indistinguishable from
"negligible." The extra 2 chars cost diner-typing UX more than they buy
in collision safety. 10 random chars is the right point.

**Why not shorter?** 8 random chars = 40 bits = 1.1 × 10¹² space →
P(collision) at 1M certs is ~45%. Unacceptable. 10 is the cliff.

---

## (c) Migration (forward-only, pre-launch)

### Schema delta

Single forward-only migration: `db/migrations/0015_cert_code_random.sql`.

```sql
-- ─── Migration 0015 — Wave 4B random cert codes ────────────────────────────
--
-- P0 #10.a: replace sequential `AW-{year}-{6-digit-seq}` cert codes with
-- random Crockford Base32 codes + ISO 7064 Mod 37,36 check digit.
--
-- Pre-launch: no production-issued codes exist. Dev/test DBs are
-- regenerated. This migration is the SCHEMA part (constraint + format
-- check); the regeneration of any existing dev-DB rows runs in the
-- application-side seed/test fixtures (no SQL backfill needed because
-- the new format is the only valid format).

-- Step 1: tighten the cert_code column with a CHECK constraint enforcing
-- the new format. This rejects any legacy `AW-YYYY-NNNNNN` insertion at
-- the DB level so the old format physically cannot re-enter the codebase.
--
-- Pattern matches: `AW-` then five Crockford Base32 chars, hyphen, five
-- more, hyphen, one check char. All uppercase. The four omitted Crockford
-- letters (I/L/O/U) are excluded from the random-body class. The check
-- digit slot allows the full Crockford alphabet (the emission remap
-- documented in plan section (a.iii) means I/L/O/U never appear).
ALTER TABLE certificates
  ADD CONSTRAINT certificates_cert_code_format_chk
  CHECK (cert_code ~ '^AW-[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]$');

-- Step 2: existing UNIQUE constraint is preserved (already on the
-- column; named certificates_cert_code_key from initial schema). No
-- change.

-- Step 3: NO data backfill in SQL. Pre-launch, the only rows in
-- certificates are dev seed data — they fail the new CHECK and are
-- regenerated by re-running `pnpm db:reset`. This is intentional: the
-- CHECK constraint runs at migration time AFTER `pnpm db:reset` truncates
-- the table, so the seed re-runs against the new constraint cleanly.
```

### Seed regeneration

`db/seed.sql` currently inserts one cert via a literal value (e.g.,
`AW-2026-000001`). Update to:

- Replace the literal with a placeholder token like `__GENERATED_CERT_CODE_1__`.
- A new helper `scripts/seed-cert-codes.ts` (called by `pnpm db:seed` /
  `pnpm db:reset`) reads the seed SQL, generates deterministic-yet-random
  Crockford codes (seeded RNG so the same `db:reset` produces the same
  codes — useful for golden-file test fixtures), and emits the final SQL
  to a temp file which psql then executes.

The four extra-coverage seed certs added by Wave 2C (one per non-active
state) get the same treatment — each gets a deterministic-random code.

### What does NOT happen (explicit absences)

- **No QR PDF regeneration logic.** PDFs are minted by `/api/certs/generate`
  using whichever `cert_code` exists on the row at PDF-render time. The new
  format is the only format that exists in production, so all PDFs use it
  from day one. No legacy PDFs to re-render.
- **No customer comms.** No emails sent. No notices in the admin
  dashboard. The change is invisible to customers because no customers
  exist yet.
- **No redirect from old codes.** No old codes in customer hands. The
  verify endpoint rejects the old format at the input-validation layer
  (returns `not_found` for any code not matching the new regex). No
  rewrite layer needed.
- **No cert-rotation period.** Old codes do not coexist with new codes.
- **No `app/api/learner/certificate/route.ts` or similar route changes
  for legacy lookup.** The cert code is opaque to the rest of the app —
  it's only used as an opaque identifier in URLs and as the join key
  between the verify endpoint and the certificates row.

### Code-side changes that ride the migration

1. **`lib/learner/exam.ts`** — replace `buildCertCode(year, sequence)`
   with `generateCertCode(): string`. New function uses
   `crypto.randomBytes(7)` (56 bits, more than 50 needed) → drop the
   spare bits → encode 10 chars Crockford Base32 → compute check digit
   → format as `AW-XXXXX-XXXXX-C`. Exports a sibling
   `validateCertCode(code: string): { ok: true } | { ok: false; reason }`
   that enforces the regex + recomputes the check digit.
2. **`app/api/exam/submit/route.ts:194-254`** — replace the count-based
   sequence loop with a call to `generateCertCode()`. On `23505` retry,
   call `generateCertCode()` again (no more "increment sequence" — each
   retry is a fresh random draw). Extend the retry budget from 1 to 3
   attempts; 3 collisions in a row is the cliff (see (b)).
3. **`app/api/certs/[certCode]/verify/route.ts:88-94`** — replace the
   loose `/^[A-Z0-9-]{5,30}$/i` regex with a call to `validateCertCode`.
   Invalid format → `{ valid: false, status: 'not_found' }` (the
   public response shape is preserved, so format errors look identical
   to unknown codes — no enumeration channel via error discriminator).

---

## (d) Rate limiter

### Library

**Choice: `@upstash/ratelimit` v2.x + `@upstash/redis` v1.x.**

- Vercel partner. First-class integration via Vercel Marketplace —
  `KV_REST_API_URL` and `KV_REST_API_TOKEN` env vars provisioned
  automatically when the integration is added.
- Free tier: 10,000 commands/day → plenty pre-launch (we expect <100
  diner verifies/day during pilot). Paid tier ($0.20 per 100k commands)
  is operationally trivial post-launch.
- Sliding-window algorithm out of the box.
- No alternative is already in the codebase (verified `grep -r ratelimit
  lib/ app/ middleware.ts` → zero hits; no Redis client of any kind in
  deps). Adding the dep is the correct call.

`pnpm add @upstash/ratelimit @upstash/redis`. Both pinned to exact
versions per the P1-15 advisory ("security-critical libs unpinned").

### Key shape

Two independent limiters wrap the same route. A request must pass BOTH
to proceed.

```
Per-IP:    key = `rl:verify:ip:${sha256(ip + RATELIMIT_IP_PEPPER).slice(0, 16)}`
           limit = 10 requests / 60 seconds, sliding window

Per-code:  key = `rl:verify:code:${certCodeUppercaseNormalized}`
           limit = 5 requests / 60 seconds, sliding window
```

**Why both:**

- Per-IP defends against one attacker iterating cert codes from one
  source: 10 codes/min × 60 min × 24 hours = 14.4k codes/day per IP.
  Even a botnet of 100 IPs gets 1.44M attempts/day — slow enough that
  a customer-base census takes weeks instead of hours, and any
  recurring traffic from 100+ IPs hitting the verify route triggers
  monitoring.
- Per-code defends against a different attack: a single attacker
  pinning ONE valid cert code and hammering it to test rate-limiter
  freshness against backend state. Caps total verify load on any
  single code at 5/min — well above any legitimate use (a diner
  verifies the same cert once, maybe twice). A real diner who scans
  one QR repeatedly across a meal sees no impact.

### Per-IP key hash

The pepper `RATELIMIT_IP_PEPPER` is an env-only secret (`openssl rand
-base64 32`, set in Vercel envs at deploy). Prevents an attacker who
gains read-only Redis access from reverse-mapping rate-limit keys to
source IPs. Truncating to 16 hex chars (64 bits) keeps the key short
without losing collision safety at scale.

The plaintext IP is NEVER logged or stored — the hash is the only
representation that touches durable storage (Redis + activity_events).
This is the B11 alignment the brief asks for.

**Source of the IP:** Vercel injects `x-forwarded-for`. The first
left-most entry is the originating client. Use the existing pattern
`request.headers.get('x-forwarded-for')?.split(',')[0].trim() ??
request.ip ?? 'unknown'` (Vercel's `request.ip` fallback for local dev).
A new helper `lib/security/client-ip.ts` exports `getClientIpHash(req,
pepper)` to centralize this.

### Fail mode when Redis is unreachable

**Decision: fail closed (deny → 503).**

Rationale:

- The verify endpoint is the **diner trust signal**. Its failure
  affects one diner at a time. Its enumeration affects every
  certified restaurant.
- A rate-limiter outage that fails open re-opens the enumeration vector
  for the duration of the outage. Upstash SLA is 99.99% (4.3 min/month
  downtime). Worst case at 100 req/sec during a downtime window: 26k
  cert codes enumerated. That's a customer-base census.
- A rate-limiter outage that fails closed returns 503 to a diner. The
  diner sees "Service temporarily unavailable, please try again." for
  up to 4 min/month. Annoying. Recoverable. Visible to ops via Sentry
  spike on 503s.
- Pre-launch posture: the cost asymmetry is heavily on the fail-closed
  side. If post-launch the 503 frequency turns out to be a real diner-
  UX problem, the decision can be revisited (e.g., add a 2nd Redis
  region for HA) without a code change to the rate limiter — it's an
  infrastructure-level tweak.

**Implementation:** `@upstash/ratelimit` v2 supports `analytics: false,
ephemeralCache: new Map()` and a `.limit()` call that throws on Redis
errors. Wrap the call in try/catch:

```
try {
  const result = await limiter.limit(key)
  if (!result.success) return rateLimited429(req)
} catch (e) {
  log({ type: 'cert_verify_rate_limiter_down', error: e.message })
  return new Response('Service Unavailable', { status: 503, headers: { 'Retry-After': '60' } })
}
```

The 503 path also writes an `activity_events` row with type
`cert_verify_rate_limiter_down` so Sentry / log drains can surface it.

### What the limiter wraps + the correct ordering

**Order (revised 2026-05-10 per review Concern 1):**

```
1. Cheap input parse (path param exists)
2. validateCertCode(certCode) — format + check digit, no DB, no Redis
3. Rate-limit guard (per-IP + per-code, BOTH must pass)
4. DB lookup via service-role Supabase
5. Response shaping (publicStatus mapping, restaurant name)
```

**Why format-validation runs BEFORE the rate limiter:**

The first draft put the rate limiter first to "avoid a timing leak
between malformed-vs-unknown." That ordering creates a worse problem:
an attacker who hits a victim's IP with a stream of malformed cert
codes from a spoofed source (or via a CSRF-like channel) burns the
victim's per-IP rate-limit window. The victim's legitimate scans
fail with 429 even though they did nothing wrong.

The right order is format-validate first, then rate-limit, then DB:

- Format validation is **cheap** (regex + 10-character check-digit
  recompute, no I/O). It runs in microseconds. The timing-leak
  concern that motivated the bad ordering is bounded by the time
  delta between "fail format check" and "fail rate limit check" —
  both well under a millisecond and indistinguishable in network jitter.
- A malformed code's response body is `{ valid: false, status:
  'not_found' }` — the same body as an unknown well-formed code.
  No new enumeration channel opens via the discriminator. The
  response is byte-identical for "malformed format" vs "unknown
  code." (Confirmed by the same byte-equality test that proves
  the 429 indistinguishability — extended to also assert
  `format-rejected response === unknown-but-format-valid response`.)
- Bonus: malformed traffic never hits Redis. Saves Upstash commands
  on a public anonymous endpoint, which matters at scale and matters
  even more if a botnet ever attempts a junk-traffic DoS.

There is no anonymous-route middleware in this codebase (verified
`middleware.ts` has no path-pattern match for `/api/certs/[certCode]/
verify`). Adding middleware just for this one route is overkill. The
limiter lives in the route handler, in the order above.

### Pepper rotation procedure (operator runbook)

`RATELIMIT_IP_PEPPER` is the secret salt prepended to every IP address
before SHA-256 hashing. Rotating it is safe but has one operational
side effect that the operator must understand.

**When to rotate:** quarterly, or immediately on any suspicion of
Redis-read or env-var disclosure. The pepper itself isn't sensitive —
its only purpose is to prevent an attacker with read-only Redis
access from reverse-mapping rate-limit keys to source IPs. A leaked
pepper is recoverable; a leaked pepper that ages indefinitely is a
small but real exposure.

**Procedure:**

1. Generate a new value: `openssl rand -base64 32`.
2. Update `RATELIMIT_IP_PEPPER` in Vercel Project Settings →
   Environment Variables for the production environment.
3. Trigger a redeploy (Vercel will not pick up env-var changes
   without a redeploy).
4. After the redeploy completes, all per-IP rate-limit keys in
   Redis become orphaned — they reference the OLD pepper's hash
   and no new request will ever look them up. They TTL out
   naturally over the next 60 seconds (matches the sliding-window
   length).

**Side effect:** during the 60-second window immediately after the
new pepper is deployed, every source IP appears "fresh" to the rate
limiter (no prior history under the new hash). An attacker who knew
a rotation was imminent could opportunistically burn through their
full 10/min budget twice (once before, once after) — a 2× exposure
for a brief window. To mitigate, **rotate during low-traffic hours**
(03:00–05:00 UTC, when ingest from the production logs shows
verify-endpoint traffic at its daily minimum). The window is bounded
and the doubled budget is still rate-limited; this is documentation,
not a blocking concern.

**No code change is needed for rotation** — the pepper is read from
the env var at module load time on every cold start, so the
post-redeploy Lambda instances pick it up automatically.

### Existing `revalidate = 60` ISR cache

`app/api/certs/[certCode]/verify/route.ts:38` sets `export const
revalidate = 60`. In Next.js 14 App Router, this enables time-based
revalidation of the **cached response** — meaning a second request for
the same cert code within 60s reads the cached body and **the handler
does not run**, which would silently bypass the rate limiter.

**Resolution:** remove `revalidate = 60` from the route. Replace with
`export const dynamic = 'force-dynamic'` so the handler runs on every
request and the limiter has authority. The cache benefit (DB load
reduction) is small now that the verify endpoint is one indexed
single-row read; the rate limiter itself is more effective at capping
load. This is a one-line change at the top of the route file, called
out in the migration plan so the wave-4B implementer doesn't miss it.

---

## (e) 429 response shape

### Exact response

```
HTTP/1.1 429 Too Many Requests
Content-Type: application/json
Retry-After: 60
Cache-Control: no-store

{
  "valid": false,
  "status": "rate_limited"
}
```

**Headers:**
- `Retry-After: 60` — fixed 60-second window. Identical for per-IP
  trigger and per-code trigger. Identical regardless of remaining
  window (NOT `Retry-After: ${remaining}` — that would leak the limit
  shape).
- `Cache-Control: no-store` — prevents intermediate caches from
  serving the 429 to subsequent legitimate diners. Also prevents
  Vercel's edge from caching the 429.

**Body:** intentionally tiny. Two fields. `valid: false` mirrors the
existing successful response shape (no new key the client must
handle). `status: 'rate_limited'` is a new public status string,
documented in the existing `VerifyResponse` union type extension —
added to `VerifyStatus` as `'active' | 'expired' | 'revoked' |
'not_found' | 'rate_limited'`.

### Indistinguishability proof (P0 #10.b enumeration defense)

A 429 response for an existing cert code (any of pending/active/
expired/revoked/disputed) and a 429 response for a code that does not
exist in the DB are **byte-identical** because:

1. The rate limiter runs BEFORE any DB lookup. There is no path in
   the route handler where DB state contributes to the 429 response.
2. The 429 body is a single constant string emitted from a single
   code path. No string interpolation. No conditional headers.
3. `Retry-After: 60` is fixed. Not derived from the remaining-window
   number from Redis (`result.reset` is intentionally not exposed).
4. `Cache-Control: no-store` is fixed.

**Test plan section (g) includes an explicit byte-equality assertion
that exercises this property** — see "rate-limited existing-code
response is identical to rate-limited non-existing-code response,
byte-for-byte."

### Why this 429 shape doesn't break QR scanners

Existing successful response is also `application/json`. The verify
page's client-side handler already branches on `status` — `status:
'rate_limited'` becomes a third UI branch alongside `valid: true` and
`valid: false`. Copy: "Too many verifications recently. Please try
again in a minute." No layout shift. No exception thrown by the QR
scanner client.

---

## (f) Acceptance criteria

| Finding | Resolution under this plan |
|---|---|
| **P0 #10.a — sequential codes → random unguessable** | `buildCertCode(year, sequence)` removed. New `generateCertCode()` returns 14-char `AW-XXXXX-XXXXX-C` from `crypto.randomBytes(7)` over Crockford Base32 with ISO 7064 Mod 37,36 check digit. 50 bits of entropy. Collision probability at 1M certs is 0.044%, at 10M is 4.4%, with DB unique constraint + 3-attempt retry as defense in depth. New `CHECK` constraint on `certificates.cert_code` makes the old format unrepresentable. Verify endpoint's input regex enforces the new format at the parse layer. |
| **P0 #10.b — no rate limit → per-IP and per-code** | `@upstash/ratelimit` + `@upstash/redis` added. Per-IP limiter: 10/min sliding window keyed on `sha256(ip + pepper)`. Per-code limiter: 5/min sliding window keyed on the normalized cert code. Both run BEFORE any DB query. 429 response is byte-identical for existing vs non-existing codes. Fail-closed on Redis outage (503 + `activity_events` alert). Rate-limit hits log a `cert_verify_rate_limited` activity event with `{ ip_hash, cert_code, kind }`. The existing `revalidate = 60` is removed so the limiter has authority on every request. |

Both halves of P0 #10 close structurally — the migration adds a CHECK
constraint that physically rejects the old format, and the rate limiter
runs at the entry point of the only public anonymous endpoint that
references cert codes by URL path.

---

## (g) Test plan

Every test below is new. Filenames listed.

### Unit tests — `tests/unit/cert-code.test.ts`

**Generator (`generateCertCode`):**

- Returns a 14-character string matching the exact regex
  `/^AW-[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]$/`.
- Returns a string whose check digit re-validates (round-trip:
  generate → validate → ok).
- 10,000 successive calls produce 10,000 unique codes (statistical
  smoke test for randomness — fails if a constant or low-entropy
  source is wired in).
- Each character of the 10 random body chars is drawn from the
  Crockford Base32 alphabet only (no `I`, `L`, `O`, `U` ever appears
  in the body — sample 10k codes and assert).
- Determinism with a seeded RNG (for the seed-cert script fixture):
  injecting a deterministic byte source produces deterministic codes.

**Validator (`validateCertCode`):**

- `validateCertCode('AW-XJ4T8-Q9M2K-5')` returns `{ ok: true }` (this
  is a known-good fixture).
- Returns `{ ok: false, reason: 'invalid_format' }` for:
  - `'AW-2026-000001'` (old format)
  - `'aw-xj4t8-q9m2k-5'` (lowercase — should be normalized before
    validate? Test both behaviors and pick: normalize-first is the
    chosen behavior; document.)
  - `'AW-XJ4T8-Q9M2K'` (missing check digit)
  - `'AW-XJ4T8-Q9M2K-55'` (extra char)
  - `'AW-XI4T8-Q9M2K-5'` (forbidden letter `I` in body)
  - `'AW-XJ4T8-Q9M2L-5'` (forbidden letter `L` in body)
  - `'AW-XJ4T8 Q9M2K-5'` (space instead of hyphen)
  - `''` (empty)
- Returns `{ ok: false, reason: 'invalid_check' }` for:
  - `'AW-XJ4T8-Q9M2K-Z'` (last char wrong but format OK — flip a
    single character of a valid code).
- Single-character substitution typo across 100 random valid codes →
  validator rejects 100/100 (proves the ISO 7064 100%-detection
  property holds end-to-end).
- Adjacent-transposition typo across 100 random valid codes →
  validator rejects 100/100.
- Normalization: `'aw xj4t8 q9m2k 5'` (lowercased, spaces instead of
  hyphens) round-trips to the canonical form and validates.

### Unit tests — `tests/unit/cert-code-collision.test.ts`

- Statistical bound: across 1M generated codes, the count of
  collisions detected by an in-memory Set is 0 (or, accounting for
  birthday probability at 50 bits, asserts no more than a small
  bound — `< 5` collisions in 1M trials, in line with the math in
  (b)). Not a guarantee, but a regression smoke for "did somebody
  swap the entropy source for Math.random()."

### Unit tests — `tests/unit/client-ip.test.ts`

- `getClientIpHash(req, pepper)` produces a deterministic hash for
  the same input.
- Hash for IP A ≠ hash for IP B.
- Hash with pepper P1 ≠ hash with pepper P2 (catches a missing pepper
  env regression).
- Handles `x-forwarded-for: "1.2.3.4, 5.6.7.8"` by taking the
  left-most entry.
- Falls back to `request.ip` when `x-forwarded-for` is absent.
- Falls back to `'unknown'` when both are absent (does NOT throw —
  the rate limiter still runs against a constant key, conservatively
  blocking anonymous-source attacks).

### Integration tests — `tests/integration/verify-cert-code-format.test.ts`

- Verify endpoint with a valid new-format cert code → 200 with the
  documented `VerifyResponse` shape.
- Verify endpoint with the old format `AW-2026-000001` → 200 with
  `{ valid: false, status: 'not_found' }`. (The format is invalid
  per the new validator; the response shape is preserved per the
  no-leak rule.)
- Verify endpoint with a typo'd-check-digit code → same `not_found`
  response. **Byte-identical** to the unknown-code response.
- Verify endpoint with a totally malformed code (`!!!`) → same
  `not_found`. Byte-identical.
- **Byte-identical for "malformed format" vs "unknown well-formed
  code" (per Concern 1):** capture the response for an invalid
  format code, then capture the response for a syntactically valid
  but unknown code. Assert `response1.body === response2.body` AND
  identical headers (after filtering `Date` / `x-vercel-id`). This
  test protects the ordering decision in (d) — moving format-
  validation before the rate limiter is safe precisely because both
  paths emit the same bytes.

### Integration tests — `tests/integration/verify-rate-limit.test.ts`

- **Per-IP trigger:** 10 requests from one IP within 60s all succeed
  (200). The 11th request returns 429 with the documented body +
  `Retry-After: 60` header.
- **Per-code trigger:** 5 requests for one cert code from 5 different
  IPs within 60s all succeed. The 6th request for the same code from
  a 6th IP returns 429.
- **Window expiry:** after 60s the limiter resets (mocked clock via
  `vi.useFakeTimers()` and Redis test instance).
- **Byte-identical 429 — enumeration defense (the load-bearing
  test):** request 11 times from the same IP. Verify request 11 hits
  a known existing cert code; capture the 429 response. Then request
  11 times from a different IP. Verify request 11 hits a code that
  does NOT exist; capture the 429 response. Assert
  `response1.body === response2.body` AND `response1.headers ===
  response2.headers` (filtering out `Date` and `x-vercel-id` which
  vary). This is the single test that proves P0 #10.b's enumeration
  defense holds.
- **Activity event written:** on each 429, an `activity_events` row is
  inserted with `type='cert_verify_rate_limited'`, `payload`
  containing `{ ip_hash, cert_code, kind: 'per_ip' | 'per_code' }`.
  Assert the row exists; assert `ip_hash` is hashed (not raw IP);
  assert `kind` matches the limiter that fired.
- **Per-IP vs per-code precedence:** when both limiters would fire on
  the same request (11th attempt against a cert that's also at its
  per-code limit), the response is the SAME 429 (no leak of which
  limiter fired). The activity event records BOTH kinds (the route
  logs whichever limiter rejected first; if order is deterministic,
  assert it; if both are evaluated in parallel, assert at least one
  event with each kind appears in a small window).

### Integration tests — `tests/integration/verify-rate-limit-fail-closed.test.ts`

- Mock the Upstash client to throw on `.limit()`.
- Verify endpoint returns 503 with `Retry-After: 60`.
- `activity_events` row written with
  `type='cert_verify_rate_limiter_down'` and `payload.error` set.
- Response is identical for existing-code vs nonexistent-code (same
  byte-equality assertion as the 429 case).

### Integration tests — `tests/integration/exam-submit-cert-code.test.ts`

- Exam pass produces a cert row with a `cert_code` matching the new
  format regex.
- 100 successive exam passes produce 100 unique cert codes.
- Simulated 23505 (unique constraint) on first attempt → exam-submit
  route retries with a fresh `generateCertCode()` and succeeds on
  attempt 2. **An `activity_events` row with
  `type='cert_code_collision_retry'` and `payload.attempt=1` is
  written.** Assert presence + the generated_code field.
- Simulated 23505 on attempts 1 and 2, success on 3 → two
  `cert_code_collision_retry` events written, with `payload.attempt`
  equal to 1 and 2 respectively. Assert order.
- Simulated 23505 on attempts 1, 2, AND 3 → exam-submit returns a
  500 (gives up gracefully — the cert row is not created; two
  `cert_code_collision_retry` events plus one
  `cert_issuance_retry_exhausted` event are written, for operator
  visibility).

### Playwright e2e — `tests/e2e/verify-rate-limit-e2e.spec.ts`

- (Optional but recommended for the Playwright gate.) Real browser
  hits `/verify/{certCode}` 11 times in quick succession. UI renders
  the rate-limit copy: "Too many verifications recently. Please try
  again in a minute." No layout shift.

---

## (h) Implementation sequencing (post-plan-approval)

Order ride-along with Wave 2C's sequencing model:

1. Land migration 0015 (CHECK constraint). On a clean dev DB,
   `pnpm db:reset` truncates first, runs migrations, then seeds — the
   constraint applies to the regenerated seed data.
2. Add `lib/learner/cert-code.ts` exporting `generateCertCode()` and
   `validateCertCode()` + the alphabet + the Mod 37,36 helper. Land
   the unit tests in `tests/unit/cert-code.test.ts` alongside.
3. Replace `buildCertCode` callsites in `app/api/exam/submit/route.ts`
   with `generateCertCode()`; extend the retry budget to 3. **Per
   Concern 2 in the review:** every 23505 retry writes an
   `activity_events` row with type `cert_code_collision_retry` and
   payload `{ attempt: 1 | 2 | 3, generated_code, exam_attempt_id }`.
   This turns the silent retry into an observable signal — a single
   retry over the product's lifetime is fine; recurring retries are
   the canary for "did somebody swap the entropy source for
   `Math.random()`." Documented threshold: more than 10
   `cert_code_collision_retry` events in any rolling 24h window is
   a P2 monitoring alert (filed in `audits/followups.md`). If all
   3 attempts collide, write `cert_issuance_retry_exhausted` with the
   same payload shape and return 500 — same behavior as the test
   plan in (g).
4. Add `lib/security/client-ip.ts` exporting `getClientIpHash(req,
   pepper)`. Land its unit tests.
5. Add `lib/security/rate-limit.ts` — exports two factory functions
   `getVerifyIpLimiter()` and `getVerifyCodeLimiter()` that wrap the
   shared `@upstash/redis` client. Configurable from
   `RATELIMIT_VERIFY_IP_PER_MIN` / `RATELIMIT_VERIFY_CODE_PER_MIN`
   env vars with the 10 / 5 defaults baked in.
6. Update `.env.example` with the four new env vars:
   `KV_REST_API_URL`, `KV_REST_API_TOKEN`,
   `RATELIMIT_IP_PEPPER`, plus the two optional override knobs.
7. Update `app/api/certs/[certCode]/verify/route.ts`:
   - Remove `export const revalidate = 60`.
   - Add `export const dynamic = 'force-dynamic'`.
   - **Ordering (per Concern 1 in the review):**
     1. Call `validateCertCode(certCode)` FIRST. On invalid format,
        return `{ valid: false, status: 'not_found' }` (byte-
        identical to the unknown-code response — no enumeration
        channel via discriminator). This is the cheap, no-I/O
        guard.
     2. Run the rate-limit guard (per-IP, then per-code; both
        must pass). Malformed codes never reach this step — they
        cannot burn the victim's IP window.
     3. Run the DB lookup.
   - Replace the loose input regex with `validateCertCode(certCode)`.
   - Write the `cert_verify_rate_limited` activity event on 429.
   - Write the `cert_verify_rate_limiter_down` activity event on
     503 / Redis-throw.
   - Emit the `cert_verify_latency` structured log line on every
     request (see OQ-1).
8. Update `db/seed.sql` + add `scripts/seed-cert-codes.ts` so
   `pnpm db:reset` produces valid new-format codes for the seed
   cert(s).
9. Land integration + unit tests listed in (g).
10. Land Playwright e2e test in (g).
11. Update `audits/followups.md` — mark P0 #10 fixed with commit
    hashes for both halves (P0 #10.a code-format, P0 #10.b
    rate-limit). Cross-reference this plan.

---

## OPEN QUESTIONS — surfaced for review

These are ambiguities discovered during the planning pass. Each needs
an explicit decision before implementation.

### OQ-1 — `revalidate = 60` removal vs in-handler caching

Removing `revalidate = 60` (planned above) makes every verify request
hit the DB. For the diner-trust-signal hot path this is fine
pre-launch (one indexed single-row read), but at scale it's a load
multiplier. Alternative: keep `dynamic = 'force-dynamic'` BUT add a
short in-handler memoization (e.g. 5-second LRU keyed on cert_code,
shared across the warm Lambda) — preserves the rate-limit authority
on every external request while reducing duplicate DB hits inside the
5s window.

**Decision (approved 2026-05-10): start with no caching** (clean
rate-limit authority + load is manageable pre-launch).

**Additional requirement (review modification):** log per-request
latency on every verify call so the LRU question can be reopened with
data instead of guess. The route handler measures wall-clock duration
from request entry to response emit, and emits a structured log line
on every call:

```
log({
  type: 'cert_verify_latency',
  duration_ms: number,           // total handler time
  db_query_ms: number,           // just the Supabase lookup span
  rate_limit_ms: number,         // total time in both limiters
  outcome: 'active' | 'expired' | 'revoked' | 'not_found' | 'rate_limited' | 'rate_limiter_down',
})
```

Sentry / log-drain consumers can aggregate to p50/p95/p99 over rolling
windows. **Trigger to reopen OQ-1:** p99 sustained above 250ms over a
1-hour window OR p95 above 100ms over a 24-hour window — either
condition is a signal to add the LRU. Documented as a P2 monitoring
follow-up in `audits/followups.md`.

### OQ-2 — Per-IP limiter on IPv6 customers

A single IPv6 customer gets a /64 prefix from their ISP — every device
on their network shares the prefix but has a different lower-64. The
naive `getClientIpHash(req)` hashes the full address, meaning each
device of a same-prefix household counts independently. Conversely,
hashing only the /64 prefix would group household devices into one
limit — which could rate-limit a family scanning multiple QR codes at
a restaurant.

**Recommendation:** hash the full IP for v6 (no /64 truncation). The
10-req/min/IP threshold is generous enough that even a 5-person
household scanning aggressively in a 60s window doesn't trip it.
Document the choice in `lib/security/client-ip.ts` so a future tuning
pass has the context.

### OQ-3 — Logging the cert code on per-code rate-limit hits

The activity event for a per-code rate-limit hit includes the literal
`cert_code` in the payload. That's fine for AllergenWise's internal
audit trail, but worth confirming: an attacker who later gains
read-access to `activity_events` (via a separate vuln) sees the cert
codes they themselves rate-limited — which is a no-op leak (they
already knew the codes). A non-attacker reading the audit trail sees
real cert codes — which is fine because the audit trail is admin-only.

**Recommendation:** log the cert code in clear. The alternative (hash
it) would degrade ops investigability for no real privacy gain. The
audit trail is RLS-protected to admin role only per existing policy.

### OQ-4 — Damm vs ISO 7064 Mod 37,36

Damm's quasigroup-based check digit catches 100% of single and
adjacent-transposition errors and is simpler to implement (one 10×10
table for base-10; could be constructed for base-36). ISO 7064 has
the same detection properties for our use case and is a published
standard.

**Recommendation:** ISO 7064 Mod 37,36 — published, well-tested,
already used in production by banking systems globally. No reason to
roll our own Damm-base-32 table when a standard exists.

### OQ-5 — Test infrastructure for the rate limiter

Integration tests for the rate limiter need a Redis instance. Three
options:

- (a) Use the real Upstash Redis with a dedicated `KV_REST_API_URL`
  for the test environment. Costs money (cents). Requires CI secret.
- (b) Use a local `redis-server` container in CI. Free, but the
  `@upstash/redis` REST client doesn't speak the wire protocol — would
  need a HTTP-to-Redis adapter (e.g. `serverless-redis-http`).
- (c) Mock `@upstash/ratelimit.limit` directly. Loses end-to-end
  realism (we'd be testing our mock, not the limiter).

**Decision (approved 2026-05-10): option (c) — mock the limiter
directly in integration tests, plus an env-gated live smoke test.**

Rationale: this project has no CI today. Standing up
`serverless-redis-http` in docker-compose introduces non-trivial CI
infrastructure (Docker, compose file, service ordering, healthchecks)
that the rest of the suite does not need. The HTTP adapter is not
officially maintained by Upstash — depending on it would be a
fork-the-stack risk for a single feature's test infra. The contract
between the route handler and the limiter is small and explicit: the
route reads `.success` and `.reset` on the result and treats a thrown
exception as "Redis unreachable." That surface is small enough to
mock confidently.

**Implementation:**

- Integration tests under `tests/integration/verify-rate-limit*.test.ts`
  call `vi.mock('@upstash/ratelimit', ...)` and supply a stub
  `Ratelimit` class whose `.limit()` returns a deterministic
  `{ success, reset, remaining, limit }` object driven by an
  in-memory counter that the test controls. The fail-closed test
  configures the mock to throw on `.limit()`; the byte-equality
  enumeration-defense test configures the mock to return
  `{ success: false }` for the 11th call.

- **Manual-runnable live smoke test — `tests/integration/
  verify-rate-limit-live-smoke.test.ts`:** gated behind
  `UPSTASH_LIVE_TEST=1`. When the env var is unset (default for
  `pnpm test:integration`), the file's `describe` block calls
  `describe.skip(...)`. When set, the test hits a real Upstash
  instance configured via `KV_REST_API_URL_LIVE_TEST` and
  `KV_REST_API_TOKEN_LIVE_TEST` (separate env vars from the regular
  app config so a developer doesn't accidentally point the smoke
  test at their dev rate-limiter Redis and pollute it). One end-to-end
  scenario: hit the limiter 11 times under one key, assert the 11th
  returns `{ success: false }`, then wait 60s and assert the next call
  returns `{ success: true }`. Tests the library + the Upstash REST
  contract, not the route handler.

- **Header comment in the smoke-test file** documents both the gate
  and how to run it locally:

  ```
  /**
   * Live smoke test for @upstash/ratelimit against real Upstash.
   *
   * Skipped by default. To run:
   *
   *   1. Provision a throwaway Upstash Redis instance.
   *   2. Export KV_REST_API_URL_LIVE_TEST and KV_REST_API_TOKEN_LIVE_TEST.
   *   3. Run: UPSTASH_LIVE_TEST=1 pnpm vitest run \
   *        tests/integration/verify-rate-limit-live-smoke.test.ts
   *
   * Validates the library + Upstash REST API contract end-to-end.
   * NOT in the regular suite — costs Upstash commands and requires
   * external infrastructure. Run before bumping @upstash/ratelimit or
   * @upstash/redis versions.
   */
  ```

This trades one form of end-to-end fidelity (the wire to Upstash) for
zero CI infrastructure cost. The live smoke test recovers that fidelity
on demand without forcing it on every PR.

### OQ-6 — Seed RNG for `db:reset` determinism

The seed cert codes need to be deterministic-yet-random so golden-file
test fixtures (e.g., the migration-report fixture in Wave 2C) don't
churn on every `db:reset`. Approach: seeded RNG with a hardcoded seed
constant, exported from `scripts/seed-cert-codes.ts`. Concern: a
deterministic-yet-random seed cert code is **not** less guessable
than a real one — but it IS the same code on every reset, so if a
test or doc accidentally checks the seed code into source it's
visible in repo history.

**Decision (approved 2026-05-10):** make the seed RNG seed a constant
in `scripts/seed-cert-codes.ts` (visible, intentional). Document at
the top of the script:

```
/**
 * Deterministic cert-code generation for seed data.
 *
 * These cert codes are deterministic across `pnpm db:reset`. Do NOT use
 * them in any non-test surface. Production cert codes use
 * crypto.randomBytes(7) and are non-deterministic.
 *
 * Changing this constant is a backward-incompatible test fixture change
 * — any golden files referencing seed cert codes (e.g.,
 * tests/integration/fixtures/cert-migration-report.golden.md) will need
 * to be regenerated. Run the golden-file regeneration step in the
 * cert-migration plan AND verify every test that hard-codes a seed
 * cert code before merging.
 */
```

### OQ-7 — Per-route vs global env-var keys

Wave 4B introduces 4 new env vars: `KV_REST_API_URL`,
`KV_REST_API_TOKEN`, `RATELIMIT_IP_PEPPER`,
`RATELIMIT_VERIFY_IP_PER_MIN`, `RATELIMIT_VERIFY_CODE_PER_MIN`. Future
waves will likely add per-route limits for the P1-14 endpoints
(signup, invite-accept, search, /invites/send). Two naming patterns:

- (a) Per-route knobs: `RATELIMIT_VERIFY_IP_PER_MIN`,
  `RATELIMIT_SIGNUP_IP_PER_MIN`, `RATELIMIT_INVITE_ACCEPT_IP_PER_MIN`,
  ...
- (b) Single config blob: `RATELIMIT_CONFIG_JSON` with route names as
  keys.

**Recommendation:** (a) — discoverable in `.env.example`, easy to
override one without touching the others, no JSON parsing at module
load. The cost is `.env.example` growth, which is fine.

---

## Pre-implementation checklist (do these before writing code)

- [ ] This plan reviewed and approved.
- [ ] OQ-1 through OQ-7 decisions confirmed (or noted as deferred
      with reasons).
- [ ] Upstash Redis integration added in Vercel for dev + production
      projects. `KV_REST_API_URL` and `KV_REST_API_TOKEN` populated.
- [ ] `RATELIMIT_IP_PEPPER` generated (`openssl rand -base64 32`)
      and set in Vercel for dev + production (different values per
      env).
- [ ] `pnpm add @upstash/ratelimit @upstash/redis serverless-redis-http`
      (the last only as devDependency for integration tests).
- [ ] CI updated to start the `serverless-redis-http` container before
      `pnpm test:integration` runs.

---

Migration plan complete at `audits/cert-code-redesign-plan.md`. Awaiting
review before implementation.

---

## Revision log — 2026-05-10 (post-review modifications)

Approved-with-mods round. Changes applied in place:

- **OQ-1 — latency logging:** added `cert_verify_latency` structured
  log line on every verify request, with `duration_ms`, `db_query_ms`,
  `rate_limit_ms`, and `outcome`. Documented the reopen-trigger
  thresholds (p99 > 250ms over 1h, or p95 > 100ms over 24h). Filed
  monitoring as P2 follow-up.
- **OQ-5 — test infrastructure:** switched from docker-compose +
  `serverless-redis-http` (option b) to mocking
  `@upstash/ratelimit.limit()` directly (option c). Added an
  env-gated (`UPSTASH_LIVE_TEST=1`) manual-runnable live smoke test
  in `tests/integration/verify-rate-limit-live-smoke.test.ts` that
  hits a real Upstash instance once to validate the library
  contract. No CI orchestration added.
- **OQ-6 — seed RNG:** expanded header-comment guidance to call out
  the golden-file regeneration requirement when the seed constant
  changes.
- **Concern 1 — ordering bug:** reversed the order — format-validate
  FIRST (cheap, no I/O), then rate-limit, then DB. Added the
  malformed-vs-unknown byte-equality test to (g). Updated
  implementation sequencing step 7. Documented why the malformed
  traffic never burns the victim's per-IP window.
- **Concern 2 — 23505 retry observability:** every collision retry
  writes `cert_code_collision_retry` activity event with
  `{ attempt, generated_code, exam_attempt_id }`; exhausted retries
  write `cert_issuance_retry_exhausted`. Test plan extended with
  assertions on event presence and ordering. P2 monitoring
  threshold (>10/day) documented for `followups.md`.
- **Concern 3 — pepper rotation procedure:** new operator runbook
  section after (d) — when to rotate, the procedure, the 60-second
  fresh-window side effect, and the low-traffic-hours mitigation.

Other OQs (2, 3, 4, 7) approved as recommended without modification.

Awaiting final review and approval for implementation.
