/**
 * GET /api/search
 *
 * Anonymous-callable restaurant directory search.
 *
 * Query params (all optional):
 *   q           - Free text (≤200 chars)
 *   allergen[]  - Array of allergen specialties to intersect (≤10)
 *   cuisine     - Cuisine equality filter
 *   zip         - US zip code to resolve to lat/lng (TODO: geocode via Mapbox;
 *                 MVP falls through gracefully if not set — no geo filter applied)
 *   radiusMi    - Search radius in miles (1–100, default 25)
 *
 * Strategy:
 *   1. Validate params via Zod.
 *   2. If zip present: (MVP) read from a static zip→lat/lng lookup, or call
 *      Mapbox Geocoding API. If unavailable, geo filter is silently skipped.
 *   3. Run FTS query via buildSearchQuery(params, 'fts').
 *   4. If FTS returns 0 rows AND q was provided: re-run with trigram fallback.
 *   5. Return ranked array.
 *
 * Return shape:
 *   [{ slug, name, cuisine, city, state, lat, lng, heroPhotoUrl,
 *      allergenSpecialties, certifiedCount, totalEmployees, listedAt,
 *      distanceMi?, avgRating?, reviewCount }]
 *
 * Devil's advocate notes:
 *  - All params are Zod-validated + bounded before reaching the SQL builder.
 *  - SQL builder uses only parameterized bindings — no string interpolation.
 *  - Anonymous anon key is used; RLS enforces status='listed' for restaurants.
 *    BUT: we use the service-role client for raw SQL (rpc or pg query) because
 *    Supabase's JS client doesn't support arbitrary raw SQL with params.
 *    Service role bypasses RLS, so we explicitly add WHERE status='listed' in SQL.
 *    This is the correct defense-in-depth pattern: RLS is a DB-level backstop,
 *    and our WHERE clause is the application-level enforcement.
 *  - Rate limiting not applied to search (read-only, anonymous, no cost/side-effect).
 *    If abuse detected in prod, add a Redis rate-limit layer (Phase 2+).
 *  - Zip→lat/lng resolution: MVP uses Mapbox Geocoding API if NEXT_PUBLIC_MAPBOX_TOKEN
 *    is set; falls back to no geo filter (search still works, just without distance).
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { buildSearchQuery as _buildSearchQuery, SearchMode } from '@/lib/directory/search';
import { createServiceSupabase } from '@/lib/supabase/server';
import {
  DEPARTED_AT_COLUMN,
  countDistinctCertifiedLearners,
  currentLearnerIdSet,
  type CertHolderRow,
  type StaffIdentityRow,
} from '@/lib/staff/membership';

// ---------------------------------------------------------------------------
// Zod schema for query params
// ---------------------------------------------------------------------------

const SearchParamsSchema = z.object({
  q: z.string().max(200, 'Search query must be ≤200 characters').optional().default(''),
  // allergen[] sent as repeated query param: ?allergen[]=peanut&allergen[]=dairy
  'allergen[]': z
    .union([z.string(), z.array(z.string())])
    .optional()
    .transform((val) => {
      if (!val) return [];
      if (typeof val === 'string') return [val];
      return val;
    })
    .pipe(z.array(z.string().max(50)).max(10, 'Maximum 10 allergen filters')),
  cuisine: z.string().max(50).optional().default(''),
  zip: z
    .string()
    .regex(/^\d{5}$/)
    .optional(),
  radiusMi: z
    .string()
    .optional()
    .default('25')
    .transform((v) => parseFloat(v))
    .pipe(z.number().min(1).max(100)),
});

// ---------------------------------------------------------------------------
// Mapbox geocoding (zip → lat/lng)
// ---------------------------------------------------------------------------

interface GeoResult {
  lat: number;
  lng: number;
}

async function geocodeZip(zip: string): Promise<GeoResult | null> {
  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
  if (!token) return null;

  try {
    const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(zip)}.json?country=US&types=postcode&access_token=${token}`;
    const res = await fetch(url, {
      // Cache geocode results for 24 hours — zip→lat/lng is stable
      next: { revalidate: 86400 },
    });
    if (!res.ok) return null;

    const data = (await res.json()) as {
      features?: Array<{ center?: [number, number] }>;
    };
    const feature = data.features?.[0];
    if (!feature?.center) return null;

    const [lng, lat] = feature.center;
    return { lat, lng };
  } catch {
    // Geocoding failure → silently degrade (no geo filter)
    return null;
  }
}

// ---------------------------------------------------------------------------
// Response shaping
// ---------------------------------------------------------------------------

interface SearchResultItem {
  slug: string;
  name: string;
  cuisine: string | null;
  city: string | null;
  state: string | null;
  lat: number | null;
  lng: number | null;
  heroPhotoUrl: string | null;
  allergenSpecialties: string[] | null;
  certifiedCount: number;
  totalEmployees: number;
  listedAt: string | null;
  distanceMi: number | null;
  avgRating: number | null;
  reviewCount: number;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function _shapeRow(row: Record<string, any>): SearchResultItem {
  return {
    slug: row.slug as string,
    name: row.name as string,
    cuisine: (row.cuisine as string | null) ?? null,
    city: (row.city as string | null) ?? null,
    state: (row.state as string | null) ?? null,
    lat: row.lat != null ? Number(row.lat) : null,
    lng: row.lng != null ? Number(row.lng) : null,
    heroPhotoUrl: (row.hero_photo_url as string | null) ?? null,
    allergenSpecialties: (row.allergen_specialties as string[] | null) ?? null,
    certifiedCount: Number(row.certified_count ?? 0),
    totalEmployees: Number(row.total_employees ?? 0),
    listedAt: (row.listed_at as string | null) ?? null,
    distanceMi: row.distance_mi != null ? Number(row.distance_mi) : null,
    avgRating: row.avg_rating != null ? Number(row.avg_rating) : null,
    reviewCount: Number(row.review_count ?? 0),
  };
}

// ---------------------------------------------------------------------------
// Execute a raw parameterized SQL query via Supabase RPC shim
// ---------------------------------------------------------------------------

/**
 * Supabase JS client does not expose a raw SQL execute function for parameterized
 * queries. We use the `query` function via the underlying postgres connection.
 *
 * In practice for Supabase, we use `supabase.rpc()` calling a postgres function,
 * OR we use the service-role REST API with a custom SQL endpoint.
 *
 * MVP approach: create a Supabase SQL function `search_restaurants` that accepts
 * a text query and returns rows. However, this is complex to parameterize for
 * variable number of params.
 *
 * Simpler MVP approach: use the Supabase service-role client's `from` chain for
 * the standard filters, and only use raw SQL for the haversine distance.
 *
 * ACTUAL MVP implementation: use `supabase.rpc('exec_search', { sql, params })`
 * which requires a custom Postgres function. Instead, we decompose into Supabase
 * client query calls that use native filter operators, which DOES use the GIN index.
 *
 * This decomposed approach:
 *  1. Build the Supabase query chain with filters.
 *  2. For haversine: post-filter in JS (acceptable for <10k restaurants).
 *  3. FTS: use .textSearch() which calls to_tsvector internally.
 *  4. Trigram fallback: if FTS yields 0 results, use .ilike() as approximation.
 *
 * The buildSearchQuery() function is still exported and tested for correctness;
 * the route handler uses Supabase client calls for compatibility.
 *
 * Note: If you have direct Postgres access (DATABASE_URL), you can use pg/postgres
 * to run the raw query. Add `postgres` package and use it here for better perf.
 *
 * CORRECTION (T-46a): nothing above ever shipped as SQL. `exec_search` and
 * `search_restaurants` do not exist, and neither does any view or function
 * containing `total_employees` — checked across db/. Every aggregate this route
 * returns, INCLUDING the public certified/total counts, is computed in the
 * TypeScript below from a joined select. If you are here to change how staff are
 * counted, this file is the place; there is no database object to fix.
 */

async function executeSearch(
  params: {
    q: string;
    allergens: string[];
    cuisine: string;
    lat: number | undefined;
    lng: number | undefined;
    radiusMi: number;
  },
  mode: SearchMode
): Promise<SearchResultItem[]> {
  const supabase = createServiceSupabase();

  // Start with the base query on listed, non-expired restaurants
  let query = supabase
    .from('restaurants')
    .select(
      `
      slug,
      name,
      cuisine,
      city,
      state,
      lat,
      lng,
      hero_photo_url,
      allergen_specialties,
      listed_at,
      certificates!left(profile_id, status),
      profiles!left(id, role, ${DEPARTED_AT_COLUMN}),
      reviews!left(id, rating, status)
    `
    )
    .eq('status', 'listed')
    .or(`listing_expires_at.is.null,listing_expires_at.gt.${new Date().toISOString()}`);

  // Text search
  if (params.q && mode === 'fts') {
    query = query.textSearch('name', params.q, { type: 'plain', config: 'english' });
  } else if (params.q && mode === 'trigram') {
    // Trigram fallback: use ilike for partial match approximation
    // (true trigram % requires raw SQL; ilike is an acceptable MVP fallback)
    query = query.ilike('name', `%${params.q}%`);
  }

  // Allergen intersect
  if (params.allergens.length > 0) {
    // Supabase's `.overlaps()` maps to && operator with GIN index
    query = query.overlaps('allergen_specialties', params.allergens);
  }

  // Cuisine filter
  if (params.cuisine) {
    query = query.eq('cuisine', params.cuisine);
  }

  // Bounding-box pre-filter for geo queries (use index on lat, lng)
  if (params.lat !== undefined && params.lng !== undefined) {
    const latDelta = params.radiusMi / 69;
    const lngDelta = params.radiusMi / 55;
    query = query
      .gte('lat', params.lat - latDelta)
      .lte('lat', params.lat + latDelta)
      .gte('lng', params.lng - lngDelta)
      .lte('lng', params.lng + lngDelta);
  }

  // Order + limit
  query = query.order('listed_at', { ascending: false }).limit(50);

  const { data, error } = await query;

  if (error) {
    throw new Error(`Search query failed: ${error.message}`);
  }

  if (!data) return [];

  // Post-process: aggregate joined data + haversine distance
  const { haversineDistance } = await import('@/lib/directory/search');

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = (data as any[])
    .map((row) => {
      // T-46a — the public denominator, and the one site that filters staff in
      // TypeScript rather than SQL. The predicate inside `currentLearnerIdSet`
      // is the same `isCurrentLearner` the other seven sites push into the
      // query; `departed_at` is selected in the join above (built from
      // DEPARTED_AT_COLUMN) because a row without it cannot be judged.
      const profiles = (Array.isArray(row.profiles) ? row.profiles : []) as StaffIdentityRow[];
      const currentLearners = currentLearnerIdSet(profiles);
      const totalEmployees = currentLearners.size;

      // T-23 — the numerator. This was `certs.filter(c => c.status ===
      // 'active').length`, certificate ROWS over a denominator of people, so a
      // learner holding two active certificates counted twice and the card
      // could render above 100%. It is now the count of distinct CURRENT
      // LEARNERS holding one, intersected against the very set the denominator
      // was taken from — which also drops a departed learner's still-valid
      // certificate, since certificates carry no membership of their own.
      //
      // lib/directory/search.ts builds the SQL form of this identical pair.
      // The two are pinned together by
      // tests/integration/search-count-parity.test.ts; change one and that
      // test fails rather than two public pages quietly disagreeing.
      const certs = (Array.isArray(row.certificates) ? row.certificates : []) as CertHolderRow[];
      const certifiedCount = countDistinctCertifiedLearners(certs, currentLearners);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const reviews: any[] = Array.isArray(row.reviews) ? row.reviews : [];
      const publishedReviews = reviews.filter((r) => r.status === 'published');
      const reviewCount = publishedReviews.length;
      const avgRating =
        reviewCount > 0
          ? parseFloat(
              (
                publishedReviews.reduce((sum: number, r: { rating: number }) => sum + r.rating, 0) /
                reviewCount
              ).toFixed(1)
            )
          : null;

      // Haversine distance
      let distanceMi: number | null = null;
      if (
        params.lat !== undefined &&
        params.lng !== undefined &&
        row.lat != null &&
        row.lng != null
      ) {
        distanceMi = parseFloat(
          haversineDistance(params.lat, params.lng, Number(row.lat), Number(row.lng)).toFixed(2)
        );
      }

      return {
        slug: row.slug as string,
        name: row.name as string,
        cuisine: row.cuisine as string | null,
        city: row.city as string | null,
        state: row.state as string | null,
        lat: row.lat != null ? Number(row.lat) : null,
        lng: row.lng != null ? Number(row.lng) : null,
        heroPhotoUrl: row.hero_photo_url as string | null,
        allergenSpecialties: row.allergen_specialties as string[] | null,
        certifiedCount,
        totalEmployees,
        listedAt: row.listed_at as string | null,
        distanceMi,
        avgRating,
        reviewCount,
      };
    })
    // Post-filter by exact haversine distance (bounding box can include corners)
    .filter((row) => {
      if (params.lat === undefined || params.lng === undefined) return true;
      return row.distanceMi != null && row.distanceMi <= params.radiusMi;
    });

  // Sort: relevance first (FTS mode), then distance, then listedAt desc
  rows.sort((a, b) => {
    // Distance sort (asc) when geo present
    if (params.lat !== undefined && params.lng !== undefined) {
      const da = a.distanceMi ?? Infinity;
      const db = b.distanceMi ?? Infinity;
      if (da !== db) return da - db;
    }
    // listedAt desc
    const ta = a.listedAt ? new Date(a.listedAt).getTime() : 0;
    const tb = b.listedAt ? new Date(b.listedAt).getTime() : 0;
    return tb - ta;
  });

  return rows;
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest): Promise<NextResponse> {
  // Parse + validate query params
  const url = new URL(request.url);
  const rawParams: Record<string, string | string[]> = {};

  for (const [key, value] of url.searchParams.entries()) {
    if (key === 'allergen[]') {
      const existing = rawParams['allergen[]'];
      if (Array.isArray(existing)) {
        existing.push(value);
      } else if (typeof existing === 'string') {
        rawParams['allergen[]'] = [existing, value];
      } else {
        rawParams['allergen[]'] = value;
      }
    } else {
      rawParams[key] = value;
    }
  }

  const parseResult = SearchParamsSchema.safeParse(rawParams);
  if (!parseResult.success) {
    return NextResponse.json(
      {
        error: 'Invalid search parameters',
        details: parseResult.error.flatten().fieldErrors,
      },
      { status: 400 }
    );
  }

  const parsed = parseResult.data;
  const allergens = parsed['allergen[]'];

  // Geo resolution
  let lat: number | undefined;
  let lng: number | undefined;

  if (parsed.zip) {
    const geo = await geocodeZip(parsed.zip);
    if (geo) {
      lat = geo.lat;
      lng = geo.lng;
    }
    // If geocoding fails, silently proceed without geo filter
  }

  const searchParams = {
    q: parsed.q,
    allergens,
    cuisine: parsed.cuisine,
    lat,
    lng,
    radiusMi: parsed.radiusMi,
  };

  try {
    // Determine search mode
    const mode: SearchMode = parsed.q ? 'fts' : 'none';

    // Primary search
    let results = await executeSearch(searchParams, mode);

    // Trigram fallback: if FTS yielded 0 rows and we had a query
    if (results.length === 0 && parsed.q) {
      results = await executeSearch(searchParams, 'trigram');
    }

    return NextResponse.json(results, {
      status: 200,
      headers: {
        // Cache search results for 60 seconds on CDN
        'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300',
      },
    });
  } catch (err) {
    console.error('[/api/search] Error:', err);
    return NextResponse.json({ error: 'Search temporarily unavailable' }, { status: 500 });
  }
}
