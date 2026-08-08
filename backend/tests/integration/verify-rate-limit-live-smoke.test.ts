/**
 * Live smoke test for @upstash/ratelimit against real Upstash.
 *
 * Skipped by default. To run:
 *
 *   1. Provision a throwaway Upstash Redis instance.
 *   2. Export KV_REST_API_URL_LIVE_TEST and KV_REST_API_TOKEN_LIVE_TEST.
 *   3. Run:
 *        UPSTASH_LIVE_TEST=1 pnpm vitest run \
 *          tests/integration/verify-rate-limit-live-smoke.test.ts
 *
 * Validates the @upstash/ratelimit library + Upstash REST API contract
 * end-to-end. NOT in the regular suite — costs Upstash commands and
 * requires external infrastructure. Run before bumping
 * @upstash/ratelimit or @upstash/redis versions.
 *
 * Per audits/cert-code-redesign-plan.md OQ-5, this is the one place that
 * touches a real Upstash instance. The rest of the rate-limit coverage
 * runs against mocked Ratelimit per the same OQ.
 */

import { describe, it, expect } from 'vitest';
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

const LIVE = process.env.UPSTASH_LIVE_TEST === '1';

(LIVE ? describe : describe.skip)('@upstash/ratelimit live smoke', () => {
  it('rejects the 6th call within a 60s window against real Upstash', async () => {
    const url = process.env.KV_REST_API_URL_LIVE_TEST;
    const token = process.env.KV_REST_API_TOKEN_LIVE_TEST;
    if (!url || !token) {
      throw new Error(
        'UPSTASH_LIVE_TEST=1 but KV_REST_API_URL_LIVE_TEST / KV_REST_API_TOKEN_LIVE_TEST not set. ' +
          'Provision a throwaway Upstash Redis instance and export both.'
      );
    }

    const redis = new Redis({ url, token });
    const limiter = new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(5, '60 s'),
      prefix: `rl:smoke:${Date.now()}`, // unique prefix per test run
      analytics: false,
    });

    // 5 successes, then 1 rejection.
    const key = 'live-smoke-key';
    for (let i = 0; i < 5; i++) {
      const r = await limiter.limit(key);
      expect(r.success, `call ${i + 1} should succeed`).toBe(true);
    }
    const sixth = await limiter.limit(key);
    expect(sixth.success).toBe(false);
    expect(sixth.reset).toBeGreaterThan(Date.now());
  }, 30_000);
});
