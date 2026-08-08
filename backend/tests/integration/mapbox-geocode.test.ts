/**
 * tests/integration/mapbox-geocode.test.ts
 *
 * Integration test for Mapbox geocoding helper (lib/directory/geocode.ts).
 *
 * Tests:
 * 1. Happy path: fetch is mocked with a Mapbox-shape response for zip 92101
 *    → returns { lat: 32.7157, lng: -117.1611 } (San Diego downtown).
 * 2. Error path: Mapbox returns empty features array → helper returns null gracefully.
 * 3. Error path: fetch throws (network error) → helper returns null, no exception leaks.
 * 4. Verify: the geocoding URL contains the correct endpoint structure + access_token.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { geocodeZip } from '@/lib/directory/geocode';

// ─── Mocks ────────────────────────────────────────────────────────────────────

// Mock global fetch — Mapbox geocoding uses fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// ─── Mapbox geocoding response fixtures ──────────────────────────────────────

function makeMapboxResponse(features: unknown[]): Response {
  return new Response(JSON.stringify({ features }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

const MAPBOX_SUCCESS_FEATURE = {
  center: [-117.1611, 32.7157], // [lng, lat] — Mapbox returns [lng, lat] order
  place_name: 'San Diego, California 92101, United States',
  geometry: {
    type: 'Point',
    coordinates: [-117.1611, 32.7157],
  },
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Mapbox geocoding integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_MAPBOX_TOKEN = 'pk.test_mapbox_token';
  });

  it('happy path: zip 92101 → { lat: 32.7157, lng: -117.1611 }', async () => {
    mockFetch.mockResolvedValue(makeMapboxResponse([MAPBOX_SUCCESS_FEATURE]));

    const result = await geocodeZip('92101');

    expect(result).not.toBeNull();
    expect(result?.lat).toBeCloseTo(32.7157, 3);
    expect(result?.lng).toBeCloseTo(-117.1611, 3);

    // Verify fetch was called with a Mapbox-shaped URL
    const fetchUrl = mockFetch.mock.calls[0][0] as string;
    expect(fetchUrl).toContain('api.mapbox.com');
    expect(fetchUrl).toContain('92101');
    expect(fetchUrl).toContain('access_token=');
  });

  it('empty features array → returns null gracefully', async () => {
    mockFetch.mockResolvedValue(makeMapboxResponse([]));

    const result = await geocodeZip('00000');
    expect(result).toBeNull();
  });

  it('fetch throws (network error) → returns null, no exception leaks', async () => {
    mockFetch.mockRejectedValue(new Error('ECONNREFUSED'));

    // Must not throw
    const result = await geocodeZip('92101');
    expect(result).toBeNull();
  });

  it('Mapbox URL includes correct endpoint and token', async () => {
    mockFetch.mockResolvedValue(makeMapboxResponse([MAPBOX_SUCCESS_FEATURE]));

    await geocodeZip('92101');

    const fetchUrl = mockFetch.mock.calls[0][0] as string;
    // Must be the Mapbox geocoding API
    expect(fetchUrl).toContain('api.mapbox.com/geocoding');
    // Must include the access token
    expect(fetchUrl).toContain('pk.test_mapbox_token');
  });

  it('missing MAPBOX_TOKEN → returns null (no crash)', async () => {
    const saved = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
    delete process.env.NEXT_PUBLIC_MAPBOX_TOKEN;

    const result = await geocodeZip('92101');
    expect(result).toBeNull();
    // Fetch should NOT have been called
    expect(mockFetch).not.toHaveBeenCalled();

    // Restore
    if (saved) process.env.NEXT_PUBLIC_MAPBOX_TOKEN = saved;
  });
});

// ─── Haversine sanity check (used by search SQL) ──────────────────────────────

describe('haversine distance sanity check', () => {
  it('SF to LA is approximately 347 miles', () => {
    // This mirrors the tests/unit/haversine.test.ts sanity check
    // Using the haversine formula inline to ensure the math is correct
    function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
      const R = 3959; // Earth radius in miles
      const dLat = ((lat2 - lat1) * Math.PI) / 180;
      const dLng = ((lng2 - lng1) * Math.PI) / 180;
      const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos((lat1 * Math.PI) / 180) *
          Math.cos((lat2 * Math.PI) / 180) *
          Math.sin(dLng / 2) ** 2;
      return R * 2 * Math.asin(Math.sqrt(a));
    }

    // San Francisco: 37.7749, -122.4194
    // Los Angeles: 34.0522, -118.2437
    const dist = haversine(37.7749, -122.4194, 34.0522, -118.2437);
    // Should be approximately 347 miles
    expect(dist).toBeGreaterThan(340);
    expect(dist).toBeLessThan(360);
  });
});
