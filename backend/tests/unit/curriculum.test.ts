import { describe, it, expect, beforeEach } from 'vitest';
import {
  loadCurriculum,
  clearCurriculumCache,
  DISCLAIMER,
  CERT_NAME,
  CERT_VALIDITY_YEARS,
  PARTICIPATION_LANGUAGE_ALLOWED,
  PARTICIPATION_LANGUAGE_FORBIDDEN,
  OPTIONAL_BADGES,
} from '@/lib/curriculum';

/**
 * Curriculum-loader shape tests.
 *
 * Content source: content/curriculum/source/AllergenWise_Curriculum_Source.pdf.
 *   5 sections, 20 lessons (3 / 4 / 4 / 3 / 6).
 *   FULL content (verbatim body + Checkpoint Quiz): Lessons 1.1–4.3.
 *   OUTLINE ONLY in the source → missing-content marker: Lessons 5.1–5.6.
 *   Final Certification Test pool: not in the source → empty.
 */

const MARKER = '<!-- CONTENT MISSING — not provided in source file -->';

const SECTION_IDS = [
  'foundations-of-food-allergens',
  'cross-contact-and-safe-handling',
  'front-of-house-communication',
  'back-of-house-procedures',
  'systems-management-legal-risk',
];

// Section 5 is outline-only in the source → marker lessons.
const MARKER_SECTION_ID = 'systems-management-legal-risk';

const LESSONS_PER_SECTION = [3, 4, 4, 3, 6];

const LESSON_TITLES: Record<string, string[]> = {
  'foundations-of-food-allergens': [
    'What Is a Food Allergy?',
    'Understanding the Top 9 Food Allergens',
    'Understanding Allergic Reactions and Anaphylaxis',
  ],
  'cross-contact-and-safe-handling': [
    'Understanding Cross-Contact',
    'Cleaning and Kitchen Safety Procedures',
    'Handwashing, Gloves, and Safe Handling Procedures',
    'Preventing Cross-Contact During Preparation',
  ],
  'front-of-house-communication': [
    'Identifying and Responding to Allergy Disclosures',
    'Order Communication and Allergy Workflow',
    'Managing Guest Expectations',
    'Recognizing and Responding to Allergic Reactions',
  ],
  'back-of-house-procedures': [
    'Ingredient Verification and Hidden Risks',
    'Safe Kitchen Execution Procedures',
    'Final Verification Before Service',
  ],
  'systems-management-legal-risk': [
    'The AllergenWise Risk Reduction Workflow',
    'Manager Decision Making and Escalation',
    'Menu, Labeling, and Allergen Awareness Systems',
    'Legal Protection and Risk Awareness',
    'High-Risk Situations and Special Considerations',
    'Daily Allergen Safety Practices',
  ],
};

describe('curriculum loader', () => {
  beforeEach(() => clearCurriculumCache());

  it('loads all 5 sections in order', () => {
    const c = loadCurriculum();
    expect(c.modules).toHaveLength(5);
    expect(c.modules.map((m) => m.id)).toEqual(SECTION_IDS);
    expect(c.modules.map((m) => m.order)).toEqual([1, 2, 3, 4, 5]);
  });

  it('section lesson counts follow the source architecture (3/4/4/3/6 = 20)', () => {
    const c = loadCurriculum();
    const counts = c.modules.map((m) => m.lessons.length);
    expect(counts).toEqual(LESSONS_PER_SECTION);
    const total = counts.reduce((a, b) => a + b, 0);
    expect(total).toBe(20);
    for (const m of c.modules) {
      expect(m.lessons.map((l) => l.order)).toEqual(
        Array.from({ length: m.lessons.length }, (_, i) => i + 1)
      );
    }
  });

  it('every lesson uses the verbatim source title', () => {
    const c = loadCurriculum();
    for (const m of c.modules) {
      expect(m.lessons.map((l) => l.title)).toEqual(LESSON_TITLES[m.id]);
    }
  });

  it('the Final Certification Test pool is empty (source provides no questions)', () => {
    const c = loadCurriculum();
    expect(c.exam_pool).toHaveLength(0);
  });

  it('Lessons 1.1–4.3 have real (non-marker) body content', () => {
    const c = loadCurriculum();
    for (const m of c.modules) {
      if (m.id === MARKER_SECTION_ID) continue;
      for (const l of m.lessons) {
        expect(l.body_md, `${l.id}`).not.toContain(MARKER);
        expect(l.body_md.trim().length, `${l.id}`).toBeGreaterThan(50);
      }
    }
  });

  it('Lessons 5.1–5.6 carry the missing-content marker (body + quiz)', () => {
    const c = loadCurriculum();
    const m = c.modules.find((mm) => mm.id === MARKER_SECTION_ID)!;
    expect(m.lessons).toHaveLength(6);
    for (const l of m.lessons) {
      expect(l.body_md.trim(), `${l.id} body`).toBe(MARKER);
      expect(l.quick_check.question.trim(), `${l.id} quiz`).toBe(MARKER);
      expect(l.quick_check.options, `${l.id} options`).toHaveLength(0);
    }
  });

  it('every real-content lesson quick_check has 4 options with exactly one correct', () => {
    const c = loadCurriculum();
    for (const m of c.modules) {
      if (m.id === MARKER_SECTION_ID) continue;
      for (const l of m.lessons) {
        expect(l.quick_check.options.length, `${l.id} option count`).toBe(4);
        const correct = l.quick_check.options.filter((o) => o.correct).length;
        expect(correct, `${l.id} quick_check`).toBe(1);
      }
    }
  });

  it('every lesson video_url uses placeholder format', () => {
    const c = loadCurriculum();
    for (const m of c.modules) {
      for (const l of m.lessons) {
        expect(l.video_url).toMatch(/^mux:\/\/placeholder-.+-\d+$/);
      }
    }
  });

  it('spot-checks verbatim source prose (no paraphrasing)', () => {
    const c = loadCurriculum();
    const byId = (id: string) => c.modules.flatMap((m) => m.lessons).find((l) => l.id === id)!;

    // Lesson 1.1
    expect(byId('d1000000-0000-0000-0000-000000000101').body_md).toContain(
      'A food allergy is an immune system reaction to a food protein.'
    );
    // Lesson 1.2 — Top 9
    expect(byId('d1000000-0000-0000-0000-000000000102').body_md).toContain(
      'The FDA identifies 9 major food allergens responsible for the majority of serious allergic reactions in the United States.'
    );
    // Lesson 3.2 — the AllergenWise workflow (9 steps)
    expect(byId('d1000000-0000-0000-0000-000000000302').body_md).toContain(
      'The AllergenWise Risk Reduction Workflow:'
    );
  });

  it('exports the verbatim Required Disclaimer Language', () => {
    expect(DISCLAIMER).toBe(
      'No restaurant can guarantee a completely allergen-free environment. This training is designed to support allergen risk reduction through education, communication, and structured procedures.'
    );
  });

  it('exports the canonical certification + participation constants', () => {
    expect(CERT_NAME).toBe('AllergenWise Certification');
    expect(CERT_VALIDITY_YEARS).toBe(2);
    expect(PARTICIPATION_LANGUAGE_ALLOWED).toEqual([
      'AllergenWise Trained Team',
      'AllergenWise Participating Location',
      'AllergenWise Risk Reduction Partner',
    ]);
    expect(PARTICIPATION_LANGUAGE_FORBIDDEN).toEqual([
      'Allergen-Free Certified',
      'Guaranteed Safe',
    ]);
    expect(OPTIONAL_BADGES).toEqual([
      'Peanut Aware',
      'Sesame Restricted',
      'Dedicated Fryer',
      'Dedicated Prep Area',
      'Staff Allergen Trained',
    ]);
  });
});
