/**
 * tests/unit/cert-code.test.ts
 *
 * Wave 4B P0 #10.a — random unguessable cert codes with ISO 7064 Mod 37,36
 * check digit over Crockford Base32. See audits/cert-code-redesign-plan.md
 * sections (a), (a.iii), (b), and (g).
 *
 * Test-first: this file is committed BEFORE lib/learner/cert-code.ts is
 * implemented. Implementation must satisfy every assertion below.
 */

import { describe, it, expect } from 'vitest';
import { generateCertCode, validateCertCode, CERT_CODE_REGEX } from '@/lib/learner/cert-code';

// ─── Generator ───────────────────────────────────────────────────────────────

describe('generateCertCode', () => {
  it('returns a 14-character string matching the documented regex', () => {
    const code = generateCertCode();
    expect(code).toMatch(CERT_CODE_REGEX);
    expect(code.length).toBe(16); // "AW-XXXXX-XXXXX-C" = 16 chars including 3 hyphens
  });

  it('returns a code whose check digit re-validates (round-trip)', () => {
    for (let i = 0; i < 50; i++) {
      const code = generateCertCode();
      const result = validateCertCode(code);
      expect(result.ok, `generated code ${code} failed self-validation`).toBe(true);
    }
  });

  it('10,000 successive calls produce 10,000 unique codes', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 10_000; i++) {
      seen.add(generateCertCode());
    }
    expect(seen.size).toBe(10_000);
  });

  it('body characters are drawn from Crockford Base32 only (no I, L, O, U)', () => {
    // Sample many codes; assert no forbidden character appears in the
    // 10 body positions (positions 3..7 and 9..13 of "AW-XXXXX-XXXXX-C").
    const forbidden = new Set(['I', 'L', 'O', 'U']);
    for (let i = 0; i < 1_000; i++) {
      const code = generateCertCode();
      // Strip "AW-" and the hyphens; the last char is the check digit and
      // may legitimately be any Crockford char (also drawn from same set).
      const body = code.slice(3).replace(/-/g, '');
      expect(body.length).toBe(11); // 10 random + 1 check
      for (const ch of body) {
        expect(forbidden.has(ch), `forbidden character ${ch} found in code ${code}`).toBe(false);
      }
    }
  });
});

// ─── Validator ───────────────────────────────────────────────────────────────

describe('validateCertCode', () => {
  it('accepts a freshly generated code', () => {
    const code = generateCertCode();
    expect(validateCertCode(code)).toEqual({ ok: true, canonical: code });
  });

  it('rejects the old format AW-2026-000001', () => {
    const result = validateCertCode('AW-2026-000001');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('invalid_format');
  });

  it('normalizes lowercase + space input and validates after normalize', () => {
    const code = generateCertCode();
    const messy = code.toLowerCase().replace(/-/g, ' ');
    const result = validateCertCode(messy);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.canonical).toBe(code);
  });

  it('rejects missing check digit', () => {
    const code = generateCertCode();
    const truncated = code.slice(0, -1);
    const result = validateCertCode(truncated);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('invalid_format');
  });

  it('rejects extra trailing character', () => {
    const code = generateCertCode() + 'A';
    const result = validateCertCode(code);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('invalid_format');
  });

  it('rejects forbidden letter I in body (after Crockford remap, check digit fails)', () => {
    // Per the Crockford spec, the validator normalizes I → 1 before checking
    // the regex. So a code with `I` in the body passes the regex check but
    // the substituted body no longer matches the original check digit. The
    // rejection arrives at the check-digit step, not the format step. The
    // public response (not_found) is identical either way; the discrimination
    // only matters for the internal `reason` log.
    const result = validateCertCode('AW-XI4T8-Q9M2K-5');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('invalid_check');
  });

  it('rejects forbidden letter L in body (after Crockford remap, check digit fails)', () => {
    const result = validateCertCode('AW-XJ4T8-Q9M2L-5');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('invalid_check');
  });

  it('rejects empty string', () => {
    const result = validateCertCode('');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('invalid_format');
  });

  it('rejects a code whose format is valid but check digit is wrong', () => {
    const code = generateCertCode();
    // Flip the check digit to a guaranteed-different Crockford char.
    const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
    const last = code[code.length - 1];
    const next = alphabet[(alphabet.indexOf(last) + 1) % alphabet.length];
    const corrupted = code.slice(0, -1) + next;
    const result = validateCertCode(corrupted);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('invalid_check');
  });

  it('100% single-character substitution detection across 100 random codes', () => {
    // ISO 7064 Mod 37,36 catches 100% of single-character substitutions.
    // Generate a code, flip ONE character at a random body position,
    // assert the validator rejects.
    const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
    let rejected = 0;
    for (let i = 0; i < 100; i++) {
      const code = generateCertCode();
      // Body positions are non-hyphen indices: 3,4,5,6,7,9,10,11,12,13,15.
      const bodyPositions = [3, 4, 5, 6, 7, 9, 10, 11, 12, 13, 15];
      const pos = bodyPositions[i % bodyPositions.length];
      const original = code[pos];
      // Pick a different char from the alphabet (skip I/L/O/U mapping for
      // body slots — they never legitimately appear, so substituting them
      // is still a real typo signal).
      let replacement = alphabet[(alphabet.indexOf(original) + 7) % alphabet.length];
      // Avoid forbidden letters in body so the format regex doesn't catch
      // it first — we want to test the CHECK DIGIT, not the regex.
      if (pos !== 15) {
        while ('ILOU'.includes(replacement)) {
          replacement = alphabet[(alphabet.indexOf(replacement) + 1) % alphabet.length];
        }
      }
      const corrupted = code.slice(0, pos) + replacement + code.slice(pos + 1);
      const result = validateCertCode(corrupted);
      if (!result.ok) rejected++;
    }
    expect(rejected).toBe(100);
  });

  it('100% adjacent-transposition detection across 100 random codes', () => {
    // Statistically flaky in a prior version: with a fixed 100-trial budget
    // and a ~1/32 (~3.1%) chance per trial that positions 3/4 are identical
    // (a no-op "transposition" the validator correctly accepts), the skip
    // count is Binomial(100, 1/32) — P(skips > 5) ≈ 8-9%, well within
    // "will fail about 1 run in 12." That's a skip-count variance artifact,
    // NOT a real detection failure: an empirical 200k-trial sweep found 0
    // missed transpositions once identical-char no-ops are excluded (ISO
    // 7064 Mod 37,36 has a genuine 100% adjacent-transposition guarantee —
    // see the module doc). Retrying until each trial is a REAL
    // transposition makes the trial count exact and the assertion a true
    // 100%, eliminating the flake instead of just tolerating it.
    let rejected = 0;
    for (let i = 0; i < 100; i++) {
      let code = generateCertCode();
      while (code[3] === code[4]) {
        code = generateCertCode();
      }
      // Transpose two adjacent body chars. Positions 3 and 4 are both in
      // the first 5-char block — guaranteed adjacent, no hyphen between.
      const transposed = code.slice(0, 3) + code[4] + code[3] + code.slice(5);
      const result = validateCertCode(transposed);
      if (!result.ok) rejected++;
    }
    expect(rejected).toBe(100);
  });
});

// ─── Statistical collision smoke ─────────────────────────────────────────────

describe('cert-code collision smoke', () => {
  // Explicit timeout: 1M crypto.randomBytes + rejection-sampling calls is
  // ~5-6s of real work, which sits right at Vitest's 5000ms default
  // testTimeout and intermittently trips it under CI/machine load — a timing
  // flake unrelated to the statistical assertion below. A generous explicit
  // budget removes that false-failure mode without weakening the check.
  it('1M generated codes produce <5 collisions (50-bit birthday bound)', () => {
    // At N=1M codes over a 2^50 space, the expected number of pairwise
    // collisions is N(N-1) / (2 * 2^50) ≈ 0.00044 (2^50 ≈ 1.126e15, so
    // ~5e11 pairs / 1.126e15 ≈ 4.4e-4 — NOT 0.44; a prior version of this
    // comment was off by 1000x). Asserting "fewer than 5" is therefore
    // enormous headroom (P(X>=5) is vanishingly small under correct
    // entropy) — this is a regression smoke test for "did somebody swap
    // crypto.randomBytes for Math.random," not a tight statistical bound.
    const seen = new Set<string>();
    let collisions = 0;
    for (let i = 0; i < 1_000_000; i++) {
      const code = generateCertCode();
      if (seen.has(code)) collisions++;
      else seen.add(code);
    }
    expect(collisions).toBeLessThan(5);
  }, 30_000);
});
