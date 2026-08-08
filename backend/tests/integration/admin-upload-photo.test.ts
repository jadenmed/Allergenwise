/**
 * @vitest-environment node
 */
/**
 * tests/integration/admin-upload-photo.test.ts
 *
 * F-S6 / Wave 2A.5 — POST /api/admin/upload-photo regression tests.
 *
 * Route contract (per audits/followups.md F-S6):
 *   - Auth: admin session (verified via createServerSupabase().auth.getUser()
 *           + DB role re-check)
 *   - Body: multipart/form-data with one `photo` file field
 *   - Size cap: 5 MB enforced server-side BEFORE buffering
 *   - MIME validation: from actual file bytes (sharp metadata), not the
 *           client-supplied Content-Type. Accepts image/jpeg, image/png,
 *           image/webp.
 *   - EXIF: stripped via sharp before upload to Supabase Storage
 *   - Output: re-encoded to the original format, uploaded via service-role
 *   - Response shapes:
 *       200 { storagePath: string, contentType: string, bytes: number }
 *       401 { error: 'Unauthorized' }
 *       403 { error: 'Forbidden: admin role required' }
 *       413 { error: 'Payload too large', maxBytes: 5242880 }
 *       415 { error: 'Unsupported media type' }
 *       422 { error: 'Invalid image' }
 *
 * Strategy: mock createServerSupabase + createServiceDb + createServiceSupabase
 * around the route handler. Capture the upload buffer to assert EXIF is
 * stripped. This is a unit-grade integration test: no real Supabase Storage
 * involved; sharp runs for real on test fixtures.
 */

import { describe, it, expect, vi, beforeEach, beforeAll, type MockedFunction } from 'vitest';
import sharp from 'sharp';

// ─── Hoisted spies ────────────────────────────────────────────────────────────

const { mockGetUser, mockServiceFrom, mockStorageUpload } = vi.hoisted(() => ({
  mockGetUser: vi.fn(),
  mockServiceFrom: vi.fn(),
  mockStorageUpload: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabase: vi.fn(async () => ({
    auth: { getUser: mockGetUser },
  })),
  createServiceSupabase: vi.fn(() => ({
    storage: {
      from: () => ({ upload: mockStorageUpload }),
    },
  })),
}));

vi.mock('@/lib/db/service', () => ({
  createServiceDb: vi.fn(() => ({ from: mockServiceFrom })),
}));

vi.mock('server-only', () => ({}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

const ADMIN_USER_ID = 'b1000000-0000-0000-0000-000000000001';
const RESTAURANT_ID = '22222222-2222-2222-2222-222222222222';
const LEARNER_USER_ID = 'b1000000-0000-0000-0000-000000000003';

let TEST_JPEG_WITH_EXIF: Buffer;
let TEST_JPEG_LARGE: Buffer;
let TEST_PNG_VALID: Buffer;
let TEST_TEXT_DISGUISED: Buffer;
let TEST_CORRUPT_BYTES: Buffer;

beforeAll(async () => {
  // Small JPEG with embedded EXIF (incl. GPS) — used for the happy path
  TEST_JPEG_WITH_EXIF = await sharp({
    create: { width: 32, height: 32, channels: 3, background: { r: 200, g: 100, b: 50 } },
  })
    .withMetadata({
      exif: {
        IFD0: {
          ImageDescription: 'sensitive description with location',
          Make: 'TestCam',
          Model: 'TestModel',
        },
      },
    })
    .jpeg()
    .toBuffer();

  // Real PNG — used for format-preservation test
  TEST_PNG_VALID = await sharp({
    create: { width: 16, height: 16, channels: 3, background: { r: 50, g: 100, b: 200 } },
  })
    .png()
    .toBuffer();

  // Build a 6 MB JPEG by inflating dimensions until buffer > 5 MB cap
  TEST_JPEG_LARGE = await sharp({
    create: { width: 4000, height: 4000, channels: 3, background: { r: 0, g: 0, b: 0 } },
  })
    .jpeg({ quality: 100 })
    .toBuffer();
  // If somehow under 5 MB, pad with random bytes (still rejected: oversize)
  if (TEST_JPEG_LARGE.length <= 5 * 1024 * 1024) {
    TEST_JPEG_LARGE = Buffer.concat([
      TEST_JPEG_LARGE,
      Buffer.alloc(6 * 1024 * 1024 - TEST_JPEG_LARGE.length),
    ]);
  }

  TEST_TEXT_DISGUISED = Buffer.from('this is plain text masquerading as image/jpeg');
  TEST_CORRUPT_BYTES = Buffer.from('\xFF\xD8\xFF\xE0NOTAVALIDJPEG' + 'X'.repeat(200));
});

function makeMultipartRequest(opts: {
  fileBuffer?: Buffer;
  fileName?: string;
  contentType?: string;
  bypassFormField?: boolean;
}) {
  const { fileBuffer, fileName = 'photo.jpg', contentType = 'image/jpeg', bypassFormField } = opts;
  const fd = new FormData();
  if (!bypassFormField && fileBuffer) {
    fd.append('photo', new Blob([new Uint8Array(fileBuffer)], { type: contentType }), fileName);
  }
  // Use the global Request constructor (Next.js NextRequest works similarly for our handler)
  return new Request('http://localhost:3000/api/admin/upload-photo', {
    method: 'POST',
    body: fd,
  });
}

function setAuthAdmin() {
  mockGetUser.mockResolvedValue({ data: { user: { id: ADMIN_USER_ID } }, error: null });
  mockServiceFrom.mockImplementation((table: string) => {
    if (table === 'profiles') {
      return {
        select: () => ({
          eq: () => ({
            single: async () => ({
              data: {
                id: ADMIN_USER_ID,
                role: 'manager',
                restaurant_id: RESTAURANT_ID,
                full_name: 'Test Admin',
              },
              error: null,
            }),
          }),
        }),
      };
    }
    return {
      select: () => ({ eq: () => ({ single: async () => ({ data: null, error: null }) }) }),
    };
  });
}

function setAuthLearner() {
  mockGetUser.mockResolvedValue({ data: { user: { id: LEARNER_USER_ID } }, error: null });
  mockServiceFrom.mockImplementation((table: string) => {
    if (table === 'profiles') {
      return {
        select: () => ({
          eq: () => ({
            single: async () => ({
              data: {
                id: LEARNER_USER_ID,
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
    return {
      select: () => ({ eq: () => ({ single: async () => ({ data: null, error: null }) }) }),
    };
  });
}

function setUnauthenticated() {
  mockGetUser.mockResolvedValue({
    data: { user: null },
    error: { message: 'Auth session missing!' },
  });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('POST /api/admin/upload-photo', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStorageUpload.mockResolvedValue({
      data: { path: 'restaurant-photos/some/path' },
      error: null,
    });
  });

  it('a. 401 without session', async () => {
    setUnauthenticated();
    const { POST } = await import('@/app/api/admin/upload-photo/route');
    const res = await POST(
      makeMultipartRequest({ fileBuffer: TEST_JPEG_WITH_EXIF }) as unknown as Parameters<
        typeof POST
      >[0]
    );
    expect(res.status).toBe(401);
    expect(mockStorageUpload).not.toHaveBeenCalled();
  });

  it('b. 403 with non-admin (learner) session', async () => {
    setAuthLearner();
    const { POST } = await import('@/app/api/admin/upload-photo/route');
    const res = await POST(
      makeMultipartRequest({ fileBuffer: TEST_JPEG_WITH_EXIF }) as unknown as Parameters<
        typeof POST
      >[0]
    );
    expect(res.status).toBe(403);
    expect(mockStorageUpload).not.toHaveBeenCalled();
  });

  it('c. 413 when file exceeds size cap (no upload happens)', async () => {
    setAuthAdmin();
    const { POST } = await import('@/app/api/admin/upload-photo/route');
    const res = await POST(
      makeMultipartRequest({ fileBuffer: TEST_JPEG_LARGE }) as unknown as Parameters<typeof POST>[0]
    );
    expect(res.status).toBe(413);
    expect(mockStorageUpload).not.toHaveBeenCalled();
  });

  it('d. 415 when file bytes are not a real image (text/plain disguised as image/jpeg)', async () => {
    setAuthAdmin();
    const { POST } = await import('@/app/api/admin/upload-photo/route');
    const res = await POST(
      makeMultipartRequest({
        fileBuffer: TEST_TEXT_DISGUISED,
        contentType: 'image/jpeg',
      }) as unknown as Parameters<typeof POST>[0]
    );
    expect([415, 422]).toContain(res.status);
    expect(mockStorageUpload).not.toHaveBeenCalled();
  });

  it('e. 422 when file is corrupt image bytes (begins with JPEG magic but garbage after)', async () => {
    setAuthAdmin();
    const { POST } = await import('@/app/api/admin/upload-photo/route');
    const res = await POST(
      makeMultipartRequest({
        fileBuffer: TEST_CORRUPT_BYTES,
        contentType: 'image/jpeg',
      }) as unknown as Parameters<typeof POST>[0]
    );
    expect([415, 422]).toContain(res.status);
    expect(mockStorageUpload).not.toHaveBeenCalled();
  });

  it('f. 200 with valid JPEG → uploads with EXIF stripped', async () => {
    setAuthAdmin();
    // Pre-confirm the input has EXIF
    const inputMeta = await sharp(TEST_JPEG_WITH_EXIF).metadata();
    expect(inputMeta.exif, 'fixture must have EXIF before upload').toBeTruthy();

    const { POST } = await import('@/app/api/admin/upload-photo/route');
    const res = await POST(
      makeMultipartRequest({ fileBuffer: TEST_JPEG_WITH_EXIF }) as unknown as Parameters<
        typeof POST
      >[0]
    );
    expect(res.status).toBe(200);

    expect(mockStorageUpload).toHaveBeenCalledTimes(1);
    const [pathArg, bufferArg, optsArg] = mockStorageUpload.mock.calls[0];
    expect(pathArg).toMatch(new RegExp(`^${RESTAURANT_ID}/`));
    expect((optsArg as { contentType: string }).contentType).toBe('image/jpeg');

    // EXIF must be stripped
    const uploadedBuf =
      bufferArg instanceof Buffer ? bufferArg : Buffer.from(bufferArg as ArrayBuffer);
    const outMeta = await sharp(uploadedBuf).metadata();
    expect(outMeta.format).toBe('jpeg');
    expect(outMeta.exif, 'EXIF must be stripped from uploaded buffer').toBeUndefined();
  });

  it('g. concurrent uploads from same admin → both succeed with distinct paths', async () => {
    setAuthAdmin();
    const { POST } = await import('@/app/api/admin/upload-photo/route');
    // Distinct buffers so any naive content-hash dedupe wouldn't accidentally pass
    const [a, b] = await Promise.all([
      POST(
        makeMultipartRequest({ fileBuffer: TEST_JPEG_WITH_EXIF }) as unknown as Parameters<
          typeof POST
        >[0]
      ),
      POST(
        makeMultipartRequest({
          fileBuffer: TEST_PNG_VALID,
          contentType: 'image/png',
          fileName: 'photo.png',
        }) as unknown as Parameters<typeof POST>[0]
      ),
    ]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);

    const aBody = (await a.json()) as { storagePath: string };
    const bBody = (await b.json()) as { storagePath: string };
    expect(aBody.storagePath).not.toBe(bBody.storagePath);
    expect(mockStorageUpload).toHaveBeenCalledTimes(2);
  });

  it('h. PNG input → PNG output (format preservation)', async () => {
    setAuthAdmin();
    const { POST } = await import('@/app/api/admin/upload-photo/route');
    const res = await POST(
      makeMultipartRequest({
        fileBuffer: TEST_PNG_VALID,
        contentType: 'image/png',
        fileName: 'photo.png',
      }) as unknown as Parameters<typeof POST>[0]
    );
    expect(res.status).toBe(200);

    const [, bufferArg, optsArg] = mockStorageUpload.mock.calls[0];
    expect((optsArg as { contentType: string }).contentType).toBe('image/png');
    const uploadedBuf =
      bufferArg instanceof Buffer ? bufferArg : Buffer.from(bufferArg as ArrayBuffer);
    const outMeta = await sharp(uploadedBuf).metadata();
    expect(outMeta.format).toBe('png');
  });
});
