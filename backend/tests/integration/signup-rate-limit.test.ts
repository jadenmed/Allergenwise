/**
 * tests/integration/signup-rate-limit.test.ts
 *
 * P1-14 — verify /api/auth/signup is rate-limited:
 *   - 11th request from one IP returns 429.
 *   - Byte-identical 429 for "email exists" vs "email does not exist"
 *     (enumeration defense — load-bearing for the P1-12 mitigation half).
 *   - Fail-closed: Redis throw → 503 + activity event.
 *   - Format validation runs BEFORE rate limit (malformed → 400, no
 *     limiter charge).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const { ipLimit, emailLimit, capturedEvents, performSignupMock } = vi.hoisted(() => ({
  ipLimit: vi.fn(),
  emailLimit: vi.fn(),
  capturedEvents: [] as Array<{ row: Record<string, unknown> }>,
  performSignupMock: vi.fn(),
}));

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

vi.mock('@/lib/auth/signup', () => ({
  performSignup: performSignupMock,
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
      return emailLimit(key);
    };
  },
}));

function makeReq(body: unknown, ip = '1.2.3.4'): NextRequest {
  return new NextRequest('http://localhost/api/auth/signup', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-forwarded-for': ip,
    },
    body: JSON.stringify(body),
  });
}

const validBody = {
  restaurant: {
    name: 'Acme Bistro',
    address: '123 Main St',
    city: 'Austin',
    state: 'TX',
    zip: '78701',
    phone: '5125550000',
    cuisine: 'New American',
  },
  admin: {
    fullName: 'Acme Owner',
    email: 'owner@acme.test',
    password: 'pw-correct-horse',
  },
  plan: 'quarterly' as const,
};

beforeEach(async () => {
  vi.clearAllMocks();
  capturedEvents.length = 0;
  ipLimit.mockResolvedValue({
    success: true,
    remaining: 10,
    reset: Date.now() + 60_000,
    limit: 10,
  });
  emailLimit.mockResolvedValue({
    success: true,
    remaining: 5,
    reset: Date.now() + 60_000,
    limit: 5,
  });
  performSignupMock.mockResolvedValue({
    ok: true,
    checkoutUrl: 'https://checkout.stripe.com/c/pay/cs_test',
    checkoutSessionId: 'cs_test',
    customerId: 'cus_test',
    restaurantId: 'r-1',
  });
  process.env.KV_REST_API_URL = 'http://kv';
  process.env.KV_REST_API_TOKEN = 'tok';
  process.env.RATELIMIT_IP_PEPPER = 'pepper';
  const mod = await import('@/lib/security/rate-limit');
  mod._resetForTests();
});

describe('signup rate limit — P1-14', () => {
  it('11th request from one IP returns 429 with Retry-After: 60 + Cache-Control: no-store', async () => {
    const { POST } = await import('@/app/api/auth/signup/route');
    let n = 0;
    ipLimit.mockImplementation(async () => {
      n++;
      return n <= 10
        ? { success: true, remaining: 10 - n, reset: Date.now() + 60_000, limit: 10 }
        : { success: false, remaining: 0, reset: Date.now() + 60_000, limit: 10 };
    });

    for (let i = 0; i < 10; i++) {
      const r = await POST(
        makeReq({ ...validBody, admin: { ...validBody.admin, email: `u${i}@x.test` } })
      );
      expect(r.status).toBeLessThan(400);
    }
    const r11 = await POST(
      makeReq({ ...validBody, admin: { ...validBody.admin, email: 'u11@x.test' } })
    );
    expect(r11.status).toBe(429);
    expect(r11.headers.get('Retry-After')).toBe('60');
    expect(r11.headers.get('Cache-Control')).toBe('no-store');
  });

  it('429 body is byte-identical for existing-email vs non-existing-email', async () => {
    const { POST } = await import('@/app/api/auth/signup/route');

    // Path A: rate-limit when performSignup would have returned EMAIL_EXISTS.
    performSignupMock.mockResolvedValueOnce({ ok: false, code: 'EMAIL_EXISTS', error: 'exists' });
    ipLimit.mockResolvedValueOnce({
      success: false,
      remaining: 0,
      reset: Date.now() + 60_000,
      limit: 10,
    });
    const a = await POST(makeReq(validBody));

    // Path B: rate-limit when performSignup would have returned ok.
    performSignupMock.mockResolvedValueOnce({
      ok: true,
      checkoutUrl: 'https://checkout.stripe.com/c/pay/cs_x',
      checkoutSessionId: 'cs_x',
      customerId: 'x',
      restaurantId: 'x',
    });
    ipLimit.mockResolvedValueOnce({
      success: false,
      remaining: 0,
      reset: Date.now() + 60_000,
      limit: 10,
    });
    const b = await POST(
      makeReq({ ...validBody, admin: { ...validBody.admin, email: 'b@x.test' } })
    );

    expect(a.status).toBe(429);
    expect(b.status).toBe(429);
    expect(await a.text()).toBe(await b.text());
    expect(a.headers.get('Retry-After')).toBe(b.headers.get('Retry-After'));
    expect(a.headers.get('Cache-Control')).toBe(b.headers.get('Cache-Control'));
  });

  it('fail-closed: Redis throw returns 503 + writes signup_rate_limiter_down', async () => {
    const { POST } = await import('@/app/api/auth/signup/route');
    ipLimit.mockRejectedValueOnce(new Error('redis down'));

    const r = await POST(makeReq(validBody));
    expect(r.status).toBe(503);
    expect(r.headers.get('Retry-After')).toBe('60');
    const ev = capturedEvents.find((c) => c.row.type === 'signup_rate_limiter_down');
    expect(ev).toBeDefined();
  });

  it('format-validation runs BEFORE rate-limit (malformed → 400, no limiter charge)', async () => {
    const { POST } = await import('@/app/api/auth/signup/route');
    ipLimit.mockClear();
    emailLimit.mockClear();

    const r1 = await POST(makeReq({ admin: { email: 'bad' } })); // missing required fields
    expect(r1.status).toBe(400);
    const r2 = await POST(
      new NextRequest('http://localhost/api/auth/signup', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: 'not-json',
      })
    );
    expect(r2.status).toBe(400);

    expect(ipLimit).not.toHaveBeenCalled();
    expect(emailLimit).not.toHaveBeenCalled();
  });

  it('per-email limiter is keyed on the lowercased email (case-insensitive)', async () => {
    const { POST } = await import('@/app/api/auth/signup/route');
    const seen: string[] = [];
    emailLimit.mockImplementation(async (key: string) => {
      seen.push(key);
      return { success: true, remaining: 5, reset: Date.now() + 60_000, limit: 5 };
    });

    await POST(makeReq({ ...validBody, admin: { ...validBody.admin, email: 'Mixed@Case.TEST' } }));
    expect(seen[0]).toBe('mixed@case.test');
  });

  it('writes signup_rate_limited event on per-IP rejection', async () => {
    const { POST } = await import('@/app/api/auth/signup/route');
    ipLimit.mockResolvedValueOnce({
      success: false,
      remaining: 0,
      reset: Date.now() + 60_000,
      limit: 10,
    });
    await POST(makeReq(validBody));
    const ev = capturedEvents.find((c) => c.row.type === 'signup_rate_limited');
    expect(ev).toBeDefined();
    expect((ev!.row.payload as Record<string, unknown>).kind).toBe('per_ip');
  });
});
