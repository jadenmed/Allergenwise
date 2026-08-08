/**
 * @vitest-environment node
 */
/**
 * tests/unit/roster-departure-route.test.ts
 *
 * T-46a — POST/DELETE /api/admin/roster/[profileId]/departure.
 *
 * The contract this file pins down:
 *   - manager-only, and scoped to the caller's OWN restaurant (a profile at
 *     another restaurant is a 404, not a 403 — the caller must not learn it
 *     exists)
 *   - learners only, so a restaurant cannot lock itself out by departing its
 *     last manager (auth_restaurant_id() in 0026 has no role branch, so a
 *     departed manager loses restaurant scope in the DATABASE too)
 *   - the write touches exactly one column: profiles.departed_at
 *   - CERTIFICATES ARE NEVER TOUCHED. No status change, no delete. Neither are
 *     lesson_progress or exam_attempts. That is the difference between removing
 *     someone from a roster and account_delete_user's GDPR erasure, which
 *     destroys a credential the restaurant paid for.
 *   - re-departing someone is a no-op that preserves the ORIGINAL date
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ─── Hoisted mocks ────────────────────────────────────────────────────────────

const { mockGetUser, mockCreateServiceDb } = vi.hoisted(() => ({
  mockGetUser: vi.fn(),
  mockCreateServiceDb: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabase: vi.fn(async () => ({ auth: { getUser: mockGetUser } })),
  createServiceSupabase: vi.fn(() => mockCreateServiceDb()),
}));

vi.mock('@/lib/db/service', () => ({ createServiceDb: mockCreateServiceDb }));

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const MANAGER_ID = 'a1000000-0000-4000-8000-000000000002';
const LEARNER_ID = 'a1000000-0000-4000-8000-000000000001';
const OTHER_MANAGER_ID = 'a1000000-0000-4000-8000-000000000003';
const RESTAURANT_ID = 'b1000000-0000-4000-8000-000000000001';

const EARLIER_DEPARTURE = '2026-07-01T09:00:00.000Z';

interface UpdateCall {
  table: string;
  payload: Record<string, unknown>;
  filters: Array<[string, unknown]>;
}

let updates: UpdateCall[];
let inserts: Array<{ table: string; payload: Record<string, unknown> }>;
let tablesTouched: string[];

/** The row the target lookup returns; null models "no such profile here". */
let targetRow: Record<string, unknown> | null;

/** The manager doing the removing. */
let callerProfile: Record<string, unknown> | null;

beforeEach(() => {
  vi.clearAllMocks();
  updates = [];
  inserts = [];
  tablesTouched = [];
  targetRow = { id: LEARNER_ID, role: 'learner', departed_at: null };
  callerProfile = {
    id: MANAGER_ID,
    role: 'manager',
    restaurant_id: RESTAURANT_ID,
    departed_at: null,
  };

  mockGetUser.mockResolvedValue({ data: { user: { id: MANAGER_ID } }, error: null });

  mockCreateServiceDb.mockImplementation(() => ({
    from(table: string) {
      tablesTouched.push(table);
      const filters: Array<[string, unknown]> = [];

      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: (column: string, value: unknown) => {
          filters.push([column, value]);
          return chain;
        },
        is: () => chain,
        // The guard's own re-read of the CALLER.
        single: async () => ({ data: callerProfile, error: null }),
        // The route's lookup of the TARGET.
        maybeSingle: async () => ({ data: targetRow, error: null }),
        update: (payload: Record<string, unknown>) => {
          updates.push({ table, payload, filters });
          return chain;
        },
        insert: async (payload: Record<string, unknown>) => {
          inserts.push({ table, payload });
          return { data: null, error: null };
        },
        then: (onF: (v: unknown) => unknown) =>
          Promise.resolve({ data: null, error: null }).then(onF),
      };
      return chain;
    },
  }));
});

function request(): NextRequest {
  return new NextRequest(new URL('/api/admin/roster/x/departure', 'http://localhost:3000'), {
    method: 'POST',
  });
}

async function callPost(profileId = LEARNER_ID) {
  const { POST } = await import('@/app/api/admin/roster/[profileId]/departure/route');
  const res = await POST(request(), { params: { profileId } });
  return { res, body: (await res.json()) as Record<string, unknown> };
}

async function callDelete(profileId = LEARNER_ID) {
  const { DELETE } = await import('@/app/api/admin/roster/[profileId]/departure/route');
  const res = await DELETE(request(), { params: { profileId } });
  return { res, body: (await res.json()) as Record<string, unknown> };
}

// ─── Happy path ───────────────────────────────────────────────────────────────

describe('POST — take a learner off the roster', () => {
  it('sets departed_at and reports the change', async () => {
    const { res, body } = await callPost();

    expect(res.status).toBe(200);
    expect(body.changed).toBe(true);
    expect(body.profileId).toBe(LEARNER_ID);
    expect(typeof body.departedAt).toBe('string');
  });

  it('writes exactly one column', async () => {
    await callPost();

    expect(updates).toHaveLength(1);
    expect(updates[0].table).toBe('profiles');
    expect(Object.keys(updates[0].payload)).toEqual(['departed_at']);
  });

  it('does NOT null out restaurant_id — certificates reference it', async () => {
    await callPost();

    expect(updates[0].payload).not.toHaveProperty('restaurant_id');
  });

  it('NEVER touches certificates, lesson_progress or exam_attempts', async () => {
    // The whole reason this endpoint exists instead of account_delete_user.
    await callPost();

    expect(tablesTouched).not.toContain('certificates');
    expect(tablesTouched).not.toContain('lesson_progress');
    expect(tablesTouched).not.toContain('exam_attempts');
    expect(tablesTouched).not.toContain('quiz_attempts');
  });

  it("scopes the write to the caller's own restaurant and to learners", async () => {
    await callPost();

    expect(updates[0].filters).toContainEqual(['id', LEARNER_ID]);
    expect(updates[0].filters).toContainEqual(['restaurant_id', RESTAURANT_ID]);
    expect(updates[0].filters).toContainEqual(['role', 'learner']);
  });

  it('records a staff_departed activity event', async () => {
    await callPost();

    const event = inserts.find((i) => i.table === 'activity_events');
    expect(event).toBeDefined();
    expect(event!.payload.type).toBe('staff_departed');
    expect(event!.payload.restaurant_id).toBe(RESTAURANT_ID);
    expect(event!.payload.actor_id).toBe(MANAGER_ID);
  });
});

// ─── Undo ─────────────────────────────────────────────────────────────────────

describe('DELETE — put them back', () => {
  it('clears departed_at', async () => {
    targetRow = { id: LEARNER_ID, role: 'learner', departed_at: EARLIER_DEPARTURE };

    const { res, body } = await callDelete();

    expect(res.status).toBe(200);
    expect(body.changed).toBe(true);
    expect(body.departedAt).toBeNull();
    expect(updates[0].payload).toEqual({ departed_at: null });
  });

  it('records a staff_restored activity event', async () => {
    targetRow = { id: LEARNER_ID, role: 'learner', departed_at: EARLIER_DEPARTURE };

    await callDelete();

    const event = inserts.find((i) => i.table === 'activity_events');
    expect(event!.payload.type).toBe('staff_restored');
  });
});

// ─── Idempotence ──────────────────────────────────────────────────────────────

describe('re-running is a no-op, not a correction', () => {
  it('re-departing preserves the ORIGINAL departure date', async () => {
    // The date is the record of when they actually left. Overwriting it with
    // "now" on a double-click would quietly rewrite that fact.
    targetRow = { id: LEARNER_ID, role: 'learner', departed_at: EARLIER_DEPARTURE };

    const { res, body } = await callPost();

    expect(res.status).toBe(200);
    expect(body.changed).toBe(false);
    expect(body.departedAt).toBe(EARLIER_DEPARTURE);
    expect(updates, 'no write at all').toHaveLength(0);
  });

  it('restoring someone who never left writes nothing', async () => {
    targetRow = { id: LEARNER_ID, role: 'learner', departed_at: null };

    const { body } = await callDelete();

    expect(body.changed).toBe(false);
    expect(updates).toHaveLength(0);
  });
});

// ─── Authorization ────────────────────────────────────────────────────────────

describe('authorization', () => {
  it('401 without a session', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });

    const { res } = await callPost();

    expect(res.status).toBe(401);
    expect(updates).toHaveLength(0);
  });

  it('403 for a learner trying to remove someone', async () => {
    callerProfile = {
      id: LEARNER_ID,
      role: 'learner',
      restaurant_id: RESTAURANT_ID,
      departed_at: null,
    };

    const { res } = await callPost();

    expect(res.status).toBe(403);
    expect(updates).toHaveLength(0);
  });

  it('403 for a manager who has themself departed', async () => {
    callerProfile = {
      id: MANAGER_ID,
      role: 'manager',
      restaurant_id: RESTAURANT_ID,
      departed_at: EARLIER_DEPARTURE,
    };

    const { res, body } = await callPost();

    expect(res.status).toBe(403);
    expect(body.error).toBe('This account is no longer active staff at this restaurant.');
    expect(updates).toHaveLength(0);
  });

  it('404 for a profile at another restaurant — existence is not disclosed', async () => {
    targetRow = null; // the restaurant_id filter excluded it

    const { res, body } = await callPost();

    expect(res.status).toBe(404);
    expect(body.error).toBe('Employee not found at this restaurant.');
    expect(updates).toHaveLength(0);
  });

  it('400 when the target is a manager — a restaurant cannot lock itself out', async () => {
    // auth_restaurant_id() (0026) has no role branch, so a departed manager
    // loses restaurant scope in the database. If the last manager could be
    // departed, nobody could read the restaurant or add staff to recover it.
    targetRow = { id: OTHER_MANAGER_ID, role: 'manager', departed_at: null };

    const { res, body } = await callPost(OTHER_MANAGER_ID);

    expect(res.status).toBe(400);
    expect(body.error).toBe('Only learner accounts can be removed from a roster.');
    expect(updates).toHaveLength(0);
  });

  it('400 on a malformed profileId', async () => {
    const { res } = await callPost('not-a-uuid');

    expect(res.status).toBe(400);
    expect(updates).toHaveLength(0);
  });
});
