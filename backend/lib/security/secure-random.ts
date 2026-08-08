/**
 * lib/security/secure-random.ts
 *
 * Wave-gate-P1 P1-9 — CSPRNG-backed randomness for security-sensitive paths.
 *
 * The platform's default non-cryptographic PRNG is predictable to an
 * attacker who has observed a few prior outputs, which means anywhere in
 * the codebase that randomness gates exam selection, order, eligibility,
 * or any other security-sensitive decision MUST source entropy from
 * `node:crypto` instead.
 *
 * Two primitives:
 *
 *   - secureRandomInt(maxExclusive): integer in [0, maxExclusive).
 *     Thin wrapper over `crypto.randomInt`, which is itself a rejection-
 *     sampling CSPRNG. Throws on bad inputs (zero / negative / non-integer).
 *
 *   - secureShuffle(items): a CSPRNG-backed Fisher-Yates shuffle over a
 *     defensive copy of the input. Returns a new array.
 *
 * Why a helper instead of inlining `crypto.randomInt` at each call site:
 * a single import site is grep-able and test-coverable, and the unit-test
 * regression guard for this finding asserts the literal string
 * the non-cryptographic PRNG token never appears under `app/` or `lib/`.
 */

import { randomInt } from 'node:crypto';

/**
 * Integer in [0, maxExclusive). CSPRNG-backed.
 *
 * @throws if maxExclusive is not a positive integer >= 1.
 */
export function secureRandomInt(maxExclusive: number): number {
  if (!Number.isInteger(maxExclusive) || maxExclusive < 1) {
    throw new Error(
      `[secure-random] secureRandomInt: maxExclusive must be a positive integer, got ${maxExclusive}`
    );
  }
  return randomInt(0, maxExclusive);
}

/**
 * Fisher-Yates shuffle backed by `crypto.randomInt`.
 *
 * Returns a new array — the input is not mutated.
 */
export function secureShuffle<T>(items: readonly T[]): T[] {
  const a = items.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = secureRandomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
