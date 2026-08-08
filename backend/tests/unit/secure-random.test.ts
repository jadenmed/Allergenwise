/**
 * tests/unit/secure-random.test.ts
 *
 * P1-9 — verify the CSPRNG helpers behave as a CSPRNG-backed Fisher-Yates
 * shuffle and uniform integer generator, and that the non-cryptographic
 * PRNG token never appears in app/ or lib/ code paths.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { secureShuffle, secureRandomInt } from '@/lib/security/secure-random';

describe('secureRandomInt', () => {
  it('throws on non-positive / non-integer maxExclusive', () => {
    expect(() => secureRandomInt(0)).toThrow();
    expect(() => secureRandomInt(-1)).toThrow();
    expect(() => secureRandomInt(1.5)).toThrow();
    expect(() => secureRandomInt(Number.NaN)).toThrow();
  });

  it('returns 0 for maxExclusive = 1', () => {
    for (let i = 0; i < 50; i++) {
      expect(secureRandomInt(1)).toBe(0);
    }
  });

  it('values stay inside [0, maxExclusive) across 10,000 samples', () => {
    const max = 17;
    for (let i = 0; i < 10_000; i++) {
      const v = secureRandomInt(max);
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(max);
    }
  });

  it('distribution across 10,000 samples is roughly uniform', () => {
    const max = 10;
    const counts = new Array<number>(max).fill(0);
    const n = 10_000;
    for (let i = 0; i < n; i++) counts[secureRandomInt(max)]++;
    const expected = n / max; // 1000
    // Three sigmas of a binomial(10000, 0.1) is sqrt(10000 * 0.1 * 0.9) * 3
    // ≈ 90 — be generous and allow ±200 so the test is never flaky.
    for (const c of counts) {
      expect(Math.abs(c - expected)).toBeLessThan(200);
    }
  });
});

describe('secureShuffle', () => {
  it('returns a new array (does not mutate input)', () => {
    const input = [1, 2, 3, 4, 5];
    const snapshot = input.slice();
    const out = secureShuffle(input);
    expect(input).toEqual(snapshot);
    expect(out).not.toBe(input);
  });

  it('output is a permutation of the input (every element appears exactly once)', () => {
    const input = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'];
    for (let trial = 0; trial < 1000; trial++) {
      const out = secureShuffle(input);
      expect(out.length).toBe(input.length);
      expect(new Set(out)).toEqual(new Set(input));
    }
  });

  it('over 10,000 shuffles of [1,2,3,4,5], every position sees every value', () => {
    const input = [1, 2, 3, 4, 5];
    const seen: Set<number>[] = input.map(() => new Set<number>());
    for (let i = 0; i < 10_000; i++) {
      const out = secureShuffle(input);
      for (let pos = 0; pos < out.length; pos++) seen[pos].add(out[pos]);
    }
    for (const s of seen) {
      // Every position should have been every value at least once across 10k.
      expect(s.size).toBe(5);
    }
  });

  it('position-value distribution across 10,000 shuffles is roughly uniform', () => {
    const input = [0, 1, 2, 3, 4];
    const n = 10_000;
    // counts[pos][value] = number of times value appeared at pos.
    const counts: number[][] = input.map(() => new Array<number>(5).fill(0));
    for (let i = 0; i < n; i++) {
      const out = secureShuffle(input);
      for (let pos = 0; pos < out.length; pos++) counts[pos][out[pos]]++;
    }
    const expected = n / 5; // 2000
    for (const row of counts) {
      for (const c of row) {
        // 3-sigma binomial(10000, 0.2) ≈ 120; allow ±300 for safety.
        expect(Math.abs(c - expected)).toBeLessThan(300);
      }
    }
  });

  it('handles empty array and single-element array', () => {
    expect(secureShuffle([])).toEqual([]);
    expect(secureShuffle(['only'])).toEqual(['only']);
  });
});

// ─── Regression guard: ban the non-cryptographic PRNG anywhere in app/+lib/ ──

describe('regression: non-cryptographic PRNG ban', () => {
  it('grep finds zero occurrences of the literal "Math.random" under app/ and lib/', () => {
    const repoRoot = resolve(__dirname, '..', '..');
    const offenders: string[] = [];
    const banned = 'Math' + '.' + 'random'; // dodge self-grep on this file
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const p = join(dir, entry);
        const s = statSync(p);
        if (s.isDirectory()) {
          walk(p);
          continue;
        }
        if (!/\.(ts|tsx|js|jsx|mjs)$/.test(entry)) continue;
        const text = readFileSync(p, 'utf8');
        if (text.includes(banned)) offenders.push(p);
      }
    };
    walk(join(repoRoot, 'app'));
    walk(join(repoRoot, 'lib'));
    expect(offenders).toEqual([]);
  });
});
