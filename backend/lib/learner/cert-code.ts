/**
 * lib/learner/cert-code.ts
 *
 * Wave 4B P0 #10.a — random unguessable cert codes.
 *
 * Format: `AW-XXXXX-XXXXX-C` where
 *   - `AW-` is a fixed namespace prefix.
 *   - `XXXXX-XXXXX` is 10 random characters from Crockford Base32
 *     (`0-9`, `A-Z` minus `I`, `L`, `O`, `U`). 50 bits of entropy.
 *   - `C` is the ISO 7064 Mod 37,36 check digit over the 10 body chars.
 *     Catches 100% of single-character substitutions and 100% of
 *     adjacent transpositions.
 *
 * The 14-char visible code (3 hyphens + 13 chars) renders cleanly on a
 * printed certificate and a QR code. The check digit fails fast at the
 * verify endpoint without revealing whether the code is "valid format
 * but unknown" vs "invalid format" — both produce the same not_found
 * response. See audits/cert-code-redesign-plan.md sections (a) and (g).
 *
 * Design references:
 *   - audits/cert-code-redesign-plan.md (Wave 4B plan)
 *   - ISO 7064 Mod 37,36 spec
 *   - Crockford Base32 spec (https://www.crockford.com/base32.html)
 *
 * This module has no external dependencies beyond `node:crypto`. Pure
 * computation — safe to import from any layer (route handler, test,
 * seed script).
 */

import { randomBytes } from 'node:crypto';

// ─── Alphabets ────────────────────────────────────────────────────────────────

/**
 * Crockford Base32 alphabet — 32 symbols, excludes I, L, O, U to avoid
 * confusion with 1, 1, 0, V.
 *
 * Order matters: the index of each character is its numeric value.
 */
const CROCKFORD_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/**
 * ISO 7064 Mod 37,36 alphabet — 36 symbols (0-9 + A-Z, full alphanumeric).
 *
 * Used internally by the check-digit algorithm. The four letters I, L, O,
 * U that Crockford excludes do exist in this alphabet (at fixed indices)
 * — they are used internally by the modular arithmetic but never EMITTED
 * in a cert code because the body always draws from Crockford, and the
 * emitted check digit gets remapped through `EMIT_REMAP` below before
 * being concatenated to the body.
 */
const MOD_36_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/**
 * Crockford normalization map — applied to USER INPUT (not to algorithm
 * output) so a hand-typed `O` becomes `0`, `I` becomes `1`, etc.
 *
 * We DO NOT apply this to the algorithm's emitted check digit. Doing so
 * would be lossy (I and L both map to 1) and would break the ISO 7064
 * Mod 37,36 detection guarantees — a substituted body whose new check
 * digit happens to land on the same remapped slot as the original would
 * compare equal under post-remap comparison.
 *
 * Instead, generateCertCode REJECTION-SAMPLES: if the algorithm produces
 * a check digit in {I, L, O, U}, the body is regenerated and we try
 * again. Rejection probability ≈ 4/36 ≈ 11%, average ~1.13 draws per
 * code — negligible cost in exchange for preserving 100% single-char
 * substitution and 100% adjacent-transposition detection.
 */
const INPUT_NORMALIZE_REMAP: Record<string, string> = {
  I: '1',
  L: '1',
  O: '0',
  U: 'V',
};

const FORBIDDEN_CHECK_CHARS = new Set(['I', 'L', 'O', 'U']);

// ─── Regex ────────────────────────────────────────────────────────────────────

/**
 * The canonical regex enforced by `validateCertCode` AND by the DB-level
 * CHECK constraint in migration 0015. Must stay in sync.
 *
 * Body characters: Crockford Base32 alphabet only (no I, L, O, U).
 * Format: `AW-` + 5 chars + `-` + 5 chars + `-` + 1 check char.
 */
export const CERT_CODE_REGEX =
  /^AW-[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]$/;

// ─── ISO 7064 Mod 37,36 check digit ──────────────────────────────────────────

/**
 * Compute the ISO 7064 Mod 37,36 check character for a string drawn from
 * the 36-character alphabet. The body is the 10 random Crockford chars
 * concatenated (no hyphens), and this function returns one character that
 * is then optionally remapped through `EMIT_REMAP`.
 */
function mod37_36(body: string): string {
  let p = 36;
  for (const ch of body) {
    const v = MOD_36_ALPHABET.indexOf(ch);
    if (v < 0) {
      throw new Error(`mod37_36: character "${ch}" not in alphabet`);
    }
    let s = (p + v) % 36;
    if (s === 0) s = 36;
    p = (s * 2) % 37;
  }
  const final = (37 - p) % 36;
  return MOD_36_ALPHABET[final];
}

/**
 * Compute the check character for the 10-char body. The raw Mod 37,36
 * output is returned verbatim — if it's one of I/L/O/U, the caller
 * (generateCertCode) is expected to reject and regenerate.
 *
 * The validator also uses this raw output for comparison, so the
 * detection properties hold byte-for-byte.
 */
function computeCheckChar(body: string): string {
  return mod37_36(body);
}

// ─── Generator ───────────────────────────────────────────────────────────────

/**
 * Generate a random cert code with check digit.
 *
 * Uses `crypto.randomBytes` for cryptographic-grade entropy. Each call
 * draws 10 fresh body characters from Crockford Base32 (50 bits), then
 * appends the Mod 37,36 check digit.
 *
 * Collision probability at 1M codes is ~0.044%; the DB's UNIQUE
 * constraint on `certificates.cert_code` is the final guard. The
 * exam-submit retry loop retries up to 3 times on collision.
 */
export function generateCertCode(): string {
  // Rejection-sample: if the Mod 37,36 check digit lands on a
  // Crockford-forbidden char (I, L, O, U), regenerate the body. Average
  // ~1.13 attempts per code.
  // Hard cap to defend against an entropy-source regression that would
  // otherwise hang. 50 attempts at 11% rejection rate is 50! / chance
  // ≈ effectively impossible.
  for (let attempt = 0; attempt < 50; attempt++) {
    const bodyChars: string[] = [];
    // 10 body chars × 5 bits = 50 bits. Pull 7 bytes (56 bits) and use
    // 50 of them via 10 × 5-bit slices. Rejection-sampling not needed
    // for the BODY because 32 is a power of 2 and 5 bits maps cleanly
    // to one Crockford index. (The rejection sampling above is for the
    // CHECK DIGIT only.)
    const bytes = randomBytes(7);
    let bits = BigInt(0);
    for (const b of bytes) {
      bits = (bits << BigInt(8)) | BigInt(b);
    }
    // Discard the 6 high bits we don't need (56 - 50 = 6).
    bits = bits >> BigInt(6);
    const FIVE_BIT_MASK = BigInt(0x1f);
    const FIVE = BigInt(5);
    for (let i = 0; i < 10; i++) {
      const idx = Number(bits & FIVE_BIT_MASK);
      bodyChars.push(CROCKFORD_ALPHABET[idx]);
      bits = bits >> FIVE;
    }
    const body = bodyChars.join('');
    const check = computeCheckChar(body);
    if (FORBIDDEN_CHECK_CHARS.has(check)) continue;
    return `AW-${body.slice(0, 5)}-${body.slice(5, 10)}-${check}`;
  }
  throw new Error('generateCertCode: rejection-sampling failed 50 times — entropy source broken?');
}

// ─── Validator ───────────────────────────────────────────────────────────────

/**
 * Result of `validateCertCode`.
 *
 * - `ok: true` → the input was well-formed AND the check digit matched.
 *   `canonical` is the uppercase-hyphenated form suitable for DB lookup.
 * - `ok: false` → either the format was wrong (`invalid_format`) or the
 *   format was right but the check digit was wrong (`invalid_check`).
 *
 * Callers SHOULD NOT branch their public response on `reason` — the
 * verify endpoint treats both rejection paths identically (returns the
 * `not_found` shape) so the rate-limiter enumeration defense holds.
 * `reason` exists for internal logging and tests.
 */
export type ValidateCertCodeResult =
  | { ok: true; canonical: string }
  | { ok: false; reason: 'invalid_format' | 'invalid_check' };

/**
 * Normalize a user-typed cert code: uppercase, strip non-Crockford
 * separators (whitespace, hyphens), apply Crockford's confusable-letter
 * remap (I/L → 1, O → 0, U → V).
 */
function normalize(input: string): string {
  let s = input.toUpperCase();
  // Strip any non-alphanumeric. Hyphens get re-inserted below.
  s = s.replace(/[^0-9A-Z]/g, '');
  // Apply Crockford confusable remap (I/L → 1, O → 0, U → V). This is
  // user-input normalization only; the algorithm's emitted check digit
  // never lands on I/L/O/U because generateCertCode rejection-samples.
  s = s.replace(/[ILOU]/g, (ch) => INPUT_NORMALIZE_REMAP[ch] ?? ch);
  return s;
}

/**
 * Validate a user-supplied cert code.
 *
 * Pipeline:
 *   1. Normalize (uppercase, strip non-alnum, apply confusable remap).
 *   2. Re-insert canonical hyphens. Expected: `AW-XXXXX-XXXXX-C` (13
 *      alnum chars + 3 hyphens = 16 chars total).
 *   3. Check the regex.
 *   4. Recompute the check digit from the 10 body chars; compare.
 */
export function validateCertCode(input: string): ValidateCertCodeResult {
  if (typeof input !== 'string' || input.length === 0) {
    return { ok: false, reason: 'invalid_format' };
  }
  const stripped = normalize(input);
  // Expect exactly 13 alphanumeric characters: 2 prefix ("AW") + 10 body + 1 check.
  if (stripped.length !== 13 || !stripped.startsWith('AW')) {
    return { ok: false, reason: 'invalid_format' };
  }
  const canonical = `AW-${stripped.slice(2, 7)}-${stripped.slice(7, 12)}-${stripped.slice(12)}`;
  if (!CERT_CODE_REGEX.test(canonical)) {
    return { ok: false, reason: 'invalid_format' };
  }
  const body = stripped.slice(2, 12);
  const expectedCheck = computeCheckChar(body);
  const actualCheck = stripped.slice(12);
  if (expectedCheck !== actualCheck) {
    return { ok: false, reason: 'invalid_check' };
  }
  return { ok: true, canonical };
}
