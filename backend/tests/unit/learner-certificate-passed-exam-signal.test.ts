/**
 * tests/unit/learner-certificate-passed-exam-signal.test.ts
 *
 * GET /api/learner/certificate's 404 body includes `hasPassedExam`, which
 * /learner/certificate uses to tell a learner their certificate is being
 * finalized rather than "go take the exam". Since T-03 a pass always
 * inserts a certificate, but it lands `pending` and this route returns
 * active certs only — so the 404-with-hasPassedExam state is now the normal
 * one immediately after passing, not a free-mode artifact.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const { mockRequireRole, mockServiceFrom } = vi.hoisted(() => ({
  mockRequireRole: vi.fn(),
  mockServiceFrom: vi.fn(),
}));

vi.mock('server-only', () => ({}));

vi.mock('@/lib/auth/require-role', () => ({
  requireRole: mockRequireRole,
}));

vi.mock('@/lib/db/service', () => ({
  createServiceDb: vi.fn(() => ({ from: mockServiceFrom, storage: { from: vi.fn() } })),
}));

const USER_ID = '11111111-1111-1111-1111-111111111111';

function chain(result: unknown) {
  const c: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'order', 'limit']) c[m] = vi.fn(() => c);
  c.single = vi.fn(async () => result);
  c.maybeSingle = vi.fn(async () => result);
  return c;
}

function makeRequest() {
  return new NextRequest('http://localhost:3000/api/learner/certificate');
}

describe('GET /api/learner/certificate — hasPassedExam signal on 404', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireRole.mockResolvedValue({
      user: { id: USER_ID },
      profile: { id: USER_ID, role: 'learner', full_name: 'Jane Learner' },
    });
  });

  it('hasPassedExam: true when a passed exam_attempts row exists but no active cert', async () => {
    mockServiceFrom.mockImplementation((table: string) => {
      if (table === 'certificates') return chain({ data: null, error: null });
      if (table === 'exam_attempts') return chain({ data: { id: 'attempt-1' }, error: null });
      return chain({ data: null, error: null });
    });

    const { GET } = await import('@/app/api/learner/certificate/route');
    const res = await GET(makeRequest());
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.hasPassedExam).toBe(true);
  });

  it('hasPassedExam: false when the learner has never passed', async () => {
    mockServiceFrom.mockImplementation((table: string) => {
      if (table === 'certificates') return chain({ data: null, error: null });
      if (table === 'exam_attempts') return chain({ data: null, error: null });
      return chain({ data: null, error: null });
    });

    const { GET } = await import('@/app/api/learner/certificate/route');
    const res = await GET(makeRequest());
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.hasPassedExam).toBe(false);
  });

  it('200 success shape is unchanged when an active cert exists', async () => {
    mockServiceFrom.mockImplementation((table: string) => {
      if (table === 'certificates') {
        return chain({
          data: {
            cert_code: 'AW-7K4M9-3XPQR-A',
            issued_at: '2026-01-01T00:00:00Z',
            expires_at: '2028-01-01T00:00:00Z',
            pdf_storage_path: null,
            restaurant_id: 'rest-1',
          },
          error: null,
        });
      }
      if (table === 'restaurants') return chain({ data: { name: 'Test Bistro' }, error: null });
      return chain({ data: null, error: null });
    });

    const { GET } = await import('@/app/api/learner/certificate/route');
    const res = await GET(makeRequest());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.certCode).toBe('AW-7K4M9-3XPQR-A');
    expect(body.hasPassedExam).toBeUndefined();
  });
});
