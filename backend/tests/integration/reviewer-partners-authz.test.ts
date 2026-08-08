/**
 * @vitest-environment node
 */
/**
 * tests/integration/reviewer-partners-authz.test.ts
 *
 * Track B — authz + contract tests for the reviewer partner admin routes:
 *   GET   /api/reviewer/partners        — list partners
 *   POST  /api/reviewer/partners        — create partner (201)
 *   PATCH /api/reviewer/partners/[id]   — update partner
 *
 * Route contract (guarded by lib/auth/require-reviewer → lib/auth/require-role):
 *   401 { error: 'Unauthorized.' }  — no session user
 *   403 { error: 'Forbidden.' }     — authenticated non-reviewer, or missing
 *                                     profile row (onMissingProfile: 'forbidden')
 *   400                             — malformed JSON body / Zod validation failure
 *   200/201                         — reviewer happy paths
 *
 * `partners` is a platform-level table (no tenant_id); the isolation property
 * asserted here is that the guard ALWAYS re-reads the role from `profiles`
 * server-side and never trusts JWT/user metadata claims.
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
const PARTNER_ID = 'd1000000-0000-0000-0000-000000000009';

const PARTNER_ROW = {
  id: PARTNER_ID,
  name: 'Acme Hospitality Group',
  contact_email: 'ops@acme.test',
  default_commission_rate: 0.2,
  status: 'active',
  created_at: '2026-07-01T00:00:00Z',
  updated_at: '2026-07-01T00:00:00Z',
};

// ─── Session client dispatcher ────────────────────────────────────────────────

/** Result of the guard's `profiles` role re-read (set per test via helpers). */
let profileResult: { data: unknown; error: unknown } = { data: null, error: null };

/** Spy on the guard's server-side profiles read: receives the column list. */
const profilesSelect = vi.fn();

// Per-terminal-operation spies. Each returns the `{ data, error }` result and
// captures the payload the route sent, so tests can assert both.
const partnersList = vi.fn();
const partnersInsert = vi.fn();
const partnersUpdate = vi.fn();

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
    if (table === 'partners') {
      return {
        select: () => ({
          order: async () => partnersList(),
        }),
        insert: (payload: Record<string, unknown>) => ({
          select: () => ({ single: async () => partnersInsert(payload) }),
        }),
        update: (payload: Record<string, unknown>) => ({
          eq: (_col: string, id: string) => ({
            select: () => ({ single: async () => partnersUpdate(payload, id) }),
          }),
        }),
      };
    }
    throw new Error(`unexpected session table ${table}`);
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

/** Assert the guard rejected BEFORE any partners query or service-client call. */
function expectNoDbSideEffects() {
  expect(partnersList).not.toHaveBeenCalled();
  expect(partnersInsert).not.toHaveBeenCalled();
  expect(partnersUpdate).not.toHaveBeenCalled();
  expect(mockCreateServiceDb).not.toHaveBeenCalled();
  expect(mockServiceFrom).not.toHaveBeenCalled();
}

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  installSessionFrom();
  mockCreateServiceDb.mockImplementation(() => ({ from: mockServiceFrom }));
  profileResult = { data: null, error: null };
  partnersList.mockReturnValue({ data: [PARTNER_ROW], error: null });
  partnersInsert.mockReturnValue({ data: PARTNER_ROW, error: null });
  partnersUpdate.mockReturnValue({ data: { ...PARTNER_ROW, name: 'Renamed' }, error: null });
});

// ─── GET /api/reviewer/partners ───────────────────────────────────────────────

describe('GET /api/reviewer/partners', () => {
  it('401 for anonymous — short-circuits before profile read and any DB call', async () => {
    setUnauthenticated();
    const { GET } = await import('@/app/api/reviewer/partners/route');
    const res = await GET();
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'Unauthorized.' });
    expect(profilesSelect).not.toHaveBeenCalled();
    expectNoDbSideEffects();
  });

  it('403 for manager', async () => {
    setAuthRole('manager');
    const { GET } = await import('@/app/api/reviewer/partners/route');
    const res = await GET();
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'Forbidden.' });
    expectNoDbSideEffects();
  });

  it('403 for learner', async () => {
    setAuthRole('learner');
    const { GET } = await import('@/app/api/reviewer/partners/route');
    const res = await GET();
    expect(res.status).toBe(403);
    expectNoDbSideEffects();
  });

  it('403 when profile row is missing (onMissingProfile: forbidden)', async () => {
    setAuthMissingProfile();
    const { GET } = await import('@/app/api/reviewer/partners/route');
    const res = await GET();
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'Forbidden.' });
    expectNoDbSideEffects();
  });

  it('200 for reviewer → { partners: [...] }', async () => {
    setAuthReviewer();
    const { GET } = await import('@/app/api/reviewer/partners/route');
    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { partners: unknown[] };
    expect(body.partners).toEqual([PARTNER_ROW]);
    expect(partnersList).toHaveBeenCalledTimes(1);
  });
});

// ─── POST /api/reviewer/partners ──────────────────────────────────────────────

describe('POST /api/reviewer/partners', () => {
  const url = '/api/reviewer/partners';
  const validBody = {
    name: 'Acme Hospitality Group',
    contact_email: 'ops@acme.test',
    default_commission_rate: 0.2,
  };

  it('401 for anonymous', async () => {
    setUnauthenticated();
    const { POST } = await import('@/app/api/reviewer/partners/route');
    const res = await POST(makeJsonReq(url, 'POST', validBody));
    expect(res.status).toBe(401);
    expectNoDbSideEffects();
  });

  it('403 for manager', async () => {
    setAuthRole('manager');
    const { POST } = await import('@/app/api/reviewer/partners/route');
    const res = await POST(makeJsonReq(url, 'POST', validBody));
    expect(res.status).toBe(403);
    expectNoDbSideEffects();
  });

  it('403 for learner', async () => {
    setAuthRole('learner');
    const { POST } = await import('@/app/api/reviewer/partners/route');
    const res = await POST(makeJsonReq(url, 'POST', validBody));
    expect(res.status).toBe(403);
    expectNoDbSideEffects();
  });

  it('403 when profile row is missing', async () => {
    setAuthMissingProfile();
    const { POST } = await import('@/app/api/reviewer/partners/route');
    const res = await POST(makeJsonReq(url, 'POST', validBody));
    expect(res.status).toBe(403);
    expectNoDbSideEffects();
  });

  it('400 on malformed JSON body (reviewer)', async () => {
    setAuthReviewer();
    const { POST } = await import('@/app/api/reviewer/partners/route');
    const res = await POST(makeJsonReq(url, 'POST', '{ not json', true));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Invalid JSON body.' });
    expect(partnersInsert).not.toHaveBeenCalled();
  });

  it('400 on Zod failure — empty name', async () => {
    setAuthReviewer();
    const { POST } = await import('@/app/api/reviewer/partners/route');
    const res = await POST(makeJsonReq(url, 'POST', { name: '' }));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; details: Record<string, unknown> };
    expect(body.error).toBe('Validation failed.');
    expect(body.details).toHaveProperty('name');
    expect(partnersInsert).not.toHaveBeenCalled();
  });

  it('400 on Zod failure — invalid contact_email', async () => {
    setAuthReviewer();
    const { POST } = await import('@/app/api/reviewer/partners/route');
    const res = await POST(
      makeJsonReq(url, 'POST', { name: 'Acme', contact_email: 'not-an-email' })
    );
    expect(res.status).toBe(400);
    expect(partnersInsert).not.toHaveBeenCalled();
  });

  it('201 for reviewer → inserts exactly the validated fields via the user-scoped client', async () => {
    setAuthReviewer();
    const { POST } = await import('@/app/api/reviewer/partners/route');
    const res = await POST(makeJsonReq(url, 'POST', validBody));
    expect(res.status).toBe(201);
    const body = (await res.json()) as { partner: unknown };
    expect(body.partner).toEqual(PARTNER_ROW);
    expect(partnersInsert).toHaveBeenCalledTimes(1);
    expect(partnersInsert).toHaveBeenCalledWith({
      name: 'Acme Hospitality Group',
      contact_email: 'ops@acme.test',
      default_commission_rate: 0.2,
    });
    // Platform-level writes on partners never touch the service-role client.
    expect(mockServiceFrom).not.toHaveBeenCalled();
  });
});

// ─── PATCH /api/reviewer/partners/[id] ────────────────────────────────────────

describe('PATCH /api/reviewer/partners/[id]', () => {
  const url = `/api/reviewer/partners/${PARTNER_ID}`;
  const ctx = { params: { id: PARTNER_ID } };
  const validBody = { name: 'Renamed', status: 'inactive' };

  it('401 for anonymous', async () => {
    setUnauthenticated();
    const { PATCH } = await import('@/app/api/reviewer/partners/[id]/route');
    const res = await PATCH(makeJsonReq(url, 'PATCH', validBody), ctx);
    expect(res.status).toBe(401);
    expectNoDbSideEffects();
  });

  it('403 for manager', async () => {
    setAuthRole('manager');
    const { PATCH } = await import('@/app/api/reviewer/partners/[id]/route');
    const res = await PATCH(makeJsonReq(url, 'PATCH', validBody), ctx);
    expect(res.status).toBe(403);
    expectNoDbSideEffects();
  });

  it('403 for learner', async () => {
    setAuthRole('learner');
    const { PATCH } = await import('@/app/api/reviewer/partners/[id]/route');
    const res = await PATCH(makeJsonReq(url, 'PATCH', validBody), ctx);
    expect(res.status).toBe(403);
    expectNoDbSideEffects();
  });

  it('403 when profile row is missing', async () => {
    setAuthMissingProfile();
    const { PATCH } = await import('@/app/api/reviewer/partners/[id]/route');
    const res = await PATCH(makeJsonReq(url, 'PATCH', validBody), ctx);
    expect(res.status).toBe(403);
    expectNoDbSideEffects();
  });

  it('400 on malformed JSON body', async () => {
    setAuthReviewer();
    const { PATCH } = await import('@/app/api/reviewer/partners/[id]/route');
    const res = await PATCH(makeJsonReq(url, 'PATCH', '{{{', true), ctx);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Invalid JSON body.' });
    expect(partnersUpdate).not.toHaveBeenCalled();
  });

  it('400 on Zod failure — empty object fails the at-least-one-field refine', async () => {
    setAuthReviewer();
    const { PATCH } = await import('@/app/api/reviewer/partners/[id]/route');
    const res = await PATCH(makeJsonReq(url, 'PATCH', {}), ctx);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('Validation failed.');
    expect(partnersUpdate).not.toHaveBeenCalled();
  });

  it('400 on Zod failure — invalid status enum', async () => {
    setAuthReviewer();
    const { PATCH } = await import('@/app/api/reviewer/partners/[id]/route');
    const res = await PATCH(makeJsonReq(url, 'PATCH', { status: 'archived' }), ctx);
    expect(res.status).toBe(400);
    expect(partnersUpdate).not.toHaveBeenCalled();
  });

  it('200 for reviewer → updates only the provided fields on the right row', async () => {
    setAuthReviewer();
    const { PATCH } = await import('@/app/api/reviewer/partners/[id]/route');
    const res = await PATCH(
      makeJsonReq(url, 'PATCH', {
        name: 'Renamed',
        status: 'inactive',
        default_commission_rate: 0.35,
      }),
      ctx
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { partner: { name: string } };
    expect(body.partner.name).toBe('Renamed');
    expect(partnersUpdate).toHaveBeenCalledTimes(1);
    expect(partnersUpdate).toHaveBeenCalledWith(
      { name: 'Renamed', status: 'inactive', default_commission_rate: 0.35 },
      PARTNER_ID
    );
    expect(mockServiceFrom).not.toHaveBeenCalled();
  });
});

// ─── Role source: server-side profiles re-read, never JWT metadata ────────────

describe('reviewer guard role source (platform-table isolation)', () => {
  it('403 when JWT metadata claims reviewer but the profiles row says learner', async () => {
    // Forged/stale JWT claim must not grant access — role comes from profiles.
    setAuthRole('learner', 'reviewer');
    const { GET } = await import('@/app/api/reviewer/partners/route');
    const res = await GET();
    expect(res.status).toBe(403);
    expect(profilesSelect).toHaveBeenCalledWith('role, departed_at');
    expectNoDbSideEffects();
  });

  it('200 when JWT metadata claims learner but the profiles row says reviewer (profiles wins)', async () => {
    setAuthRole('reviewer', 'learner');
    const { GET } = await import('@/app/api/reviewer/partners/route');
    const res = await GET();
    expect(res.status).toBe(200);
    expect(profilesSelect).toHaveBeenCalledWith('role, departed_at');
    expect(partnersList).toHaveBeenCalledTimes(1);
  });
});
