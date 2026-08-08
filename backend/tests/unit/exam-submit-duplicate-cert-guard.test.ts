/**
 * tests/unit/exam-submit-duplicate-cert-guard.test.ts
 *
 * T-49 — /api/exam/submit refuses to bank a second exam for a learner who
 * already holds a current certificate.
 *
 * This is defence in depth, not the primary guard. /api/exam/start refuses
 * entry, so the only way to reach this branch is a race: two concurrent start
 * requests can both pass the active-attempt check and open two attempts, and
 * the second submit then lands here after the first has already issued the
 * certificate.
 *
 * The refusal happens BEFORE the exam_attempts UPDATE, so nothing is mutated —
 * asserted below, because a guard that returned 409 after writing the row would
 * still have changed the attempt ledger.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { ALREADY_CERTIFIED_MESSAGE } from '@/lib/learner/issuance-guard';

// ─── Hoisted spies ────────────────────────────────────────────────────────────

const { mockGetUser, mockServiceFrom, capturedInserts, capturedUpdates } = vi.hoisted(() => ({
  mockGetUser: vi.fn(),
  mockServiceFrom: vi.fn(),
  capturedInserts: [] as Array<{ table: string; row: Record<string, unknown> }>,
  capturedUpdates: [] as Array<{ table: string; row: Record<string, unknown> }>,
}));

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabase: vi.fn(async () => ({ auth: { getUser: mockGetUser } })),
}));

vi.mock('@/lib/db/service', () => ({
  createServiceDb: vi.fn(() => ({ from: mockServiceFrom })),
}));

vi.mock('server-only', () => ({}));

vi.mock('@/lib/email/send', () => ({
  sendEmail: vi.fn().mockResolvedValue({ ok: true }),
}));

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const USER_ID = '11111111-1111-1111-1111-111111111111';
const RESTAURANT_ID = '22222222-2222-2222-2222-222222222222';
const ATTEMPT_ID = '33333333-3333-3333-3333-333333333333';
const NEW_CERT_ID = '44444444-4444-4444-4444-444444444444';
const HELD_CERT_ID = '55555555-5555-5555-5555-555555555555';
const HELD_CERT_CODE = 'AW-T49AA-BBBB1-2';

const FUTURE = '2028-08-05T12:00:00.000Z';

function chain(table: string, result: unknown, listResult: unknown = result) {
  const c: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'in', 'like', 'order', 'limit']) c[m] = vi.fn(() => c);
  c.update = vi.fn((row: Record<string, unknown>) => {
    capturedUpdates.push({ table, row });
    return c;
  });
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

/** All 25 answers correct, so the attempt would pass and try to issue a cert. */
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

function buildDispatcher(heldCerts: Array<Record<string, unknown>>) {
  const startedAt = new Date(Date.now() - 60_000).toISOString();

  mockServiceFrom.mockImplementation((table: string) => {
    if (table === 'profiles') {
      return chain('profiles', {
        data: {
          id: USER_ID,
          role: 'learner',
          restaurant_id: RESTAURANT_ID,
          full_name: 'Jane Learner',
          departed_at: null,
          restaurants: { name: 'The Test Bistro' },
        },
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
      return chain(
        'certificates',
        { data: { id: NEW_CERT_ID }, error: null },
        { data: heldCerts, error: null }
      );
    }
    return chain(table, { data: null, error: null }, { data: [], error: null });
  });
}

function makeRequest() {
  return new NextRequest('http://localhost:3000/api/exam/submit', {
    method: 'POST',
    body: JSON.stringify({ attemptId: ATTEMPT_ID, answers: answersForAllCorrect() }),
  });
}

async function submit() {
  const { POST } = await import('@/app/api/exam/submit/route');
  return POST(makeRequest());
}

beforeEach(() => {
  vi.clearAllMocks();
  capturedInserts.length = 0;
  capturedUpdates.length = 0;
  mockGetUser.mockResolvedValue({ data: { user: { id: USER_ID } }, error: null });
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('POST /api/exam/submit — T-49 duplicate-certificate guard', () => {
  it('refuses with 409 when the learner already holds a PENDING certificate', async () => {
    buildDispatcher([
      { id: HELD_CERT_ID, cert_code: HELD_CERT_CODE, status: 'pending', expires_at: FUTURE },
    ]);

    const res = await submit();
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.error).toBe(ALREADY_CERTIFIED_MESSAGE);
    expect(body.certCode).toBe(HELD_CERT_CODE);
  });

  it('creates NO second certificate row — the headline assertion', async () => {
    buildDispatcher([
      { id: HELD_CERT_ID, cert_code: HELD_CERT_CODE, status: 'pending', expires_at: FUTURE },
    ]);

    await submit();

    expect(capturedInserts.filter((c) => c.table === 'certificates')).toHaveLength(0);
  });

  it('mutates nothing — the exam_attempts row is not updated', async () => {
    // A 409 issued after the UPDATE would still have changed the attempt
    // ledger. The guard sits ahead of every write in this route.
    buildDispatcher([
      { id: HELD_CERT_ID, cert_code: HELD_CERT_CODE, status: 'active', expires_at: FUTURE },
    ]);

    await submit();

    expect(capturedUpdates).toHaveLength(0);
    expect(capturedInserts).toHaveLength(0);
  });

  it('refuses when the held certificate is ACTIVE and unexpired', async () => {
    buildDispatcher([
      { id: HELD_CERT_ID, cert_code: HELD_CERT_CODE, status: 'active', expires_at: FUTURE },
    ]);

    const res = await submit();
    expect(res.status).toBe(409);
  });

  it('CONTROL — a learner holding no blocking certificate still passes and is issued one', async () => {
    // Without this, a guard that refused everybody would pass every case above.
    buildDispatcher([]);

    const res = await submit();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.passed).toBe(true);
    expect(body.certCode).toBeDefined();
    expect(capturedInserts.filter((c) => c.table === 'certificates')).toHaveLength(1);
    expect(capturedUpdates.filter((u) => u.table === 'exam_attempts')).toHaveLength(1);
  });
});
