/**
 * tests/unit/directory-cert-stat.test.ts
 *
 * Unit tests for lib/directory/cert-stat.ts — the single source of truth for
 * turning the two public certification counts into a renderable state.
 *
 * The defect this guards against: the previous inline ternary
 *
 *     totalEmployees > 0 ? Math.round((certifiedCount / totalEmployees) * 100) : 100
 *
 * rendered "100% of staff certified" on a public, unauthenticated page for
 * THREE distinct situations — no learners enrolled, an all-manager restaurant,
 * and a failed count query. None of them is full certification.
 *
 * Core invariant asserted throughout: a percentage exists ONLY when a positive
 * denominator exists. There is no fallback percentage.
 */

import { describe, it, expect } from 'vitest';
import { deriveCertStat, isCertStatDegraded } from '@/lib/directory/cert-stat';

describe('deriveCertStat', () => {
  // ── The three cases that used to render 100% ──────────────────────────────

  it('does NOT report 100% when there are no learners (count genuinely 0)', () => {
    const stat = deriveCertStat(0, 0);
    expect(stat.kind).toBe('no-denominator');
    expect(stat).not.toHaveProperty('percent');
  });

  it('does NOT report 100% for an all-manager restaurant (0 learner-role staff)', () => {
    // The profiles count filters .eq('role','learner'), so a restaurant whose
    // staff are all role='manager' yields a genuine 0 denominator.
    const stat = deriveCertStat(0, 0);
    expect(stat.kind).toBe('no-denominator');
    expect(stat).not.toHaveProperty('percent');
  });

  it('does NOT report 100% when a count query failed (null)', () => {
    expect(deriveCertStat(null, null).kind).toBe('unavailable');
    expect(deriveCertStat(0, null).kind).toBe('unavailable');
    expect(deriveCertStat(null, 0).kind).toBe('unavailable');
    expect(deriveCertStat(3, null).kind).toBe('unavailable');
    expect(deriveCertStat(null, 10).kind).toBe('unavailable');
  });

  it('never returns a percent for any non-positive or unknown denominator', () => {
    const denominators = [null, undefined, 0, -1, NaN];
    for (const total of denominators) {
      const stat = deriveCertStat(5, total);
      expect(stat).not.toHaveProperty('percent');
      expect(stat.kind).not.toBe('known');
    }
  });

  // ── The two states must stay distinguishable ──────────────────────────────

  it('keeps "genuinely zero" and "count failed" as distinct states', () => {
    const zero = deriveCertStat(0, 0);
    const failed = deriveCertStat(null, null);

    expect(zero.kind).toBe('no-denominator');
    expect(failed.kind).toBe('unavailable');
    expect(zero.kind).not.toBe(failed.kind);
  });

  it('a successful count of zero can never produce the unavailable state', () => {
    // Every combination where both counts are real numbers must NOT be
    // 'unavailable', no matter how small.
    for (const certified of [0, 1, 7]) {
      for (const total of [0, 1, 7]) {
        expect(deriveCertStat(certified, total).kind).not.toBe('unavailable');
      }
    }
  });

  it('a failed count can never produce the no-denominator state', () => {
    for (const certified of [null, undefined]) {
      for (const total of [null, undefined, 0, 5]) {
        expect(deriveCertStat(certified, total).kind).not.toBe('no-denominator');
      }
    }
  });

  // ── Normal path ───────────────────────────────────────────────────────────

  it('computes the percentage when the denominator is positive', () => {
    expect(deriveCertStat(5, 10)).toEqual({
      kind: 'known',
      certified: 5,
      total: 10,
      percent: 50,
    });
  });

  it('reports 100% only when every learner is certified', () => {
    expect(deriveCertStat(8, 8)).toEqual({
      kind: 'known',
      certified: 8,
      total: 8,
      percent: 100,
    });
  });

  it('reports 0% for a real zero numerator over a real positive denominator', () => {
    const stat = deriveCertStat(0, 4);
    expect(stat).toEqual({ kind: 'known', certified: 0, total: 4, percent: 0 });
  });

  it('rounds to the nearest whole percent', () => {
    // 1/3 = 33.33… → 33
    expect(deriveCertStat(1, 3)).toMatchObject({ percent: 33 });
    // 2/3 = 66.67… → 67
    expect(deriveCertStat(2, 3)).toMatchObject({ percent: 67 });
  });

  // ── Range contract the progressbar depends on ────────────────────────────

  it('clamps percent to 100 so aria-valuemax and bar width stay in range', () => {
    // certifiedCount counts certificate ROWS; one learner can hold two active
    // certificates, pushing the raw ratio above 1.
    expect(deriveCertStat(4, 2)).toMatchObject({ kind: 'known', percent: 100 });
  });

  it('floors negative counts at zero rather than emitting a negative percent', () => {
    expect(deriveCertStat(-3, 10)).toMatchObject({ kind: 'known', percent: 0 });
  });

  // ── Degradation predicate ────────────────────────────────────────────────

  it('isCertStatDegraded is true only when a count did not arrive', () => {
    expect(isCertStatDegraded(null, 5)).toBe(true);
    expect(isCertStatDegraded(5, null)).toBe(true);
    expect(isCertStatDegraded(undefined, undefined)).toBe(true);

    expect(isCertStatDegraded(0, 0)).toBe(false);
    expect(isCertStatDegraded(0, 5)).toBe(false);
    expect(isCertStatDegraded(5, 5)).toBe(false);
  });
});
