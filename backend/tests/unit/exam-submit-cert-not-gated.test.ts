/**
 * tests/unit/exam-submit-cert-not-gated.test.ts
 *
 * T-03 — a passed exam ALWAYS inserts a `pending` certificates row. There is
 * no flag with a vote on it any more.
 *
 * This file is what survives tests/unit/exam-submit-free-mode.test.ts. The
 * two cases asserting that MVP_FREE_MODE=true suppressed cert issuance are
 * gone with the behaviour they described; the two asserting that the flag
 * off/unset still issued a cert describe the rule that is now
 * unconditional, and they live on here — extended to run under the
 * coming-soon gate in every state, which is the property that would
 * actually regress if someone re-coupled cert issuance to a flag.
 *
 * Note what the certificate does NOT do: nothing activates it. It stays
 * `pending` until the cert fee is charged, which is T-41b's job. A pile of
 * pending rows is the expected post-T-03 state.
 *
 * Modeled on tests/unit/exam-submit-pending-cert.test.ts's mock harness,
 * which covers the shape of the inserted row; this file covers the fact
 * that it is inserted at all, regardless of the gate.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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

describe('POST /api/exam/submit — a pass always issues a pending cert (T-03)', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let fetchSpy: any;
  const originalComingSoon = process.env.COMING_SOON;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    capturedInserts.length = 0;
    delete process.env.COMING_SOON;
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

  afterEach(() => {
    if (originalComingSoon === undefined) delete process.env.COMING_SOON;
    else process.env.COMING_SOON = originalComingSoon;
  });

  async function submitAPass() {
    const { POST } = await import('@/app/api/exam/submit/route');
    const res = await POST(makeRequest({ attemptId: ATTEMPT_ID, answers: answersForAllCorrect() }));
    const body = (await res.json()) as {
      passed: boolean;
      scorePercent: number;
      certCode?: string;
    };
    return { res, body };
  }

  // The coming-soon gate is a routing concern. Cert issuance is a
  // certification concern. They were coupled through one flag; T-03 cut the
  // wire, and these cases are what proves the cut — not a comment.
  const gateStates = [
    ['unset (the default — gate ON)', undefined],
    ['false (gate off, site public)', 'false'],
    ['true (gate explicitly on)', 'true'],
  ] as const;

  function applyGate(value: string | undefined) {
    if (value === undefined) delete process.env.COMING_SOON;
    else process.env.COMING_SOON = value;
  }

  it.each(gateStates)('COMING_SOON %s: a pass inserts a pending cert', async (_label, value) => {
    applyGate(value);

    const { res, body } = await submitAPass();

    expect(res.status).toBe(200);
    expect(body.passed).toBe(true);
    expect(body.scorePercent).toBe(100);

    const certInsert = capturedInserts.find((c) => c.table === 'certificates');
    expect(certInsert, 'a pass must insert a certificates row').toBeDefined();
    expect((certInsert!.row as Record<string, unknown>).status).toBe('pending');
  });

  it.each(gateStates)('COMING_SOON %s: a pass returns its certCode', async (_label, value) => {
    applyGate(value);

    const { body } = await submitAPass();

    expect(body.certCode).toBeTruthy();
  });

  it('the cert is issued as pending and nothing here activates it (T-41b owns that)', async () => {
    const { body } = await submitAPass();

    expect(body.passed).toBe(true);

    const certInsert = capturedInserts.find((c) => c.table === 'certificates');
    expect((certInsert!.row as Record<string, unknown>).status).toBe('pending');
    expect((certInsert!.row as Record<string, unknown>).status).not.toBe('active');

    // No PDF render is kicked off for a pending cert — that happens on
    // activation. Asserted so a future change cannot start rendering PDFs
    // for certificates nobody has paid for.
    const certGenCall = fetchSpy.mock.calls.find(
      ([url]: [unknown]) => typeof url === 'string' && url.includes('/api/certs/generate')
    );
    expect(certGenCall).toBeUndefined();
  });

  it('the route does not reference the coming-soon flag at all', async () => {
    // The structural half. The behavioural cases above would still pass if
    // someone reintroduced a flag check here in a branch that happens to be
    // inert under these fixtures; this one would not.
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const src = readFileSync(
      resolve(__dirname, '..', '..', 'app/api/exam/submit/route.ts'),
      'utf8'
    );

    expect(src).not.toMatch(/isComingSoonEnabled|COMING_SOON|@\/lib\/coming-soon/);
  });
});
