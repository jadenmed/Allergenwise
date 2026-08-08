/**
 * tests/unit/exam-submit-pending-cert.test.ts
 *
 * Wave 2C — exam pass creates the cert in `status='pending'` with no
 * payment metadata. PDF generation is deferred to the webhook activation
 * (OQ-1 approved: generate at activation time).
 *
 * Asserts:
 *   1. The certificates INSERT carries status='pending'.
 *   2. fee_charged_cents and stripe_payment_intent_id are NOT set at exam-pass.
 *   3. No fetch to /api/certs/generate fires from this route any more.
 *   4. The activity event written is `cert_issued` (per design (g)
 *      "cert_issued (existing — repurposed): pending insertion").
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ─── Hoisted spies ────────────────────────────────────────────────────────────

const { mockGetUser, mockServerFrom, mockServiceFrom, capturedInserts } = vi.hoisted(() => ({
  mockGetUser: vi.fn(),
  mockServerFrom: vi.fn(),
  mockServiceFrom: vi.fn(),
  capturedInserts: [] as Array<{ table: string; row: Record<string, unknown> }>,
}));

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabase: vi.fn(async () => ({
    auth: { getUser: mockGetUser },
    from: mockServerFrom,
  })),
}));

vi.mock('@/lib/db/service', () => ({
  createServiceDb: vi.fn(() => ({
    from: mockServiceFrom,
  })),
}));

vi.mock('server-only', () => ({}));

vi.mock('@/lib/email/client', () => ({
  resend: { emails: { send: vi.fn().mockResolvedValue({ id: 'mock-email' }) } },
  FROM_EMAIL: 'hello@allergenwise.com',
}));

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const USER_ID = '11111111-1111-1111-1111-111111111111';
const RESTAURANT_ID = '22222222-2222-2222-2222-222222222222';
const ATTEMPT_ID = '33333333-3333-3333-3333-333333333333';
const NEW_CERT_ID = '44444444-4444-4444-4444-444444444444';

/**
 * `listResult` is what awaiting the builder resolves to, where `result` is what
 * `.single()` returns. T-49's duplicate-issuance guard reads a LIST of this
 * learner's blocking certificates, so that read must resolve to an array while
 * the cert insert's `.single()` keeps resolving to a row. Defaults to `result`
 * so every other table behaves exactly as before.
 */
function chain(table: string, result: unknown, listResult: unknown = result) {
  const c: Record<string, unknown> = {};
  const passthrough = ['select', 'eq', 'in', 'like', 'order', 'limit', 'update'];
  for (const m of passthrough) c[m] = vi.fn(() => c);
  c.insert = vi.fn((row: Record<string, unknown>) => {
    capturedInserts.push({ table, row });
    return c;
  });
  c.single = vi.fn(async () => result);
  c.maybeSingle = vi.fn(async () => result);
  c.then = (onF: (v: unknown) => unknown) => Promise.resolve(listResult).then(onF);
  c.catch = (onR: (e: unknown) => unknown) => Promise.resolve(listResult).catch(onR);
  return c;
}

function answersForAllCorrect(): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < 25; i++) {
    const hex = String(i).padStart(2, '0');
    out[`aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa${hex}`] = 'opt-correct';
  }
  return out;
}

function questionRows() {
  // Shared bank (0018): submit loads question_choices, not inline options.
  return Object.keys(answersForAllCorrect()).map((id) => ({
    id,
    question_choices: [
      { id: 'opt-correct', text: 'A', is_correct: true },
      { id: 'opt-wrong', text: 'B', is_correct: false },
    ],
  }));
}

function makeRequest(body: object) {
  return new NextRequest('http://localhost:3000/api/exam/submit', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

// ─── Test ─────────────────────────────────────────────────────────────────────

describe('POST /api/exam/submit — Wave 2C pending cert', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let fetchSpy: any;

  beforeEach(() => {
    vi.clearAllMocks();
    capturedInserts.length = 0;
    process.env.CRON_SECRET = 'test-cron-secret-abc';
    process.env.APP_URL = 'http://localhost:3000';

    mockGetUser.mockResolvedValue({ data: { user: { id: USER_ID } }, error: null });

    mockServerFrom.mockImplementation((table: string) => {
      if (table === 'profiles') {
        return chain('profiles', {
          data: { id: USER_ID, role: 'learner', restaurant_id: RESTAURANT_ID, departed_at: null },
          error: null,
        });
      }
      return chain(table, { data: null, error: null });
    });

    const startedAt = new Date(Date.now() - 60_000).toISOString();
    mockServiceFrom.mockImplementation((table: string) => {
      if (table === 'profiles') {
        return chain('profiles', {
          data: { id: USER_ID, role: 'learner', restaurant_id: RESTAURANT_ID, departed_at: null },
          error: null,
        });
      }
      if (table === 'exam_attempts') {
        return chain('exam_attempts', {
          data: {
            id: ATTEMPT_ID,
            profile_id: USER_ID,
            started_at: startedAt,
            submitted_at: null,
            time_limit_seconds: 1800,
            passed: null,
            score_percent: null,
          },
          error: null,
        });
      }
      if (table === 'questions') {
        return chain('questions', { data: questionRows(), error: null });
      }
      if (table === 'certificates') {
        // The empty list is the T-49 guard read: this learner holds no blocking
        // certificate. Every case here is about a learner earning their first.
        return chain(
          'certificates',
          { data: { id: NEW_CERT_ID }, error: null, count: 0 },
          { data: [], error: null }
        );
      }
      if (table === 'activity_events') {
        return chain('activity_events', { data: null, error: null });
      }
      return chain(table, { data: null, error: null });
    });

    fetchSpy = vi
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
  });

  it('inserts cert with status=pending and no payment metadata', async () => {
    const { POST } = await import('@/app/api/exam/submit/route');

    const res = await POST(makeRequest({ attemptId: ATTEMPT_ID, answers: answersForAllCorrect() }));
    expect(res.status).toBe(200);

    const certInsert = capturedInserts.find((c) => c.table === 'certificates');
    expect(certInsert, 'a certificates row should be inserted').toBeDefined();

    const row = certInsert!.row as Record<string, unknown>;
    expect(row.status, 'cert must be inserted as pending').toBe('pending');
    expect(row.fee_charged_cents ?? null, 'fee_charged_cents must be null at exam-pass').toBeNull();
    expect(row.stripe_payment_intent_id ?? null, 'PI id must be null at exam-pass').toBeNull();
    expect(row.profile_id).toBe(USER_ID);
    expect(row.restaurant_id).toBe(RESTAURANT_ID);
    expect(row.exam_attempt_id).toBe(ATTEMPT_ID);
  });

  it('does NOT call /api/certs/generate (PDF deferred to activation)', async () => {
    const { POST } = await import('@/app/api/exam/submit/route');
    await POST(makeRequest({ attemptId: ATTEMPT_ID, answers: answersForAllCorrect() }));

    const certGenCall = fetchSpy.mock.calls.find(
      ([url]: [unknown]) => typeof url === 'string' && url.includes('/api/certs/generate')
    );
    expect(
      certGenCall,
      'PDF generation must NOT fire at exam-pass; it is deferred to webhook activation'
    ).toBeUndefined();
  });

  it('writes a `cert_issued` activity event tagged status=pending', async () => {
    const { POST } = await import('@/app/api/exam/submit/route');
    await POST(makeRequest({ attemptId: ATTEMPT_ID, answers: answersForAllCorrect() }));

    const certIssued = capturedInserts.find(
      (c) => c.table === 'activity_events' && c.row.type === 'cert_issued'
    );
    expect(certIssued, 'cert_issued activity event must be written').toBeDefined();
    const payload = certIssued!.row.payload as Record<string, unknown>;
    expect(payload.status).toBe('pending');
  });
});
