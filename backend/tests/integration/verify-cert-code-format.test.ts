/**
 * tests/integration/verify-cert-code-format.test.ts
 *
 * Wave 4B P0 #10.a — verify endpoint format validation.
 *
 * Asserts that the route's response is identical across three rejection
 * paths (malformed input, valid format but unknown code, valid format
 * with wrong check digit) — the enumeration defense against discriminating
 * the rejection reason from the public response.
 *
 * Per Concern 1 in the review: format-validation runs FIRST (cheap),
 * then rate-limit, then DB. The byte-equality assertion below is the
 * load-bearing test that proves the ordering is safe (the byte stream
 * does not leak which path failed).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET } from '@/app/api/certs/[certCode]/verify/route';
import { generateCertCode } from '@/lib/learner/cert-code';
import { _resetForTests as resetRateLimit } from '@/lib/security/rate-limit';

// ─── Mocks ───────────────────────────────────────────────────────────────────

const { mockServiceFrom, mockLimiterLimit } = vi.hoisted(() => ({
  mockServiceFrom: vi.fn(),
  mockLimiterLimit: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createServiceSupabase: vi.fn(() => ({ from: mockServiceFrom })),
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

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeRequest(certCode: string) {
  return new Request(`http://localhost/api/certs/${certCode}/verify`);
}

async function readJson(res: Response): Promise<unknown> {
  return res.json();
}

beforeEach(() => {
  vi.clearAllMocks();
  resetRateLimit();
  process.env.KV_REST_API_URL = 'http://test-kv';
  process.env.KV_REST_API_TOKEN = 'test-kv-token';
  process.env.RATELIMIT_IP_PEPPER = 'test-pepper';

  // Default: both limiters allow.
  mockLimiterLimit.mockResolvedValue({
    success: true,
    remaining: 10,
    reset: Date.now() + 60_000,
    limit: 10,
  });
  // Default DB: returns not-found for every lookup.
  mockServiceFrom.mockImplementation(() => ({
    select: () => ({
      eq: () => ({
        single: vi.fn().mockResolvedValue({ data: null, error: { code: 'PGRST116' } }),
      }),
    }),
  }));
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('verify endpoint — format validation (Wave 4B P0 #10.a)', () => {
  it('returns 200 + valid response shape for a known-active cert', async () => {
    const code = generateCertCode();
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

    const res = await GET(makeRequest(code), { params: { certCode: code } });
    expect(res.status).toBe(200);
    const body = (await readJson(res)) as Record<string, unknown>;
    expect(body.valid).toBe(true);
    expect(body.status).toBe('active');
    expect(body.restaurantName).toBe('Sample Bistro');
  });

  it('old format AW-2026-000001 → not_found', async () => {
    const res = await GET(makeRequest('AW-2026-000001'), {
      params: { certCode: 'AW-2026-000001' },
    });
    expect(res.status).toBe(200);
    const body = (await readJson(res)) as Record<string, unknown>;
    expect(body).toEqual({ valid: false, status: 'not_found' });
  });

  it('malformed gibberish → not_found', async () => {
    const res = await GET(makeRequest('!!!'), { params: { certCode: '!!!' } });
    expect(res.status).toBe(200);
    const body = (await readJson(res)) as Record<string, unknown>;
    expect(body).toEqual({ valid: false, status: 'not_found' });
  });

  it('valid format with WRONG check digit → not_found', async () => {
    const code = generateCertCode();
    const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
    const last = code[code.length - 1];
    const next = alphabet[(alphabet.indexOf(last) + 1) % alphabet.length];
    const corrupted = code.slice(0, -1) + next;
    const res = await GET(makeRequest(corrupted), { params: { certCode: corrupted } });
    expect(res.status).toBe(200);
    const body = (await readJson(res)) as Record<string, unknown>;
    expect(body).toEqual({ valid: false, status: 'not_found' });
  });

  it('byte-identical response for malformed-format vs unknown-but-valid-format codes (P0 #10 enumeration defense)', async () => {
    // Both paths must emit identical bytes — the public response cannot
    // leak which rejection happened.
    const malformedRes = await GET(makeRequest('AW-2026-000001'), {
      params: { certCode: 'AW-2026-000001' },
    });
    const validButUnknown = generateCertCode();
    const unknownRes = await GET(makeRequest(validButUnknown), {
      params: { certCode: validButUnknown },
    });

    const malformedBody = await malformedRes.text();
    const unknownBody = await unknownRes.text();

    expect(malformedRes.status).toBe(unknownRes.status);
    expect(malformedBody).toBe(unknownBody);
    expect(malformedRes.headers.get('content-type')).toBe(unknownRes.headers.get('content-type'));
  });

  it('byte-identical response for wrong-check-digit vs unknown-code (defense extension)', async () => {
    const codeA = generateCertCode();
    const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
    const lastA = codeA[codeA.length - 1];
    const nextA = alphabet[(alphabet.indexOf(lastA) + 1) % alphabet.length];
    const wrongCheck = codeA.slice(0, -1) + nextA;
    const wrongCheckRes = await GET(makeRequest(wrongCheck), { params: { certCode: wrongCheck } });

    const codeB = generateCertCode();
    const unknownRes = await GET(makeRequest(codeB), { params: { certCode: codeB } });

    const wrongCheckBody = await wrongCheckRes.text();
    const unknownBody = await unknownRes.text();
    expect(wrongCheckBody).toBe(unknownBody);
  });

  it('malformed input never burns the per-IP rate-limit window (ordering proof)', async () => {
    // The rate-limit mock counts calls. If format-validation runs BEFORE
    // the limiter (as the plan requires), malformed input should never
    // reach the limiter.
    mockLimiterLimit.mockClear();
    for (let i = 0; i < 100; i++) {
      await GET(makeRequest('not-a-real-code'), { params: { certCode: 'not-a-real-code' } });
    }
    expect(mockLimiterLimit).not.toHaveBeenCalled();
  });
});
