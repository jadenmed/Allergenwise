/**
 * tests/integration/invite-send-rate-limit.test.ts
 *
 * P1-14 — verify /api/invites/send is rate-limited:
 *   - Per-IP guard fires before the auth/role lookup.
 *   - Per-restaurant guard fires after the role lookup (because it
 *     needs the resolved restaurant_id).
 *   - Byte-identical 429 across kinds.
 *   - Fail-closed: Redis throw → 503 + activity event.
 *   - Format validation runs first.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const { ipLimit, restLimit, capturedEvents, mockGetUser, mockServiceFrom } = vi.hoisted(() => ({
  ipLimit: vi.fn(),
  restLimit: vi.fn(),
  capturedEvents: [] as Array<{ row: Record<string, unknown> }>,
  mockGetUser: vi.fn(),
  mockServiceFrom: vi.fn(),
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
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  })),
}));

vi.mock('@/lib/db/service', () => ({
  createServiceDb: vi.fn(() => ({ from: mockServiceFrom })),
}));

vi.mock('@/lib/email/client', () => ({
  resend: { emails: { send: vi.fn().mockResolvedValue({ id: 'mock-email' }) } },
  FROM_EMAIL: 'hello@allergenwise.com',
}));

vi.mock('@/lib/auth/invite', () => ({
  generateInviteToken: vi.fn(() => 'tok-x'),
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
      return restLimit(key);
    };
  },
}));

const ADMIN_ID = '11111111-1111-1111-1111-111111111111';
const RESTAURANT_ID = '22222222-2222-2222-2222-222222222222';

function buildHappyDispatcher() {
  mockServiceFrom.mockImplementation((table: string) => {
    if (table === 'profiles') {
      return {
        select: () => ({
          eq: () => ({
            single: vi.fn().mockResolvedValue({
              data: {
                id: ADMIN_ID,
                role: 'manager',
                restaurant_id: RESTAURANT_ID,
                full_name: 'Owner',
              },
              error: null,
            }),
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
          }),
        }),
        // insert returns a learner profile id
        insert: () => ({
          select: () => ({
            single: vi.fn().mockResolvedValue({ data: { id: 'learner-1' }, error: null }),
          }),
        }),
      };
    }
    if (table === 'restaurants') {
      return {
        select: () => ({
          eq: () => ({
            single: vi.fn().mockResolvedValue({ data: { name: 'Acme' }, error: null }),
          }),
        }),
      };
    }
    if (table === 'activity_events') {
      return {
        insert: vi.fn(() => ({
          then: (onF: (v: unknown) => unknown) =>
            Promise.resolve({ data: null, error: null }).then(onF),
          catch: () => Promise.resolve({ data: null, error: null }),
        })),
      };
    }
    throw new Error(`unexpected table ${table}`);
  });

  // auth.admin.createUser via service client — need to inject on createServiceDb mock chain.
  // The route calls serviceClient.auth.admin.createUser; we'll patch later.
}

function makeReq(body: unknown, ip = '1.2.3.4'): NextRequest {
  return new NextRequest('http://localhost/api/invites/send', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify(body),
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
  restLimit.mockResolvedValue({
    success: true,
    remaining: 20,
    reset: Date.now() + 60_000,
    limit: 20,
  });
  mockGetUser.mockResolvedValue({ data: { user: { id: ADMIN_ID } }, error: null });
  buildHappyDispatcher();
  process.env.KV_REST_API_URL = 'http://kv';
  process.env.KV_REST_API_TOKEN = 'tok';
  process.env.RATELIMIT_IP_PEPPER = 'pepper';
  const mod = await import('@/lib/security/rate-limit');
  mod._resetForTests();
});

describe('invites/send rate limit — P1-14', () => {
  it('per-IP rate-limit fires before auth lookup (mockGetUser never called)', async () => {
    const { POST } = await import('@/app/api/invites/send/route');
    ipLimit.mockResolvedValueOnce({
      success: false,
      remaining: 0,
      reset: Date.now() + 60_000,
      limit: 10,
    });
    mockGetUser.mockClear();

    const r = await POST(makeReq({ email: 'e@x.test', fullName: 'A B', jobRole: 'server' }));
    expect(r.status).toBe(429);
    expect(mockGetUser).not.toHaveBeenCalled();
    const ev = capturedEvents.find((c) => c.row.type === 'invite_send_rate_limited');
    expect(ev).toBeDefined();
    expect((ev!.row.payload as Record<string, unknown>).kind).toBe('per_ip');
  });

  it('per-restaurant rate-limit fires AFTER auth (mockGetUser was called)', async () => {
    const { POST } = await import('@/app/api/invites/send/route');
    // per-IP passes, per-restaurant rejects
    restLimit.mockResolvedValueOnce({
      success: false,
      remaining: 0,
      reset: Date.now() + 60_000,
      limit: 20,
    });

    const r = await POST(makeReq({ email: 'e@x.test', fullName: 'A B', jobRole: 'server' }));
    expect(r.status).toBe(429);
    expect(mockGetUser).toHaveBeenCalled();
    const ev = capturedEvents.find((c) => c.row.type === 'invite_send_rate_limited');
    expect(ev).toBeDefined();
    expect((ev!.row.payload as Record<string, unknown>).kind).toBe('per_restaurant');
    expect((ev!.row.payload as Record<string, unknown>).restaurant_id).toBe(RESTAURANT_ID);
  });

  it('byte-identical 429 across per-IP vs per-restaurant rejection', async () => {
    const { POST } = await import('@/app/api/invites/send/route');
    ipLimit.mockResolvedValueOnce({
      success: false,
      remaining: 0,
      reset: Date.now() + 60_000,
      limit: 10,
    });
    const a = await POST(makeReq({ email: 'a@x.test', fullName: 'A', jobRole: 's' }));
    restLimit.mockResolvedValueOnce({
      success: false,
      remaining: 0,
      reset: Date.now() + 60_000,
      limit: 20,
    });
    const b = await POST(makeReq({ email: 'b@x.test', fullName: 'B', jobRole: 's' }));
    expect(a.status).toBe(429);
    expect(b.status).toBe(429);
    expect(await a.text()).toBe(await b.text());
    expect(a.headers.get('Retry-After')).toBe(b.headers.get('Retry-After'));
  });

  it('fail-closed: Redis throw returns 503 + invite_send_rate_limiter_down', async () => {
    const { POST } = await import('@/app/api/invites/send/route');
    ipLimit.mockRejectedValueOnce(new Error('redis down'));
    const r = await POST(makeReq({ email: 'e@x.test', fullName: 'A', jobRole: 's' }));
    expect(r.status).toBe(503);
    const ev = capturedEvents.find((c) => c.row.type === 'invite_send_rate_limiter_down');
    expect(ev).toBeDefined();
  });

  it('format-validation runs FIRST (malformed → 400, no limiter charge)', async () => {
    const { POST } = await import('@/app/api/invites/send/route');
    ipLimit.mockClear();
    restLimit.mockClear();
    const r = await POST(makeReq({})); // missing all required fields
    expect(r.status).toBe(400);
    expect(ipLimit).not.toHaveBeenCalled();
    expect(restLimit).not.toHaveBeenCalled();
  });
});
