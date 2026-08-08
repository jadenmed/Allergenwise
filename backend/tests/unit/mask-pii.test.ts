/**
 * tests/unit/mask-pii.test.ts
 *
 * P1-8 — behavior tests for the PII-masking helpers used in webhook
 * + email-send log lines. The regression-grep counterpart lives at
 * tests/unit/log-pii-grep.test.ts.
 */
import { describe, it, expect } from 'vitest';
import { maskEmail, maskName, emailHash } from '@/lib/security/mask-pii';

describe('maskEmail', () => {
  it('matches the inline pattern previously used at the deletion send-site', () => {
    // Sanity: the new helper produces the same shape as the old inline form
    // `email.replace(/(.{2}).+(@.+)/, '$1***$2')` for the common case.
    const inline = (e: string) => e.replace(/(.{2}).+(@.+)/, '$1***$2');
    expect(maskEmail('alice.smith@example.com')).toBe(inline('alice.smith@example.com'));
    expect(maskEmail('jane.doe@allergenwise.io')).toBe(inline('jane.doe@allergenwise.io'));
  });

  it('redacts the local part beyond the first 2 chars', () => {
    expect(maskEmail('alice.smith@example.com')).toBe('al***@example.com');
    expect(maskEmail('hello@world.co')).toBe('he***@world.co');
  });

  it('preserves the domain verbatim', () => {
    expect(maskEmail('abcdef@sub.example.co.uk')).toBe('ab***@sub.example.co.uk');
  });

  it('handles a 2-char local part (too short for a 2-char prefix)', () => {
    expect(maskEmail('a@x.io')).toBe('***@x.io');
    expect(maskEmail('ab@x.io')).toBe('***@x.io');
  });

  it('returns "***" on missing @ (not an email)', () => {
    expect(maskEmail('not-an-email')).toBe('***');
  });

  it('returns "<no-email>" on null / undefined / empty', () => {
    expect(maskEmail(null)).toBe('<no-email>');
    expect(maskEmail(undefined)).toBe('<no-email>');
    expect(maskEmail('')).toBe('<no-email>');
  });

  it('never leaks the original local part of a normal email', () => {
    const samples = [
      'alice.smith@example.com',
      'bob+filter@allergenwise.io',
      'CarolUpper@Domain.IO',
      'd.e.f.g@longer-domain.example.co.uk',
    ];
    for (const e of samples) {
      const masked = maskEmail(e);
      const local = e.split('@')[0];
      // The full local part must not survive verbatim.
      expect(masked.includes(local)).toBe(false);
      // Domain must survive intact.
      expect(masked.endsWith(`@${e.split('@')[1]}`)).toBe(true);
      // No literal '@' followed by missing domain.
      expect(masked).toMatch(/@.+/);
    }
  });
});

describe('maskName', () => {
  it('redacts each token beyond the first letter', () => {
    expect(maskName('Jane Doe')).toBe('J*** D***');
    expect(maskName('Alice Bob Carol')).toBe('A*** B*** C***');
  });

  it('handles single-token names', () => {
    expect(maskName('Madonna')).toBe('M***');
  });

  it('leaves single-character tokens alone', () => {
    expect(maskName('A B')).toBe('A B');
  });

  it('trims and collapses whitespace', () => {
    expect(maskName('  jane   doe  ')).toBe('j*** d***');
  });

  it('returns "<no-name>" on null / undefined / empty / whitespace-only', () => {
    expect(maskName(null)).toBe('<no-name>');
    expect(maskName(undefined)).toBe('<no-name>');
    expect(maskName('')).toBe('<no-name>');
    expect(maskName('   ')).toBe('<no-name>');
  });

  it('never leaks the full original name', () => {
    const samples = ['Jane Doe', 'Alice Bob Carol', 'Bartholomew', 'Mary-Anne O’Brien'];
    for (const n of samples) {
      const masked = maskName(n);
      // Full original cannot survive verbatim (unless every token was already a
      // single char — none of the samples qualify).
      expect(masked).not.toBe(n);
      expect(masked.includes(n.trim())).toBe(false);
    }
  });
});

describe('emailHash', () => {
  it('is deterministic for the same input', () => {
    expect(emailHash('alice@example.com')).toBe(emailHash('alice@example.com'));
  });

  it('is case-insensitive (lowercased before hashing)', () => {
    expect(emailHash('Alice@Example.COM')).toBe(emailHash('alice@example.com'));
  });

  it('returns 16 hex chars', () => {
    const h = emailHash('alice@example.com');
    expect(h).toMatch(/^[0-9a-f]{16}$/);
  });

  it('returns different hashes for different emails', () => {
    expect(emailHash('alice@example.com')).not.toBe(emailHash('bob@example.com'));
  });

  it('returns "" on null / undefined / empty', () => {
    expect(emailHash(null)).toBe('');
    expect(emailHash(undefined)).toBe('');
    expect(emailHash('')).toBe('');
  });

  it('never contains the raw email substring', () => {
    const e = 'alice.smith@example.com';
    const h = emailHash(e);
    expect(h.includes('alice')).toBe(false);
    expect(h.includes('example')).toBe(false);
  });
});
