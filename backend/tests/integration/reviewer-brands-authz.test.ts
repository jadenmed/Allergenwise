/**
 * @vitest-environment node
 */
/**
 * tests/integration/reviewer-brands-authz.test.ts
 *
 * Track B — authz + contract tests for the reviewer brand admin routes:
 *   GET   /api/reviewer/brands        — list brands + restaurantCount
 *   POST  /api/reviewer/brands        — create brand (201; 409 on dup slug)
 *   PATCH /api/reviewer/brands/[id]   — update name/slug (user-scoped client)
 *                                       and assign/unassign restaurant
 *                                       membership (SERVICE-ROLE client;
 *                                       reviewer is SELECT-only on restaurants
 *                                       via RLS)
 *
 * Route contract (guarded by lib/auth/require-reviewer → lib/auth/require-role):
 *   401 { error: 'Unauthorized.' }  — no session user
 *   403 { error: 'Forbidden.' }     — authenticated non-reviewer, or missing
 *                                     profile row (onMissingProfile: 'forbidden')
 *   400                             — malformed JSON body / Zod validation failure
 *   409 { error: 'Slug already in use.' } — insert/update error code 23505
 *   200/201                         — reviewer happy paths
 *
 * Key security assertions:
 *   - Membership writes go through createServiceDb (service role) while
 *     name/slug writes stay on the user-scoped client.
 *   - BOTH are unreachable without passing the reviewer guard: on 401/403 the
 *     service client is never even constructed.
 *   - `brands` is a platform-level table (no tenant_id); the isolation property
 *     is that the guard re-reads the role from `profiles` server-side and never
 *     trusts JWT/user metadata claims.
 *
 * Strategy (house style, see admin-upload-photo.test.ts): mock
 * createServerSupabase + createServiceDb around the real route handlers.
 * No real Supabase involved.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ─── Hoisted spies ────────────────────────────────────────────────────────────

const { mockGetUser, mockSessionFrom, mockServiceFrom, mockCreateServiceDb } = vi.hoisted(() => ({
  mockGetUser: vi.fn(),
  mockSessionFrom: vi.fn(),
  mockServiceFrom: vi.fn(),
  mockCreateServiceDb: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabase: vi.fn(async () => ({
    auth: { getUser: mockGetUser },
    from: mockSessionFrom,
  })),
  createServiceSupabase: vi.fn(() => ({ from: mockServiceFrom })),
}));

vi.mock('@/lib/db/service', () => ({
  createServiceDb: mockCreateServiceDb,
}));

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const REVIEWER_ID = 'c1000000-0000-0000-0000-000000000001';
const BRAND_ID = 'e1000000-0000-0000-0000-000000000001';
const BRAND_ID_2 = 'e1000000-0000-0000-0000-000000000002';

const BRAND_ROW = {
  id: BRAND_ID,
  slug: 'acme-diner',
  name: 'Acme Diner',
  created_at: '2026-07-01T00:00:00Z',
  updated_at: '2026-07-01T00:00:00Z',
};

const BRAND_ROW_2 = {
  id: BRAND_ID_2,
  slug: 'zest-kitchen',
  name: 'Zest Kitchen',
  created_at: '2026-06-01T00:00:00Z',
  updated_at: '2026-06-01T00:00:00Z',
};

const DUP_SLUG_ERROR = {
  code: '23505',
  message: 'duplicate key value violates unique constraint "brands_slug_key"',
};

// ─── Session (user-scoped, RLS) client dispatcher ─────────────────────────────

/** Result of the guard's `profiles` role re-read (set per test via helpers). */
let profileResult: { data: unknown; error: unknown } = { data: null, error: null };

/** Spy on the guard's server-side profiles read: receives the column list. */
const profilesSelect = vi.fn();

// Per-terminal-operation spies on the USER-SCOPED client. Each returns the
// `{ data, error }` result and captures the payload the route sent.
const brandsList = vi.fn();
const brandsGet = vi.fn();
const brandsInsert = vi.fn();
const brandsUpdate = vi.fn();
const restaurantsList = vi.fn();

function installSessionFrom() {
  mockSessionFrom.mockImplementation((table: string) => {
    if (table === 'profiles') {
      return {
        select: (cols: string) => {
          profilesSelect(cols);
          return { eq: () => ({ single: async () => profileResult }) };
        },
      };
    }
    if (table === 'brands') {
      return {
        select: () => ({
          order: async () => brandsList(),
          eq: () => ({ single: async () => brandsGet() }),
        }),
        insert: (payload: Record<string, unknown>) => ({
          select: () => ({ single: async () => brandsInsert(payload) }),
        }),
        // brands/[id] PATCH awaits .update().eq() directly → { error }
        update: (payload: Record<string, unknown>) => ({
          eq: (_col: string, id: string) => Promise.resolve(brandsUpdate(payload, id)),
        }),
      };
    }
    if (table === 'restaurants') {
      // brands GET awaits .select('id, brand_id') directly (read-only)
      return { select: () => Promise.resolve(restaurantsList()) };
    }
    throw new Error(`unexpected session table ${table}`);
  });
}

// ─── Service-role client dispatcher (membership writes only) ─────────────────

/** Spy on service-role restaurants membership writes: (payload, ids) → { error }. */
const serviceRestaurantsUpdate = vi.fn();

function installServiceFrom() {
  mockServiceFrom.mockImplementation((table: string) => {
    if (table === 'restaurants') {
      return {
        update: (payload: Record<string, unknown>) => ({
          in: (_col: string, ids: string[]) =>
            Promise.resolve(serviceRestaurantsUpdate(payload, ids)),
        }),
      };
    }
    throw new Error(`unexpected service table ${table}`);
  });
}

// ─── Auth helpers ─────────────────────────────────────────────────────────────

function setUnauthenticated() {
  mockGetUser.mockResolvedValue({
    data: { user: null },
    error: { message: 'Auth session missing!' },
  });
}

/** Authenticated session whose SERVER-SIDE profiles row has the given role. */
function setAuthRole(role: string, metadataRole?: string) {
  mockGetUser.mockResolvedValue({
    data: {
      user: {
        id: REVIEWER_ID,
        app_metadata: { role: metadataRole ?? role },
        user_metadata: { role: metadataRole ?? role },
      },
    },
    error: null,
  });
  profileResult = { data: { role }, error: null };
}

function setAuthReviewer() {
  setAuthRole('reviewer');
}

/** Authenticated session but no profiles row (single() errors). */
function setAuthMissingProfile() {
  mockGetUser.mockResolvedValue({ data: { user: { id: REVIEWER_ID } }, error: null });
  profileResult = {
    data: null,
    error: { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' },
  };
}

// ─── Request helpers ──────────────────────────────────────────────────────────

function makeJsonReq(path: string, method: string, body: unknown, raw = false): NextRequest {
  return new NextRequest(`http://localhost:3000${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: raw ? (body as string) : JSON.stringify(body),
  });
}

/**
 * Assert the guard rejected BEFORE any brand query or service-client call —
 * i.e. neither the user-scoped data path nor the service-role client is
 * reachable without passing the reviewer guard.
 */
function expectNoDbSideEffects() {
  expect(brandsList).not.toHaveBeenCalled();
  expect(brandsGet).not.toHaveBeenCalled();
  expect(brandsInsert).not.toHaveBeenCalled();
  expect(brandsUpdate).not.toHaveBeenCalled();
  expect(restaurantsList).not.toHaveBeenCalled();
  expect(serviceRestaurantsUpdate).not.toHaveBeenCalled();
  expect(mockCreateServiceDb).not.toHaveBeenCalled();
  expect(mockServiceFrom).not.toHaveBeenCalled();
}

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  installSessionFrom();
  installServiceFrom();
  mockCreateServiceDb.mockImplementation(() => ({ from: mockServiceFrom }));
  profileResult = { data: null, error: null };
  brandsList.mockReturnValue({ data: [BRAND_ROW, BRAND_ROW_2], error: null });
  brandsGet.mockReturnValue({ data: BRAND_ROW, error: null });
  brandsInsert.mockReturnValue({ data: BRAND_ROW, error: null });
  brandsUpdate.mockReturnValue({ error: null });
  restaurantsList.mockReturnValue({ data: [], error: null });
  serviceRestaurantsUpdate.mockReturnValue({ error: null });
});

// ─── GET /api/reviewer/brands ─────────────────────────────────────────────────

describe('GET /api/reviewer/brands', () => {
  it('401 for anonymous — short-circuits before profile read and any DB call', async () => {
    setUnauthenticated();
    const { GET } = await import('@/app/api/reviewer/brands/route');
    const res = await GET();
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'Unauthorized.' });
    expect(profilesSelect).not.toHaveBeenCalled();
    expectNoDbSideEffects();
  });

  it('403 for manager', async () => {
    setAuthRole('manager');
    const { GET } = await import('@/app/api/reviewer/brands/route');
    const res = await GET();
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'Forbidden.' });
    expectNoDbSideEffects();
  });

  it('403 for learner', async () => {
    setAuthRole('learner');
    const { GET } = await import('@/app/api/reviewer/brands/route');
    const res = await GET();
    expect(res.status).toBe(403);
    expectNoDbSideEffects();
  });

  it('403 when profile row is missing (onMissingProfile: forbidden)', async () => {
    setAuthMissingProfile();
    const { GET } = await import('@/app/api/reviewer/brands/route');
    const res = await GET();
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'Forbidden.' });
    expectNoDbSideEffects();
  });

  it('200 for reviewer → brands with computed restaurantCount', async () => {
    setAuthReviewer();
    restaurantsList.mockReturnValue({
      data: [
        { id: 'r1', brand_id: BRAND_ID },
        { id: 'r2', brand_id: BRAND_ID },
        { id: 'r3', brand_id: BRAND_ID_2 },
        { id: 'r4', brand_id: null }, // unassigned — counted nowhere
      ],
      error: null,
    });
    const { GET } = await import('@/app/api/reviewer/brands/route');
    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { brands: Array<{ id: string; restaurantCount: number }> };
    expect(body.brands).toHaveLength(2);
    expect(body.brands[0]).toEqual({ ...BRAND_ROW, restaurantCount: 2 });
    expect(body.brands[1]).toEqual({ ...BRAND_ROW_2, restaurantCount: 1 });
  });
});

// ─── POST /api/reviewer/brands ────────────────────────────────────────────────

describe('POST /api/reviewer/brands', () => {
  const url = '/api/reviewer/brands';
  const validBody = { name: 'Acme Diner', slug: 'acme-diner' };

  it('401 for anonymous', async () => {
    setUnauthenticated();
    const { POST } = await import('@/app/api/reviewer/brands/route');
    const res = await POST(makeJsonReq(url, 'POST', validBody));
    expect(res.status).toBe(401);
    expectNoDbSideEffects();
  });

  it('403 for manager', async () => {
    setAuthRole('manager');
    const { POST } = await import('@/app/api/reviewer/brands/route');
    const res = await POST(makeJsonReq(url, 'POST', validBody));
    expect(res.status).toBe(403);
    expectNoDbSideEffects();
  });

  it('403 for learner', async () => {
    setAuthRole('learner');
    const { POST } = await import('@/app/api/reviewer/brands/route');
    const res = await POST(makeJsonReq(url, 'POST', validBody));
    expect(res.status).toBe(403);
    expectNoDbSideEffects();
  });

  it('403 when profile row is missing', async () => {
    setAuthMissingProfile();
    const { POST } = await import('@/app/api/reviewer/brands/route');
    const res = await POST(makeJsonReq(url, 'POST', validBody));
    expect(res.status).toBe(403);
    expectNoDbSideEffects();
  });

  it('400 on malformed JSON body (reviewer)', async () => {
    setAuthReviewer();
    const { POST } = await import('@/app/api/reviewer/brands/route');
    const res = await POST(makeJsonReq(url, 'POST', '{ not json', true));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Invalid JSON body.' });
    expect(brandsInsert).not.toHaveBeenCalled();
  });

  it('400 on Zod failure — slug with uppercase/spaces rejected', async () => {
    setAuthReviewer();
    const { POST } = await import('@/app/api/reviewer/brands/route');
    const res = await POST(makeJsonReq(url, 'POST', { name: 'Acme', slug: 'Not A Slug!' }));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; details: Record<string, unknown> };
    expect(body.error).toBe('Validation failed.');
    expect(body.details).toHaveProperty('slug');
    expect(brandsInsert).not.toHaveBeenCalled();
  });

  it('201 for reviewer → inserts name+slug via the user-scoped client', async () => {
    setAuthReviewer();
    const { POST } = await import('@/app/api/reviewer/brands/route');
    const res = await POST(makeJsonReq(url, 'POST', validBody));
    expect(res.status).toBe(201);
    const body = (await res.json()) as { brand: unknown };
    expect(body.brand).toEqual(BRAND_ROW);
    expect(brandsInsert).toHaveBeenCalledTimes(1);
    expect(brandsInsert).toHaveBeenCalledWith({ name: 'Acme Diner', slug: 'acme-diner' });
    expect(mockServiceFrom).not.toHaveBeenCalled();
  });

  it('409 when insert hits unique violation 23505 (duplicate slug)', async () => {
    setAuthReviewer();
    brandsInsert.mockReturnValue({ data: null, error: DUP_SLUG_ERROR });
    const { POST } = await import('@/app/api/reviewer/brands/route');
    const res = await POST(makeJsonReq(url, 'POST', validBody));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'Slug already in use.' });
  });
});

// ─── PATCH /api/reviewer/brands/[id] ──────────────────────────────────────────

describe('PATCH /api/reviewer/brands/[id]', () => {
  const url = `/api/reviewer/brands/${BRAND_ID}`;
  const ctx = { params: { id: BRAND_ID } };

  it('401 for anonymous — service client is never constructed', async () => {
    setUnauthenticated();
    const { PATCH } = await import('@/app/api/reviewer/brands/[id]/route');
    const res = await PATCH(makeJsonReq(url, 'PATCH', { assignRestaurantIds: ['r1'] }), ctx);
    expect(res.status).toBe(401);
    // Guard rejection short-circuits BEFORE any DB call — the service-role
    // client (which could bypass RLS) is not even instantiated.
    expect(mockCreateServiceDb).not.toHaveBeenCalled();
    expectNoDbSideEffects();
  });

  it('403 for manager — service client is never constructed', async () => {
    setAuthRole('manager');
    const { PATCH } = await import('@/app/api/reviewer/brands/[id]/route');
    const res = await PATCH(makeJsonReq(url, 'PATCH', { assignRestaurantIds: ['r1'] }), ctx);
    expect(res.status).toBe(403);
    expect(mockCreateServiceDb).not.toHaveBeenCalled();
    expectNoDbSideEffects();
  });

  it('403 for learner — service client is never constructed', async () => {
    setAuthRole('learner');
    const { PATCH } = await import('@/app/api/reviewer/brands/[id]/route');
    const res = await PATCH(makeJsonReq(url, 'PATCH', { unassignRestaurantIds: ['r1'] }), ctx);
    expect(res.status).toBe(403);
    expect(mockCreateServiceDb).not.toHaveBeenCalled();
    expectNoDbSideEffects();
  });

  it('403 when profile row is missing', async () => {
    setAuthMissingProfile();
    const { PATCH } = await import('@/app/api/reviewer/brands/[id]/route');
    const res = await PATCH(makeJsonReq(url, 'PATCH', { name: 'New Name' }), ctx);
    expect(res.status).toBe(403);
    expectNoDbSideEffects();
  });

  it('400 on malformed JSON body', async () => {
    setAuthReviewer();
    const { PATCH } = await import('@/app/api/reviewer/brands/[id]/route');
    const res = await PATCH(makeJsonReq(url, 'PATCH', '{{{', true), ctx);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Invalid JSON body.' });
    expect(brandsUpdate).not.toHaveBeenCalled();
    expect(serviceRestaurantsUpdate).not.toHaveBeenCalled();
  });

  it('400 on Zod failure — empty object fails the at-least-one-field refine', async () => {
    setAuthReviewer();
    const { PATCH } = await import('@/app/api/reviewer/brands/[id]/route');
    const res = await PATCH(makeJsonReq(url, 'PATCH', {}), ctx);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('Validation failed.');
    expect(brandsUpdate).not.toHaveBeenCalled();
    expect(serviceRestaurantsUpdate).not.toHaveBeenCalled();
  });

  it('200 name/slug update → USER-SCOPED client only; no restaurants write', async () => {
    setAuthReviewer();
    const { PATCH } = await import('@/app/api/reviewer/brands/[id]/route');
    const res = await PATCH(
      makeJsonReq(url, 'PATCH', { name: 'Acme Rebrand', slug: 'acme-rebrand' }),
      ctx
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { brand: unknown };
    expect(body.brand).toEqual(BRAND_ROW);
    expect(brandsUpdate).toHaveBeenCalledTimes(1);
    expect(brandsUpdate).toHaveBeenCalledWith(
      { name: 'Acme Rebrand', slug: 'acme-rebrand' },
      BRAND_ID
    );
    // Membership untouched — the service client performed no write.
    expect(serviceRestaurantsUpdate).not.toHaveBeenCalled();
    expect(mockServiceFrom).not.toHaveBeenCalled();
  });

  it('200 assignRestaurantIds → membership write goes through the SERVICE client', async () => {
    setAuthReviewer();
    const { PATCH } = await import('@/app/api/reviewer/brands/[id]/route');
    const res = await PATCH(makeJsonReq(url, 'PATCH', { assignRestaurantIds: ['r1', 'r2'] }), ctx);
    expect(res.status).toBe(200);
    // Service-role client used for restaurants.brand_id (reviewer is
    // SELECT-only on restaurants under RLS)…
    expect(mockCreateServiceDb).toHaveBeenCalled();
    expect(serviceRestaurantsUpdate).toHaveBeenCalledTimes(1);
    expect(serviceRestaurantsUpdate).toHaveBeenCalledWith({ brand_id: BRAND_ID }, ['r1', 'r2']);
    // …while the user-scoped client never writes brands or restaurants here.
    expect(brandsUpdate).not.toHaveBeenCalled();
  });

  it('200 unassignRestaurantIds → service client nulls brand_id', async () => {
    setAuthReviewer();
    const { PATCH } = await import('@/app/api/reviewer/brands/[id]/route');
    const res = await PATCH(makeJsonReq(url, 'PATCH', { unassignRestaurantIds: ['r3'] }), ctx);
    expect(res.status).toBe(200);
    expect(serviceRestaurantsUpdate).toHaveBeenCalledTimes(1);
    expect(serviceRestaurantsUpdate).toHaveBeenCalledWith({ brand_id: null }, ['r3']);
    expect(brandsUpdate).not.toHaveBeenCalled();
  });

  it('200 combined name + assign → each half uses its designated client', async () => {
    setAuthReviewer();
    const { PATCH } = await import('@/app/api/reviewer/brands/[id]/route');
    const res = await PATCH(
      makeJsonReq(url, 'PATCH', { name: 'Acme Rebrand', assignRestaurantIds: ['r1'] }),
      ctx
    );
    expect(res.status).toBe(200);
    // name → user-scoped (RLS-enforced) brands update
    expect(brandsUpdate).toHaveBeenCalledWith({ name: 'Acme Rebrand' }, BRAND_ID);
    // membership → service-role restaurants update
    expect(serviceRestaurantsUpdate).toHaveBeenCalledWith({ brand_id: BRAND_ID }, ['r1']);
  });

  it('409 when the slug update hits unique violation 23505', async () => {
    setAuthReviewer();
    brandsUpdate.mockReturnValue({ error: DUP_SLUG_ERROR });
    const { PATCH } = await import('@/app/api/reviewer/brands/[id]/route');
    const res = await PATCH(makeJsonReq(url, 'PATCH', { slug: 'taken-slug' }), ctx);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'Slug already in use.' });
    // 409 short-circuits before any membership write.
    expect(serviceRestaurantsUpdate).not.toHaveBeenCalled();
  });
});

// ─── Role source: server-side profiles re-read, never JWT metadata ────────────

describe('reviewer guard role source (platform-table isolation)', () => {
  it('403 when JWT metadata claims reviewer but the profiles row says manager', async () => {
    // Forged/stale JWT claim must not grant access — role comes from profiles.
    setAuthRole('manager', 'reviewer');
    const { PATCH } = await import('@/app/api/reviewer/brands/[id]/route');
    const res = await PATCH(
      makeJsonReq(`/api/reviewer/brands/${BRAND_ID}`, 'PATCH', { assignRestaurantIds: ['r1'] }),
      { params: { id: BRAND_ID } }
    );
    expect(res.status).toBe(403);
    expect(profilesSelect).toHaveBeenCalledWith('role, departed_at');
    expect(mockCreateServiceDb).not.toHaveBeenCalled();
    expectNoDbSideEffects();
  });

  it('200 when JWT metadata claims learner but the profiles row says reviewer (profiles wins)', async () => {
    setAuthRole('reviewer', 'learner');
    const { GET } = await import('@/app/api/reviewer/brands/route');
    const res = await GET();
    expect(res.status).toBe(200);
    expect(profilesSelect).toHaveBeenCalledWith('role, departed_at');
    expect(brandsList).toHaveBeenCalledTimes(1);
  });
});
