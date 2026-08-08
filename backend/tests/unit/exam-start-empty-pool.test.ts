/**
 * tests/unit/exam-start-empty-pool.test.ts
 *
 * Final-exam pool gate (AllergenWise Curriculum Source — the file ships NO
 * Final Certification Test questions, so the pool is empty and certification
 * is blocked). /api/exam/start must return a clear "content pending" error
 * (HTTP 503) whenever fewer than 25 questions can be drawn, rather than
 * starting a partial exam.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Hoisted mocks ────────────────────────────────────────────────────────────

const { mockGetUser, mockServiceFrom } = vi.hoisted(() => ({
  mockGetUser: vi.fn(),
  mockServiceFrom: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabase: vi.fn(async () => ({ auth: { getUser: mockGetUser } })),
}));

vi.mock('@/lib/db/service', () => ({
  createServiceDb: vi.fn(() => ({ from: mockServiceFrom })),
}));

vi.mock('server-only', () => ({}));

vi.mock('@/lib/learner/progress', () => ({
  areAllModulesComplete: vi.fn(() => true),
}));

vi.mock('@/lib/learner/exam', () => ({
  checkCooldown: vi.fn(() => ({ canAttempt: true, attemptNumber: 1 })),
  findActiveAttempt: vi.fn(() => null),
}));

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const USER_ID = '11111111-1111-1111-1111-111111111111';

const MODULES = Array.from({ length: 5 }, (_, m) => ({
  id: `mod-${m + 1}`,
  order_index: m + 1,
}));

type BankRow = {
  id: string;
  prompt: string;
  question_choices: Array<{ id: string; text: string; order_index: number }>;
};

/**
 * Builds the from() dispatcher. `pool` maps module id → questions returned for
 * that module's draw query (shared bank, 0018). An empty/short pool exercises
 * the gate.
 */
function buildDispatcher(pool: Record<string, BankRow[]>) {
  mockServiceFrom.mockImplementation((table: string) => {
    if (table === 'profiles') {
      return {
        select: () => ({
          eq: () => ({
            single: vi
              .fn()
              .mockResolvedValue({ data: { id: USER_ID, role: 'learner' }, error: null }),
          }),
        }),
      };
    }
    if (table === 'modules') {
      return {
        select: () => ({ order: vi.fn().mockResolvedValue({ data: MODULES, error: null }) }),
      };
    }
    if (table === 'lessons') {
      return { select: vi.fn().mockResolvedValue({ data: [], error: null }) };
    }
    if (table === 'lesson_progress') {
      return { select: () => ({ eq: vi.fn().mockResolvedValue({ data: [], error: null }) }) };
    }
    if (table === 'certificates') {
      // T-49 duplicate-issuance guard, which /api/exam/start consults before it
      // looks at attempts. Empty: this learner holds no blocking certificate,
      // so the route runs on to the pool gate these tests are actually about.
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
          eq: () => ({ order: vi.fn().mockResolvedValue({ data: [], error: null }) }),
        }),
        // If the route ever reaches insert despite the gate, surface it loudly.
        insert: () => ({
          select: () => ({
            single: vi.fn().mockResolvedValue({
              data: { id: 'SHOULD-NOT-INSERT', started_at: new Date().toISOString() },
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
              limit: vi.fn().mockResolvedValue({ data: pool[val] ?? [], error: null }),
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
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('exam-start — empty Final Certification Test pool gate', () => {
  it('returns 503 "content pending" when the exam pool is empty', async () => {
    buildDispatcher({}); // no questions for any module
    const { POST } = await import('@/app/api/exam/start/route');

    const res = await POST(
      new Request('http://localhost/api/exam/start', { method: 'POST' }) as unknown as Parameters<
        typeof POST
      >[0]
    );

    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('Final exam not yet available — content pending');
  });

  it('returns 503 when fewer than 25 questions can be drawn (partial pool)', async () => {
    // 2 questions per module × 5 = 10 < 25 → still blocked (no partial exam).
    const pool: Record<string, BankRow[]> = {};
    for (const mod of MODULES) {
      pool[mod.id] = Array.from({ length: 2 }, (_, q) => ({
        id: `q-${mod.id}-${q + 1}`,
        prompt: `Q ${q + 1}`,
        question_choices: [{ id: 'a', text: 'A', order_index: 0 }],
      }));
    }
    buildDispatcher(pool);
    const { POST } = await import('@/app/api/exam/start/route');

    const res = await POST(
      new Request('http://localhost/api/exam/start', { method: 'POST' }) as unknown as Parameters<
        typeof POST
      >[0]
    );

    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('Final exam not yet available — content pending');
  });
});
