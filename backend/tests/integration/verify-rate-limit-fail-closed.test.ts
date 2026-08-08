/**
 * tests/integration/verify-rate-limit-fail-closed.test.ts
 *
 * Wave 4B P0 #10.b — fail-closed behavior on Redis unreachable.
 *
 * Per audits/cert-code-redesign-plan.md (d): if @upstash/ratelimit
 * throws (Redis unreachable, network blip, etc.), the verify endpoint
 * returns 503 — NOT a free pass. This test exercises that contract by
 * configuring the mocked .limit() to throw.
 *
 * Also asserts the cert_verify_rate_limiter_down activity event is
 * written so ops monitoring can see the outage.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET } from '@/app/api/certs/[certCode]/verify/route';
import { generateCertCode } from '@/lib/learner/cert-code';
import { _resetForTests as resetRateLimit } from '@/lib/security/rate-limit';

const { mockServiceFrom, mockLimiterLimit, capturedInserts } = vi.hoisted(() => ({
  mockServiceFrom: vi.fn(),
  mockLimiterLimit: vi.fn(),
  capturedInserts: [] as Array<{ table: string; row: Record<string, unknown> }>,
}));

vi.mock('@/lib/supabase/server', () => ({
  createServiceSupabase: vi.fn(() => ({
    from: (table: string) => {
      if (table === 'activity_events') {
        return {
          insert: vi.fn((row: Record<string, unknown>) => {
            capturedInserts.push({ table, row });
            return Promise.resolve({ data: null, error: null });
          }),
        };
      }
      return mockServiceFrom(table);
    },
  })),
}));

vi.mock('@upstash/ratelimit', () => ({
  Ratelimit: class {
    static slidingWindow() {
      return {};
    }
    limit = mockLimiterLimit;
  },
}));

vi.mock('@upstash/redis', () => ({
  Redis: class {
    constructor() {}
  },
}));

function makeRequest(certCode: string, ip = '1.2.3.4') {
  return new Request(`http://localhost/api/certs/${certCode}/verify`, {
    headers: { 'x-forwarded-for': ip },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  capturedInserts.length = 0;
  resetRateLimit();
  process.env.KV_REST_API_URL = 'http://test-kv';
  process.env.KV_REST_API_TOKEN = 'test-kv-token';
  process.env.RATELIMIT_IP_PEPPER = 'test-pepper';
  // Default DB stub: any cert lookup returns active.
  mockServiceFrom.mockImplementation(() => ({
    select: () => ({
      eq: () => ({
        single: vi.fn().mockResolvedValue({
          data: {
            issued_at: '2026-01-01T00:00:00Z',
            expires_at: '2027-01-01T00:00:00Z',
            status: 'active',
            restaurants: { name: 'Sample Bistro' },
          },
          error: null,
        }),
      }),
    }),
  }));
});

describe('verify endpoint fail-closed on Redis throw — Wave 4B', () => {
  it('returns 503 + Retry-After when .limit() throws', async () => {
    mockLimiterLimit.mockRejectedValue(new Error('connect ECONNREFUSED'));
    const code = generateCertCode();
    const res = await GET(makeRequest(code), { params: { certCode: code } });
    expect(res.status).toBe(503);
    expect(res.headers.get('Retry-After')).toBe('60');
  });

  it('writes cert_verify_rate_limiter_down activity event', async () => {
    mockLimiterLimit.mockRejectedValue(new Error('connect ECONNREFUSED'));
    const code = generateCertCode();
    await GET(makeRequest(code), { params: { certCode: code } });

    const event = capturedInserts.find((c) => c.row.type === 'cert_verify_rate_limiter_down');
    expect(event).toBeDefined();
    const payload = event!.row.payload as Record<string, unknown>;
    expect(payload.error).toMatch(/ECONNREFUSED/);
  });

  it('503 response is identical for existing vs non-existing codes', async () => {
    // Redis is dead — neither path knows whether the cert exists.
    mockLimiterLimit.mockRejectedValue(new Error('connect ECONNREFUSED'));
    const codeA = generateCertCode();
    const codeB = generateCertCode();
    // Even if the DB would have differed, the limiter throws first.
    const resA = await GET(makeRequest(codeA, '1.1.1.1'), { params: { certCode: codeA } });
    const resB = await GET(makeRequest(codeB, '2.2.2.2'), { params: { certCode: codeB } });
    expect(resA.status).toBe(503);
    expect(resB.status).toBe(503);
    const bodyA = await resA.text();
    const bodyB = await resB.text();
    expect(bodyA).toBe(bodyB);
    expect(resA.headers.get('Retry-After')).toBe(resB.headers.get('Retry-After'));
  });
});
