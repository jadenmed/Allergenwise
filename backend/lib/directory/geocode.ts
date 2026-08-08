/**
 * lib/directory/geocode.ts
 *
 * Mapbox Geocoding API helper for the restaurant directory.
 * Used by /api/search to resolve zip codes → lat/lng for proximity filtering.
 *
 * Uses the Mapbox Geocoding v5 REST API:
 *   GET https://api.mapbox.com/geocoding/v5/mapbox.places/{query}.json?...
 *
 * Environment:
 *   NEXT_PUBLIC_MAPBOX_TOKEN — required for all geocoding calls.
 *   In server-side contexts (route handlers, cron), set the env var directly.
 *
 * Error handling:
 *   All errors (network, empty response, invalid format) return null.
 *   Never throws — callers treat null as "geocode unavailable".
 */

export interface GeoPoint {
  lat: number;
  lng: number;
}

interface MapboxFeature {
  center?: [number, number]; // [lng, lat]
  geometry?: {
    type: string;
    coordinates?: [number, number];
  };
}

interface MapboxGeocodingResponse {
  features?: MapboxFeature[];
}

/**
 * Resolves a US zip code to a lat/lng point using the Mapbox Geocoding API.
 * Returns null if the zip cannot be resolved (no results, network error, etc.).
 *
 * @param zip     - US zip code (e.g. "92101")
 * @returns         { lat, lng } or null
 */
export async function geocodeZip(zip: string): Promise<GeoPoint | null> {
  return geocodeQuery(`${zip} United States`);
}

/**
 * Geocodes a free-text address or query string.
 * Returns null on any error.
 *
 * @param query   - Free-text query (e.g. "92101 United States" or "123 Main St, San Diego")
 * @returns         { lat, lng } or null
 */
async function geocodeQuery(query: string): Promise<GeoPoint | null> {
  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
  if (!token) {
    console.warn('[geocode] NEXT_PUBLIC_MAPBOX_TOKEN is not set — geocoding unavailable');
    return null;
  }

  const encodedQuery = encodeURIComponent(query);
  const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodedQuery}.json?access_token=${token}&types=postcode,address,place&limit=1&country=US`;

  try {
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
      // 5-second timeout for geocoding calls
      signal: AbortSignal.timeout(5000),
    });

    if (!res.ok) {
      console.warn(`[geocode] Mapbox API returned ${res.status} for query: ${query}`);
      return null;
    }

    const data = (await res.json()) as MapboxGeocodingResponse;

    const features = data?.features;
    if (!features || features.length === 0) {
      return null;
    }

    const first = features[0];

    // Mapbox returns coordinates as [longitude, latitude]
    const coords = first.center ?? first.geometry?.coordinates;
    if (!coords || coords.length < 2) {
      return null;
    }

    return {
      lat: coords[1],
      lng: coords[0],
    };
  } catch (err) {
    // Network timeout, DNS failure, etc. — log and return null
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[geocode] Geocoding failed for "${query}": ${msg}`);
    return null;
  }
}
