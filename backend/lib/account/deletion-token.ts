/**
 * lib/account/deletion-token.ts
 *
 * P1-16 — two-phase deletion token primitives.
 *
 * The raw token is a 32-byte (256-bit) crypto.randomBytes value
 * encoded as base64url (43 chars, URL-safe). It is emailed to the user
 * exactly once at request time. The DB stores `token_hash`
 * (sha256(token).hex). At confirm time the handler hashes the
 * submitted token and looks it up — the raw secret never lives in the
 * DB after issuance.
 *
 * Tokens are:
 *   - single-use: `used_at` flips on first valid confirm.
 *   - time-bounded: `expires_at = issued_at + 24h`.
 *   - per-profile: only valid for the profile that requested it.
 *
 * P1-9 alignment — entropy source is `crypto.randomBytes`. The
 * grep regression test under `tests/unit/secure-random.test.ts`
 * enforces no non-cryptographic PRNG appears under app/ or lib/.
 */

import { randomBytes, createHash } from 'node:crypto';

/** 24-hour TTL in milliseconds. Exported so tests can verify. */
export const TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Generate a 43-character base64url-encoded deletion token.
 *
 * 256 bits of entropy. Far above any feasible brute-force budget over
 * a 24h window even before per-account rate limits kick in.
 */
export function generateDeletionToken(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * Hash a raw token for at-rest storage. Returns a hex SHA-256.
 *
 * Truncation: NONE. Full 64-char hex. Collision risk at 256-bit
 * preimage space is zero in practice; storing the full hash also
 * lets the DB UNIQUE constraint work as the secondary defense.
 */
export function hashDeletionToken(rawToken: string): string {
  return createHash('sha256').update(rawToken).digest('hex');
}

export type ValidationResult =
  | { ok: true }
  | { ok: false; reason: 'expired' | 'used' | 'not_found' | 'mismatch' };

export interface TokenRow {
  profile_id: string;
  expires_at: string;
  used_at: string | null;
}

/**
 * Validate a token row against a candidate profile. Pure function;
 * the DB lookup is the caller's responsibility.
 */
export function validateTokenRow(
  row: TokenRow | null,
  candidateProfileId: string,
  nowMs: number = Date.now()
): ValidationResult {
  if (!row) return { ok: false, reason: 'not_found' };
  if (row.used_at) return { ok: false, reason: 'used' };
  if (Date.parse(row.expires_at) <= nowMs) return { ok: false, reason: 'expired' };
  if (row.profile_id !== candidateProfileId) return { ok: false, reason: 'mismatch' };
  return { ok: true };
}
