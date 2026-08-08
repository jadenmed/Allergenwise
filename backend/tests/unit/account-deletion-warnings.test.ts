/**
 * tests/unit/account-deletion-warnings.test.ts
 *
 * P1-16 Concern 1 — sole-admin pre-warning builder.
 */

import { describe, it, expect, vi } from 'vitest';
import { buildDeletionWarnings } from '@/lib/account/deletion-warnings';

interface MockOptions {
  adminships?: Array<{ role: string; restaurant_id: string }>;
  peers?: Array<{ id: string }>;
  activeSubs?: Array<{ id: string; status: string }>;
  restaurantName?: string;
}

function makeDb(opts: MockOptions): Parameters<typeof buildDeletionWarnings>[0] {
  const profilesCalls: number[] = [];
  const fromImpl = (table: string) => {
    if (table === 'profiles') {
      profilesCalls.push(1);
      const callIdx = profilesCalls.length;
      const resolveData = () => {
        if (callIdx === 1) {
          return { data: opts.adminships ?? [], error: null };
        }
        return { data: opts.peers ?? [], error: null };
      };
      // Build a chain where `.eq(...).eq(...).neq(...)` all return this thenable.
      const chain: Record<string, unknown> = {};
      chain.select = () => chain;
      chain.eq = () => chain;
      chain.neq = () => chain;
      chain.then = (onF: (v: unknown) => unknown) => Promise.resolve(resolveData()).then(onF);
      return chain;
    }
    if (table === 'subscriptions') {
      const chain: Record<string, unknown> = {};
      chain.select = () => chain;
      chain.eq = () => chain;
      chain.limit = vi.fn().mockResolvedValue({ data: opts.activeSubs ?? [], error: null });
      return chain;
    }
    if (table === 'restaurants') {
      return {
        select: () => ({
          eq: () => ({
            single: vi.fn().mockResolvedValue({
              data: opts.restaurantName ? { name: opts.restaurantName } : null,
              error: null,
            }),
          }),
        }),
      };
    }
    throw new Error(`unexpected table ${table}`);
  };
  return { from: fromImpl } as unknown as Parameters<typeof buildDeletionWarnings>[0];
}

describe('buildDeletionWarnings', () => {
  const PROFILE = 'p-1';
  const R = 'r-1';

  it('returns empty array if user is not an admin anywhere', async () => {
    const db = makeDb({ adminships: [{ role: 'learner', restaurant_id: R }] });
    expect(await buildDeletionWarnings(db, PROFILE)).toEqual([]);
  });

  it('returns empty array if user is an admin but a co-admin exists', async () => {
    const db = makeDb({
      adminships: [{ role: 'manager', restaurant_id: R }],
      peers: [{ id: 'other' }],
      activeSubs: [{ id: 's-1', status: 'active' }],
    });
    expect(await buildDeletionWarnings(db, PROFILE)).toEqual([]);
  });

  it('returns a warning when sole admin AND active subscription', async () => {
    const db = makeDb({
      adminships: [{ role: 'manager', restaurant_id: R }],
      peers: [],
      activeSubs: [{ id: 's-1', status: 'active' }],
      restaurantName: 'Acme Bistro',
    });
    const out = await buildDeletionWarnings(db, PROFILE);
    expect(out).toHaveLength(1);
    expect(out[0]).toContain('Acme Bistro');
    expect(out[0]).toContain('sole admin');
  });

  it('returns no warning when sole admin but subscription is NOT active', async () => {
    const db = makeDb({
      adminships: [{ role: 'manager', restaurant_id: R }],
      peers: [],
      activeSubs: [],
    });
    expect(await buildDeletionWarnings(db, PROFILE)).toEqual([]);
  });
});
