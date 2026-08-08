/**
 * tests/unit/progress.test.ts
 * Tests for lib/learner/progress.ts — module completion, lock, status derivation,
 * anti-cheat plausibility check.
 */
import { describe, it, expect } from 'vitest';
import {
  isModuleComplete,
  areAllModulesComplete,
  isLessonLocked,
  deriveLessonStatus,
  isWatchedSecondsPlausible,
  deriveModuleStatus,
} from '@/lib/learner/progress';
import type { ModuleRow, ProgressMap } from '@/lib/learner/progress';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const MODULE_IDS = ['m1', 'm2', 'm3', 'm4', 'm5'];
const MODULES: ModuleRow[] = MODULE_IDS.map((id, i) => ({ id, order_index: i + 1 }));

function lessonsPerModuleWith(lessonCounts: number[]): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  MODULE_IDS.forEach((mid, mi) => {
    result[mid] = Array.from({ length: lessonCounts[mi] }, (_, li) => `${mid}-l${li + 1}`);
  });
  return result;
}

function completeAllLessons(ids: string[]): ProgressMap {
  const map: ProgressMap = {};
  for (const id of ids) {
    map[id] = { status: 'complete', watched_seconds: 999 };
  }
  return map;
}

// ─── isModuleComplete ────────────────────────────────────────────────────────

describe('isModuleComplete', () => {
  it('empty lessons: not complete', () => {
    expect(isModuleComplete([], {})).toBe(false);
  });

  it('all lessons complete: true', () => {
    const ids = ['l1', 'l2', 'l3'];
    const progress = completeAllLessons(ids);
    expect(isModuleComplete(ids, progress)).toBe(true);
  });

  it('one lesson not_started: false', () => {
    const ids = ['l1', 'l2', 'l3'];
    const progress = completeAllLessons(ids);
    progress['l2'] = { status: 'not_started', watched_seconds: 0 };
    expect(isModuleComplete(ids, progress)).toBe(false);
  });

  it('one lesson in_progress: false', () => {
    const ids = ['l1', 'l2'];
    const progress: ProgressMap = {
      l1: { status: 'complete', watched_seconds: 100 },
      l2: { status: 'in_progress', watched_seconds: 50 },
    };
    expect(isModuleComplete(ids, progress)).toBe(false);
  });

  it('lesson in progress map with no entry: treated as not_started → false', () => {
    const ids = ['l1', 'l2'];
    const progress: ProgressMap = {
      l1: { status: 'complete', watched_seconds: 100 },
      // l2 not in map
    };
    expect(isModuleComplete(ids, progress)).toBe(false);
  });
});

// ─── areAllModulesComplete ─────────────────────────────────────────────────────

describe('areAllModulesComplete', () => {
  it('all 5 modules with all lessons complete: true', () => {
    const lessonsPerModule = lessonsPerModuleWith([6, 6, 6, 6, 6]);
    const allLessonIds = Object.values(lessonsPerModule).flat();
    const progressMap = completeAllLessons(allLessonIds);
    expect(areAllModulesComplete(MODULE_IDS, lessonsPerModule, progressMap)).toBe(true);
  });

  it('last module not complete: false', () => {
    const lessonsPerModule = lessonsPerModuleWith([6, 6, 6, 6, 6]);
    const allLessonIds = Object.values(lessonsPerModule).flat();
    const progressMap = completeAllLessons(allLessonIds);
    // Mark last lesson of module 5 as in_progress
    const m5Lessons = lessonsPerModule['m5'];
    progressMap[m5Lessons[m5Lessons.length - 1]] = { status: 'in_progress', watched_seconds: 50 };
    expect(areAllModulesComplete(MODULE_IDS, lessonsPerModule, progressMap)).toBe(false);
  });

  it('no modules: false', () => {
    expect(areAllModulesComplete([], {}, {})).toBe(false);
  });
});

// ─── isLessonLocked ───────────────────────────────────────────────────────────

describe('isLessonLocked', () => {
  const lessonsPerModule = lessonsPerModuleWith([3, 3, 3, 3, 3]);

  it('module 1 (first) is never locked', () => {
    const progressMap: ProgressMap = {}; // nothing complete
    expect(isLessonLocked(1, MODULES, lessonsPerModule, progressMap)).toBe(false);
  });

  it('module 2 is locked when module 1 is not complete', () => {
    const progressMap: ProgressMap = {}; // nothing complete
    expect(isLessonLocked(2, MODULES, lessonsPerModule, progressMap)).toBe(true);
  });

  it('module 2 is unlocked when module 1 is complete', () => {
    const progressMap = completeAllLessons(lessonsPerModule['m1']);
    expect(isLessonLocked(2, MODULES, lessonsPerModule, progressMap)).toBe(false);
  });

  it('module 3 is locked when module 1 complete but module 2 not', () => {
    const progressMap = completeAllLessons(lessonsPerModule['m1']);
    expect(isLessonLocked(3, MODULES, lessonsPerModule, progressMap)).toBe(true);
  });

  it('module 5 is locked when only modules 1-3 complete', () => {
    const progressMap = completeAllLessons([
      ...lessonsPerModule['m1'],
      ...lessonsPerModule['m2'],
      ...lessonsPerModule['m3'],
    ]);
    expect(isLessonLocked(5, MODULES, lessonsPerModule, progressMap)).toBe(true);
  });

  it('module 5 is unlocked when all 4 prior modules complete', () => {
    const progressMap = completeAllLessons([
      ...lessonsPerModule['m1'],
      ...lessonsPerModule['m2'],
      ...lessonsPerModule['m3'],
      ...lessonsPerModule['m4'],
    ]);
    expect(isLessonLocked(5, MODULES, lessonsPerModule, progressMap)).toBe(false);
  });

  it('order_index 0 or negative is always unlocked (defensive)', () => {
    expect(isLessonLocked(0, MODULES, lessonsPerModule, {})).toBe(false);
    expect(isLessonLocked(-1, MODULES, lessonsPerModule, {})).toBe(false);
  });
});

// ─── deriveLessonStatus ───────────────────────────────────────────────────────

describe('deriveLessonStatus', () => {
  const DURATION = 300; // 300s video

  it('0 watched on not_started lesson: stays not_started', () => {
    expect(deriveLessonStatus(0, DURATION, 'not_started')).toBe('not_started');
  });

  it('1 watched on not_started: in_progress', () => {
    expect(deriveLessonStatus(1, DURATION, 'not_started')).toBe('in_progress');
  });

  it('89% watched: in_progress', () => {
    expect(deriveLessonStatus(Math.floor(0.89 * DURATION), DURATION, 'in_progress')).toBe(
      'in_progress'
    );
  });

  it('exactly 90% watched: complete', () => {
    expect(deriveLessonStatus(Math.floor(0.9 * DURATION), DURATION, 'in_progress')).toBe(
      'complete'
    );
  });

  it('100% watched: complete', () => {
    expect(deriveLessonStatus(DURATION, DURATION, 'in_progress')).toBe('complete');
  });

  it('already complete: never regress (idempotent)', () => {
    expect(deriveLessonStatus(0, DURATION, 'complete')).toBe('complete');
    expect(deriveLessonStatus(100, DURATION, 'complete')).toBe('complete');
  });

  it('null duration: can only be in_progress (never auto-complete)', () => {
    expect(deriveLessonStatus(999, null, 'in_progress')).toBe('in_progress');
    expect(deriveLessonStatus(0, null, 'not_started')).toBe('not_started');
  });

  it('zero duration (e.g. text-only lesson): never auto-completes via watch time', () => {
    expect(deriveLessonStatus(0, 0, 'not_started')).toBe('not_started');
    expect(deriveLessonStatus(1, 0, 'not_started')).toBe('in_progress');
  });
});

// ─── isWatchedSecondsPlausible ────────────────────────────────────────────────

describe('isWatchedSecondsPlausible', () => {
  it('null startedAt (first POST): always plausible', () => {
    expect(isWatchedSecondsPlausible(600, null)).toBe(true);
  });

  it('elapsed >= 0.5 × watchedSeconds: plausible', () => {
    const startedAt = new Date(Date.now() - 400_000).toISOString(); // 400s ago
    expect(isWatchedSecondsPlausible(600, startedAt)).toBe(true); // 400 >= 0.5*600=300 ✓
  });

  it('elapsed < 0.5 × watchedSeconds: not plausible (cheat)', () => {
    const startedAt = new Date(Date.now() - 10_000).toISOString(); // 10s ago
    expect(isWatchedSecondsPlausible(600, startedAt)).toBe(false); // 10 < 300 ✗
  });

  it('exactly at boundary (elapsed = 0.5 × watchedSeconds): plausible', () => {
    const nowMs = Date.now();
    const startedAt = new Date(nowMs - 300_000).toISOString(); // 300s ago
    expect(isWatchedSecondsPlausible(600, startedAt, nowMs)).toBe(true); // 300 >= 300 ✓
  });

  it('injectable nowMs for testability', () => {
    const startedAt = new Date(0).toISOString(); // epoch
    // nowMs = 1s later, watchedSeconds = 0 → plausible
    expect(isWatchedSecondsPlausible(0, startedAt, 1000)).toBe(true);
  });

  it('invalid startedAt (unparseable): treated as plausible', () => {
    expect(isWatchedSecondsPlausible(600, 'not-a-date')).toBe(true);
  });

  it('0 watchedSeconds: always plausible', () => {
    const startedAt = new Date().toISOString();
    expect(isWatchedSecondsPlausible(0, startedAt)).toBe(true);
  });
});

// ─── deriveModuleStatus ───────────────────────────────────────────────────────

describe('deriveModuleStatus', () => {
  const lessonsPerModule = lessonsPerModuleWith([3, 3, 3, 3, 3]);

  it('first module, nothing complete: not_started', () => {
    const result = deriveModuleStatus(
      MODULES[0],
      lessonsPerModule['m1'],
      {},
      MODULES,
      lessonsPerModule
    );
    expect(result.status).toBe('not_started');
    expect(result.completedCount).toBe(0);
  });

  it('second module with prereq not done: locked', () => {
    const result = deriveModuleStatus(
      MODULES[1],
      lessonsPerModule['m2'],
      {},
      MODULES,
      lessonsPerModule
    );
    expect(result.status).toBe('locked');
  });

  it('second module with prereq done, none started: not_started', () => {
    const progressMap = completeAllLessons(lessonsPerModule['m1']);
    const result = deriveModuleStatus(
      MODULES[1],
      lessonsPerModule['m2'],
      progressMap,
      MODULES,
      lessonsPerModule
    );
    expect(result.status).toBe('not_started');
  });

  it('module in progress (1 of 3 complete): in_progress', () => {
    const progressMap: ProgressMap = {
      'm2-l1': { status: 'complete', watched_seconds: 100 },
      ...completeAllLessons(lessonsPerModule['m1']),
    };
    const result = deriveModuleStatus(
      MODULES[1],
      lessonsPerModule['m2'],
      progressMap,
      MODULES,
      lessonsPerModule
    );
    expect(result.status).toBe('in_progress');
    expect(result.completedCount).toBe(1);
    expect(result.totalCount).toBe(3);
  });

  it('module fully complete: complete', () => {
    const progressMap = completeAllLessons([...lessonsPerModule['m1'], ...lessonsPerModule['m2']]);
    const result = deriveModuleStatus(
      MODULES[1],
      lessonsPerModule['m2'],
      progressMap,
      MODULES,
      lessonsPerModule
    );
    expect(result.status).toBe('complete');
    expect(result.completedCount).toBe(3);
  });

  it('returns correct id and orderIndex', () => {
    const result = deriveModuleStatus(
      MODULES[2],
      lessonsPerModule['m3'],
      completeAllLessons([...lessonsPerModule['m1'], ...lessonsPerModule['m2']]),
      MODULES,
      lessonsPerModule
    );
    expect(result.id).toBe('m3');
    expect(result.orderIndex).toBe(3);
  });
});
