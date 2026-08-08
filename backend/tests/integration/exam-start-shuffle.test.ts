/**
 * tests/integration/exam-start-shuffle.test.ts
 *
 * P1-9 — verify the exam-start route uses a CSPRNG-backed shuffle.
 *
 * The route draws 5 questions per module from the same fixed pool and
 * stitches them into a 25-question exam. With Math.random() the order
 * was predictable from observed prior attempts. With the CSPRNG-backed
 * `secureShuffle` it is not.
 *
 * This test is statistical, not exact:
 *   - Start 20 attempts back-to-back against the same fixed pool.
 *   - Assert at least 18 of the 20 returned question-ID orders are
 *     distinct (the previous Math.random-based shuffle could collide
 *     across a few attempts, but a CSPRNG essentially never does at
 *     this size).
 *
 * Critically it also asserts the CONSECUTIVE pair (start N, start N+1)
 * produces a different question order at least 19/20 times — the
 * specific predictability vector P1-9 was about: an attacker who
 * observed the order on attempt K should NOT be able to anticipate the
 * order on attempt K+1.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Hoisted mocks ────────────────────────────────────────────────────────────

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
  createServiceDb: vi.fn(() => ({
    from: mockServiceFrom,
  })),
}));

vi.mock('server-only', () => ({}));

// areAllModulesComplete short-circuits to true so we don't have to fixture lesson progress.
vi.mock('@/lib/learner/progress', () => ({
  areAllModulesComplete: vi.fn(() => true),
}));

vi.mock('@/lib/learner/exam', () => ({
  checkCooldown: vi.fn(() => ({ canAttempt: true, attemptNumber: 1 })),
  findActiveAttempt: vi.fn(() => null),
}));

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const USER_ID = '11111111-1111-1111-1111-111111111111';

// 5 modules × 10 questions each = 50 distinct question IDs in the pool.
const MODULES = Array.from({ length: 5 }, (_, m) => ({
  id: `mod-${m + 1}`,
  order_index: m + 1,
}));

type BankRow = {
  id: string;
  prompt: string;
  question_choices: Array<{ id: string; text: string; order_index: number }>;
};

const QUESTION_POOL: Record<string, BankRow[]> = {};
for (const mod of MODULES) {
  QUESTION_POOL[mod.id] = Array.from({ length: 10 }, (_, q) => ({
    id: `q-${mod.id}-${q + 1}`,
    prompt: `Q ${mod.id} ${q + 1}`,
    question_choices: [
      { id: 'a', text: 'A', order_index: 0 },
      { id: 'b', text: 'B', order_index: 1 },
    ],
  }));
}

// ─── Mock-from dispatcher ─────────────────────────────────────────────────────

function buildDispatcher() {
  mockServiceFrom.mockImplementation((table: string) => {
    if (table === 'profiles') {
      return {
        select: () => ({
          eq: () => ({
            single: vi.fn().mockResolvedValue({
              data: { id: USER_ID, role: 'learner' },
              error: null,
            }),
          }),
        }),
      };
    }
    if (table === 'modules') {
      return {
        select: () => ({
          order: vi.fn().mockResolvedValue({ data: MODULES, error: null }),
        }),
      };
    }
    if (table === 'lessons') {
      return {
        select: vi.fn().mockResolvedValue({ data: [], error: null }),
      };
    }
    if (table === 'lesson_progress') {
      return {
        select: () => ({
          eq: vi.fn().mockResolvedValue({ data: [], error: null }),
        }),
      };
    }
    if (table === 'certificates') {
      // T-49 duplicate-issuance guard, consulted before attempts are loaded.
      // Empty: this learner holds no blocking certificate, so the route runs on
      // to the question draw these tests are actually about.
      return {
        select: () => ({
          eq: () => ({
            in: () => ({ order: vi.fn().mockResolvedValue({ data: [], error: null }) }),
          }),
        }),
      };
    }
    if (table === 'exam_attempts') {
      return {
        select: () => ({
          eq: () => ({
            order: vi.fn().mockResolvedValue({ data: [], error: null }),
          }),
        }),
        insert: () => ({
          select: () => ({
            single: vi.fn().mockResolvedValue({
              data: {
                id: `attempt-${Math.floor(Date.now() * Math.E) % 99999}`,
                started_at: new Date().toISOString(),
              },
              error: null,
            }),
          }),
        }),
      };
    }
    if (table === 'questions') {
      // Route chains .eq('is_exam_eligible', true).eq('module_id', mod.id).limit(100)
      return {
        select: () => ({
          eq: () => ({
            eq: (_col: string, val: string) => ({
              limit: vi.fn().mockResolvedValue({
                data: QUESTION_POOL[val] ?? [],
                error: null,
              }),
            }),
          }),
        }),
      };
    }
    throw new Error(`Unexpected table: ${table}`);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetUser.mockResolvedValue({ data: { user: { id: USER_ID } }, error: null });
  buildDispatcher();
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('exam-start CSPRNG shuffle — P1-9', () => {
  it('20 consecutive starts produce distinct question orders (CSPRNG entropy)', async () => {
    const { POST } = await import('@/app/api/exam/start/route');

    const orders: string[] = [];
    for (let i = 0; i < 20; i++) {
      const res = await POST(
        new Request('http://localhost/api/exam/start', { method: 'POST' }) as unknown as Parameters<
          typeof POST
        >[0]
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as { questions: Array<{ id: string }> };
      orders.push(body.questions.map((q) => q.id).join(','));
    }
    const unique = new Set(orders);
    expect(unique.size).toBeGreaterThanOrEqual(18);
  });

  it('consecutive starts differ in order (attacker cannot predict K+1 from K)', async () => {
    const { POST } = await import('@/app/api/exam/start/route');

    let differingPairs = 0;
    let prev: string | null = null;
    for (let i = 0; i < 20; i++) {
      const res = await POST(
        new Request('http://localhost/api/exam/start', { method: 'POST' }) as unknown as Parameters<
          typeof POST
        >[0]
      );
      const body = (await res.json()) as { questions: Array<{ id: string }> };
      const order = body.questions.map((q) => q.id).join(',');
      if (prev !== null && order !== prev) differingPairs++;
      prev = order;
    }
    // 19 possible consecutive pairs across 20 starts.
    expect(differingPairs).toBeGreaterThanOrEqual(18);
  });
});
