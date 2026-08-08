/**
 * tests/unit/slug.test.ts
 *
 * Tests for lib/reviewer/slug.ts — toKebab, baseSlug, uniqueSlug.
 * All pure-function tests; no DB, no network.
 */

import { describe, it, expect } from 'vitest';
import { toKebab, baseSlug, uniqueSlug, uniqueSlugFromArray } from '@/lib/reviewer/slug';

// ─── toKebab ─────────────────────────────────────────────────────────────────

describe('toKebab', () => {
  it('lowercases ASCII', () => {
    expect(toKebab('Hello World')).toBe('hello-world');
  });

  it('replaces spaces with hyphens', () => {
    expect(toKebab('The Green Fork')).toBe('the-green-fork');
  });

  it('replaces multiple spaces/special chars with a single hyphen', () => {
    expect(toKebab("Joe's   Diner!!")).toBe('joe-s-diner');
  });

  it('strips accents — é → e', () => {
    expect(toKebab('Café Bistró')).toBe('cafe-bistro');
  });

  it('strips accents — ñ → n', () => {
    expect(toKebab('El Niño')).toBe('el-nino');
  });

  it('strips accents — ü → u', () => {
    expect(toKebab('Münchener Haus')).toBe('munchener-haus');
  });

  it('trims leading/trailing hyphens', () => {
    expect(toKebab('--hello--')).toBe('hello');
  });

  it('returns empty string for empty input', () => {
    expect(toKebab('')).toBe('');
  });

  it('returns empty string for whitespace-only input', () => {
    expect(toKebab('   ')).toBe('');
  });

  it('handles apostrophes gracefully', () => {
    expect(toKebab("McDonald's")).toBe('mcdonald-s');
  });

  it('handles numbers', () => {
    expect(toKebab('Pier 39 Kitchen')).toBe('pier-39-kitchen');
  });

  it('handles slash characters', () => {
    expect(toKebab('Steak / Burger')).toBe('steak-burger');
  });

  it('handles emoji by stripping them (non-ASCII)', () => {
    // Emoji are non-ASCII, so they become hyphens and then get trimmed.
    const result = toKebab('Good Food 🌮');
    expect(result).toBe('good-food');
  });

  it('handles Chinese characters by stripping them', () => {
    // Pure CJK input → all stripped → empty
    expect(toKebab('餐厅')).toBe('');
  });
});

// ─── baseSlug ─────────────────────────────────────────────────────────────────

describe('baseSlug', () => {
  it('concatenates name and city with a hyphen', () => {
    expect(baseSlug('The Green Fork', 'San Diego')).toBe('the-green-fork-san-diego');
  });

  it('falls back to "restaurant" when both produce empty slug', () => {
    expect(baseSlug('', '')).toBe('restaurant');
  });

  it('handles empty city gracefully', () => {
    expect(baseSlug('Taco Town', '')).toBe('taco-town');
  });

  it('handles empty name gracefully', () => {
    expect(baseSlug('', 'Austin')).toBe('austin');
  });

  it('strips accents from both parts', () => {
    expect(baseSlug('Café Rêve', 'Montréal')).toBe('cafe-reve-montreal');
  });

  it('handles special characters in city name', () => {
    expect(baseSlug('Bistro', 'St. Louis')).toBe('bistro-st-louis');
  });
});

// ─── uniqueSlug ───────────────────────────────────────────────────────────────

describe('uniqueSlug', () => {
  it('returns base slug when no collisions', () => {
    expect(uniqueSlug('The Green Fork', 'San Diego', new Set())).toBe('the-green-fork-san-diego');
  });

  it('returns base slug when existing set does not contain it', () => {
    const existing = new Set(['other-restaurant-city']);
    expect(uniqueSlug('The Green Fork', 'San Diego', existing)).toBe('the-green-fork-san-diego');
  });

  it('appends -2 on first collision', () => {
    const existing = new Set(['the-green-fork-san-diego']);
    expect(uniqueSlug('The Green Fork', 'San Diego', existing)).toBe('the-green-fork-san-diego-2');
  });

  it('appends -3 on second collision', () => {
    const existing = new Set(['the-green-fork-san-diego', 'the-green-fork-san-diego-2']);
    expect(uniqueSlug('The Green Fork', 'San Diego', existing)).toBe('the-green-fork-san-diego-3');
  });

  it('handles 3+ deep collisions correctly', () => {
    const existing = new Set([
      'the-green-fork-san-diego',
      'the-green-fork-san-diego-2',
      'the-green-fork-san-diego-3',
    ]);
    expect(uniqueSlug('The Green Fork', 'San Diego', existing)).toBe('the-green-fork-san-diego-4');
  });

  it('handles 5-deep collision chain', () => {
    const base = 'bistro-austin';
    const existing = new Set([base, `${base}-2`, `${base}-3`, `${base}-4`, `${base}-5`]);
    expect(uniqueSlug('Bistro', 'Austin', existing)).toBe(`${base}-6`);
  });

  it('works with default empty set parameter', () => {
    expect(uniqueSlug('Test Place', 'LA')).toBe('test-place-la');
  });

  it('falls back to "restaurant" base for names that produce no ASCII slug', () => {
    // Chinese restaurant name in pure CJK
    const slug = uniqueSlug('餐厅', '');
    expect(slug).toBe('restaurant');
  });
});

// ─── uniqueSlugFromArray ──────────────────────────────────────────────────────

describe('uniqueSlugFromArray', () => {
  it('works with array input, no collision', () => {
    expect(uniqueSlugFromArray('Green Fork', 'Portland', [])).toBe('green-fork-portland');
  });

  it('works with array input, with collision', () => {
    expect(uniqueSlugFromArray('Green Fork', 'Portland', ['green-fork-portland'])).toBe(
      'green-fork-portland-2'
    );
  });

  it('handles null-like values without crashing', () => {
    // TypeScript guards at compile time, but runtime safety matters.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(() => uniqueSlugFromArray('' as any, '' as any, [])).not.toThrow();
  });
});

// ─── Accent edge cases ────────────────────────────────────────────────────────

describe('accent/special-char edge cases', () => {
  it('handles mixed accented + normal: Ñoño → nono', () => {
    expect(toKebab('Ñoño')).toBe('nono');
  });

  it('handles ligature: æ → ae-equivalent (stripped to empty if not ASCII base)', () => {
    // 'æ' normalizes to 'a' + combining 'e' via NFD, but 'æ' is U+00E6 which
    // decomposes as itself (no decomposition for ligatures) → gets stripped.
    const result = toKebab('Smørrebrød');
    // ø and ø-with-stroke: ø is U+00F8, no canonical decomposition to ASCII.
    // Test that it doesn't crash and produces a valid slug.
    expect(result).toMatch(/^[a-z0-9-]*$/);
  });

  it('handles German ß gracefully', () => {
    const result = toKebab('Straße');
    expect(result).toMatch(/^[a-z0-9-]*$/);
  });

  it('trailing hyphens are always stripped', () => {
    // Name + city that ends up with a trailing hyphen due to special chars.
    const result = toKebab('Good Food!');
    expect(result).not.toMatch(/-$/);
    expect(result).not.toMatch(/^-/);
  });
});
