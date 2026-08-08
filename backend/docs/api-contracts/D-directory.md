# API Contracts — Agent D: Directory + Reviews

**Phase:** 1 — Backend Domain Build  
**Agent:** D — Directory + Reviews APIs  
**Status:** Complete

---

## Endpoints

### `GET /api/search`

**Auth:** Anonymous (no JWT required)  
**Rate limit:** None (read-only, no side-effects)  
**Cache:** `public, s-maxage=60, stale-while-revalidate=300`

#### Query Parameters

| Param | Type | Constraints | Default | Description |
|---|---|---|---|---|
| `q` | `string` | max 200 chars | `""` | Free-text search query |
| `allergen[]` | `string[]` | max 10 items, repeatable | `[]` | Allergen specialties to intersect |
| `cuisine` | `string` | max 50 chars | `""` | Cuisine equality filter |
| `zip` | `string` | 5-digit US zip | — | Source zip for geo search |
| `radiusMi` | `number` | 1–100, integer | `25` | Search radius in miles |

**Example:** `GET /api/search?q=pizza&allergen[]=peanut&allergen[]=dairy&zip=92101&radiusMi=10`

#### Success Response `200`

```ts
Array<{
  slug: string;
  name: string;
  cuisine: string | null;
  city: string | null;
  state: string | null;
  lat: number | null;
  lng: number | null;
  heroPhotoUrl: string | null;
  allergenSpecialties: string[] | null;
  certifiedCount: number;        // active non-revoked certs
  totalEmployees: number;        // learner-role profiles
  listedAt: string | null;       // ISO 8601 timestamptz
  distanceMi: number | null;     // null when no zip provided
  avgRating: number | null;      // null when no published reviews
  reviewCount: number;
}>
```

Maximum 50 results.

**Ordering:**
1. FTS relevance rank (descending) — when `q` provided and FTS mode
2. Distance (ascending) — when `zip` resolved to lat/lng
3. `listed_at` (descending) — always as tiebreaker

**FTS fallback:** If FTS yields 0 results and `q` is set, re-runs with trigram (ILIKE) fallback.

#### Error Responses

| Status | Body | Condition |
|---|---|---|
| `400` | `{ error, details }` | Zod validation failure |
| `500` | `{ error }` | DB or geocoding failure |

---

### `GET /api/directory/[slug]`

**Auth:** Anonymous (no JWT required)  
**Rate limit:** None (read-only)  
**Cache:** `public, s-maxage=60, stale-while-revalidate=300`

#### Path Parameters

| Param | Constraints | Description |
|---|---|---|
| `slug` | `[a-z0-9-]+`, max 120 chars | Restaurant URL slug |

#### Success Response `200`

```ts
{
  id: string;
  slug: string;
  name: string;
  cuisine: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  lat: number | null;
  lng: number | null;
  phone: string | null;
  website: string | null;
  heroPhotoUrl: string | null;
  about: string | null;
  hoursJson: Record<string, { open: string; close: string }> | null;
  allergenSpecialties: string[] | null;
  listedAt: string | null;
  listingExpiresAt: string | null;
  certifiedCount: number;
  totalEmployees: number;
  avgRating: number | null;
  reviewCount: number;
  reviews: Array<{
    id: string;
    authorName: string;
    rating: number;           // 1–5
    body: string;
    allergenContext: string | null;
    createdAt: string;        // ISO 8601
  }>;                         // published only, max 50, desc by created_at
}
```

**Note:** `authorEmail` is NOT returned. Stored for moderation use only.

#### Error Responses

| Status | Body | Condition |
|---|---|---|
| `404` | `{ error: "Not found" }` | Slug not found, not listed, or listing expired |
| `500` | `{ error }` | DB failure |

---

### `POST /api/reviews/submit`

**Auth:** Anonymous (no JWT required)  
**Rate limit:** 1 review per IP per restaurant per 24 hours (via `review_rate_limits` table)  
**Honeypot:** `hpField` must be empty string

#### Request Body

```ts
{
  restaurantSlug: string;      // [a-z0-9-]+, max 120 chars
  authorName: string;          // 1–100 chars (trimmed)
  authorEmail?: string;        // valid email, optional — not returned in any API
  rating: number;              // integer 1–5
  body: string;                // 50–2000 chars (trimmed)
  allergenContext?: string;    // max 50 chars, e.g. "tree_nut"
  hpField: string;             // honeypot — must be "" or absent
}
```

#### Success Response `200`

```json
{ "message": "Your review is pending moderation" }
```

**Important:** This response is returned in ALL non-error cases — including honeypot rejections and rate-limit hits. This prevents abusers from learning they've been filtered.

A random 100–300ms delay is added to every response to prevent timing oracle attacks.

#### Error Responses

| Status | Body | Condition |
|---|---|---|
| `400` | `{ error, details }` | Zod validation failure (rating out of range, body too short/long, etc.) |
| `404` | `{ error: "Restaurant not found" }` | Slug not found or restaurant not listed |
| `500` | `{ error }` | DB failure |

**Rate-limit policy:** Silent 200 (same as success). Abusers see no indication they are rate-limited.

---

## Database Dependencies

| Table | Operation | Notes |
|---|---|---|
| `restaurants` | SELECT | Filter `status='listed'` + `listing_expires_at` in all endpoints |
| `reviews` | SELECT (published) | `GET /api/directory/[slug]` |
| `reviews` | INSERT (pending) | `POST /api/reviews/submit` |
| `certificates` | SELECT (count) | Non-revoked cert count in both GET endpoints |
| `profiles` | SELECT (count) | Learner-role count in both GET endpoints |
| `review_rate_limits` | SELECT + UPSERT | Rate-limit enforcement in submit |

---

## Supporting Files

| File | Purpose |
|---|---|
| `lib/directory/search.ts` | SQL builder (FTS + trigram + haversine). Exported for cron/Agent F. |
| `lib/directory/moderation.ts` | Spam heuristics used by Agent E's review moderation. |
| `db/migrations/0008_review_rate_limits.sql` | `review_rate_limits` table migration. |

---

## Security Notes

1. **SQL injection:** All user input goes through Zod validation + Supabase client parameterized queries. `buildSearchQuery()` uses only `$N` bindings — never string interpolation.
2. **Anonymous access:** Both GET endpoints use service-role client but explicitly filter `status='listed'` and `status='published'`. RLS provides defense-in-depth.
3. **Honeypot:** `hpField` is invisible to humans (CSS hidden), filled by bots. Silent 200 prevents adaptation.
4. **Rate-limit timing:** Random 100–300ms jitter on all responses prevents timing-based fingerprinting of filter outcomes.
5. **Data minimization:** `authorEmail` is stored but never returned. No Stripe IDs or internal IDs are exposed.
6. **Slug validation:** Strict regex `[a-z0-9-]+` on slug path param prevents path traversal and SQL wildcards.

---

## Handoff Notes for Phase 3 (UI) — Agent D

- **Directory list page** calls `GET /api/search` with filter state serialized as URL params. Use `allergen[]` for repeated allergen values.
- **Directory detail page** calls `GET /api/directory/[slug]`. The `slug` comes from the URL segment.
- **Review form** submits to `POST /api/reviews/submit`. Include a visually hidden `hpField` input (CSS: `position: absolute; left: -9999px; opacity: 0`).
- Both GET endpoints are CDN-cacheable (60s). Mutation (review submit) is not cached.
- Distance in search results is `null` when no `zip` is provided — UI should hide distance display in that case.
- `certifiedCount` and `totalEmployees` can be used to display e.g. "12/12 certified" badge on restaurant cards.

---

## Handoff Notes for Agent F (cron/background)

- `buildSearchQuery()` from `lib/directory/search.ts` is exported. Call with `mode='fts'` or `mode='trigram'`.
- `haversineDistance()` is also exported for pure JS distance calculations in cron jobs.
- `computeSpamScore()` from `lib/directory/moderation.ts` is available for the review moderation endpoint (Agent E).

---

## Open Questions

1. **Zip→lat/lng geocoding:** MVP calls Mapbox Geocoding API on every search with a zip. Consider caching zip→lat/lng in a small DB table or KV store for production to avoid API costs + latency.
2. **Allergen GIN index on `allergen_specialties`:** The schema has a GIN index on `restaurants` for FTS (`restaurants_fts_idx`), but no GIN index on `allergen_specialties` column itself. The `&&` operator can use a GIN index on the array column — recommend adding `CREATE INDEX ON restaurants USING GIN (allergen_specialties)` in a future migration for better performance at scale.
3. **Raw SQL vs Supabase client:** The `buildSearchQuery()` function generates correct parameterized SQL for a raw Postgres driver. The route handler uses Supabase's JS client chain instead (for compatibility), which approximates but doesn't identically match the SQL. For production scale, wire up a direct Postgres connection using `postgres` npm package to run the exact haversine SQL.
4. **Review rate-limit by IP:** IP-based rate limiting can be bypassed with rotating proxies. For production, consider adding email-based rate limiting (if email provided) as a secondary check.
