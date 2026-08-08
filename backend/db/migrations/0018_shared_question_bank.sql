-- AllergenWise — Shared Question Bank
-- Migration: 0018_shared_question_bank.sql
-- Idempotent: CREATE TABLE IF NOT EXISTS + DROP POLICY IF EXISTS before CREATE.
-- Run after 0017_decide_submission_ownership.sql.
--
-- Why this migration (CONTEXT.md OQ-2, locked decision set):
--   One shared question bank powers BOTH lesson checkpoint quizzes AND the
--   final certification exam. The legacy `exam_questions` table is folded into
--   the new `questions` table (is_exam_eligible=true) and then DROPPED. Lesson
--   quizzes draw `questions` rows tagged with a lesson_id; the final exam draws
--   `questions` rows where is_exam_eligible=true (lesson_id NULL = exam-only).
--
--   Tagging on `questions`:
--     - lesson_id (nullable)   NULL = exam-only pool, not tied to a lesson
--     - module_id              kept for the exam's 5-per-module randomization
--     - difficulty             easy | medium | hard
--     - is_exam_eligible       final exam draws only from this pool
--
--   Choices live in `question_choices` (one row per option). This replaces the
--   inline `options jsonb` of exam_questions; the canonical correct answer is
--   `question_choices.is_correct`. Server-side scoring loads choices from the DB
--   (app strips is_correct before any response — same posture as the old model).
--
--   Per-learner quiz state:
--     - quiz_attempts          one row per attempt (header: score, counts)
--     - quiz_attempt_answers   one row per answered question (audit detail)
--
--   On quiz_attempt_answers vs a jsonb blob: the exam path stores answers as a
--   jsonb column on exam_attempts. We deliberately SPLIT the quiz answers into a
--   normalized child table instead, because lesson quizzes are unlimited-retry
--   and admins must query per-learner progress ("show me every answer this
--   learner gave on lesson X across all attempts"). A normalized table makes
--   that an indexed join rather than a jsonb scan, and it is the single source
--   of truth (no redundant jsonb snapshot on quiz_attempts to drift).
--
--   lessons.quick_check_question / lessons.quick_check_options remain (DEPRECATED
--   but kept populated with each lesson's first checkpoint question) for the
--   existing lesson-player surface. New authoring targets `questions`.
--
-- RLS posture (mirrors 0003_rls.sql + 0011_rls_hardening.sql):
--   - questions / question_choices: authenticated read (content not secret;
--     grading is server-side, app strips is_correct). Matches the old
--     exam_questions_authenticated_read policy.
--   - quiz_attempts: learner reads/inserts OWN; admin reads their restaurant's
--     learners; reviewer reads all. NO learner UPDATE policy — every write path
--     uses a service-role client, matching the 0011 hardening that dropped the
--     forgery-prone exam_attempts / lesson_progress UPDATE policies.
--   - quiz_attempt_answers: learner reads OWN (via parent attempt); admin reads
--     their restaurant's; reviewer reads all. Writes via service-role only.

begin;

-- ─── questions ───────────────────────────────────────────────────────────────

create table if not exists questions (
  id                uuid primary key default gen_random_uuid(),
  prompt            text not null,
  lesson_id         uuid references lessons(id) on delete cascade,   -- NULL = exam-only
  module_id         uuid references modules(id),                     -- exam 5-per-module draw
  difficulty        text check (difficulty in ('easy','medium','hard')),
  is_exam_eligible  boolean not null default false,
  created_at        timestamptz default now(),
  updated_at        timestamptz default now()
);

do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'trg_questions_updated_at') then
    create trigger trg_questions_updated_at
      before update on questions
      for each row execute function set_updated_at();
  end if;
end $$;

-- ─── question_choices ────────────────────────────────────────────────────────

create table if not exists question_choices (
  id           uuid primary key default gen_random_uuid(),
  question_id  uuid not null references questions(id) on delete cascade,
  text         text not null,
  is_correct   boolean not null default false,
  order_index  int not null default 0,
  created_at   timestamptz default now()
);

create index if not exists idx_question_choices_question on question_choices (question_id);

-- ─── quiz_attempts ───────────────────────────────────────────────────────────

create table if not exists quiz_attempts (
  id             uuid primary key default gen_random_uuid(),
  profile_id     uuid not null references profiles(id) on delete cascade,
  lesson_id      uuid not null references lessons(id) on delete cascade,
  started_at     timestamptz default now(),
  submitted_at   timestamptz,
  score_percent  int,
  correct_count  int,
  total_count    int,
  updated_at     timestamptz default now()
);

create index if not exists idx_quiz_attempts_profile_lesson on quiz_attempts (profile_id, lesson_id);

do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'trg_quiz_attempts_updated_at') then
    create trigger trg_quiz_attempts_updated_at
      before update on quiz_attempts
      for each row execute function set_updated_at();
  end if;
end $$;

-- ─── quiz_attempt_answers ────────────────────────────────────────────────────

create table if not exists quiz_attempt_answers (
  id          uuid primary key default gen_random_uuid(),
  attempt_id  uuid not null references quiz_attempts(id) on delete cascade,
  question_id uuid not null references questions(id) on delete cascade,
  choice_id   uuid references question_choices(id) on delete set null,  -- NULL = unanswered
  is_correct  boolean not null default false,
  created_at  timestamptz default now()
);

create index if not exists idx_quiz_attempt_answers_attempt on quiz_attempt_answers (attempt_id);

-- ─── Data migration: exam_questions → questions + question_choices ────────────
-- Preserve every existing exam question. Reuse the original id as questions.id
-- so any historical exam_attempts.answers keyed on it still resolve. Each row's
-- inline options jsonb ([{id,text,correct}, ...]) becomes one question_choices
-- row per option, with order_index = array ordinality (0-based) and is_correct
-- copied from the option's `correct` flag.

insert into questions (id, prompt, lesson_id, module_id, difficulty, is_exam_eligible)
select eq.id, eq.question, null, eq.module_id, eq.difficulty, true
from exam_questions eq
on conflict (id) do nothing;

insert into question_choices (question_id, text, is_correct, order_index)
select
  eq.id,
  coalesce(elem->>'text', ''),
  coalesce((elem->>'correct')::boolean, false),
  (ord - 1)::int
from exam_questions eq
cross join lateral jsonb_array_elements(eq.options) with ordinality as t(elem, ord);

-- ─── Drop legacy exam_questions (data copied above) ──────────────────────────
-- Its RLS policy goes with it. Code is repointed to questions/question_choices
-- in the same change set (app/api/exam/start + submit).
drop policy if exists "exam_questions_authenticated_read" on exam_questions;
drop table if exists exam_questions;

-- ─── DEPRECATION markers on the legacy single-question lesson columns ─────────
comment on column lessons.quick_check_question is
  'DEPRECATED (0018_shared_question_bank): legacy single-question checkpoint. '
  'Authoritative quiz store is the shared `questions` table (lesson_id-tagged). '
  'Kept populated with each lesson''s first checkpoint question for the existing '
  'lesson player.';
comment on column lessons.quick_check_options is
  'DEPRECATED (0018_shared_question_bank): see lessons.quick_check_question.';

-- ─── RLS ─────────────────────────────────────────────────────────────────────

alter table questions             enable row level security;
alter table question_choices      enable row level security;
alter table quiz_attempts         enable row level security;
alter table quiz_attempt_answers  enable row level security;

-- questions: any authenticated user can read (content not secret; the app strips
-- correct answers, scoring is server-side). Mirrors the old exam_questions policy.
drop policy if exists "questions_authenticated_read" on questions;
create policy "questions_authenticated_read"
  on questions for select
  using (auth.uid() is not null);

-- question_choices: same posture. is_correct is never sent to the client by the
-- app layer; service-role scoring reads it server-side.
drop policy if exists "question_choices_authenticated_read" on question_choices;
create policy "question_choices_authenticated_read"
  on question_choices for select
  using (auth.uid() is not null);

-- quiz_attempts: learner reads own.
drop policy if exists "quiz_attempts_learner_read_own"      on quiz_attempts;
drop policy if exists "quiz_attempts_learner_insert_own"    on quiz_attempts;
drop policy if exists "quiz_attempts_admin_read_restaurant" on quiz_attempts;
drop policy if exists "quiz_attempts_reviewer_read_all"     on quiz_attempts;

create policy "quiz_attempts_learner_read_own"
  on quiz_attempts for select
  using (profile_id = auth.uid());

-- Learner can insert own attempts. (No UPDATE policy — submit writes go via
-- service-role, matching the 0011 hardening of exam_attempts / lesson_progress.)
create policy "quiz_attempts_learner_insert_own"
  on quiz_attempts for insert
  with check (profile_id = auth.uid());

-- Admin reads attempts for their restaurant's learners.
create policy "quiz_attempts_admin_read_restaurant"
  on quiz_attempts for select
  using (
    auth_role() = 'admin'
    and exists (
      select 1 from profiles p
      where p.id = quiz_attempts.profile_id
        and p.restaurant_id = auth_restaurant_id()
    )
  );

-- Reviewer reads all attempts.
create policy "quiz_attempts_reviewer_read_all"
  on quiz_attempts for select
  using (auth_role() = 'reviewer');

-- quiz_attempt_answers: learner reads own (via the parent attempt). No insert
-- policy — answers are written by the service-role submit handler.
drop policy if exists "quiz_attempt_answers_learner_read_own"      on quiz_attempt_answers;
drop policy if exists "quiz_attempt_answers_admin_read_restaurant" on quiz_attempt_answers;
drop policy if exists "quiz_attempt_answers_reviewer_read_all"     on quiz_attempt_answers;

create policy "quiz_attempt_answers_learner_read_own"
  on quiz_attempt_answers for select
  using (
    exists (
      select 1 from quiz_attempts qa
      where qa.id = quiz_attempt_answers.attempt_id
        and qa.profile_id = auth.uid()
    )
  );

create policy "quiz_attempt_answers_admin_read_restaurant"
  on quiz_attempt_answers for select
  using (
    auth_role() = 'admin'
    and exists (
      select 1
      from quiz_attempts qa
      join profiles p on p.id = qa.profile_id
      where qa.id = quiz_attempt_answers.attempt_id
        and p.restaurant_id = auth_restaurant_id()
    )
  );

create policy "quiz_attempt_answers_reviewer_read_all"
  on quiz_attempt_answers for select
  using (auth_role() = 'reviewer');

commit;
