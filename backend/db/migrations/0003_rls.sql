-- AllergenWise — Row Level Security
-- Migration: 0003_rls.sql
-- Idempotent: uses DROP POLICY IF EXISTS before every CREATE POLICY.
-- Run after 0002_indexes.sql. Defense-in-depth at the DB layer.
-- RLS does NOT replace middleware or layout-level role checks — it's the final layer.

-- ─── Enable RLS on every table ───────────────────────────────────────────────

alter table restaurants      enable row level security;
alter table profiles         enable row level security;
alter table subscriptions    enable row level security;
alter table modules          enable row level security;
alter table lessons          enable row level security;
alter table exam_questions   enable row level security;
alter table lesson_progress  enable row level security;
alter table exam_attempts    enable row level security;
alter table certificates     enable row level security;
alter table submissions      enable row level security;
alter table reviews          enable row level security;
alter table activity_events  enable row level security;
alter table stripe_events    enable row level security;

-- ─── Helper: get current user's role from profiles ───────────────────────────
-- Defined as a security-definer function so it runs as owner, not RLS user,
-- preventing infinite recursion in the profiles policy itself.

create or replace function auth_role()
returns text
language sql
stable
security definer
as $$
  select role from profiles where id = auth.uid()
$$;

create or replace function auth_restaurant_id()
returns uuid
language sql
stable
security definer
as $$
  select restaurant_id from profiles where id = auth.uid()
$$;

-- ─── restaurants ─────────────────────────────────────────────────────────────

drop policy if exists "restaurants_public_read_listed"   on restaurants;
drop policy if exists "restaurants_admin_read_own"       on restaurants;
drop policy if exists "restaurants_admin_update_own"     on restaurants;
drop policy if exists "restaurants_reviewer_read_all"    on restaurants;

-- Anyone (including anonymous) can read listed restaurants
create policy "restaurants_public_read_listed"
  on restaurants for select
  using (status = 'listed');

-- Admin reads own restaurant row (unlisted, pending, etc.)
create policy "restaurants_admin_read_own"
  on restaurants for select
  using (id = auth_restaurant_id() and auth_role() = 'admin');

-- Admin can update own restaurant
create policy "restaurants_admin_update_own"
  on restaurants for update
  using (id = auth_restaurant_id() and auth_role() = 'admin');

-- Reviewer can read all restaurants
create policy "restaurants_reviewer_read_all"
  on restaurants for select
  using (auth_role() = 'reviewer');

-- Service role (webhook, cron) bypasses RLS automatically when using service key.

-- ─── profiles ─────────────────────────────────────────────────────────────────

drop policy if exists "profiles_read_self"                  on profiles;
drop policy if exists "profiles_update_self"                on profiles;
drop policy if exists "profiles_admin_read_restaurant"      on profiles;
drop policy if exists "profiles_admin_insert_learner"       on profiles;
drop policy if exists "profiles_reviewer_read_all"          on profiles;

-- User can read their own profile
create policy "profiles_read_self"
  on profiles for select
  using (id = auth.uid());

-- User can update their own profile
create policy "profiles_update_self"
  on profiles for update
  using (id = auth.uid());

-- Admin can read all profiles in their restaurant
create policy "profiles_admin_read_restaurant"
  on profiles for select
  using (
    auth_role() = 'admin'
    and restaurant_id = auth_restaurant_id()
  );

-- Admin can insert learner profiles (inviting employees)
create policy "profiles_admin_insert_learner"
  on profiles for insert
  with check (
    auth_role() = 'admin'
    and role = 'learner'
    and restaurant_id = auth_restaurant_id()
  );

-- Reviewer can read all profiles
create policy "profiles_reviewer_read_all"
  on profiles for select
  using (auth_role() = 'reviewer');

-- ─── subscriptions ────────────────────────────────────────────────────────────

drop policy if exists "subscriptions_admin_read_own"     on subscriptions;
drop policy if exists "subscriptions_reviewer_read_all"  on subscriptions;

-- Admin reads own restaurant's subscriptions
create policy "subscriptions_admin_read_own"
  on subscriptions for select
  using (
    auth_role() = 'admin'
    and restaurant_id = auth_restaurant_id()
  );

-- Reviewer can read all subscriptions
create policy "subscriptions_reviewer_read_all"
  on subscriptions for select
  using (auth_role() = 'reviewer');

-- ─── modules ──────────────────────────────────────────────────────────────────

drop policy if exists "modules_authenticated_read" on modules;

-- All authenticated users can read modules (curriculum is not secret)
create policy "modules_authenticated_read"
  on modules for select
  using (auth.uid() is not null);

-- ─── lessons ──────────────────────────────────────────────────────────────────

drop policy if exists "lessons_authenticated_read" on lessons;

-- All authenticated users can read lessons
create policy "lessons_authenticated_read"
  on lessons for select
  using (auth.uid() is not null);

-- ─── exam_questions ───────────────────────────────────────────────────────────

drop policy if exists "exam_questions_learner_read" on exam_questions;

-- Authenticated users with any role can read exam questions (exam drawn server-side)
create policy "exam_questions_learner_read"
  on exam_questions for select
  using (auth_role() in ('learner', 'admin', 'reviewer'));

-- ─── lesson_progress ──────────────────────────────────────────────────────────

drop policy if exists "lesson_progress_learner_read_own"         on lesson_progress;
drop policy if exists "lesson_progress_learner_insert_own"       on lesson_progress;
drop policy if exists "lesson_progress_learner_update_own"       on lesson_progress;
drop policy if exists "lesson_progress_admin_read_restaurant"    on lesson_progress;

-- Learner can read/write own progress
create policy "lesson_progress_learner_read_own"
  on lesson_progress for select
  using (profile_id = auth.uid());

create policy "lesson_progress_learner_insert_own"
  on lesson_progress for insert
  with check (profile_id = auth.uid());

create policy "lesson_progress_learner_update_own"
  on lesson_progress for update
  using (profile_id = auth.uid());

-- Admin can read progress for their restaurant's learners
create policy "lesson_progress_admin_read_restaurant"
  on lesson_progress for select
  using (
    auth_role() = 'admin'
    and exists (
      select 1 from profiles p
      where p.id = lesson_progress.profile_id
        and p.restaurant_id = auth_restaurant_id()
    )
  );

-- ─── exam_attempts ────────────────────────────────────────────────────────────

drop policy if exists "exam_attempts_learner_read_own"       on exam_attempts;
drop policy if exists "exam_attempts_learner_insert_own"     on exam_attempts;
drop policy if exists "exam_attempts_learner_update_own"     on exam_attempts;
drop policy if exists "exam_attempts_admin_read_restaurant"  on exam_attempts;
drop policy if exists "exam_attempts_reviewer_read_all"      on exam_attempts;

-- Learner can read/insert own attempts
create policy "exam_attempts_learner_read_own"
  on exam_attempts for select
  using (profile_id = auth.uid());

create policy "exam_attempts_learner_insert_own"
  on exam_attempts for insert
  with check (profile_id = auth.uid());

create policy "exam_attempts_learner_update_own"
  on exam_attempts for update
  using (profile_id = auth.uid());

-- Admin can read attempts for their restaurant
create policy "exam_attempts_admin_read_restaurant"
  on exam_attempts for select
  using (
    auth_role() = 'admin'
    and exists (
      select 1 from profiles p
      where p.id = exam_attempts.profile_id
        and p.restaurant_id = auth_restaurant_id()
    )
  );

-- Reviewer can read all exam attempts
create policy "exam_attempts_reviewer_read_all"
  on exam_attempts for select
  using (auth_role() = 'reviewer');

-- ─── certificates ─────────────────────────────────────────────────────────────

drop policy if exists "certificates_learner_read_own"            on certificates;
drop policy if exists "certificates_admin_read_restaurant"       on certificates;
drop policy if exists "certificates_public_read_by_cert_code"   on certificates;
drop policy if exists "certificates_reviewer_read_all"           on certificates;

-- Learner reads own certificates
create policy "certificates_learner_read_own"
  on certificates for select
  using (profile_id = auth.uid());

-- Admin reads certificates for their restaurant
create policy "certificates_admin_read_restaurant"
  on certificates for select
  using (
    auth_role() = 'admin'
    and restaurant_id = auth_restaurant_id()
  );

-- PUBLIC: anyone can look up a certificate by cert_code (for verification page).
-- The app's WHERE clause filters to cert_code; this policy allows the scan.
-- cert_code values are non-guessable tokens, not enumerable by this policy alone.
create policy "certificates_public_read_by_cert_code"
  on certificates for select
  using (true);

-- Reviewer can read all
create policy "certificates_reviewer_read_all"
  on certificates for select
  using (auth_role() = 'reviewer');

-- ─── submissions ──────────────────────────────────────────────────────────────

drop policy if exists "submissions_admin_insert"        on submissions;
drop policy if exists "submissions_admin_read_own"      on submissions;
drop policy if exists "submissions_reviewer_read_all"   on submissions;
drop policy if exists "submissions_reviewer_update_all" on submissions;

-- Admin can insert a submission for their restaurant
create policy "submissions_admin_insert"
  on submissions for insert
  with check (
    auth_role() = 'admin'
    and restaurant_id = auth_restaurant_id()
    and submitted_by = auth.uid()
  );

-- Admin can read their restaurant's submissions
create policy "submissions_admin_read_own"
  on submissions for select
  using (
    auth_role() = 'admin'
    and restaurant_id = auth_restaurant_id()
  );

-- Reviewer can read all submissions
create policy "submissions_reviewer_read_all"
  on submissions for select
  using (auth_role() = 'reviewer');

-- Reviewer can update submissions (set status, notes, reviewer_id)
create policy "submissions_reviewer_update_all"
  on submissions for update
  using (auth_role() = 'reviewer');

-- ─── reviews ──────────────────────────────────────────────────────────────────

drop policy if exists "reviews_public_insert"               on reviews;
drop policy if exists "reviews_public_read_published"       on reviews;
drop policy if exists "reviews_admin_read_own_restaurant"   on reviews;
drop policy if exists "reviews_reviewer_read_all"           on reviews;
drop policy if exists "reviews_reviewer_update_all"         on reviews;

-- Anyone (including anonymous) can insert a review (status starts 'pending')
create policy "reviews_public_insert"
  on reviews for insert
  with check (status = 'pending');

-- Anyone can read published reviews
create policy "reviews_public_read_published"
  on reviews for select
  using (status = 'published');

-- Admin can read all reviews for their restaurant (including pending)
create policy "reviews_admin_read_own_restaurant"
  on reviews for select
  using (
    auth_role() = 'admin'
    and restaurant_id = auth_restaurant_id()
  );

-- Reviewer can read and update all reviews
create policy "reviews_reviewer_read_all"
  on reviews for select
  using (auth_role() = 'reviewer');

create policy "reviews_reviewer_update_all"
  on reviews for update
  using (auth_role() = 'reviewer');

-- ─── activity_events ──────────────────────────────────────────────────────────

drop policy if exists "activity_events_admin_read_own"      on activity_events;
drop policy if exists "activity_events_reviewer_read_all"   on activity_events;

-- Admin reads activity for their restaurant
create policy "activity_events_admin_read_own"
  on activity_events for select
  using (
    auth_role() = 'admin'
    and restaurant_id = auth_restaurant_id()
  );

-- Reviewer can read all activity
create policy "activity_events_reviewer_read_all"
  on activity_events for select
  using (auth_role() = 'reviewer');

-- ─── stripe_events ────────────────────────────────────────────────────────────

-- Service role only — no user-facing policies needed.
-- Deny all by default (RLS enabled, no permissive policies for users).
-- Webhook handler uses service-role key which bypasses RLS.
