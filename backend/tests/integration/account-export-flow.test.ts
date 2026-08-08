/**
 * tests/integration/account-export-flow.test.ts
 *
 * P1-16 — export route returns the documented JSON with attachment
 * headers, runs auth/rate-limit gates, and emits the audit event.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const { mockGetUser, ipLimit, acctLimit, capturedEvents } = vi.hoisted(() => ({
  mockGetUser: vi.fn(),
  ipLimit: vi.fn(),
  acctLimit: vi.fn(),
  capturedEvents: [] as Array<{ row: Record<string, unknown> }>,
}));

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabase: vi.fn(async () => ({ auth: { getUser: mockGetUser } })),
  createServiceSupabase: vi.fn(() => ({
    from: (table: string) => {
      if (table === 'activity_events') {
        return {
          insert: vi.fn((row: Record<string, unknown>) => {
            capturedEvents.push({ row });
            return Promise.resolve({ data: null, error: null });
          }),
          // also covers the buildAccountExport activity_events.select call
          select: () => ({
            eq: () =>
              Promise.resolve({
                data: [{ id: 'e-1', type: 'exam_passed', payload: {}, created_at: 'now' }],
                error: null,
              }),
          }),
        };
      }
      if (table === 'profiles') {
        return {
          select: () => ({
            eq: () => ({
              single: vi.fn().mockResolvedValue({
                data: {
                  id: 'p-1',
                  full_name: 'Jane',
                  email: 'jane@x.test',
                  role: 'manager',
                  invited_at: null,
                  invited_by: null,
                  accepted_at: null,
                },
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === 'certificates') {
        return {
          select: () => ({
            eq: () => Promise.resolve({ data: [{ cert_code: 'AW-1' }], error: null }),
          }),
        };
      }
      if (table === 'exam_attempts') {
        return { select: () => ({ eq: () => Promise.resolve({ data: [], error: null }) }) };
      }
      if (table === 'lesson_progress') {
        return { select: () => ({ eq: () => Promise.resolve({ data: [], error: null }) }) };
      }
      throw new Error(`unexpected table ${table}`);
    },
  })),
}));

vi.mock('@upstash/redis', () => ({
  Redis: class {
    constructor() {}
  },
}));
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
      if (this.prefix.includes(':ip')) return ipLimit(key);
      return acctLimit(key);
    };
  },
}));

beforeEach(async () => {
  vi.clearAllMocks();
  capturedEvents.length = 0;
  mockGetUser.mockResolvedValue({ data: { user: { id: 'p-1' } }, error: null });
  ipLimit.mockResolvedValue({
    success: true,
    remaining: 5,
    reset: Date.now() + 3_600_000,
    limit: 5,
  });
  acctLimit.mockResolvedValue({
    success: true,
    remaining: 1,
    reset: Date.now() + 3_600_000,
    limit: 1,
  });
  process.env.KV_REST_API_URL = 'http://kv';
  process.env.KV_REST_API_TOKEN = 'tok';
  process.env.RATELIMIT_IP_PEPPER = 'pepper';
  const mod = await import('@/lib/security/rate-limit');
  mod._resetForTests();
});

function req(ip = '1.2.3.4'): NextRequest {
  return new NextRequest('http://localhost/api/account/me/export', {
    method: 'GET',
    headers: { 'x-forwarded-for': ip },
  });
}

describe('GET /api/account/me/export', () => {
  it('200 + JSON body + attachment headers + schema block', async () => {
    const { GET } = await import('@/app/api/account/me/export/route');
    const res = await GET(req());
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toMatch(/application\/json/);
    expect(res.headers.get('Content-Disposition') ?? '').toMatch(
      /attachment; filename="allergenwise-data-export-/
    );
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    const body = JSON.parse(await res.text());
    expect(body.schema.version).toBe(1);
    expect(body.schema.fields).toHaveProperty('certificates');
    expect(body.profile.id).toBe('p-1');
    expect(body.certificates).toHaveLength(1);
    // Audit event written.
    expect(capturedEvents.some((e) => e.row.type === 'account_export_requested')).toBe(true);
  });

  it('401 without session', async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: null }, error: null });
    const { GET } = await import('@/app/api/account/me/export/route');
    const res = await GET(req());
    expect(res.status).toBe(401);
  });

  it('429 when per-account limit triggered (1/hr cap)', async () => {
    acctLimit.mockResolvedValueOnce({
      success: false,
      remaining: 0,
      reset: Date.now() + 3_600_000,
      limit: 1,
    });
    const { GET } = await import('@/app/api/account/me/export/route');
    const res = await GET(req());
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('60');
    expect(capturedEvents.some((e) => e.row.type === 'account_export_rate_limited')).toBe(true);
  });

  it('503 when Redis throws (fail-closed)', async () => {
    ipLimit.mockRejectedValueOnce(new Error('redis down'));
    const { GET } = await import('@/app/api/account/me/export/route');
    const res = await GET(req());
    expect(res.status).toBe(503);
    expect(capturedEvents.some((e) => e.row.type === 'account_export_rate_limiter_down')).toBe(
      true
    );
  });
});
