/**
 * tests/integration/invite-accept-rate-limit.test.ts
 *
 * P1-14 — verify /api/auth/invite/accept is rate-limited:
 *   - 11th request from one IP returns 429.
 *   - Byte-identical 429 across "real token" vs "fake token".
 *   - Per-token-hash limiter is keyed on sha256 (not raw token).
 *   - Fail-closed: Redis throw → 503 + activity event.
 *   - Format validation runs BEFORE rate limit.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { createHash } from 'node:crypto';

const { ipLimit, tokenLimit, capturedEvents, validateInviteMock, acceptInviteMock } = vi.hoisted(
  () => ({
    ipLimit: vi.fn(),
    tokenLimit: vi.fn(),
    capturedEvents: [] as Array<{ row: Record<string, unknown> }>,
    validateInviteMock: vi.fn(),
    acceptInviteMock: vi.fn(),
  })
);

vi.mock('@/lib/supabase/server', () => ({
  createServiceSupabase: vi.fn(() => ({
    from: (table: string) => {
      if (table === 'activity_events') {
        return {
          insert: vi.fn((row: Record<string, unknown>) => {
            capturedEvents.push({ row });
            return Promise.resolve({ data: null, error: null });
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  })),
}));

vi.mock('@/lib/auth/invite', () => ({
  validateInviteToken: validateInviteMock,
  acceptInvite: acceptInviteMock,
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
      if (this.prefix.endsWith(':ip')) return ipLimit(key);
      return tokenLimit(key);
    };
  },
}));

function makeReq(token: string, ip = '1.2.3.4', password = 'pw-correct-horse'): NextRequest {
  return new NextRequest('http://localhost/api/auth/invite/accept', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify({ token, password }),
  });
}

beforeEach(async () => {
  vi.clearAllMocks();
  capturedEvents.length = 0;
  ipLimit.mockResolvedValue({
    success: true,
    remaining: 10,
    reset: Date.now() + 60_000,
    limit: 10,
  });
  tokenLimit.mockResolvedValue({
    success: true,
    remaining: 5,
    reset: Date.now() + 60_000,
    limit: 5,
  });
  validateInviteMock.mockResolvedValue({ valid: true, profile: { id: 'p1', role: 'learner' } });
  acceptInviteMock.mockResolvedValue({ redirectUrl: '/learner' });
  process.env.KV_REST_API_URL = 'http://kv';
  process.env.KV_REST_API_TOKEN = 'tok';
  process.env.RATELIMIT_IP_PEPPER = 'pepper';
  const mod = await import('@/lib/security/rate-limit');
  mod._resetForTests();
});

describe('invite-accept rate limit — P1-14', () => {
  it('11th request from one IP returns 429', async () => {
    const { POST } = await import('@/app/api/auth/invite/accept/route');
    let n = 0;
    ipLimit.mockImplementation(async () => {
      n++;
      return n <= 10
        ? { success: true, remaining: 10 - n, reset: Date.now() + 60_000, limit: 10 }
        : { success: false, remaining: 0, reset: Date.now() + 60_000, limit: 10 };
    });
    for (let i = 0; i < 10; i++) {
      const r = await POST(makeReq(`token-${i}`));
      expect(r.status).toBeLessThan(400);
    }
    const r11 = await POST(makeReq('token-11'));
    expect(r11.status).toBe(429);
    expect(r11.headers.get('Retry-After')).toBe('60');
    expect(r11.headers.get('Cache-Control')).toBe('no-store');
  });

  it('429 body is byte-identical for real vs unknown token', async () => {
    const { POST } = await import('@/app/api/auth/invite/accept/route');

    validateInviteMock.mockResolvedValueOnce({
      valid: true,
      profile: { id: 'p1', role: 'learner' },
    });
    ipLimit.mockResolvedValueOnce({
      success: false,
      remaining: 0,
      reset: Date.now() + 60_000,
      limit: 10,
    });
    const a = await POST(makeReq('real-token'));

    validateInviteMock.mockResolvedValueOnce({ valid: false, reason: 'not_found' });
    ipLimit.mockResolvedValueOnce({
      success: false,
      remaining: 0,
      reset: Date.now() + 60_000,
      limit: 10,
    });
    const b = await POST(makeReq('fake-token'));

    expect(a.status).toBe(429);
    expect(b.status).toBe(429);
    expect(await a.text()).toBe(await b.text());
  });

  it('per-token limiter keyed on sha256, not raw token', async () => {
    const { POST } = await import('@/app/api/auth/invite/accept/route');
    const seen: string[] = [];
    tokenLimit.mockImplementation(async (k: string) => {
      seen.push(k);
      return { success: true, remaining: 5, reset: Date.now() + 60_000, limit: 5 };
    });
    const token = 'plaintext-token-do-not-leak';
    await POST(makeReq(token));
    const expected = createHash('sha256').update(token).digest('hex').slice(0, 32);
    expect(seen[0]).toBe(expected);
    expect(seen[0]).not.toContain('plaintext');
  });

  it('fail-closed: Redis throw returns 503 + writes invite_accept_rate_limiter_down', async () => {
    const { POST } = await import('@/app/api/auth/invite/accept/route');
    ipLimit.mockRejectedValueOnce(new Error('redis down'));
    const r = await POST(makeReq('any'));
    expect(r.status).toBe(503);
    const ev = capturedEvents.find((c) => c.row.type === 'invite_accept_rate_limiter_down');
    expect(ev).toBeDefined();
  });

  it('format-validation runs BEFORE rate-limit (malformed → 400, no limiter charge)', async () => {
    const { POST } = await import('@/app/api/auth/invite/accept/route');
    ipLimit.mockClear();
    tokenLimit.mockClear();
    const r = await POST(
      new NextRequest('http://localhost/api/auth/invite/accept', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password: 'short' }), // missing token, password too short
      })
    );
    expect(r.status).toBe(400);
    expect(ipLimit).not.toHaveBeenCalled();
    expect(tokenLimit).not.toHaveBeenCalled();
  });
});
