/**
 * tests/unit/app-url.test.ts
 *
 * lib/app-url.ts — the base URL Stripe Checkout sends a PAYING restaurant back
 * to.
 *
 * The regression this guards (T-41a review): the old inline
 * `process.env.APP_URL ?? 'http://localhost:3000'` meant an unset APP_URL in
 * the deployment redirected every paying restaurant to their own machine after
 * the charge succeeded — no error, no log, nothing to page on. Production must
 * therefore THROW rather than fall back, and that is the load-bearing test in
 * this file.
 *
 * `resolveAppUrl` takes the environment as a parameter, so every branch is
 * proven without mutating the real process.env.
 */
import { describe, it, expect } from 'vitest';
import { resolveAppUrl, LOCAL_DEV_APP_URL } from '@/lib/app-url';

describe('resolveAppUrl', () => {
  // ── 1. APP_URL / NEXT_PUBLIC_APP_URL ────────────────────────────────────────

  it('prefers APP_URL', () => {
    expect(resolveAppUrl({ APP_URL: 'https://allergenwise.com' })).toBe('https://allergenwise.com');
  });

  it('falls back to NEXT_PUBLIC_APP_URL — both spellings exist in this repo', () => {
    expect(resolveAppUrl({ NEXT_PUBLIC_APP_URL: 'https://allergenwise.com' })).toBe(
      'https://allergenwise.com'
    );
  });

  it('APP_URL wins over NEXT_PUBLIC_APP_URL when both are set', () => {
    expect(
      resolveAppUrl({
        APP_URL: 'https://server.example.com',
        NEXT_PUBLIC_APP_URL: 'https://client.example.com',
      })
    ).toBe('https://server.example.com');
  });

  it('treats an empty or whitespace-only value as unset', () => {
    expect(resolveAppUrl({ APP_URL: '   ', NEXT_PUBLIC_APP_URL: 'https://allergenwise.com' })).toBe(
      'https://allergenwise.com'
    );
    expect(resolveAppUrl({ APP_URL: '' })).toBe(LOCAL_DEV_APP_URL);
  });

  // ── Trailing slash — the double-slash bug in success_url ────────────────────

  it('strips a trailing slash', () => {
    expect(resolveAppUrl({ APP_URL: 'https://allergenwise.com/' })).toBe(
      'https://allergenwise.com'
    );
  });

  it('strips several trailing slashes', () => {
    expect(resolveAppUrl({ APP_URL: 'https://allergenwise.com///' })).toBe(
      'https://allergenwise.com'
    );
  });

  it('keeps a path prefix, minus its trailing slash', () => {
    expect(resolveAppUrl({ APP_URL: 'https://example.com/app/' })).toBe('https://example.com/app');
  });

  // ── 2. VERCEL_URL ───────────────────────────────────────────────────────────

  it('falls back to https://VERCEL_URL — Vercel injects the host with no scheme', () => {
    expect(resolveAppUrl({ VERCEL_URL: 'allergenwise-abc123.vercel.app' })).toBe(
      'https://allergenwise-abc123.vercel.app'
    );
  });

  it('does not double the scheme if VERCEL_URL already carries one', () => {
    expect(resolveAppUrl({ VERCEL_URL: 'https://allergenwise-abc123.vercel.app' })).toBe(
      'https://allergenwise-abc123.vercel.app'
    );
  });

  it('VERCEL_URL is only a fallback — an explicit base URL wins', () => {
    expect(
      resolveAppUrl({
        APP_URL: 'https://allergenwise.com',
        VERCEL_URL: 'allergenwise-abc123.vercel.app',
      })
    ).toBe('https://allergenwise.com');
  });

  it('still throws in production when VERCEL_URL is set but unusable', () => {
    expect(() => resolveAppUrl({ VERCEL_URL: '   ', NODE_ENV: 'production' })).toThrow(
      /No application base URL is configured/
    );
  });

  // ── 3. Production throws ────────────────────────────────────────────────────

  it('THROWS in production when nothing is set', () => {
    expect(() => resolveAppUrl({ NODE_ENV: 'production' })).toThrow(
      /No application base URL is configured/
    );
  });

  it('the production error names the variables an operator has to set', () => {
    let message = '';
    try {
      resolveAppUrl({ NODE_ENV: 'production' });
    } catch (err) {
      message = err instanceof Error ? err.message : String(err);
    }
    expect(message).toContain('APP_URL');
    expect(message).toContain('NEXT_PUBLIC_APP_URL');
    expect(message).toContain('VERCEL_URL');
    // And says why it refuses to guess.
    expect(message).toContain('success_url');
  });

  it('a malformed base URL in production throws rather than being passed through', () => {
    // Silently shipping "not a url" into success_url would strand the customer
    // just as effectively as localhost does.
    expect(() => resolveAppUrl({ APP_URL: 'not a url', NODE_ENV: 'production' })).toThrow(
      /No application base URL is configured/
    );
  });

  it('rejects a non-http scheme', () => {
    expect(() => resolveAppUrl({ APP_URL: 'javascript:alert(1)', NODE_ENV: 'production' })).toThrow(
      /No application base URL is configured/
    );
  });

  // ── 4. Local dev ────────────────────────────────────────────────────────────

  it('returns localhost outside production when nothing is set', () => {
    expect(resolveAppUrl({})).toBe(LOCAL_DEV_APP_URL);
    expect(resolveAppUrl({ NODE_ENV: 'development' })).toBe(LOCAL_DEV_APP_URL);
    expect(resolveAppUrl({ NODE_ENV: 'test' })).toBe(LOCAL_DEV_APP_URL);
  });

  it('honours an explicit http://localhost base URL', () => {
    expect(resolveAppUrl({ APP_URL: 'http://localhost:4000' })).toBe('http://localhost:4000');
  });
});
