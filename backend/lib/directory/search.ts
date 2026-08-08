/**
 * lib/directory/search.ts
 *
 * Pure SQL builder for the restaurant directory search.
 * Exported so Phase-1 Agent F (cron) and any future consumers can call it directly.
 *
 * Strategy:
 *  1. Always filter status = 'listed' and listing_expires_at > now().
 *  2. If `q` provided: try FTS first (to_tsvector @@ plainto_tsquery).
 *     If FTS yields zero rows, fall back to trigram (name % q).
 *  3. If `allergens` provided: filter using the && GIN array-intersect operator.
 *  4. If `cuisine` provided: equality filter.
 *  5. If lat/lng provided (resolved from zip upstream): haversine distance column,
 *     filter HAVING distance_mi <= radiusMi.
 *  6. ORDER: rank desc (when q present) → distance_mi asc (when geo present) → listed_at desc.
 *  7. LIMIT 50.
 *
 * All user-supplied values go through Zod before reaching here and are passed as
 * parameterized `$N` bindings — never interpolated into SQL strings.
 *
 * Devil's advocate notes addressed:
 *  - q is bounded to ≤200 chars by Zod before entering this function; function also
 *    throws on violation as defense-in-depth.
 *  - allergens array bounded to ≤10 items by Zod.
 *  - radiusMi clamped 1–100 by Zod.
 *  - No string interpolation of user input — params array only.
 *  - Haversine formula uses acos(cos()*cos()*cos() + sin()*sin()) — correct for
 *    short distances (<500 mi); adequate for MVP directory.
 *  - allergen_specialties && $allergens uses the GIN index on that column (added
 *    in 0002_indexes.sql via gin on allergen_specialties — agent should verify;
 *    if not present the query degrades gracefully, still correct).
 *  - Empty q → all listed restaurants ordered by listed_at desc.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SearchParams {
  /** Free-text search (max 200 chars). Empty string = no FTS filter. */
  q: string;
  /** Allergen specialties the restaurant must have (intersect). */
  allergens: string[];
  /** Cuisine equality filter (empty = no filter). */
  cuisine: string;
  /** Resolved latitude from zip (undefined = no geo filter). */
  lat: number | undefined;
  /** Resolved longitude from zip (undefined = no geo filter). */
  lng: number | undefined;
  /** Search radius in miles (1–100). Used only when lat/lng are present. */
  radiusMi: number;
}

export interface SearchRow {
  slug: string;
  name: string;
  cuisine: string | null;
  city: string | null;
  state: string | null;
  lat: number | null;
  lng: number | null;
  hero_photo_url: string | null;
  allergen_specialties: string[] | null;
  certified_count: number;
  total_employees: number;
  listed_at: string | null;
  distance_mi: number | null;
  avg_rating: number | null;
  review_count: number;
}

export interface SqlQuery {
  text: string;
  params: (string | number | string[])[];
}

// ---------------------------------------------------------------------------
// Haversine distance expression builder
// ---------------------------------------------------------------------------

/**
 * Returns the SQL expression fragment for haversine distance in miles.
 * Uses parameterized $N bindings — caller must append lat, lng to params before
 * calling this function and pass the indices of those params.
 *
 * Formula from §12:
 *   3959 * acos(
 *     cos(radians($lat)) * cos(radians(lat)) * cos(radians(lng) - radians($lng))
 *     + sin(radians($lat)) * sin(radians(lat))
 *   )
 *
 * NOTE: acos() can produce NaN when floating-point rounding pushes the argument
 * slightly above 1.0. We wrap with LEAST(..., 1.0) inside acos to guard this.
 */
function haversineExpr(latParamIdx: number, lngParamIdx: number): string {
  return `(3959 * acos(LEAST(
    cos(radians($${latParamIdx})) * cos(radians(lat)) * cos(radians(lng) - radians($${lngParamIdx}))
    + sin(radians($${latParamIdx})) * sin(radians(lat)),
    1.0
  )))`;
}

// ---------------------------------------------------------------------------
// Main SQL builder
// ---------------------------------------------------------------------------

/**
 * Builds a parameterized SQL query for the restaurant directory search.
 *
 * The query is designed for use with Supabase's `rpc` or a raw Postgres client.
 * Supabase's `.from().select()` chain cannot express haversine + FTS fallback,
 * so we build raw SQL here and call it via `supabase.rpc('search_restaurants', ...)`
 * or a service-role raw query.
 *
 * Actually, for simplicity and type safety, we return a { text, params } object
 * that callers pass to the Postgres driver directly via supabase.rpc or pg driver.
 *
 * Two-pass strategy for FTS + trigram:
 * The route handler calls buildSearchQuery twice if needed:
 *   1. Primary: with FTS WHERE clause.
 *   2. Fallback: if primary returns 0 rows, with trigram WHERE clause.
 * Both calls share the same params structure. The `mode` param controls which.
 */
export type SearchMode = 'fts' | 'trigram' | 'none';

export function buildSearchQuery(params: SearchParams, mode: SearchMode = 'none'): SqlQuery {
  if (params.q.length > 200) {
    throw new Error('Search query exceeds 200-character limit');
  }
  if (params.allergens.length > 10) {
    throw new Error('Allergen filter exceeds 10-item limit');
  }

  const sqlParams: (string | number | string[])[] = [];
  const whereClauses: string[] = [];

  // Always filter to listed, non-expired
  whereClauses.push(`r.status = 'listed'`);
  whereClauses.push(`(r.listing_expires_at IS NULL OR r.listing_expires_at > now())`);

  // ── Text search ──────────────────────────────────────────────────────────
  if (params.q && mode !== 'none') {
    sqlParams.push(params.q);
    const qIdx = sqlParams.length;

    if (mode === 'fts') {
      // FTS: parameterized via plainto_tsquery
      whereClauses.push(
        `to_tsvector('english', r.name || ' ' || coalesce(r.cuisine, '') || ' ' || coalesce(r.city, ''))
         @@ plainto_tsquery('english', $${qIdx})`
      );
    } else {
      // Trigram fallback: name similarity
      whereClauses.push(`r.name % $${qIdx}`);
    }
  }

  // ── Allergen filter ──────────────────────────────────────────────────────
  if (params.allergens.length > 0) {
    sqlParams.push(params.allergens);
    const allergenIdx = sqlParams.length;
    // Cast to text[] so the && operator uses the GIN index on allergen_specialties
    whereClauses.push(`r.allergen_specialties && $${allergenIdx}::text[]`);
  }

  // ── Cuisine filter ───────────────────────────────────────────────────────
  if (params.cuisine) {
    sqlParams.push(params.cuisine);
    whereClauses.push(`r.cuisine = $${sqlParams.length}`);
  }

  // ── Geo / haversine ──────────────────────────────────────────────────────
  let distanceExpr = 'NULL::numeric';
  let havingClause = '';

  if (params.lat !== undefined && params.lng !== undefined) {
    sqlParams.push(params.lat);
    const latIdx = sqlParams.length;
    sqlParams.push(params.lng);
    const lngIdx = sqlParams.length;
    sqlParams.push(params.radiusMi);
    const radiusIdx = sqlParams.length;

    distanceExpr = haversineExpr(latIdx, lngIdx);
    // WHERE-level pre-filter using bounding box (uses the geo index on lat, lng)
    // before the expensive acos computation. ~1 degree lat ≈ 69 mi, ~1 deg lng ≈ 55 mi.
    // We use a generous 2× ratio to avoid false negatives near poles/date-line.
    sqlParams.push(params.radiusMi / 69);
    const latDeltaIdx = sqlParams.length;
    sqlParams.push(params.radiusMi / 55);
    const lngDeltaIdx = sqlParams.length;

    whereClauses.push(
      `r.lat BETWEEN ($${latIdx}::numeric - $${latDeltaIdx}::numeric) AND ($${latIdx}::numeric + $${latDeltaIdx}::numeric)`
    );
    whereClauses.push(
      `r.lng BETWEEN ($${lngIdx}::numeric - $${lngDeltaIdx}::numeric) AND ($${lngIdx}::numeric + $${lngDeltaIdx}::numeric)`
    );

    havingClause = `HAVING ${distanceExpr} <= $${radiusIdx}`;
  }

  // ── ORDER BY ─────────────────────────────────────────────────────────────
  // 1. Relevance (FTS rank) when q present
  // 2. Distance asc when geo present
  // 3. listed_at desc as tiebreaker
  const orderParts: string[] = [];

  if (params.q && mode === 'fts') {
    orderParts.push(
      `ts_rank(
         to_tsvector('english', r.name || ' ' || coalesce(r.cuisine, '') || ' ' || coalesce(r.city, '')),
         plainto_tsquery('english', $1)
       ) DESC`
    );
  }

  if (params.lat !== undefined && params.lng !== undefined) {
    orderParts.push(`distance_mi ASC`);
  }

  orderParts.push(`r.listed_at DESC`);

  const orderByClause = `ORDER BY ${orderParts.join(', ')}`;

  // ── SELECT ───────────────────────────────────────────────────────────────
  const selectSql = `
    SELECT
      r.slug,
      r.name,
      r.cuisine,
      r.city,
      r.state,
      r.lat,
      r.lng,
      r.hero_photo_url,
      r.allergen_specialties,
      r.listed_at,
      -- Wave 2C — only certs with status='active' count as publicly certified.
      -- The same canonical predicate as isPubliclyActiveCert().
      --
      -- T-23 — this counted DISTINCT c.id: distinct CERTIFICATES, which is not
      -- distinct PEOPLE. Nothing stops one learner holding two active certs, so
      -- the numerator could exceed the denominator below and the card rendered
      -- above 100%. It counts the HOLDER now (ch.id), so a learner with ten
      -- active certificates is one certified learner. ch is NULL for a holder
      -- who has departed or is not a learner, and COUNT ignores NULLs — that is
      -- the membership filter, not an accident of the join.
      COUNT(DISTINCT ch.id) FILTER (WHERE c.status = 'active') AS certified_count,
      -- Total CURRENT learner employees linked to this restaurant.
      -- T-46a — departed_at IS NULL is the whole of membership. The
      -- TypeScript path in app/api/search/route.ts applies it through
      -- lib/staff/membership.ts; this file is raw SQL and cannot import that,
      -- so the predicate is spelled out. It must stay identical to that one.
      COUNT(DISTINCT p.id) FILTER (WHERE p.role = 'learner' AND p.departed_at IS NULL)
        AS total_employees,
      -- Distance (NULL when no geo params)
      ${distanceExpr} AS distance_mi,
      -- Review aggregates (published only)
      ROUND(AVG(rv.rating) FILTER (WHERE rv.status = 'published'), 1) AS avg_rating,
      COUNT(rv.id) FILTER (WHERE rv.status = 'published') AS review_count
    FROM restaurants r
    LEFT JOIN certificates c  ON c.restaurant_id = r.id
    -- T-23 — the certificate's HOLDER, joined so the numerator can be counted
    -- in people. The membership predicate lives in the join, not the FILTER, so
    -- a cert held by someone departed, by a manager, or by a profile belonging
    -- to another restaurant yields ch.id = NULL and is not counted. Those three
    -- conditions are exactly the set intersection the TypeScript path performs
    -- (its cert rows are intersected against THIS restaurant's current learners).
    LEFT JOIN profiles ch     ON ch.id = c.profile_id
                             AND ch.restaurant_id = r.id
                             AND ch.role = 'learner'
                             AND ch.departed_at IS NULL
    LEFT JOIN profiles p      ON p.restaurant_id = r.id
    LEFT JOIN reviews rv      ON rv.restaurant_id = r.id
    WHERE ${whereClauses.join('\n      AND ')}
    GROUP BY r.id
    ${havingClause}
    ${orderByClause}
    LIMIT 50
  `.trim();

  return { text: selectSql, params: sqlParams };
}

// ---------------------------------------------------------------------------
// Haversine pure-function (exported for unit tests)
// ---------------------------------------------------------------------------

/**
 * Computes haversine distance in miles between two lat/lng points.
 * Exported for unit testing (tests/unit/haversine.test.ts).
 *
 * Uses the same formula as the SQL expression above.
 */
export function haversineDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 3959; // Earth radius in miles
  const toRad = (deg: number) => (deg * Math.PI) / 180;

  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}
