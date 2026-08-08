/**
 * tests/unit/moderation.test.ts
 *
 * Unit tests for lib/directory/moderation.ts spam heuristics.
 * Tests each individual heuristic and the composite score function.
 */

import { describe, it, expect } from 'vitest';
import {
  linkCount,
  allCapsRatio,
  hasExcessiveRepetition,
  hasContactInfo,
  spamKeywordCount,
  computeSpamScore,
} from '@/lib/directory/moderation';

// ---------------------------------------------------------------------------
// linkCount
// ---------------------------------------------------------------------------

describe('linkCount', () => {
  it('returns 0 for clean text', () => {
    expect(linkCount('Great food, very clean kitchen!')).toBe(0);
  });

  it('counts one https link', () => {
    expect(linkCount('Visit https://example.com for more info.')).toBe(1);
  });

  it('counts multiple links', () => {
    expect(linkCount('Go to https://a.com or http://b.org or www.c.net')).toBe(3);
  });

  it('counts www. links without protocol', () => {
    expect(linkCount('Check www.spammy-deals.com now!')).toBe(1);
  });

  it('returns 0 for empty string', () => {
    expect(linkCount('')).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// allCapsRatio
// ---------------------------------------------------------------------------

describe('allCapsRatio', () => {
  it('returns 0.0 for all-lowercase text', () => {
    expect(allCapsRatio('great restaurant!')).toBeCloseTo(0, 5);
  });

  it('returns 1.0 for all-uppercase text', () => {
    expect(allCapsRatio('GREAT RESTAURANT')).toBeCloseTo(1.0, 5);
  });

  it('returns ~0.5 for mixed case', () => {
    const ratio = allCapsRatio('Great Restaurant');
    expect(ratio).toBeGreaterThan(0.05);
    expect(ratio).toBeLessThan(0.6);
  });

  it('ignores non-alpha characters', () => {
    // "!@#ABC!@#" → 3 uppercase / 3 alpha = 1.0
    expect(allCapsRatio('!@#ABC!@#')).toBeCloseTo(1.0, 5);
  });

  it('returns 0 for empty string', () => {
    expect(allCapsRatio('')).toBe(0);
  });

  it('returns 0 for purely numeric/symbol string', () => {
    expect(allCapsRatio('12345 !!!')).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// hasExcessiveRepetition
// ---------------------------------------------------------------------------

describe('hasExcessiveRepetition', () => {
  it('returns true for word repeated 4+ times', () => {
    expect(hasExcessiveRepetition('great great great great')).toBe(true);
  });

  it('returns true for word repeated more than 4 times', () => {
    expect(hasExcessiveRepetition('buy buy buy buy buy')).toBe(true);
  });

  it('returns false for word repeated only 3 times', () => {
    expect(hasExcessiveRepetition('good good good')).toBe(false);
  });

  it('returns false for natural varied text', () => {
    expect(
      hasExcessiveRepetition(
        'The food was excellent. The service was great. We loved the ambiance.'
      )
    ).toBe(false);
  });

  it('is case-insensitive', () => {
    expect(hasExcessiveRepetition('GREAT great Great great')).toBe(true);
  });

  it('returns false for empty string', () => {
    expect(hasExcessiveRepetition('')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// hasContactInfo
// ---------------------------------------------------------------------------

describe('hasContactInfo', () => {
  it('detects US phone number (xxx-xxx-xxxx)', () => {
    expect(hasContactInfo('Call us at 555-867-5309 for a reservation.')).toBe(true);
  });

  it('detects US phone number with parens', () => {
    expect(hasContactInfo('Phone: (800) 555-1234')).toBe(true);
  });

  it('detects email address', () => {
    expect(hasContactInfo('Email promo@spam.com for discount codes.')).toBe(true);
  });

  it('returns false for clean review text', () => {
    expect(hasContactInfo('Amazing gluten-free menu! Highly recommend for celiac families.')).toBe(
      false
    );
  });

  it('returns false for empty string', () => {
    expect(hasContactInfo('')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// spamKeywordCount
// ---------------------------------------------------------------------------

describe('spamKeywordCount', () => {
  it('returns 0 for clean text', () => {
    expect(
      spamKeywordCount('The allergen menu was clearly labeled and staff was knowledgeable.')
    ).toBe(0);
  });

  it('detects "click here"', () => {
    expect(spamKeywordCount('Click here for amazing deals!')).toBe(1);
  });

  it('detects multiple keywords', () => {
    expect(spamKeywordCount('Order now and earn money with this casino offer!')).toBeGreaterThan(1);
  });

  it('is case-insensitive', () => {
    expect(spamKeywordCount('BUY NOW — LIMITED TIME offer!')).toBeGreaterThanOrEqual(1);
  });

  it('returns 0 for empty string', () => {
    expect(spamKeywordCount('')).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// computeSpamScore
// ---------------------------------------------------------------------------

describe('computeSpamScore', () => {
  it('returns score 0 and no flags for genuinely clean review', () => {
    const result = computeSpamScore(
      "We dined here last Sunday and the chef personally accommodated our son's peanut allergy. " +
        'The staff was attentive, the food was excellent, and we felt safe. Highly recommend.'
    );
    expect(result.score).toBe(0);
    expect(result.flags).toHaveLength(0);
    expect(result.flagged).toBe(false);
  });

  it('flags review with link', () => {
    const result = computeSpamScore(
      'Great food! Visit https://spammy.deals/promo for 50% off your next meal.'
    );
    expect(result.flags.some((f) => f.includes('link'))).toBe(true);
    expect(result.score).toBeGreaterThan(0);
  });

  it('flags all-caps review', () => {
    const result = computeSpamScore('THIS PLACE IS ABSOLUTELY THE BEST. GREAT FOOD AND SERVICE!!!');
    expect(result.flags.some((f) => f.includes('all-caps'))).toBe(true);
  });

  it('flags repetitive review', () => {
    const result = computeSpamScore('great great great great food');
    expect(result.flags.some((f) => f.includes('repetition'))).toBe(true);
  });

  it('flags review with phone number', () => {
    const result = computeSpamScore('Loved the food! Call 555-867-5309 for the secret menu.');
    expect(result.flags.some((f) => f.includes('contact info'))).toBe(true);
    expect(result.score).toBeGreaterThanOrEqual(0.4);
  });

  it('flags review with spam keywords', () => {
    const result = computeSpamScore('Order now! Limited time offer. Buy now and earn money!');
    expect(result.flags.some((f) => f.includes('keyword'))).toBe(true);
  });

  it('score is clamped to [0, 1] even for extreme spam', () => {
    const text =
      'BUY NOW BUY NOW BUY NOW BUY NOW. Click here https://spam.com http://spam2.com. ' +
      'Email spam@spam.com or call 555-867-5309. Casino bitcoin crypto diet pill. ' +
      'earn money earn money earn money guaranteed weight loss buy buy buy buy buy.';
    const result = computeSpamScore(text);
    expect(result.score).toBeLessThanOrEqual(1.0);
    expect(result.score).toBeGreaterThan(0.6);
    expect(result.flagged).toBe(true);
  });

  it('score is exactly 0 for minimum viable clean review', () => {
    const result = computeSpamScore('Very good allergy-aware restaurant. Staff was helpful.');
    expect(result.score).toBe(0);
    expect(result.flagged).toBe(false);
  });

  it('considers all-caps author name as minor signal', () => {
    const clean = computeSpamScore('Great food, loved the gluten-free options!');
    const withCapsAuthor = computeSpamScore(
      'Great food, loved the gluten-free options!',
      'SPAMMY MCSPAM'
    );
    expect(withCapsAuthor.score).toBeGreaterThan(clean.score);
  });

  it('flagged is true when score > 0.6', () => {
    const result = computeSpamScore(
      'Click here for casino deals! https://spam.com. Call 555-123-4567. Earn money now!'
    );
    expect(result.flagged).toBe(result.score > 0.6);
  });

  it('flags array contains human-readable descriptions', () => {
    const result = computeSpamScore('EVERYTHING IS GREAT!!! https://promo.com BUY NOW.');
    for (const flag of result.flags) {
      expect(typeof flag).toBe('string');
      expect(flag.length).toBeGreaterThan(0);
    }
  });
});
