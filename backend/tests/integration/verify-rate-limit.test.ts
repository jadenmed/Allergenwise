/**
 * tests/integration/verify-rate-limit.test.ts
 *
 * Wave 4B P0 #10.b — rate-limiter behavior on the verify endpoint.
 *
 * Per OQ-5: @upstash/ratelimit is mocked directly. The route reads
 * .success and .reset; the mock supplies deterministic values driven by
 * an in-memory counter the test controls.
 *
 * Coverage (per audits/cert-code-redesign-plan.md (g)):
 *   - Per-IP trigger at the 11th request.
 *   - Per-code trigger at the 6th request.
 *   - Byte-identical 429 for existing vs non-existing codes.
 *   - 429 carries Retry-After: 60 + Cache-Control: no-store.
 *   - activity_events row written for every 429 with the right payload.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET } from '@/app/api/certs/[certCode]/verify/route';
import { generateCertCode } from '@/lib/learner/cert-code';
import { _resetForTests as resetRateLimit } from '@/lib/security/rate-limit';

// ─── Mocks ───────────────────────────────────────────────────────────────────

const { mockServiceFrom, ipLimiterLimit, codeLimiterLimit, capturedInserts } = vi.hoisted(() => ({
  mockServiceFrom: vi.fn(),
  ipLimiterLimit: vi.fn(),
  codeLimiterLimit: vi.fn(),
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

let limiterCallIndex = 0;

vi.mock('@upstash/ratelimit', () => ({
  Ratelimit: class {
    static slidingWindow() {
      return {};
    }
    constructor(opts: { prefix?: string }) {
      this.prefix = opts.prefix ?? '';
    }
    prefix: string;
    limit = async (key: string) => {
      limiterCallIndex++;
      // Dispatch to the per-prefix mock so the test can distinguish
      // IP-vs-code rejection mode.
      if (this.prefix.endsWith(':ip')) return ipLimiterLimit(key);
      return codeLimiterLimit(key);
    };
  },
}));

vi.mock('@upstash/redis', () => ({
  Redis: class {
    constructor() {}
  },
}));

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeRequest(certCode: string, opts: { ip?: string } = {}) {
  const headers: Record<string, string> = {};
  if (opts.ip) headers['x-forwarded-for'] = opts.ip;
  return new Request(`http://localhost/api/certs/${certCode}/verify`, { headers });
}

function dbReturnsActive(name = 'Sample Bistro') {
  mockServiceFrom.mockImplementation(() => ({
    select: () => ({
      eq: () => ({
        single: vi.fn().mockResolvedValue({
          data: {
            issued_at: '2026-01-01T00:00:00Z',
            expires_at: '2027-01-01T00:00:00Z',
            status: 'active',
            restaurants: { name },
          },
          error: null,
        }),
      }),
    }),
  }));
}

function dbReturnsNotFound() {
  mockServiceFrom.mockImplementation(() => ({
    select: () => ({
      eq: () => ({
        single: vi.fn().mockResolvedValue({ data: null, error: { code: 'PGRST116' } }),
      }),
    }),
  }));
}

beforeEach(() => {
  vi.clearAllMocks();
  capturedInserts.length = 0;
  limiterCallIndex = 0;
  resetRateLimit();
  process.env.KV_REST_API_URL = 'http://test-kv';
  process.env.KV_REST_API_TOKEN = 'test-kv-token';
  process.env.RATELIMIT_IP_PEPPER = 'test-pepper';

  ipLimiterLimit.mockResolvedValue({
    success: true,
    remaining: 10,
    reset: Date.now() + 60_000,
    limit: 10,
  });
  codeLimiterLimit.mockResolvedValue({
    success: true,
    remaining: 5,
    reset: Date.now() + 60_000,
    limit: 5,
  });
  dbReturnsActive();
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('verify endpoint rate limiter — Wave 4B P0 #10.b', () => {
  it('11th request from one IP returns 429 with Retry-After + no-store + indistinguishable body', async () => {
    let calls = 0;
    ipLimiterLimit.mockImplementation(async () => {
      calls++;
      return calls <= 10
        ? { success: true, remaining: 10 - calls, reset: Date.now() + 60_000, limit: 10 }
        : { success: false, remaining: 0, reset: Date.now() + 60_000, limit: 10 };
    });

    const code = generateCertCode();
    for (let i = 0; i < 10; i++) {
      const res = await GET(makeRequest(code, { ip: '1.2.3.4' }), { params: { certCode: code } });
      expect(res.status).toBe(200);
    }
    const res11 = await GET(makeRequest(code, { ip: '1.2.3.4' }), { params: { certCode: code } });
    expect(res11.status).toBe(429);
    expect(res11.headers.get('Retry-After')).toBe('60');
    expect(res11.headers.get('Cache-Control')).toBe('no-store');
    const body = await res11.json();
    expect(body).toEqual({ valid: false, status: 'rate_limited' });
  });

  it('6th request for one code returns 429 even if from 6 different IPs', async () => {
    let calls = 0;
    codeLimiterLimit.mockImplementation(async () => {
      calls++;
      return calls <= 5
        ? { success: true, remaining: 5 - calls, reset: Date.now() + 60_000, limit: 5 }
        : { success: false, remaining: 0, reset: Date.now() + 60_000, limit: 5 };
    });
    const code = generateCertCode();
    for (let i = 0; i < 5; i++) {
      const res = await GET(makeRequest(code, { ip: `1.1.1.${i}` }), {
        params: { certCode: code },
      });
      expect(res.status).toBe(200);
    }
    const res6 = await GET(makeRequest(code, { ip: '9.9.9.9' }), { params: { certCode: code } });
    expect(res6.status).toBe(429);
  });

  it('429 body is byte-identical for existing-code vs non-existing-code (P0 #10.b enumeration defense)', async () => {
    // First scenario: rate-limit an existing (active) code.
    dbReturnsActive('Foo Bistro');
    ipLimiterLimit.mockResolvedValueOnce({
      success: false,
      remaining: 0,
      reset: Date.now() + 60_000,
      limit: 10,
    });
    const existingCode = generateCertCode();
    const existingRes = await GET(makeRequest(existingCode, { ip: '1.2.3.4' }), {
      params: { certCode: existingCode },
    });

    // Second scenario: rate-limit a non-existing code.
    dbReturnsNotFound();
    ipLimiterLimit.mockResolvedValueOnce({
      success: false,
      remaining: 0,
      reset: Date.now() + 60_000,
      limit: 10,
    });
    const unknownCode = generateCertCode();
    const unknownRes = await GET(makeRequest(unknownCode, { ip: '5.6.7.8' }), {
      params: { certCode: unknownCode },
    });

    expect(existingRes.status).toBe(429);
    expect(unknownRes.status).toBe(429);
    const existingBody = await existingRes.text();
    const unknownBody = await unknownRes.text();
    expect(existingBody).toBe(unknownBody);
    expect(existingRes.headers.get('Retry-After')).toBe(unknownRes.headers.get('Retry-After'));
    expect(existingRes.headers.get('Cache-Control')).toBe(unknownRes.headers.get('Cache-Control'));
  });

  it('writes a cert_verify_rate_limited activity event on per-IP rejection', async () => {
    ipLimiterLimit.mockResolvedValue({
      success: false,
      remaining: 0,
      reset: Date.now() + 60_000,
      limit: 10,
    });
    const code = generateCertCode();
    await GET(makeRequest(code, { ip: '1.2.3.4' }), { params: { certCode: code } });

    const event = capturedInserts.find((c) => c.row.type === 'cert_verify_rate_limited');
    expect(event).toBeDefined();
    const payload = event!.row.payload as Record<string, unknown>;
    expect(payload.kind).toBe('per_ip');
    expect(payload.cert_code).toBe(code);
    expect(payload.ip_hash).toMatch(/^[0-9a-f]{16}$/);
  });

  it('writes a cert_verify_rate_limited activity event on per-code rejection', async () => {
    codeLimiterLimit.mockResolvedValue({
      success: false,
      remaining: 0,
      reset: Date.now() + 60_000,
      limit: 5,
    });
    const code = generateCertCode();
    await GET(makeRequest(code, { ip: '1.2.3.4' }), { params: { certCode: code } });

    const event = capturedInserts.find((c) => c.row.type === 'cert_verify_rate_limited');
    expect(event).toBeDefined();
    const payload = event!.row.payload as Record<string, unknown>;
    expect(payload.kind).toBe('per_code');
    expect(payload.cert_code).toBe(code);
  });

  it('rate-limit guard runs AFTER format validation (malformed input does not hit limiter)', async () => {
    // Send malformed input. Per the ordering decision in Concern 1, this
    // must NEVER reach the rate limiter (so a victim's IP can't be
    // drained by spoofed malformed traffic).
    ipLimiterLimit.mockClear();
    codeLimiterLimit.mockClear();
    await GET(makeRequest('AW-2026-000001', { ip: '1.2.3.4' }), {
      params: { certCode: 'AW-2026-000001' },
    });
    await GET(makeRequest('!!!', { ip: '1.2.3.4' }), { params: { certCode: '!!!' } });
    await GET(makeRequest('xxx', { ip: '1.2.3.4' }), { params: { certCode: 'xxx' } });
    expect(ipLimiterLimit).not.toHaveBeenCalled();
    expect(codeLimiterLimit).not.toHaveBeenCalled();
  });
});
