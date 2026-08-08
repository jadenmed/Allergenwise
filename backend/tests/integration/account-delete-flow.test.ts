/**
 * tests/integration/account-delete-flow.test.ts
 *
 * P1-16 — request → confirm → done flow with mocked Supabase service
 * client and mocked Upstash limiter.
 *
 * Coverage:
 *   - Happy path: request → email send invoked, token row hashed (NOT
 *     raw), activity event written with no PII.
 *   - Confirm without session → 401.
 *   - Confirm with wrong token → 410 + activity event.
 *   - Confirm with expired token → 410.
 *   - Confirm with already-used token → 410 (replay defense).
 *   - Re-request invalidates the prior outstanding token.
 *   - Rate limit returns 429 with byte-identical body.
 *   - Fail-closed Redis throw → 503.
 *   - Activity event payloads contain only profile_id + ip_hash —
 *     never email or full_name (P1-8 alignment).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { hashDeletionToken, generateDeletionToken } from '@/lib/account/deletion-token';

const {
  mockGetUser,
  ipLimit,
  acctLimit,
  capturedEvents,
  resendSend,
  capturedTokenInserts,
  capturedTokenUpdates,
  rpcMock,
  storageRemove,
  authAdminUpdate,
  tokenRowForLookup,
} = vi.hoisted(() => ({
  mockGetUser: vi.fn(),
  ipLimit: vi.fn(),
  acctLimit: vi.fn(),
  capturedEvents: [] as Array<{ row: Record<string, unknown> }>,
  resendSend: vi.fn(),
  capturedTokenInserts: [] as Record<string, unknown>[],
  capturedTokenUpdates: [] as Record<string, unknown>[],
  rpcMock: vi.fn(),
  storageRemove: vi.fn(),
  authAdminUpdate: vi.fn(),
  tokenRowForLookup: { current: null as unknown as Record<string, unknown> | null },
}));

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabase: vi.fn(async () => ({ auth: { getUser: mockGetUser } })),
  createServiceSupabase: vi.fn(() => ({
    auth: { admin: { updateUserById: authAdminUpdate } },
    storage: { from: () => ({ remove: storageRemove }) },
    rpc: rpcMock,
    from: (table: string) => {
      if (table === 'activity_events') {
        return {
          insert: vi.fn((row: Record<string, unknown>) => {
            capturedEvents.push({ row });
            return Promise.resolve({ data: null, error: null });
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
                  restaurant_id: 'r-1',
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
            eq: () => Promise.resolve({ data: [{ pdf_storage_path: 'p/1.pdf' }], error: null }),
          }),
        };
      }
      if (table === 'subscriptions') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({ limit: vi.fn().mockResolvedValue({ data: [], error: null }) }),
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
      if (table === 'account_deletion_tokens') {
        return {
          insert: (row: Record<string, unknown>) => {
            capturedTokenInserts.push(row);
            return {
              select: () => ({
                single: vi.fn().mockResolvedValue({ data: { id: 'tok-1' }, error: null }),
              }),
            };
          },
          update: (v: Record<string, unknown>) => {
            capturedTokenUpdates.push(v);
            return {
              eq: () => ({
                is: vi.fn().mockResolvedValue({ error: null }),
              }),
              // chain that also resolves for the confirm-stamp path
              then: (onF: (r: { error: null }) => unknown) =>
                Promise.resolve({ error: null }).then(onF),
            };
          },
          select: () => ({
            eq: () => ({
              single: vi.fn().mockResolvedValue({ data: tokenRowForLookup.current, error: null }),
            }),
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  })),
}));

vi.mock('@/lib/email/client', () => ({
  resend: { emails: { send: resendSend } },
  FROM_EMAIL: 'hello@allergenwise.com',
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
  capturedTokenInserts.length = 0;
  capturedTokenUpdates.length = 0;
  tokenRowForLookup.current = null;
  ipLimit.mockResolvedValue({
    success: true,
    remaining: 5,
    reset: Date.now() + 3_600_000,
    limit: 5,
  });
  acctLimit.mockResolvedValue({
    success: true,
    remaining: 5,
    reset: Date.now() + 3_600_000,
    limit: 5,
  });
  resendSend.mockResolvedValue({ data: { id: 'mail-1' }, error: null });
  authAdminUpdate.mockResolvedValue({ data: null, error: null });
  rpcMock.mockResolvedValue({ error: null });
  storageRemove.mockResolvedValue({ error: null });
  mockGetUser.mockResolvedValue({ data: { user: { id: 'p-1' } }, error: null });
  process.env.KV_REST_API_URL = 'http://kv';
  process.env.KV_REST_API_TOKEN = 'tok';
  process.env.RATELIMIT_IP_PEPPER = 'pepper';
  process.env.APP_URL = 'https://app.test';
  const mod = await import('@/lib/security/rate-limit');
  mod._resetForTests();
});

function req(path: string, body?: unknown, ip = '1.2.3.4'): NextRequest {
  return new NextRequest(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

// ─── Request phase ───────────────────────────────────────────────────────────

describe('POST /api/account/me/request-deletion', () => {
  it('happy path: 201 + emits hashed token row + activity event with no PII', async () => {
    const { POST } = await import('@/app/api/account/me/request-deletion/route');
    const res = await POST(req('/api/account/me/request-deletion', {}));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toHaveProperty('requestedAt');
    expect(body).toHaveProperty('expiresAt');
    expect(body).toHaveProperty('warnings');
    expect(Array.isArray(body.warnings)).toBe(true);

    // Token row carries a hash, not the raw token.
    expect(capturedTokenInserts).toHaveLength(1);
    const inserted = capturedTokenInserts[0];
    expect(inserted.token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(inserted.profile_id).toBe('p-1');
    expect(inserted.ip_hash).toMatch(/^[0-9a-f]{16}$/);

    // Email send invoked — fire-and-forget as of 04-03 (B4), so the send
    // lands a microtask tick after the response resolves; poll for it.
    await vi.waitFor(() => expect(resendSend).toHaveBeenCalledTimes(1));

    // Audit event: only profile_id + deletion_request_id + ip_hash.
    const ev = capturedEvents.find((e) => e.row.type === 'account_deletion_requested');
    expect(ev).toBeDefined();
    const payload = ev!.row.payload as Record<string, unknown>;
    expect(payload.profile_id).toBe('p-1');
    expect(payload).not.toHaveProperty('email');
    expect(payload).not.toHaveProperty('full_name');
  });

  it('401 when no session', async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: null }, error: null });
    const { POST } = await import('@/app/api/account/me/request-deletion/route');
    const res = await POST(req('/api/account/me/request-deletion', {}));
    expect(res.status).toBe(401);
  });

  it("429 on rate-limit hit; byte-identical to a different IP's 429", async () => {
    const { POST } = await import('@/app/api/account/me/request-deletion/route');
    ipLimit.mockResolvedValueOnce({
      success: false,
      remaining: 0,
      reset: Date.now() + 3_600_000,
      limit: 5,
    });
    const a = await POST(req('/api/account/me/request-deletion', {}, '1.1.1.1'));
    ipLimit.mockResolvedValueOnce({
      success: false,
      remaining: 0,
      reset: Date.now() + 3_600_000,
      limit: 5,
    });
    const b = await POST(req('/api/account/me/request-deletion', {}, '2.2.2.2'));
    expect(a.status).toBe(429);
    expect(b.status).toBe(429);
    expect(await a.text()).toBe(await b.text());
  });

  it('fail-closed: Redis throw returns 503', async () => {
    const { POST } = await import('@/app/api/account/me/request-deletion/route');
    ipLimit.mockRejectedValueOnce(new Error('redis down'));
    const res = await POST(req('/api/account/me/request-deletion', {}));
    expect(res.status).toBe(503);
    expect(
      capturedEvents.some((e) => e.row.type === 'account_deletion_request_rate_limiter_down')
    ).toBe(true);
  });

  it('re-request invalidates prior outstanding tokens', async () => {
    const { POST } = await import('@/app/api/account/me/request-deletion/route');
    await POST(req('/api/account/me/request-deletion', {}));
    await POST(req('/api/account/me/request-deletion', {}));
    // Each request calls the update before insert.
    expect(capturedTokenUpdates.length).toBeGreaterThanOrEqual(2);
    expect(capturedTokenUpdates[0].used_reason).toBe('superseded');
  });
});

// ─── Confirm phase ───────────────────────────────────────────────────────────

describe('POST /api/account/me/confirm-deletion', () => {
  it('happy path: deletes via RPC + bans auth + cleans storage + 200', async () => {
    const raw = generateDeletionToken();
    tokenRowForLookup.current = {
      id: 'tok-1',
      profile_id: 'p-1',
      expires_at: new Date(Date.now() + 60_000).toISOString(),
      used_at: null,
    };

    const { POST } = await import('@/app/api/account/me/confirm-deletion/route');
    const res = await POST(req('/api/account/me/confirm-deletion', { token: raw }));
    expect(res.status).toBe(200);
    expect(authAdminUpdate).toHaveBeenCalledTimes(1);
    expect(rpcMock).toHaveBeenCalledWith(
      'account_delete_user',
      expect.objectContaining({
        p_profile_id: 'p-1',
        p_deletion_request_id: 'tok-1',
      })
    );
    expect(storageRemove).toHaveBeenCalledWith(['p/1.pdf']);
    expect(capturedEvents.some((e) => e.row.type === 'account_deletion_confirmed')).toBe(true);
  });

  it('410 + activity event when token not found', async () => {
    tokenRowForLookup.current = null;
    const { POST } = await import('@/app/api/account/me/confirm-deletion/route');
    const res = await POST(req('/api/account/me/confirm-deletion', { token: 'x' }));
    expect(res.status).toBe(410);
    const ev = capturedEvents.find((e) => e.row.type === 'account_deletion_confirm_invalid');
    expect(ev).toBeDefined();
    expect((ev!.row.payload as Record<string, unknown>).reason).toBe('not_found');
  });

  it('410 when token expired', async () => {
    tokenRowForLookup.current = {
      id: 'tok-1',
      profile_id: 'p-1',
      expires_at: new Date(Date.now() - 1000).toISOString(),
      used_at: null,
    };
    const { POST } = await import('@/app/api/account/me/confirm-deletion/route');
    const res = await POST(req('/api/account/me/confirm-deletion', { token: 'x' }));
    expect(res.status).toBe(410);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it('410 when token used (replay defense)', async () => {
    tokenRowForLookup.current = {
      id: 'tok-1',
      profile_id: 'p-1',
      expires_at: new Date(Date.now() + 60_000).toISOString(),
      used_at: new Date().toISOString(),
    };
    const { POST } = await import('@/app/api/account/me/confirm-deletion/route');
    const res = await POST(req('/api/account/me/confirm-deletion', { token: 'x' }));
    expect(res.status).toBe(410);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it('410 when token belongs to another profile (mismatch)', async () => {
    tokenRowForLookup.current = {
      id: 'tok-1',
      profile_id: 'p-OTHER',
      expires_at: new Date(Date.now() + 60_000).toISOString(),
      used_at: null,
    };
    const { POST } = await import('@/app/api/account/me/confirm-deletion/route');
    const res = await POST(req('/api/account/me/confirm-deletion', { token: 'x' }));
    expect(res.status).toBe(410);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it('401 when no session', async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: null }, error: null });
    const { POST } = await import('@/app/api/account/me/confirm-deletion/route');
    const res = await POST(req('/api/account/me/confirm-deletion', { token: 'x' }));
    expect(res.status).toBe(401);
  });

  it('400 when token missing from body', async () => {
    const { POST } = await import('@/app/api/account/me/confirm-deletion/route');
    const res = await POST(req('/api/account/me/confirm-deletion', {}));
    expect(res.status).toBe(400);
  });
});
