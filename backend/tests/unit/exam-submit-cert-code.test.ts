/**
 * tests/unit/exam-submit-cert-code.test.ts
 *
 * Wave 4B P0 #10.a — exam/submit produces a new-format cert code via
 * `generateCertCode()` (random Crockford Base32 + ISO 7064 check digit).
 * Per Concern 2 in the review, every 23505 collision retry writes a
 * `cert_code_collision_retry` activity event, and an exhausted retry
 * budget writes `cert_issuance_retry_exhausted`.
 *
 * Tests focus on the cert-code path. The pending-status semantics are
 * already covered by tests/unit/exam-submit-pending-cert.test.ts; that
 * file is not duplicated here.
 *
 * Test-first: this file is committed BEFORE app/api/exam/submit/route.ts
 * is updated. Implementation must satisfy every assertion below.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { CERT_CODE_REGEX } from '@/lib/learner/cert-code';

// ─── Hoisted spies ────────────────────────────────────────────────────────────

const { mockGetUser, mockServerFrom, mockServiceFrom, capturedInserts, certInsertOutcomes } =
  vi.hoisted(() => ({
    mockGetUser: vi.fn(),
    mockServerFrom: vi.fn(),
    mockServiceFrom: vi.fn(),
    capturedInserts: [] as Array<{ table: string; row: Record<string, unknown> }>,
    // Queue of outcomes for the certificates.insert chain. Each entry maps to
    // one INSERT attempt. Pop-from-front.
    certInsertOutcomes: [] as Array<{
      data: { id: string } | null;
      error: { code?: string } | null;
    }>,
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
 * learner's blocking certificates, so that read has to resolve to an array
 * while the cert insert's `.single()` keeps resolving to a row. Defaults to
 * `result` so every other table behaves exactly as before.
 */
function chain(table: string, result: unknown, listResult: unknown = result) {
  const c: Record<string, unknown> = {};
  const passthrough = ['select', 'eq', 'in', 'like', 'order', 'limit', 'update'];
  for (const m of passthrough) c[m] = vi.fn(() => c);
  c.insert = vi.fn((row: Record<string, unknown>) => {
    capturedInserts.push({ table, row });
    // The certificates table consumes its outcome queue so we can simulate
    // 23505 retries deterministically.
    if (table === 'certificates' && certInsertOutcomes.length > 0) {
      const next = certInsertOutcomes.shift()!;
      const certChain: Record<string, unknown> = {
        select: vi.fn(() => certChain),
        single: vi.fn(async () => next),
      };
      return certChain;
    }
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

beforeEach(() => {
  vi.clearAllMocks();
  capturedInserts.length = 0;
  certInsertOutcomes.length = 0;
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
      // Default outcome — success on first insert. Tests can preempt by
      // pushing to certInsertOutcomes BEFORE invoking the route.
      // The empty list is the T-49 guard read: this learner holds no blocking
      // certificate, which is what every test here assumes — they are all about
      // a learner earning their first one.
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

  vi.spyOn(global, 'fetch').mockResolvedValue(
    new Response(JSON.stringify({ ok: true }), { status: 200 })
  );
});

describe('POST /api/exam/submit — Wave 4B cert code', () => {
  it('emits a cert_code matching the new random Crockford format', async () => {
    certInsertOutcomes.push({ data: { id: NEW_CERT_ID }, error: null });
    const { POST } = await import('@/app/api/exam/submit/route');
    const res = await POST(makeRequest({ attemptId: ATTEMPT_ID, answers: answersForAllCorrect() }));
    expect(res.status).toBe(200);

    const certInsert = capturedInserts.find((c) => c.table === 'certificates');
    expect(certInsert).toBeDefined();
    const certCode = certInsert!.row.cert_code as string;
    expect(certCode).toMatch(CERT_CODE_REGEX);
    // No year segment — confirms the old AW-YYYY-NNNNNN format is gone.
    expect(certCode).not.toMatch(/^AW-20\d{2}-\d{6}$/);
  });

  // Timeout raised from vitest's 5s default. Measured 2026-07-29, six full-suite
  // runs on this machine: 4232 / 4591 / 4616 / 5827 ms, plus two runs killed AT
  // the old 5000 ms ceiling — those two are censored, not measured, so their
  // true cost is unknown and >= 5000. Solo, this same test takes ~749 ms.
  //
  // The variable is CPU contention, NOT the database. There is no DB call in
  // this loop — every Supabase call is mocked — and the 749 ms solo figure was
  // taken with the local Supabase containers fully up. The cost is 100 rounds of
  // vi.resetModules() + a fresh dynamic import of the route: CPU-bound module-
  // graph work competing with 87 other test files across 4 workers.
  //
  // Do NOT lower this without re-measuring. A timeout here is not contained.
  // vitest cannot cancel a running test body, so the aborted loop keeps
  // iterating alongside the tests that follow and mutates the fixtures they
  // share — the `capturedInserts.length = 0` and `certInsertOutcomes.push(...)`
  // statements at the top of this loop body — failing two downstream tests that
  // have nothing wrong with them. (Named, not cited by line number: this comment
  // has grown twice and broken a line citation both times.) T-28 in
  // MASTER_TASKLIST.md tracks making the loop cheap enough not to need this.
  it('100 successive submits produce 100 unique cert codes', async () => {
    const seen = new Set<string>();
    for (let i = 0; i < 100; i++) {
      capturedInserts.length = 0;
      certInsertOutcomes.push({ data: { id: NEW_CERT_ID }, error: null });
      vi.resetModules();
      const { POST } = await import('@/app/api/exam/submit/route');
      await POST(makeRequest({ attemptId: ATTEMPT_ID, answers: answersForAllCorrect() }));
      const certInsert = capturedInserts.find((c) => c.table === 'certificates');
      const certCode = certInsert!.row.cert_code as string;
      expect(seen.has(certCode), `duplicate cert code on iteration ${i}: ${certCode}`).toBe(false);
      seen.add(certCode);
    }
    expect(seen.size).toBe(100);
  }, 60_000);

  it('logs a cert_code_collision_retry event when first INSERT hits 23505 and second succeeds', async () => {
    // First INSERT: unique violation. Second: success.
    certInsertOutcomes.push({ data: null, error: { code: '23505' } });
    certInsertOutcomes.push({ data: { id: NEW_CERT_ID }, error: null });

    const { POST } = await import('@/app/api/exam/submit/route');
    const res = await POST(makeRequest({ attemptId: ATTEMPT_ID, answers: answersForAllCorrect() }));
    expect(res.status).toBe(200);

    // Two cert INSERTs were attempted.
    const certInserts = capturedInserts.filter((c) => c.table === 'certificates');
    expect(certInserts).toHaveLength(2);
    // The two attempts used DIFFERENT generated codes (no "sequence + 1"
    // pattern — each retry is a fresh random draw).
    expect(certInserts[0].row.cert_code).not.toBe(certInserts[1].row.cert_code);

    // The retry event was written with payload.attempt = 1 (the first
    // failed attempt's number, per the plan's documented payload shape).
    const retryEvents = capturedInserts.filter(
      (c) => c.table === 'activity_events' && c.row.type === 'cert_code_collision_retry'
    );
    expect(retryEvents).toHaveLength(1);
    const payload = retryEvents[0].row.payload as Record<string, unknown>;
    expect(payload.attempt).toBe(1);
    expect(payload.generated_code).toBe(certInserts[0].row.cert_code);
    expect(payload.exam_attempt_id).toBe(ATTEMPT_ID);
  });

  it('writes cert_issuance_retry_exhausted after 3 consecutive 23505 collisions', async () => {
    certInsertOutcomes.push({ data: null, error: { code: '23505' } });
    certInsertOutcomes.push({ data: null, error: { code: '23505' } });
    certInsertOutcomes.push({ data: null, error: { code: '23505' } });

    const { POST } = await import('@/app/api/exam/submit/route');
    const res = await POST(makeRequest({ attemptId: ATTEMPT_ID, answers: answersForAllCorrect() }));
    // The route still returns 200 — the exam attempt itself succeeded;
    // the cert is what failed. Per the plan, the response carries no
    // certCode field on retry-exhausted, and the exhausted event is in
    // the audit trail for operator visibility.
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.passed).toBe(true);
    expect(body.certCode).toBeUndefined();

    const certInserts = capturedInserts.filter((c) => c.table === 'certificates');
    expect(certInserts).toHaveLength(3);

    // Two collision-retry events (attempts 1 and 2) — attempt 3's failure
    // is recorded as the exhausted event, not as another retry.
    const retryEvents = capturedInserts.filter(
      (c) => c.table === 'activity_events' && c.row.type === 'cert_code_collision_retry'
    );
    expect(retryEvents).toHaveLength(2);
    expect((retryEvents[0].row.payload as Record<string, unknown>).attempt).toBe(1);
    expect((retryEvents[1].row.payload as Record<string, unknown>).attempt).toBe(2);

    const exhaustedEvents = capturedInserts.filter(
      (c) => c.table === 'activity_events' && c.row.type === 'cert_issuance_retry_exhausted'
    );
    expect(exhaustedEvents).toHaveLength(1);
    const exhaustedPayload = exhaustedEvents[0].row.payload as Record<string, unknown>;
    expect(exhaustedPayload.exam_attempt_id).toBe(ATTEMPT_ID);
    expect(exhaustedPayload.attempts).toBe(3);
  });
});
