/**
 * tests/unit/haversine.test.ts
 *
 * Validates the haversineDistance() pure function exported from
 * lib/directory/search.ts using known geographic pairs.
 *
 * Reference distances (approximate):
 *  - San Francisco → Los Angeles:     ~347 mi (within 5%)
 *  - New York City → Los Angeles:     ~2,445 mi (within 5%)
 *  - Same point → same point:         0 mi (exact)
 *  - Adjacent zip codes (~1 mi apart): < 2 mi
 *
 * Acceptance: within 5% of reference (matching §12 requirement).
 */

import { describe, it, expect } from 'vitest';
import { haversineDistance } from '@/lib/directory/search';

// Known reference points
const SF = { lat: 37.7749, lng: -122.4194 };
const LA = { lat: 34.0522, lng: -118.2437 };
const NYC = { lat: 40.7128, lng: -74.006 };
const CHI = { lat: 41.8781, lng: -87.6298 };

// Tolerance helper
function withinPercent(actual: number, expected: number, pct: number): boolean {
  return Math.abs(actual - expected) / expected <= pct / 100;
}

describe('haversineDistance', () => {
  it('SF to LA ≈ 347 miles (within 5%)', () => {
    const dist = haversineDistance(SF.lat, SF.lng, LA.lat, LA.lng);
    expect(dist).toBeGreaterThan(0);
    expect(withinPercent(dist, 347, 5)).toBe(true);
  });

  it('LA to SF (reversed) ≈ 347 miles (symmetric)', () => {
    const dist1 = haversineDistance(SF.lat, SF.lng, LA.lat, LA.lng);
    const dist2 = haversineDistance(LA.lat, LA.lng, SF.lat, SF.lng);
    expect(Math.abs(dist1 - dist2)).toBeLessThan(0.01);
  });

  it('NYC to LA ≈ 2,445 miles (within 5%)', () => {
    const dist = haversineDistance(NYC.lat, NYC.lng, LA.lat, LA.lng);
    expect(withinPercent(dist, 2445, 5)).toBe(true);
  });

  it('NYC to Chicago ≈ 713 miles (within 5%)', () => {
    const dist = haversineDistance(NYC.lat, NYC.lng, CHI.lat, CHI.lng);
    expect(withinPercent(dist, 713, 5)).toBe(true);
  });

  it('same point → 0 miles (identity)', () => {
    const dist = haversineDistance(SF.lat, SF.lng, SF.lat, SF.lng);
    expect(dist).toBeCloseTo(0, 5);
  });

  it('handles negative longitudes correctly (cross-continent)', () => {
    const dist = haversineDistance(NYC.lat, NYC.lng, LA.lat, LA.lng);
    // Sanity: should be a positive, finite number
    expect(dist).toBeGreaterThan(0);
    expect(Number.isFinite(dist)).toBe(true);
  });

  it('returns miles (not km) — SF to LA sanity check', () => {
    const distMi = haversineDistance(SF.lat, SF.lng, LA.lat, LA.lng);
    // km would be ~559; we expect ~347 miles
    expect(distMi).toBeLessThan(450);
    expect(distMi).toBeGreaterThan(300);
  });

  it('handles points very close together (sub-mile accuracy)', () => {
    // Two points ~0.5 miles apart (roughly)
    const p1 = { lat: 37.7749, lng: -122.4194 };
    const p2 = { lat: 37.7821, lng: -122.4194 }; // ~0.5 mi north
    const dist = haversineDistance(p1.lat, p1.lng, p2.lat, p2.lng);
    expect(dist).toBeGreaterThan(0.3);
    expect(dist).toBeLessThan(0.8);
  });

  it('result is a finite number (no NaN from acos edge cases)', () => {
    // Test with antipodal-adjacent points that might stress acos(1.0)
    const dist = haversineDistance(89.9999, 0, -89.9999, 180);
    expect(Number.isFinite(dist)).toBe(true);
    expect(Number.isNaN(dist)).toBe(false);
  });
});
