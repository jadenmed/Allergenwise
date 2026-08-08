/**
 * tests/integration/signup-email-enumeration.test.ts
 *
 * P1-12 response-shape half — registered vs unregistered emails must
 * return byte-identical failure bodies and headers from
 * /api/auth/signup, so an attacker cannot distinguish the cases via
 * the discriminator (`code: 'EMAIL_EXISTS'` vs `code: 'AUTH_ERROR'`)
 * or via differing HTTP status.
 *
 * Ops-side distinguishability is preserved via an activity_events row
 * (`signup_email_exists` vs `signup_auth_error`), which is asserted
 * here too so the ops signal is not silently dropped along with the
 * client-facing discriminator.
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

function makeReq(body: unknown, ip = '9.9.9.9'): NextRequest {
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
  process.env.KV_REST_API_URL = 'http://kv';
  process.env.KV_REST_API_TOKEN = 'tok';
  process.env.RATELIMIT_IP_PEPPER = 'pepper';
  const mod = await import('@/lib/security/rate-limit');
  mod._resetForTests();
});

describe('signup email enumeration — P1-12 response-shape', () => {
  it('returns byte-identical body + status + headers for EMAIL_EXISTS vs AUTH_ERROR', async () => {
    const { POST } = await import('@/app/api/auth/signup/route');

    // Path A: email already registered.
    performSignupMock.mockResolvedValueOnce({
      ok: false,
      code: 'EMAIL_EXISTS',
      error: 'An account with this email already exists.',
    });
    const a = await POST(
      makeReq({
        ...validBody,
        admin: { ...validBody.admin, email: 'existing@acme.test' },
      })
    );

    // Path B: generic auth failure (e.g., weak password rejected by Supabase Auth).
    performSignupMock.mockResolvedValueOnce({
      ok: false,
      code: 'AUTH_ERROR',
      error: 'Password should be at least 6 characters.',
    });
    const b = await POST(
      makeReq({
        ...validBody,
        admin: { ...validBody.admin, email: 'fresh@acme.test' },
      })
    );

    expect(a.status).toBe(b.status);

    const aText = await a.text();
    const bText = await b.text();
    expect(aText).toBe(bText);

    // No `code` discriminator leaking through to the client.
    const aJson = JSON.parse(aText);
    expect(aJson).not.toHaveProperty('code');
    expect(aJson.error).toBeTruthy();

    // Header surface must also match — Content-Type, Cache-Control, etc.
    expect(a.headers.get('content-type')).toBe(b.headers.get('content-type'));
    expect(a.headers.get('cache-control')).toBe(b.headers.get('cache-control'));
  });

  it('preserves ops distinguishability via activity_events for EMAIL_EXISTS', async () => {
    const { POST } = await import('@/app/api/auth/signup/route');

    performSignupMock.mockResolvedValueOnce({
      ok: false,
      code: 'EMAIL_EXISTS',
      error: 'An account with this email already exists.',
    });
    await POST(
      makeReq({
        ...validBody,
        admin: { ...validBody.admin, email: 'existing@acme.test' },
      })
    );

    const ev = capturedEvents.find((c) => c.row.type === 'signup_email_exists');
    expect(ev).toBeDefined();
    const payload = ev!.row.payload as Record<string, unknown>;
    // ip_hash is fine; raw email is a P1-8 leak and must not be logged.
    expect(payload.ip_hash).toBeTruthy();
    expect(JSON.stringify(payload)).not.toContain('existing@acme.test');
  });

  it('preserves ops distinguishability via activity_events for AUTH_ERROR', async () => {
    const { POST } = await import('@/app/api/auth/signup/route');

    performSignupMock.mockResolvedValueOnce({
      ok: false,
      code: 'AUTH_ERROR',
      error: 'Password should be at least 6 characters.',
    });
    await POST(
      makeReq({
        ...validBody,
        admin: { ...validBody.admin, email: 'fresh@acme.test' },
      })
    );

    const ev = capturedEvents.find((c) => c.row.type === 'signup_auth_error');
    expect(ev).toBeDefined();
    const payload = ev!.row.payload as Record<string, unknown>;
    expect(payload.ip_hash).toBeTruthy();
    expect(JSON.stringify(payload)).not.toContain('fresh@acme.test');
  });
});
