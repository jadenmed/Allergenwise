/**
 * lib/learner/progress.ts
 * Pure helpers for module-completion checks and lesson-lock enforcement.
 * No DB calls — takes plain data and returns boolean / derived state.
 * Tested by: tests/unit/progress.test.ts
 */

import type { LessonProgress, LessonStatus } from '@/lib/types/db';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface LessonRow {
  id: string;
  module_id: string;
  order_index: number;
  video_duration_seconds: number | null;
}

export interface ModuleRow {
  id: string;
  order_index: number;
}

export interface ProgressMap {
  [lessonId: string]: Pick<LessonProgress, 'status' | 'watched_seconds'>;
}

// ─── Module completion ────────────────────────────────────────────────────────

/**
 * Returns true if every lesson in the module has status='complete'.
 * A module with zero lessons is NOT considered complete (edge case protection).
 */
export function isModuleComplete(moduleLessonIds: string[], progressMap: ProgressMap): boolean {
  if (moduleLessonIds.length === 0) return false;
  return moduleLessonIds.every((id) => progressMap[id]?.status === 'complete');
}

/**
 * Returns true if ALL 5 modules are complete.
 * moduleIds must be the ordered list of all module IDs.
 * lessonsPerModule maps moduleId → lessonIds.
 */
export function areAllModulesComplete(
  moduleIds: string[],
  lessonsPerModule: Record<string, string[]>,
  progressMap: ProgressMap
): boolean {
  if (moduleIds.length === 0) return false;
  return moduleIds.every((mid) => isModuleComplete(lessonsPerModule[mid] ?? [], progressMap));
}

/**
 * Given a lesson's module order_index, returns whether the lesson is locked.
 * Module 1 (order_index=1) is always unlocked.
 * Module N (order_index > 1) is locked unless module N-1 is complete.
 *
 * @param moduleOrderIndex    1-based order index of the lesson's module
 * @param allModules          all modules sorted by order_index asc
 * @param lessonsPerModule    moduleId → lessonIds
 * @param progressMap         lessonId → progress
 */
export function isLessonLocked(
  moduleOrderIndex: number,
  allModules: ModuleRow[],
  lessonsPerModule: Record<string, string[]>,
  progressMap: ProgressMap
): boolean {
  // First module is always unlocked
  if (moduleOrderIndex <= 1) return false;

  // Find the preceding module (order_index = moduleOrderIndex - 1)
  const prereqModule = allModules.find((m) => m.order_index === moduleOrderIndex - 1);
  if (!prereqModule) return false; // no prereq found → allow (defensive)

  const prereqLessonIds = lessonsPerModule[prereqModule.id] ?? [];
  return !isModuleComplete(prereqLessonIds, progressMap);
}

// ─── Status derivation ────────────────────────────────────────────────────────

/**
 * Computes what a lesson's status should be given current watched_seconds
 * and the lesson's total duration.
 */
export function deriveLessonStatus(
  watchedSeconds: number,
  videoDurationSeconds: number | null,
  existingStatus: LessonStatus
): LessonStatus {
  // Once complete, never regress (idempotent)
  if (existingStatus === 'complete') return 'complete';

  if (videoDurationSeconds != null && videoDurationSeconds > 0) {
    if (watchedSeconds >= 0.9 * videoDurationSeconds) return 'complete';
  }

  if (watchedSeconds > 0) return 'in_progress';

  return existingStatus === 'not_started' ? 'not_started' : 'in_progress';
}

// ─── Anti-cheat: elapsed wall-clock check ─────────────────────────────────────

/**
 * Returns true if the claimed watchedSeconds is plausible given the elapsed
 * wall-clock time since the learner first started the lesson.
 *
 * Rule: elapsed real seconds must be >= 0.5 × claimed watchedSeconds.
 * (You can't claim 5 minutes of watching in 30 seconds of real time.)
 *
 * startedAt: ISO timestamp of first POST (lesson_progress.started_at)
 * nowMs:     current time in ms (injectable for testability)
 */
export function isWatchedSecondsPlausible(
  watchedSeconds: number,
  startedAt: string | null,
  nowMs: number = Date.now()
): boolean {
  if (startedAt == null) return true; // first post ever — always allow
  const startMs = new Date(startedAt).getTime();
  if (isNaN(startMs)) return true; // unparseable date → allow
  const elapsedSeconds = (nowMs - startMs) / 1000;
  return elapsedSeconds >= 0.5 * watchedSeconds;
}

// ─── Module status summary for home-data endpoint ────────────────────────────

export type ModuleStatus = 'locked' | 'not_started' | 'in_progress' | 'complete';

export interface ModuleSummary {
  id: string;
  orderIndex: number;
  status: ModuleStatus;
  completedCount: number;
  totalCount: number;
}

/**
 * Derives module-level status for the learner home-data endpoint.
 */
export function deriveModuleStatus(
  module: ModuleRow,
  lessonIds: string[],
  progressMap: ProgressMap,
  allModules: ModuleRow[],
  lessonsPerModule: Record<string, string[]>
): ModuleSummary {
  const completedCount = lessonIds.filter((id) => progressMap[id]?.status === 'complete').length;
  const totalCount = lessonIds.length;

  const locked = isLessonLocked(module.order_index, allModules, lessonsPerModule, progressMap);

  let status: ModuleStatus;
  if (locked) {
    status = 'locked';
  } else if (completedCount === totalCount && totalCount > 0) {
    status = 'complete';
  } else if (completedCount > 0) {
    status = 'in_progress';
  } else {
    status = 'not_started';
  }

  return { id: module.id, orderIndex: module.order_index, status, completedCount, totalCount };
}
