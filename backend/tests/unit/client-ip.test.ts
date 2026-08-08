/**
 * tests/unit/client-ip.test.ts
 *
 * Wave 4B P0 #10.b — IP hashing helper for the rate-limit key.
 *
 * Per audits/cert-code-redesign-plan.md OQ-2: full IPv6 hash (no /64
 * truncation). Plus B11 alignment — raw IP never leaves this function.
 */

import { describe, it, expect } from 'vitest';
import { NextRequest } from 'next/server';
import { getClientIpHash } from '@/lib/security/client-ip';

const PEPPER = 'unit-test-pepper-do-not-use-in-production';

function makeReq(opts: { xff?: string }): NextRequest {
  const headers = new Headers();
  if (opts.xff) headers.set('x-forwarded-for', opts.xff);
  return new NextRequest('http://localhost/api/x', { headers });
}

describe('getClientIpHash', () => {
  it('produces a deterministic hash for the same IP + pepper', () => {
    const req = makeReq({ xff: '1.2.3.4' });
    const a = getClientIpHash(req, PEPPER);
    const b = getClientIpHash(req, PEPPER);
    expect(a).toBe(b);
  });

  it('produces different hashes for different IPs', () => {
    const a = getClientIpHash(makeReq({ xff: '1.2.3.4' }), PEPPER);
    const b = getClientIpHash(makeReq({ xff: '5.6.7.8' }), PEPPER);
    expect(a).not.toBe(b);
  });

  it('produces different hashes for different peppers (catches missing pepper)', () => {
    const a = getClientIpHash(makeReq({ xff: '1.2.3.4' }), 'pepper-a');
    const b = getClientIpHash(makeReq({ xff: '1.2.3.4' }), 'pepper-b');
    expect(a).not.toBe(b);
  });

  it('takes the left-most entry from a multi-hop x-forwarded-for', () => {
    const a = getClientIpHash(makeReq({ xff: '1.2.3.4, 5.6.7.8, 9.10.11.12' }), PEPPER);
    const b = getClientIpHash(makeReq({ xff: '1.2.3.4' }), PEPPER);
    expect(a).toBe(b);
  });

  it('falls back to a stable "unknown" hash when no header is present', () => {
    const a = getClientIpHash(makeReq({}), PEPPER);
    const b = getClientIpHash(makeReq({}), PEPPER);
    expect(a).toBe(b);
    // Should NOT throw, should NOT be empty.
    expect(a.length).toBeGreaterThan(0);
  });

  it('hashes the FULL IPv6 address (no /64 truncation)', () => {
    // Two addresses in the same /64 prefix should produce DIFFERENT
    // hashes. Per the plan's OQ-2 decision: each device on a household
    // ISP-assigned /64 is rate-limited independently.
    const a = getClientIpHash(makeReq({ xff: '2001:db8:abcd:0012::1' }), PEPPER);
    const b = getClientIpHash(makeReq({ xff: '2001:db8:abcd:0012::2' }), PEPPER);
    expect(a).not.toBe(b);
  });

  it('returns a hex hash truncated to 16 characters (64 bits)', () => {
    const a = getClientIpHash(makeReq({ xff: '1.2.3.4' }), PEPPER);
    expect(a).toMatch(/^[0-9a-f]{16}$/);
  });
});
