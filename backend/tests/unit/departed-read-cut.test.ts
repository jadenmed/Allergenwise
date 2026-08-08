/**
 * @vitest-environment node
 */
/**
 * tests/unit/departed-read-cut.test.ts
 *
 * T-46a — THE READ-CUT, proved with real requests through the real route
 * handlers. Not an assertion about a disabled button or a CSS class.
 *
 * The requirement: a departed learner must not keep reading the restaurant's
 * data — colleagues, roster, submission state. Cutting the query is the point.
 * A page that renders greyed-out while still fetching restaurant rows is a
 * data-exposure bug wearing a disabled style, so the assertions here are not
 * only "403" but ALSO "the restaurant-scoped query never ran": every blocked
 * case checks the exact list of tables the route touched.
 *
 * The other half of the requirement is that their OWN records stay readable —
 * certificate downloadable, lesson progress visible but not resumable, exam not
 * takeable. Those routes opt in with `allowDeparted: true` and are asserted to
 * still return 200 with real content.
 *
 * The database-level half of this cut — auth_restaurant_id() returning NULL, so
 * the row-level grant is gone even when no route is involved — is proved
 * against real Postgres in tests/integration/departed-staff-rls.test.ts.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ─── Hoisted mocks ────────────────────────────────────────────────────────────

const { mockGetUser, mockSessionFrom, mockCreateServiceDb } = vi.hoisted(() => ({
  mockGetUser: vi.fn(),
  mockSessionFrom: vi.fn(),
  mockCreateServiceDb: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabase: vi.fn(async () => ({
    auth: { getUser: mockGetUser },
    from: mockSessionFrom,
  })),
  createServiceSupabase: vi.fn(() => mockCreateServiceDb()),
}));

vi.mock('@/lib/db/service', () => ({
  createServiceDb: mockCreateServiceDb,
}));

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const LEARNER_ID = 'a1000000-0000-4000-8000-000000000001';
const MANAGER_ID = 'a1000000-0000-4000-8000-000000000002';
const RESTAURANT_ID = 'b1000000-0000-4000-8000-000000000001';
const LESSON_ID = 'c1000000-0000-4000-8000-000000000001';

const DEPARTED_AT = '2026-08-02T14:30:00.000Z';

/** Every table the service client was asked for, in order. */
let serviceTables: string[] = [];

/** The profile row the guard's re-read returns. */
let profileRow: Record<string, unknown> | null = null;

/** Rows the service client hands back, per table. */
const serviceRows: Record<string, unknown> = {};

function setCaller(role: 'learner' | 'manager', departedAt: string | null) {
  mockGetUser.mockResolvedValue({
    data: { user: { id: role === 'learner' ? LEARNER_ID : MANAGER_ID } },
    error: null,
  });
  profileRow = {
    id: role === 'learner' ? LEARNER_ID : MANAGER_ID,
    role,
    restaurant_id: RESTAURANT_ID,
    full_name: 'Test Person',
    email: 'test@example.test',
    departed_at: departedAt,
  };
}

function makeChain(table: string) {
  const chain: Record<string, unknown> = {};
  for (const method of ['select', 'eq', 'in', 'gt', 'gte', 'lte', 'is', 'or', 'order', 'limit']) {
    chain[method] = () => chain;
  }
  const rows = serviceRows[table] ?? [];
  const first = Array.isArray(rows) ? (rows[0] ?? null) : rows;
  // The guard's own profile re-read is the only `.single()` on `profiles`;
  // the roster list arrives through the thenable below. Keeping them apart is
  // what lets a test assert "the guard ran, the roster query did not".
  const singleRow = table === 'profiles' ? profileRow : first;
  chain.single = async () => ({ data: singleRow, error: null });
  chain.maybeSingle = async () => ({ data: singleRow, error: null });
  chain.insert = async () => ({ data: null, error: null });
  chain.update = () => chain;
  chain.upsert = async () => ({ data: null, error: null });
  chain.then = (onF: (v: unknown) => unknown) =>
    Promise.resolve({ data: rows, error: null, count: Array.isArray(rows) ? rows.length : 0 }).then(
      onF
    );
  return chain;
}

beforeEach(() => {
  vi.clearAllMocks();
  serviceTables = [];
  for (const key of Object.keys(serviceRows)) delete serviceRows[key];

  mockSessionFrom.mockImplementation((table: string) => {
    if (table === 'profiles') {
      return {
        select: () => ({ eq: () => ({ single: async () => ({ data: profileRow, error: null }) }) }),
      };
    }
    return makeChain(table);
  });

  mockCreateServiceDb.mockImplementation(() => ({
    from: (table: string) => {
      serviceTables.push(table);
      return makeChain(table);
    },
    storage: {
      from: () => ({
        createSignedUrl: async () => ({
          data: { signedUrl: 'https://example.test/cert.pdf' },
          error: null,
        }),
      }),
    },
  }));
});

function req(path: string, body?: unknown): NextRequest {
  return new NextRequest(new URL(path, 'http://localhost:3000'), {
    method: body === undefined ? 'GET' : 'POST',
    ...(body === undefined
      ? {}
      : { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }),
  });
}

// ─── Restaurant-scoped reads are CUT ──────────────────────────────────────────

describe('a departed manager cannot read the restaurant', () => {
  it('GET /api/admin/roster — 403, and the roster query never runs', async () => {
    setCaller('manager', DEPARTED_AT);
    const { GET } = await import('@/app/api/admin/roster/route');

    const res = await GET();

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({
      error: 'This account is no longer active staff at this restaurant.',
    });
    // The guard's own profile re-read is the ONLY table touched: no roster
    // read, no lesson_progress, no activity_events, no certificates.
    expect(serviceTables).toEqual(['profiles']);
  });

  it('GET /api/admin/dashboard-stats — 403, and no restaurant query runs', async () => {
    setCaller('manager', DEPARTED_AT);
    const { GET } = await import('@/app/api/admin/dashboard-stats/route');

    const res = await GET();

    expect(res.status).toBe(403);
    expect(serviceTables).toEqual(['profiles']);
  });

  it('GET /api/submissions/status — 403, submission state is not disclosed', async () => {
    setCaller('manager', DEPARTED_AT);
    const { GET } = await import('@/app/api/submissions/status/route');

    const res = await GET(req('/api/submissions/status?session_id=cs_test_abc123'));

    expect(res.status).toBe(403);
    expect(serviceTables).toEqual(['profiles']);
    expect(serviceTables).not.toContain('submissions');
  });
});

describe('a departed learner cannot resume the course or sit the exam', () => {
  it('POST /api/exam/start — 403, the exam is not takeable', async () => {
    setCaller('learner', DEPARTED_AT);
    const { POST } = await import('@/app/api/exam/start/route');

    const res = await POST(req('/api/exam/start', {}));

    expect(res.status).toBe(403);
    expect(serviceTables, 'no modules, lessons or exam_attempts read').toEqual(['profiles']);
  });

  it('POST /api/lesson/progress — 403, progress is visible but not resumable', async () => {
    setCaller('learner', DEPARTED_AT);
    const { POST } = await import('@/app/api/lesson/progress/route');

    const res = await POST(
      req('/api/lesson/progress', { lessonId: LESSON_ID, watchedSeconds: 30 })
    );

    expect(res.status).toBe(403);
    expect(serviceTables, 'nothing written to lesson_progress').toEqual([]);
  });

  it('GET /api/lesson/[lessonId] — 403, lesson content is not served', async () => {
    setCaller('learner', DEPARTED_AT);
    const { GET } = await import('@/app/api/lesson/[lessonId]/route');

    const res = await GET(req(`/api/lesson/${LESSON_ID}`), { params: { lessonId: LESSON_ID } });

    expect(res.status).toBe(403);
    expect(serviceTables).toEqual([]);
  });
});

// ─── Their own records stay readable ──────────────────────────────────────────

describe("a departed learner's own records are still theirs", () => {
  it('GET /api/learner/certificate — 200, the certificate is still downloadable', async () => {
    setCaller('learner', DEPARTED_AT);
    serviceRows.certificates = [
      {
        cert_code: 'AW-TEST-0001',
        issued_at: '2026-05-01T00:00:00.000Z',
        expires_at: '2027-05-01T00:00:00.000Z',
        pdf_storage_path: `${RESTAURANT_ID}/AW-TEST-0001.pdf`,
        restaurant_id: RESTAURANT_ID,
      },
    ];
    serviceRows.restaurants = [{ name: "Bella's Kitchen" }];

    const { GET } = await import('@/app/api/learner/certificate/route');
    const res = await GET(req('/api/learner/certificate'));
    const body = (await res.json()) as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(body.certCode).toBe('AW-TEST-0001');
    expect(body.pdfUrl, 'a signed URL, not a disabled button').toBe(
      'https://example.test/cert.pdf'
    );
    expect(body.restaurantName, 'the restaurant printed on their own credential').toBe(
      "Bella's Kitchen"
    );
  });

  it('GET /api/learner/home-data — 200, lesson progress is still visible', async () => {
    setCaller('learner', DEPARTED_AT);
    serviceRows.modules = [
      { id: 'm1', order_index: 1, title: 'Allergens 101', description: '', estimated_minutes: 10 },
    ];
    serviceRows.lessons = [
      {
        id: LESSON_ID,
        module_id: 'm1',
        order_index: 1,
        title: 'Intro',
        video_duration_seconds: 60,
      },
    ];
    serviceRows.lesson_progress = [
      { lesson_id: LESSON_ID, status: 'complete', watched_seconds: 60 },
    ];

    const { GET } = await import('@/app/api/learner/home-data/route');
    const res = await GET(req('/api/learner/home-data'));
    const body = (await res.json()) as { modules: Array<{ lessons: Array<{ status: string }> }> };

    expect(res.status).toBe(200);
    expect(body.modules[0].lessons[0].status, 'their own progress, still readable').toBe(
      'complete'
    );
  });
});

// ─── The control: the cut is membership, not a blanket break ──────────────────

describe('current staff are unaffected', () => {
  it('GET /api/admin/roster — a CURRENT manager still reads the roster', async () => {
    setCaller('manager', null);
    serviceRows.profiles = [
      {
        id: LEARNER_ID,
        full_name: 'Current Learner',
        email: 'learner@example.test',
        job_role: 'server',
        invited_at: null,
        accepted_at: '2026-06-01T00:00:00.000Z',
        created_at: '2026-06-01T00:00:00.000Z',
      },
    ];

    const { GET } = await import('@/app/api/admin/roster/route');
    const res = await GET();

    expect(res.status).toBe(200);
    expect(serviceTables, 'the roster query DID run this time').toContain('lesson_progress');
  });

  it('POST /api/exam/start — a CURRENT learner passes the membership guard', async () => {
    setCaller('learner', null);
    const { POST } = await import('@/app/api/exam/start/route');

    const res = await POST(req('/api/exam/start', {}));
    const body = (await res.json()) as { error?: string };

    // With no curriculum seeded the route refuses on its OWN grounds (modules
    // not complete). That is the point: the membership guard let it through to
    // its own logic, so the refusal is a different refusal.
    expect(body.error).not.toBe('This account is no longer active staff at this restaurant.');
    expect(serviceTables, 'the route reached its own queries').toContain('modules');
  });
});
