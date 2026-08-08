# Curriculum source — canonical

`AllergenWise_Curriculum_Source.pdf` in this directory is the **single source of
truth** for all AllergenWise curriculum content. Treat it like a contract.

## Rules

- **Everything in the file goes into the database verbatim.** Lesson bodies,
  Key Concepts, "Important:" callouts, and Checkpoint Quiz questions/options are
  transcribed exactly — no paraphrasing, summarizing, or condensing.
- **Nothing not in the file is invented.** Where the file supplies no content,
  the marker below is used instead of placeholder prose:

  ```
  <!-- CONTENT MISSING — not provided in source file -->
  ```

- **To change curriculum content:** update this PDF first, then re-run the seed.
  Do not edit `db/seed-curriculum.sql` or `content/curriculum/*.json` ahead of
  the file — the file leads, the code follows.

## Current coverage (as of 2026-05-28)

| Source section | Lessons | Coverage |
|---|---|---|
| 1 — Foundations of Food Allergens | 1.1–1.3 | **Full** (verbatim body + Checkpoint Quiz) |
| 2 — Cross-Contact and Safe Handling | 2.1–2.4 | **Full** |
| 3 — Front of House Communication | 3.1–3.4 | **Full** |
| 4 — Back of House Procedures | 4.1–4.3 | **Full** |
| 5 — Systems, Management, Legal Risk | 5.1–5.6 | **Outline only** → missing-content marker (body + quiz) |
| 6 — Final Certification Test | — | **No question pool in the file** → no exam-eligible questions seeded (`questions` where `is_exam_eligible=true`); cert issuance blocked |

Notes on faithful rendering:
- The full-content section gives **no "Lesson Purpose"** for Lessons 4.1–4.3 and
  **no "Key Concepts" list** for Lessons 1.2, 4.1, 4.2, 4.3 — those headers are
  therefore omitted from those lesson bodies (not fabricated).
- Lesson 1.2's Checkpoint Quiz has **5** questions; every other full-content
  lesson has 4.

## Where this content lands

- `db/seed-curriculum.sql` — modules, lessons (`body_md`, deprecated
  `quick_check_*` = each lesson's first question), and the shared question bank
  (`questions` + `question_choices`: one `questions` row per Checkpoint Quiz
  question, lesson-tagged and `is_exam_eligible=false`; migration
  `0018_shared_question_bank.sql`).
- `content/curriculum/*.json` — the loader's view (`lib/curriculum.ts`):
  verbatim `body_md` + each lesson's first `quick_check`. Multi-question quizzes
  live in the DB table.
- `lib/disclaimer.ts` — canonical constants (`DISCLAIMER`, `CERT_NAME`,
  `CERT_VALIDITY_YEARS`, `PARTICIPATION_LANGUAGE_ALLOWED/FORBIDDEN`,
  `OPTIONAL_BADGES`), re-exported from `lib/curriculum.ts`.
