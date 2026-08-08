/**
 * tests/unit/account-deletion-token.test.ts
 *
 * P1-16 — token generator + hasher + validator.
 */

import { describe, it, expect } from 'vitest';
import {
  generateDeletionToken,
  hashDeletionToken,
  validateTokenRow,
  TOKEN_TTL_MS,
} from '@/lib/account/deletion-token';
import { createHash } from 'node:crypto';

describe('generateDeletionToken', () => {
  it('produces a 43-character base64url string', () => {
    for (let i = 0; i < 50; i++) {
      const t = generateDeletionToken();
      expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/);
    }
  });

  it('10,000 tokens are unique (basic entropy smoke)', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 10_000; i++) seen.add(generateDeletionToken());
    expect(seen.size).toBe(10_000);
  });
});

describe('hashDeletionToken', () => {
  it('produces a 64-char hex string matching node sha256', () => {
    const raw = 'plaintext-token';
    expect(hashDeletionToken(raw)).toBe(createHash('sha256').update(raw).digest('hex'));
  });

  it('is deterministic across calls', () => {
    const raw = generateDeletionToken();
    expect(hashDeletionToken(raw)).toBe(hashDeletionToken(raw));
  });
});

describe('validateTokenRow', () => {
  const PROFILE = '11111111-1111-1111-1111-111111111111';
  const future = (ms: number) => new Date(Date.now() + ms).toISOString();

  it('returns ok for a fresh, unused, matching token', () => {
    const row = { profile_id: PROFILE, expires_at: future(60_000), used_at: null };
    expect(validateTokenRow(row, PROFILE)).toEqual({ ok: true });
  });

  it('returns not_found for null row', () => {
    expect(validateTokenRow(null, PROFILE)).toEqual({ ok: false, reason: 'not_found' });
  });

  it('returns used when used_at is set', () => {
    const row = {
      profile_id: PROFILE,
      expires_at: future(60_000),
      used_at: new Date().toISOString(),
    };
    expect(validateTokenRow(row, PROFILE)).toEqual({ ok: false, reason: 'used' });
  });

  it('returns expired past expires_at', () => {
    const row = { profile_id: PROFILE, expires_at: future(-1000), used_at: null };
    expect(validateTokenRow(row, PROFILE)).toEqual({ ok: false, reason: 'expired' });
  });

  it('returns mismatch when profile_id does not match the caller', () => {
    const row = { profile_id: PROFILE, expires_at: future(60_000), used_at: null };
    expect(validateTokenRow(row, '22222222-2222-2222-2222-222222222222')).toEqual({
      ok: false,
      reason: 'mismatch',
    });
  });

  it('TTL constant is 24 hours', () => {
    expect(TOKEN_TTL_MS).toBe(24 * 60 * 60 * 1000);
  });
});
