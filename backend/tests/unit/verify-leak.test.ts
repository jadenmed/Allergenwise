/**
 * tests/unit/verify-leak.test.ts
 *
 * Verifies that the public verify endpoint response contains ONLY the allowed
 * fields per the domain non-negotiable in CLAUDE.md:
 *
 *   "Public verification endpoint leaks nothing beyond Active/Expired/Revoked
 *    + restaurant name + issue date"
 *
 * Allowed response keys:
 *   valid         boolean — always present
 *   status        'active' | 'expired' | 'revoked' | 'not_found' — always present
 *   restaurantName string  — present when cert found
 *   issuedAt      string  — present when cert found
 *   expiresAt     string  — present when cert found
 *
 * Forbidden fields (must NOT appear in any response):
 *   - recipientName / full_name (PII: individual's name)
 *   - email / author_email
 *   - id / cert_code / profile_id / restaurant_id (internal UUIDs)
 *   - score_percent / exam scores
 *   - address / city / state / zip / lat / lng / phone / website
 *   - revoked (internal boolean — surface as "status=revoked" instead)
 *   - pdf_storage_path / fee_charged_cents / stripe_payment_intent_id
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import type { VerifyResponse } from '@/app/api/certs/[certCode]/verify/route';
import { generateCertCode } from '@/lib/learner/cert-code';
import { _resetForTests as resetRateLimit } from '@/lib/security/rate-limit';

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('@/lib/supabase/server', () => ({
  createServiceSupabase: vi.fn(),
}));

// Mock Upstash so the route's rate-limit guard always passes; the leak
// invariants we're asserting live below that layer.
vi.mock('@upstash/ratelimit', () => ({
  Ratelimit: class {
    static slidingWindow() {
      return {};
    }
    limit = vi.fn().mockResolvedValue({
      success: true,
      remaining: 100,
      reset: Date.now() + 60_000,
      limit: 100,
    });
  },
}));
vi.mock('@upstash/redis', () => ({
  Redis: class {
    constructor() {}
  },
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeRequest(certCode: string): NextRequest {
  return new NextRequest(`http://localhost/api/certs/${certCode}/verify`, {
    method: 'GET',
  });
}

const ALLOWED_KEYS: (keyof VerifyResponse)[] = [
  'valid',
  'status',
  'restaurantName',
  'issuedAt',
  'expiresAt',
];

const FORBIDDEN_FIELDS = [
  'recipientName',
  'full_name',
  'email',
  'author_email',
  'id',
  'cert_code',
  'profile_id',
  'restaurant_id',
  'score_percent',
  'exam_score',
  'address',
  'city',
  'state',
  'zip',
  'lat',
  'lng',
  'phone',
  'website',
  'revoked',
  'pdf_storage_path',
  'fee_charged_cents',
  'stripe_payment_intent_id',
  'updated_at',
  'created_at',
];

/** Asserts the response contains no forbidden fields. */
function assertNoLeaks(body: Record<string, unknown>): void {
  for (const field of FORBIDDEN_FIELDS) {
    expect(
      Object.prototype.hasOwnProperty.call(body, field),
      `Response must not contain "${field}" — it leaks PII or internal data`
    ).toBe(false);
  }
}

/** Asserts that all keys in the response are in the allowed set. */
function assertOnlyAllowedKeys(body: Record<string, unknown>): void {
  const actualKeys = Object.keys(body);
  for (const key of actualKeys) {
    expect(
      ALLOWED_KEYS.includes(key as keyof VerifyResponse),
      `Response contains unexpected key "${key}" — only [${ALLOWED_KEYS.join(', ')}] are allowed`
    ).toBe(true);
  }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('verify endpoint — leak prevention', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetRateLimit();
    process.env.KV_REST_API_URL = 'http://test-kv';
    process.env.KV_REST_API_TOKEN = 'test-kv-token';
    process.env.RATELIMIT_IP_PEPPER = 'test-pepper';
  });

  it('not_found response contains ONLY { valid, status }', async () => {
    const { createServiceSupabase } = await import('@/lib/supabase/server');
    vi.mocked(createServiceSupabase).mockReturnValue({
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: null, error: { message: 'not found' } }),
          }),
        }),
      }),
    } as unknown as ReturnType<typeof createServiceSupabase>);

    const { GET } = await import('@/app/api/certs/[certCode]/verify/route');
    const res = await GET(makeRequest('AW-2026-000001'), {
      params: { certCode: 'AW-2026-000001' },
    });
    const body = (await res.json()) as Record<string, unknown>;

    expect(body.valid).toBe(false);
    expect(body.status).toBe('not_found');
    assertNoLeaks(body);
    assertOnlyAllowedKeys(body);
  });

  it('active response contains ONLY { valid, status, restaurantName, issuedAt, expiresAt }', async () => {
    const { createServiceSupabase } = await import('@/lib/supabase/server');
    const futureDate = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();
    vi.mocked(createServiceSupabase).mockReturnValue({
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: {
                // These are the only fields the query selects (no profile_id join, no PII)
                issued_at: '2026-01-01T00:00:00Z',
                expires_at: futureDate,
                status: 'active',
                restaurants: { name: 'The Green Fork' },
                // MUST NOT include: full_name, email, address, lat, lng, etc.
              },
              error: null,
            }),
          }),
        }),
      }),
    } as unknown as ReturnType<typeof createServiceSupabase>);

    const { GET } = await import('@/app/api/certs/[certCode]/verify/route');
    const validCode = generateCertCode();
    const res = await GET(makeRequest(validCode), {
      params: { certCode: validCode },
    });
    const body = (await res.json()) as Record<string, unknown>;

    expect(body.valid).toBe(true);
    expect(body.status).toBe('active');
    expect(body.restaurantName).toBe('The Green Fork');
    expect(body.issuedAt).toBe('2026-01-01T00:00:00Z');
    expect(body.expiresAt).toBe(futureDate);
    assertNoLeaks(body);
    assertOnlyAllowedKeys(body);
  });

  it('expired response contains ONLY { valid, status, restaurantName, issuedAt, expiresAt }', async () => {
    const { createServiceSupabase } = await import('@/lib/supabase/server');
    vi.mocked(createServiceSupabase).mockReturnValue({
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: {
                issued_at: '2025-01-01T00:00:00Z',
                expires_at: '2026-01-01T00:00:00Z', // past
                status: 'expired',
                restaurants: { name: 'The Green Fork' },
              },
              error: null,
            }),
          }),
        }),
      }),
    } as unknown as ReturnType<typeof createServiceSupabase>);

    const { GET } = await import('@/app/api/certs/[certCode]/verify/route');
    const validCode = generateCertCode();
    const res = await GET(makeRequest(validCode), {
      params: { certCode: validCode },
    });
    const body = (await res.json()) as Record<string, unknown>;

    expect(body.valid).toBe(false);
    expect(body.status).toBe('expired');
    expect(body.restaurantName).toBe('The Green Fork');
    assertNoLeaks(body);
    assertOnlyAllowedKeys(body);
  });

  it('revoked response contains ONLY { valid, status, restaurantName, issuedAt, expiresAt }', async () => {
    const { createServiceSupabase } = await import('@/lib/supabase/server');
    const futureDate = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();
    vi.mocked(createServiceSupabase).mockReturnValue({
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: {
                issued_at: '2026-01-01T00:00:00Z',
                expires_at: futureDate,
                status: 'revoked',
                restaurants: { name: 'Bad Kitchen' },
              },
              error: null,
            }),
          }),
        }),
      }),
    } as unknown as ReturnType<typeof createServiceSupabase>);

    const { GET } = await import('@/app/api/certs/[certCode]/verify/route');
    const validCode = generateCertCode();
    const res = await GET(makeRequest(validCode), {
      params: { certCode: validCode },
    });
    const body = (await res.json()) as Record<string, unknown>;

    expect(body.valid).toBe(false);
    expect(body.status).toBe('revoked');
    // 'revoked' boolean must NOT be in response — it's surfaced as status='revoked' instead
    assertNoLeaks(body);
    assertOnlyAllowedKeys(body);
  });

  it('invalid cert code format returns not_found without leaking internal error', async () => {
    const { GET } = await import('@/app/api/certs/[certCode]/verify/route');
    const res = await GET(makeRequest('../../etc/passwd'), {
      params: { certCode: '../../etc/passwd' },
    });
    const body = (await res.json()) as Record<string, unknown>;

    expect(body.valid).toBe(false);
    expect(body.status).toBe('not_found');
    assertNoLeaks(body);
    assertOnlyAllowedKeys(body);
  });
});
