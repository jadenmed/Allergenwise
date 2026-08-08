/**
 * tests/unit/rate-limit-factories.test.ts
 *
 * P1-14 — verify the new limiter factories are wired through Upstash
 * with the documented prefix + window + override behavior.
 *
 * We mock @upstash/ratelimit + @upstash/redis so no real network hit is
 * involved. The mock captures `prefix` and the `slidingWindow` args so
 * we can assert each factory wires the right limit + key namespace.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { ctorSpy, slidingSpy } = vi.hoisted(() => ({
  ctorSpy: vi.fn(),
  slidingSpy: vi.fn(),
}));

vi.mock('@upstash/ratelimit', () => ({
  Ratelimit: class {
    static slidingWindow(...args: unknown[]) {
      slidingSpy(args);
      return { __limiter: args };
    }
    constructor(opts: { prefix?: string; limiter?: unknown }) {
      ctorSpy(opts);
      this.prefix = opts.prefix ?? '';
    }
    prefix: string;
    limit = vi.fn().mockResolvedValue({ success: true });
  },
}));

vi.mock('@upstash/redis', () => ({
  Redis: class {
    constructor() {}
  },
}));

beforeEach(async () => {
  vi.clearAllMocks();
  process.env.KV_REST_API_URL = 'http://test-kv';
  process.env.KV_REST_API_TOKEN = 'test';
  // Wipe overrides so default knobs apply.
  delete process.env.RATELIMIT_SIGNUP_IP_PER_MIN;
  delete process.env.RATELIMIT_SIGNUP_EMAIL_PER_MIN;
  delete process.env.RATELIMIT_INVITE_ACCEPT_IP_PER_MIN;
  delete process.env.RATELIMIT_INVITE_ACCEPT_TOKEN_PER_MIN;
  delete process.env.RATELIMIT_INVITE_SEND_IP_PER_MIN;
  delete process.env.RATELIMIT_INVITE_SEND_RESTAURANT_PER_MIN;
  const mod = await import('@/lib/security/rate-limit');
  mod._resetForTests();
});

describe('P1-14 rate-limit factories', () => {
  it('signup IP factory uses prefix rl:signup:ip and slidingWindow(10, 60s)', async () => {
    const { getSignupIpLimiter } = await import('@/lib/security/rate-limit');
    getSignupIpLimiter();
    expect(ctorSpy.mock.calls.at(-1)?.[0].prefix).toBe('rl:signup:ip');
    expect(slidingSpy.mock.calls.at(-1)?.[0]).toEqual([10, '60 s']);
  });

  it('signup email factory uses prefix rl:signup:email and slidingWindow(5, 60s)', async () => {
    const { getSignupEmailLimiter } = await import('@/lib/security/rate-limit');
    getSignupEmailLimiter();
    expect(ctorSpy.mock.calls.at(-1)?.[0].prefix).toBe('rl:signup:email');
    expect(slidingSpy.mock.calls.at(-1)?.[0]).toEqual([5, '60 s']);
  });

  it('invite-accept IP factory uses prefix rl:invite-accept:ip and slidingWindow(10, 60s)', async () => {
    const { getInviteAcceptIpLimiter } = await import('@/lib/security/rate-limit');
    getInviteAcceptIpLimiter();
    expect(ctorSpy.mock.calls.at(-1)?.[0].prefix).toBe('rl:invite-accept:ip');
    expect(slidingSpy.mock.calls.at(-1)?.[0]).toEqual([10, '60 s']);
  });

  it('invite-accept token factory uses prefix rl:invite-accept:token and slidingWindow(5, 60s)', async () => {
    const { getInviteAcceptTokenLimiter } = await import('@/lib/security/rate-limit');
    getInviteAcceptTokenLimiter();
    expect(ctorSpy.mock.calls.at(-1)?.[0].prefix).toBe('rl:invite-accept:token');
    expect(slidingSpy.mock.calls.at(-1)?.[0]).toEqual([5, '60 s']);
  });

  it('invite-send IP factory uses prefix rl:invite-send:ip and slidingWindow(10, 60s)', async () => {
    const { getInviteSendIpLimiter } = await import('@/lib/security/rate-limit');
    getInviteSendIpLimiter();
    expect(ctorSpy.mock.calls.at(-1)?.[0].prefix).toBe('rl:invite-send:ip');
    expect(slidingSpy.mock.calls.at(-1)?.[0]).toEqual([10, '60 s']);
  });

  it('invite-send restaurant factory uses prefix rl:invite-send:restaurant and slidingWindow(20, 60s)', async () => {
    const { getInviteSendRestaurantLimiter } = await import('@/lib/security/rate-limit');
    getInviteSendRestaurantLimiter();
    expect(ctorSpy.mock.calls.at(-1)?.[0].prefix).toBe('rl:invite-send:restaurant');
    expect(slidingSpy.mock.calls.at(-1)?.[0]).toEqual([20, '60 s']);
  });

  it('env-var override is honored at first call', async () => {
    process.env.RATELIMIT_SIGNUP_IP_PER_MIN = '3';
    const { getSignupIpLimiter, _resetForTests } = await import('@/lib/security/rate-limit');
    _resetForTests();
    getSignupIpLimiter();
    expect(slidingSpy.mock.calls.at(-1)?.[0]).toEqual([3, '60 s']);
  });

  it('factories are memoized (second call returns the same instance)', async () => {
    const { getSignupIpLimiter } = await import('@/lib/security/rate-limit');
    const a = getSignupIpLimiter();
    const b = getSignupIpLimiter();
    expect(a).toBe(b);
  });
});
