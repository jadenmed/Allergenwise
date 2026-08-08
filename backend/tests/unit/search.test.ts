/**
 * tests/unit/search.test.ts
 *
 * Unit tests for lib/directory/search.ts — SQL builder.
 * Tests query construction logic, NOT the database.
 *
 * All tests validate the generated SQL text and params array,
 * confirming correctness of parameterization, clause inclusion,
 * and fallback modes.
 */

import { describe, it, expect } from 'vitest';
import { buildSearchQuery } from '@/lib/directory/search';

const BASE_PARAMS = {
  q: '',
  allergens: [],
  cuisine: '',
  lat: undefined,
  lng: undefined,
  radiusMi: 25,
};

describe('buildSearchQuery', () => {
  // ── Basic guards ──────────────────────────────────────────────────────────

  it('throws if q exceeds 200 characters', () => {
    expect(() => buildSearchQuery({ ...BASE_PARAMS, q: 'a'.repeat(201) }, 'fts')).toThrow(
      '200-character limit'
    );
  });

  it('throws if allergens exceeds 10 items', () => {
    expect(() =>
      buildSearchQuery(
        { ...BASE_PARAMS, allergens: Array.from({ length: 11 }, (_, i) => `a${i}`) },
        'none'
      )
    ).toThrow('10-item limit');
  });

  // ── Always-present clauses ───────────────────────────────────────────────

  it('always includes status = listed filter', () => {
    const { text } = buildSearchQuery(BASE_PARAMS, 'none');
    expect(text).toContain("r.status = 'listed'");
  });

  it('always includes listing_expires_at filter', () => {
    const { text } = buildSearchQuery(BASE_PARAMS, 'none');
    expect(text).toContain('listing_expires_at');
  });

  it('always includes LIMIT 50', () => {
    const { text } = buildSearchQuery(BASE_PARAMS, 'none');
    expect(text).toContain('LIMIT 50');
  });

  // ── FTS mode ─────────────────────────────────────────────────────────────

  it('includes FTS clause in fts mode when q is set', () => {
    const { text, params } = buildSearchQuery({ ...BASE_PARAMS, q: 'pizza' }, 'fts');
    expect(text).toContain('plainto_tsquery');
    expect(text).toContain('to_tsvector');
    // q should be first param ($1)
    expect(params[0]).toBe('pizza');
  });

  it('includes ts_rank in ORDER BY in fts mode', () => {
    const { text } = buildSearchQuery({ ...BASE_PARAMS, q: 'pizza' }, 'fts');
    expect(text).toContain('ts_rank');
    expect(text).toContain('DESC');
  });

  // ── Trigram mode ─────────────────────────────────────────────────────────

  it('includes trigram % operator in trigram mode', () => {
    const { text, params } = buildSearchQuery({ ...BASE_PARAMS, q: 'pizza' }, 'trigram');
    expect(text).toContain('r.name %');
    expect(params[0]).toBe('pizza');
  });

  it('does NOT include plainto_tsquery in trigram mode', () => {
    const { text } = buildSearchQuery({ ...BASE_PARAMS, q: 'pizza' }, 'trigram');
    expect(text).not.toContain('plainto_tsquery');
  });

  // ── No-text mode ─────────────────────────────────────────────────────────

  it('does not include text search clauses in none mode', () => {
    const { text } = buildSearchQuery({ ...BASE_PARAMS, q: 'pizza' }, 'none');
    expect(text).not.toContain('plainto_tsquery');
    expect(text).not.toContain('r.name %');
  });

  it('empty q with none mode produces valid SQL with no text filter', () => {
    const { text, params } = buildSearchQuery(BASE_PARAMS, 'none');
    expect(text).not.toContain('plainto_tsquery');
    expect(params).toHaveLength(0);
  });

  // ── Allergen filter ───────────────────────────────────────────────────────

  it('includes allergen && filter when allergens provided', () => {
    const { text, params } = buildSearchQuery(
      { ...BASE_PARAMS, allergens: ['peanut', 'dairy'] },
      'none'
    );
    expect(text).toContain('allergen_specialties &&');
    expect(text).toContain('::text[]');
    // allergens should be a param
    const allergenParam = params.find((p) => Array.isArray(p));
    expect(allergenParam).toEqual(['peanut', 'dairy']);
  });

  it('does NOT include allergen filter when allergens empty', () => {
    const { text } = buildSearchQuery(BASE_PARAMS, 'none');
    // The WHERE clause must not include the allergen array-intersect filter.
    // Note: allergen_specialties appears in the SELECT list always (as a returned column),
    // so we check for the specific && filter operator, not just the column name.
    expect(text).not.toContain('allergen_specialties &&');
  });

  // ── Cuisine filter ────────────────────────────────────────────────────────

  it('includes cuisine equality filter when cuisine provided', () => {
    const { text, params } = buildSearchQuery({ ...BASE_PARAMS, cuisine: 'italian' }, 'none');
    expect(text).toContain('r.cuisine =');
    expect(params).toContain('italian');
  });

  it('does NOT include cuisine filter when cuisine empty', () => {
    const { text } = buildSearchQuery(BASE_PARAMS, 'none');
    expect(text).not.toContain('r.cuisine =');
  });

  // ── Geo / haversine ───────────────────────────────────────────────────────

  it('includes haversine expression when lat/lng provided', () => {
    const { text, params } = buildSearchQuery(
      { ...BASE_PARAMS, lat: 37.7749, lng: -122.4194, radiusMi: 10 },
      'none'
    );
    expect(text).toContain('3959 * acos');
    expect(text).toContain('distance_mi');
    expect(text).toContain('HAVING');
    // lat, lng, radiusMi should all be in params
    expect(params).toContain(37.7749);
    expect(params).toContain(-122.4194);
    expect(params).toContain(10);
  });

  it('includes ORDER BY distance_mi ASC when geo present', () => {
    const { text } = buildSearchQuery({ ...BASE_PARAMS, lat: 37.7749, lng: -122.4194 }, 'none');
    expect(text).toContain('distance_mi ASC');
  });

  it('includes bounding-box WHERE clauses when geo present', () => {
    const { text } = buildSearchQuery(
      { ...BASE_PARAMS, lat: 37.7749, lng: -122.4194, radiusMi: 25 },
      'none'
    );
    expect(text).toContain('r.lat BETWEEN');
    expect(text).toContain('r.lng BETWEEN');
  });

  it('haversine expr uses LEAST(..., 1.0) to guard acos domain', () => {
    const { text } = buildSearchQuery({ ...BASE_PARAMS, lat: 37.7749, lng: -122.4194 }, 'none');
    expect(text).toContain('LEAST(');
    expect(text).toContain('1.0');
  });

  it('does NOT include haversine when lat/lng not provided', () => {
    const { text } = buildSearchQuery(BASE_PARAMS, 'none');
    expect(text).not.toContain('3959 * acos');
    expect(text).toContain('NULL::numeric AS distance_mi');
  });

  // ── Combined filters ──────────────────────────────────────────────────────

  it('combines all filters correctly with no param index collisions', () => {
    const { text, params } = buildSearchQuery(
      {
        q: 'sushi',
        allergens: ['shellfish'],
        cuisine: 'japanese',
        lat: 34.0522,
        lng: -118.2437,
        radiusMi: 15,
      },
      'fts'
    );

    // All clauses present
    expect(text).toContain('plainto_tsquery');
    expect(text).toContain('allergen_specialties &&');
    expect(text).toContain('r.cuisine =');
    expect(text).toContain('3959 * acos');

    // No duplicate $N references (each param used exactly once in correct slot)
    const paramRefs = (text.match(/\$\d+/g) ?? []).map((p) => parseInt(p.slice(1)));
    const uniqueRefs = new Set(paramRefs);
    // All referenced params should be within the params array bounds
    expect(Math.max(...paramRefs)).toBeLessThanOrEqual(params.length);
    // Param indices should be 1-based sequential
    for (let i = 1; i <= params.length; i++) {
      expect(uniqueRefs.has(i)).toBe(true);
    }
  });

  // ── ORDER BY ──────────────────────────────────────────────────────────────

  it('includes listed_at DESC as tiebreaker always', () => {
    const { text } = buildSearchQuery(BASE_PARAMS, 'none');
    expect(text).toContain('r.listed_at DESC');
  });

  // ── SELECT columns ────────────────────────────────────────────────────────

  it('selects all required output columns', () => {
    const { text } = buildSearchQuery(BASE_PARAMS, 'none');
    const required = [
      'r.slug',
      'r.name',
      'r.cuisine',
      'r.city',
      'r.state',
      'r.lat',
      'r.lng',
      'r.hero_photo_url',
      'r.allergen_specialties',
      'r.listed_at',
      'certified_count',
      'total_employees',
      'distance_mi',
      'avg_rating',
      'review_count',
    ];
    for (const col of required) {
      expect(text).toContain(col);
    }
  });

  // ── Certification counts (T-23 / T-46a) ──────────────────────────────────
  //
  // Both counts are PEOPLE. The numerator is distinct current learners holding
  // an active certificate; the denominator is distinct current learners. The
  // TypeScript twin of these two lines lives in app/api/search/route.ts and the
  // numbers are pinned together against a real database in
  // tests/integration/search-count-parity.test.ts.

  describe('certification counts', () => {
    const { text } = buildSearchQuery(BASE_PARAMS, 'none');

    it('counts distinct certificate HOLDERS, not distinct certificates', () => {
      // COUNT(DISTINCT c.id) was the defect: it deduplicates certificates,
      // which reads as though it handles this and does not. One learner with
      // two active certificates counted twice, over a denominator of people.
      expect(text).toContain("COUNT(DISTINCT ch.id) FILTER (WHERE c.status = 'active')");
      expect(text).not.toContain('COUNT(DISTINCT c.id)');
    });

    it('joins the holder so the membership predicate can reach the numerator', () => {
      expect(text).toContain('LEFT JOIN profiles ch');
      expect(text).toContain('ch.id = c.profile_id');
      // Same restaurant, learner role, still on the roster — the three
      // conditions that make this exactly the TypeScript intersection.
      expect(text).toContain('ch.restaurant_id = r.id');
      expect(text).toContain("ch.role = 'learner'");
      expect(text).toContain('ch.departed_at IS NULL');
    });

    it('excludes departed staff from the denominator', () => {
      // T-46a filtered seven call sites and missed this one, so the SQL and
      // TypeScript denominators disagreed about the same restaurant.
      expect(text).toContain("COUNT(DISTINCT p.id) FILTER (WHERE p.role = 'learner'");
      expect(text).toContain('p.departed_at IS NULL');
    });

    it('still counts only publicly-active certificates', () => {
      expect(text).toContain("c.status = 'active'");
    });

    it('leaves the review aggregates alone', () => {
      expect(text).toContain("ROUND(AVG(rv.rating) FILTER (WHERE rv.status = 'published'), 1)");
      expect(text).toContain("COUNT(rv.id) FILTER (WHERE rv.status = 'published')");
    });
  });
});
