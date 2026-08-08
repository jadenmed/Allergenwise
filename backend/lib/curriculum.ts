// ─── Curriculum loader ────────────────────────────────────────────────────────
// Curriculum content lives in content/curriculum/ split across one file per
// module (manifest.json + module-N-{slug}.json). This loader assembles the
// unified shape that matches MVP_BUILD §6.
//
// Pilot-grade content. Replace via the same files when allergist/RDN-vetted
// curriculum is ready.

import { readFileSync } from 'fs';
import { join } from 'path';

// Canonical constants from the AllergenWise Curriculum Source file.
// Defined in lib/disclaimer.ts (dependency-free so Client Components can import
// them too); re-exported here so callers may import from either module.
export {
  DISCLAIMER,
  CERT_NAME,
  CERT_VALIDITY_YEARS,
  PARTICIPATION_LANGUAGE_ALLOWED,
  PARTICIPATION_LANGUAGE_FORBIDDEN,
  OPTIONAL_BADGES,
} from '@/lib/disclaimer';

const ROOT = join(process.cwd(), 'content', 'curriculum');

export interface QuickCheckOption {
  text: string;
  correct: boolean;
}

export interface QuickCheck {
  question: string;
  options: QuickCheckOption[];
  explanation: string;
}

export interface Lesson {
  id: string;
  order: number;
  title: string;
  body_md: string;
  video_url: string;
  duration_sec: number;
  quick_check: QuickCheck;
}

export interface Module {
  id: string;
  order: number;
  title: string;
  description: string;
  estimated_minutes: number;
  lessons: Lesson[];
}

export interface ExamOption {
  id: string;
  text: string;
  correct: boolean;
}

export type ExamDifficulty = 'easy' | 'medium' | 'hard';

export interface ExamQuestion {
  id: string;
  question: string;
  options: ExamOption[];
  module_id_ref: string;
  difficulty: ExamDifficulty;
}

export interface Curriculum {
  _disclaimer: string;
  _version: string;
  _generated_at: string;
  modules: Module[];
  exam_pool: ExamQuestion[];
}

interface Manifest {
  _disclaimer: string;
  _version: string;
  _generated_at: string;
  modules: { id: string; order: number; file: string }[];
}

interface ModuleFile {
  module: Module;
  exam_questions: ExamQuestion[];
}

let cached: Curriculum | null = null;

export function loadCurriculum(): Curriculum {
  if (cached) return cached;

  const manifest: Manifest = JSON.parse(readFileSync(join(ROOT, 'manifest.json'), 'utf8'));

  const modules: Module[] = [];
  const exam_pool: ExamQuestion[] = [];

  const sorted = [...manifest.modules].sort((a, b) => a.order - b.order);
  for (const entry of sorted) {
    const data: ModuleFile = JSON.parse(readFileSync(join(ROOT, entry.file), 'utf8'));
    if (data.module.id !== entry.id) {
      throw new Error(
        `Curriculum manifest mismatch: ${entry.file} declares id="${data.module.id}" but manifest expects id="${entry.id}"`
      );
    }
    modules.push(data.module);
    for (const q of data.exam_questions) {
      if (q.module_id_ref !== entry.id) {
        throw new Error(
          `Exam question ${q.id} has module_id_ref="${q.module_id_ref}" but lives in module ${entry.id}`
        );
      }
      exam_pool.push(q);
    }
  }

  cached = {
    _disclaimer: manifest._disclaimer,
    _version: manifest._version,
    _generated_at: manifest._generated_at,
    modules,
    exam_pool,
  };
  return cached;
}

export function clearCurriculumCache(): void {
  cached = null;
}
