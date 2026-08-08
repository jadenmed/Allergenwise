/**
 * @vitest-environment node
 */
/**
 * tests/integration/csv-upload-prebuffer-cap.test.ts
 *
 * Wave 5A — P1-10 regression tests.
 *
 * Audit finding: `app/api/admin/csv-upload/route.ts` previously buffered the
 * entire request body into a string before any size validation. That made the
 * route trivially DoS-able by an authenticated admin or a credential-leak
 * attacker — a multi-gigabyte CSV would exhaust memory before any check ran.
 *
 * Three-layer defense expected (matches the upload-photo pattern):
 *   1. Pre-buffer Content-Length reject  → 413 before formData() runs
 *   2. File.size cap after formData()    → 413 covers missing/lying CL header
 *   3. UTF-8 byte cap after .text()      → 413 covers multibyte expansion
 *
 * Limit: 10 MB (MAX_CSV_BYTES). Pre-buffer guard adds 64 KB envelope slack so
 * a multipart wrapper around a 10 MB file doesn't false-413.
 *
 * Notes on the user-facing prompt vs. this test file:
 *   The original task prompt for P1-10 described CSV export streaming, but
 *   the only CSV route in the repo is the upload (audit P1-10 unambiguously
 *   names this route + lines). This test exercises the actual fix.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockGetUser, mockServiceFrom } = vi.hoisted(() => ({
  mockGetUser: vi.fn(),
  mockServiceFrom: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabase: vi.fn(async () => ({
    auth: { getUser: mockGetUser },
  })),
}));

vi.mock('@/lib/db/service', () => ({
  createServiceDb: vi.fn(() => ({ from: mockServiceFrom })),
}));

vi.mock('@/lib/email/client', () => ({
  resend: { emails: { send: vi.fn(async () => ({ data: null, error: null })) } },
  FROM_EMAIL: 'noreply@example.test',
}));

vi.mock('@/lib/email/templates/EmployeeInvite', () => ({
  EmployeeInvite: () => null,
  SUBJECT_EMPLOYEE_INVITE: 'invite',
}));

vi.mock('server-only', () => ({}));

const ADMIN_ID = 'b1000000-0000-0000-0000-000000000001';
const RESTAURANT_ID = '22222222-2222-2222-2222-222222222222';
const LEARNER_ID = 'b1000000-0000-0000-0000-000000000003';

function setAuthAdmin() {
  mockGetUser.mockResolvedValue({ data: { user: { id: ADMIN_ID } }, error: null });
  mockServiceFrom.mockImplementation((table: string) => {
    if (table === 'profiles') {
      return {
        select: (cols: string) => {
          if (cols.includes('role')) {
            // verifyAdmin path
            return {
              eq: () => ({
                single: async () => ({
                  data: {
                    id: ADMIN_ID,
                    role: 'manager',
                    restaurant_id: RESTAURANT_ID,
                    full_name: 'Test Admin',
                  },
                  error: null,
                }),
              }),
            };
          }
          // existing-emails path
          return { eq: async () => ({ data: [], error: null }) };
        },
      };
    }
    if (table === 'csv_upload_drafts') {
      return {
        insert: () => ({
          select: () => ({
            single: async () => ({
              data: { id: '00000000-0000-0000-0000-000000000099' },
              error: null,
            }),
          }),
        }),
      };
    }
    return { select: () => ({ eq: async () => ({ data: [], error: null }) }) };
  });
}

function setAuthLearner() {
  mockGetUser.mockResolvedValue({ data: { user: { id: LEARNER_ID } }, error: null });
  mockServiceFrom.mockImplementation((table: string) => {
    if (table === 'profiles') {
      return {
        select: () => ({
          eq: () => ({
            single: async () => ({
              data: {
                id: LEARNER_ID,
                role: 'learner',
                restaurant_id: RESTAURANT_ID,
                full_name: 'Test Learner',
              },
              error: null,
            }),
          }),
        }),
      };
    }
    return { select: () => ({ eq: async () => ({ data: [], error: null }) }) };
  });
}

function setUnauthenticated() {
  mockGetUser.mockResolvedValue({ data: { user: null }, error: { message: 'missing' } });
}

function makeMultipartRequest(opts: {
  fileBytes?: Uint8Array;
  fileName?: string;
  overrideContentLength?: string;
  omitFile?: boolean;
}) {
  const { fileBytes, fileName = 'invites.csv', overrideContentLength, omitFile } = opts;
  const fd = new FormData();
  if (!omitFile && fileBytes) {
    fd.append('file', new Blob([new Uint8Array(fileBytes)], { type: 'text/csv' }), fileName);
  }
  const headers: Record<string, string> = {};
  if (overrideContentLength !== undefined) {
    headers['content-length'] = overrideContentLength;
  }
  return new Request('http://localhost:3000/api/admin/csv-upload', {
    method: 'POST',
    body: fd,
    headers,
  });
}

function tinyValidCsv(): Uint8Array {
  const body = 'email,fullName,jobRole\nuser1@example.com,User One,Server\n';
  return new TextEncoder().encode(body);
}

describe('POST /api/admin/csv-upload — P1-10 pre-buffer DoS cap', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('a. 401 without session (before any size work)', async () => {
    setUnauthenticated();
    const { POST } = await import('@/app/api/admin/csv-upload/route');
    const res = await POST(
      makeMultipartRequest({ fileBytes: tinyValidCsv() }) as unknown as Parameters<typeof POST>[0]
    );
    expect(res.status).toBe(401);
  });

  it('b. 403 for non-admin role (before any size work)', async () => {
    setAuthLearner();
    const { POST } = await import('@/app/api/admin/csv-upload/route');
    const res = await POST(
      makeMultipartRequest({ fileBytes: tinyValidCsv() }) as unknown as Parameters<typeof POST>[0]
    );
    expect(res.status).toBe(403);
  });

  it('c. 413 fast-path: Content-Length over cap rejects before formData()', async () => {
    setAuthAdmin();
    const { POST } = await import('@/app/api/admin/csv-upload/route');
    // Lie about Content-Length: claim 50 MB. A real attacker would back this
    // with an actual oversized stream; the test confirms the cheap header
    // pre-check fires without us having to allocate 50 MB in memory.
    const res = await POST(
      makeMultipartRequest({
        fileBytes: tinyValidCsv(),
        overrideContentLength: String(50 * 1024 * 1024),
      }) as unknown as Parameters<typeof POST>[0]
    );
    expect(res.status).toBe(413);
    const body = (await res.json()) as { error: string; maxBytes: number };
    expect(body.error).toMatch(/payload too large/i);
    expect(body.maxBytes).toBe(10 * 1024 * 1024);
  });

  it('d. 413 second-layer: oversize File.size with no Content-Length still rejects', async () => {
    setAuthAdmin();
    const { POST } = await import('@/app/api/admin/csv-upload/route');
    // 11 MB of dummy CSV bytes. With FormData under Node 20, the Request
    // computes its own Content-Length; we don't override it here, so the
    // pre-buffer header check sees the real (oversize) length OR the File
    // entry check fires second. Either branch must produce 413; we assert
    // the status without prescribing which layer caught it.
    const oversized = new Uint8Array(11 * 1024 * 1024);
    oversized.set(new TextEncoder().encode('email,fullName,jobRole\n'));
    const res = await POST(
      makeMultipartRequest({ fileBytes: oversized }) as unknown as Parameters<typeof POST>[0]
    );
    expect(res.status).toBe(413);
  });

  it('e. 200 for a small valid CSV (regression — guards must not false-413 on normal use)', async () => {
    setAuthAdmin();
    const { POST } = await import('@/app/api/admin/csv-upload/route');
    const res = await POST(
      makeMultipartRequest({ fileBytes: tinyValidCsv() }) as unknown as Parameters<typeof POST>[0]
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { validRows: unknown[] };
    expect(body.validRows.length).toBe(1);
  });

  it('f. 400 for missing file field (still works after the guards)', async () => {
    setAuthAdmin();
    const { POST } = await import('@/app/api/admin/csv-upload/route');
    const res = await POST(
      makeMultipartRequest({ omitFile: true }) as unknown as Parameters<typeof POST>[0]
    );
    expect(res.status).toBe(400);
  });
});
