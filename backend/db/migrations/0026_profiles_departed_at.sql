-- AllergenWise — A departed employee can be removed from a roster
-- Migration: 0026_profiles_departed_at.sql
-- Idempotent: add column IF NOT EXISTS, create index IF NOT EXISTS,
-- CREATE OR REPLACE FUNCTION. Safe to re-run.
--
-- Numbering note: 0025 is taken by a task landing in parallel. 0019 was never
-- used (0022_rename_admin_to_manager.sql documents that renumber).
--
-- THE BUG THIS CLOSES
--   `profiles` had no membership state. lib/admin/eligibility.ts condition 2
--   requires every learner-role profile at a restaurant to hold a certificate,
--   with no status filter because there was no status to filter on. One
--   employee who is hired, never finishes the course and quits therefore blocks
--   that restaurant from EVER submitting for a directory listing, and nothing
--   in the product could clear it. The only removal path that existed —
--   account_delete_user (0016) — is GDPR erasure: it hard-deletes certificates
--   and exam attempts, destroying a credential the restaurant paid for.
--
-- WHAT MEMBERSHIP IS NOW
--   `departed_at is null`. That is the entire state. No status enum, no active
--   flag, no second source of truth to drift from.
--
-- WHAT IS DELIBERATELY NOT DONE
--   restaurant_id is NOT nulled out. It is referenced by
--   certificates.restaurant_id and it is what makes "certified while at X" a
--   recordable fact; nulling it would orphan those records and erase a true
--   statement. The certificate itself is NOT touched — no status change, no
--   deletion. It stays active until it expires on its own schedule. The person
--   sat the exam, the restaurant paid, and the certificate names the restaurant
--   and the date: still true after they leave. Lesson progress and exam
--   attempts are preserved for the same reason. Certificate transfer between
--   restaurants is separate, later work and is not designed for here.
--
-- WHY THE COLUMN AND THE RLS PREDICATE SHIP TOGETHER
--   They are the same fact. Splitting them across two migrations would leave a
--   window in which the column exists and the policies disagree with it — a
--   window in which the app believes someone has been removed while the
--   database still grants them the restaurant's rows.

begin;

-- ─── 1. profiles.departed_at ─────────────────────────────────────────────────
-- NULL means current staff. A timestamp means the manager removed them then.
-- Nullable with no default, so every existing row is current staff: the
-- migration changes nobody's membership on the way in.

alter table profiles
  add column if not exists departed_at timestamptz;

comment on column profiles.departed_at is
  'When this person stopped being staff at restaurant_id. NULL = current staff; this is the ONLY membership predicate. restaurant_id stays populated on purpose (certificates reference it). Their certificate, lesson progress and exam attempts are all preserved — removal changes membership, never the credential.';

-- ─── 2. Index for the membership filter ──────────────────────────────────────
-- Every count of "current staff at this restaurant" is (restaurant_id, role)
-- WHERE departed_at is null — eight call sites in the app, plus
-- auth_restaurant_id() below. Partial, because departed rows are never the ones
-- being counted.

create index if not exists idx_profiles_restaurant_role_current
  on profiles (restaurant_id, role)
  where departed_at is null;

-- ─── 3. auth_restaurant_id() — the database's own membership predicate ───────
-- THE LOAD-BEARING CHANGE. Filtering only in TypeScript would leave the
-- row-level grant intact: a departed person's restaurant_id is still populated
-- (see above), so their Postgres session would keep satisfying every policy
-- that scopes on this helper even when no route hands them the rows. Cutting it
-- here cuts it for all of them at once.
--
-- CREATE OR REPLACE, never DROP: 19 live policies depend on this function and
-- the signature is unchanged, so not one of them is rewritten or reloaded.
--
-- AUDIT OF ALL 19 DEPENDENT CLAUSES — every one FAILS CLOSED on NULL.
--   The live set is defined in 0022_rename_admin_to_manager.sql, which
--   recreated every surviving policy under its `_manager_` name. Shapes:
--
--   A. `<col> = auth_restaurant_id()` on the policy's own table  (13 clauses)
--        restaurants_manager_read_own, profiles_manager_read_restaurant,
--        profiles_manager_insert_learner, subscriptions_manager_read_own,
--        certificates_manager_read_restaurant, submissions_manager_insert,
--        submissions_manager_read_own, reviews_manager_read_own_restaurant,
--        activity_events_manager_read_own,
--        csv_drafts_manager_{select,insert,delete}_own
--      `x = NULL` yields NULL, which is not TRUE → row filtered, insert
--      rejected.
--
--   B. `exists (… where p.restaurant_id = auth_restaurant_id())`  (4 clauses)
--        lesson_progress_manager_read_restaurant,
--        exam_attempts_manager_read_restaurant,
--        quiz_attempts_manager_read_restaurant,
--        quiz_attempt_answers_manager_read_restaurant
--      The inner predicate is never TRUE, so EXISTS returns FALSE (never NULL).
--
--   C. `(storage.foldername(name))[1] = (select id::text from restaurants
--       where id = auth_restaurant_id())`                          (2 clauses)
--        roster_uploads_manager_insert, roster_uploads_manager_read
--      The subquery matches zero rows → scalar NULL → comparison NULL.
--
--   D. three-branch OR                                             (1 clause)
--        certificates_learner_read_own (storage.objects)
--      Only the manager branch dies. The `c.profile_id = auth.uid()` branch is
--      untouched, which is what keeps a departed learner's certificate PDF
--      downloadable — required, not incidental.
--
--   There is no NOT IN, no `is [not] distinct from`, and no negated comparison
--   anywhere in the live set: every clause is a positive equality or a positive
--   EXISTS. That is why one function can be swapped without a policy rewrite,
--   and why no clause becomes MORE permissive.
--
-- MANAGERS LOSE SCOPE TOO — DELIBERATE. This helper has no role branch, so a
-- departed manager loses restaurant scope exactly like a departed learner.
-- Membership is membership; a manager who has left the business must not keep
-- reading its roster. Stated here rather than left to be discovered as a side
-- effect. The API guards the other side of it: the departure endpoint refuses
-- any target whose role is not 'learner', so a restaurant cannot be locked out
-- of its own data by marking its last manager departed.
--
-- SELF-SCOPED READS ARE UNAFFECTED. profiles_read_self (0003_rls.sql:83) keys
-- on auth.uid(), not on this helper, and so do certificates_learner_read_own
-- (the certificates TABLE policy), lesson_progress_learner_read_own and
-- quiz_attempts_learner_read_own. A departed person keeps reading their own
-- profile, their own certificate and their own progress. Required behaviour,
-- not an oversight.
--
-- auth_role() is NOT changed. Role is not membership: reviewers and partners
-- are scoped by role and have no restaurant, and narrowing auth_role() would
-- break them for no gain.

-- `set search_path = public` is part of this definition, not a tidy-up. The
-- pre-0026 helper omitted it, but this migration REPLACES the function, so the
-- shipped version is this one. A security-definer function runs as its owner;
-- without a pinned search_path the unqualified `profiles` resolves against the
-- CALLER's path, and this function is consulted from storage.objects policies
-- as well as public ones. `auth.uid()` stays schema-qualified, so it resolves
-- either way.
create or replace function auth_restaurant_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select restaurant_id
    from profiles
   where id = auth.uid()
     and departed_at is null
$$;

commit;

-- ─────────────────────────────────────────────────────────────────────────────
-- REVERSE MIGRATION (rollback) — run as a single transaction.
--
-- Restores the pre-0026 helper FIRST, so the policies stop consulting
-- departed_at before the column disappears. Dropping the column while the
-- function still referenced it would leave auth_restaurant_id() broken and
-- every manager locked out of their own restaurant.
--
-- begin;
--
-- create or replace function auth_restaurant_id()
-- returns uuid language sql stable security definer
-- set search_path = public as $$
--   select restaurant_id from profiles where id = auth.uid()
-- $$;
--
-- drop index if exists idx_profiles_restaurant_role_current;
-- alter table profiles drop column if exists departed_at;
--
-- commit;
-- ─────────────────────────────────────────────────────────────────────────────
