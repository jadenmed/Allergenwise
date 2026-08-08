-- AllergenWise — Rename role 'admin' → 'manager'  (Manager Course architecture, PR 1)
-- Migration: 0022_rename_admin_to_manager.sql
--
-- RENUMBERED 0019 -> 0022 (2026-07-14, Track B landing): 0020/0021 (partner
-- attribution) landed on the trunk first and are already applied to dev DBs.
-- Running the rename BEFORE them (as 0019) would leave any already-provisioned
-- DB with a role constraint missing 'partner' (0019 alone would be the only
-- unapplied migration and its constraint lacked 'partner'). As 0022, the rename
-- runs after 0020's constraint and its final constraint includes 'partner'.
--
-- Numbering note: the architecture doc (Appendix A / §9) sketched this as "0018",
-- but 0018_shared_question_bank.sql already exists in this repo, so the rename
-- takes 0019 and PR 2's courses migration shifts to 0020.
--
-- WHAT THIS DOES
--   Renames the `admin` role to `manager`. Pure rename — no behavior change, no
--   new role, no new column. The auth_role() security-definer function is
--   `select role from profiles`, so it returns 'manager' for these users after
--   the data update with NO function change. URLs and the (admin) route group are
--   intentionally left as-is for this PR; RLS POLICY NAMES are renamed (see the
--   rename manifest below).
--
-- ORDER OF OPERATIONS (deliberate — differs from the doc's sketch)
--   The doc listed "update data, then swap constraint." That order fails: the
--   OLD check constraint forbids 'manager', so the UPDATE would be rejected.
--   Correct order is: (1) drop old constraint, (2) update data, (3) add new
--   constraint. Done below inside one transaction.
--
-- IDEMPOTENT
--   Every policy drops BOTH its old (_admin_) and new (_manager_) name before the
--   create, and the constraint drop is `if exists`. Re-running is safe. The data
--   UPDATE is naturally idempotent (no rows match 'admin' on a second run).
--
-- ─── POLICY NAME RENAMES (Task B — exhaustive; a reviewer can verify without ──
-- ─── running anything by checking each old→new pair against 0003/0004/0018) ───
--   16 live policies gate on the role. 15 carry `_admin_` in their NAME and are
--   renamed `_admin_` → `_manager_` below; the 16th (certificates_learner_read_own
--   on storage.objects) has no `_admin_` in its name — it is the learner-named
--   policy whose body contains an admin OR-branch, so its NAME is unchanged and
--   only its body flips. Every policy body's role value flips 'admin'→'manager'.
--
--   Group A — table policies from 0003_rls.sql (11):
--     1.  restaurants_admin_read_own            → restaurants_manager_read_own              (restaurants)
--     2.  profiles_admin_read_restaurant        → profiles_manager_read_restaurant          (profiles)
--     3.  profiles_admin_insert_learner         → profiles_manager_insert_learner           (profiles)  [keeps role='learner' — Q5]
--     4.  subscriptions_admin_read_own          → subscriptions_manager_read_own            (subscriptions)
--     5.  lesson_progress_admin_read_restaurant → lesson_progress_manager_read_restaurant   (lesson_progress)
--     6.  exam_attempts_admin_read_restaurant   → exam_attempts_manager_read_restaurant     (exam_attempts)
--     7.  certificates_admin_read_restaurant    → certificates_manager_read_restaurant      (certificates)
--     8.  submissions_admin_insert              → submissions_manager_insert                (submissions)
--     9.  submissions_admin_read_own            → submissions_manager_read_own              (submissions)
--     10. reviews_admin_read_own_restaurant     → reviews_manager_read_own_restaurant       (reviews)
--     11. activity_events_admin_read_own        → activity_events_manager_read_own          (activity_events)
--
--   Group B — table policies from 0018_shared_question_bank.sql (2):
--     12. quiz_attempts_admin_read_restaurant        → quiz_attempts_manager_read_restaurant        (quiz_attempts)
--     13. quiz_attempt_answers_admin_read_restaurant → quiz_attempt_answers_manager_read_restaurant (quiz_attempt_answers)
--
--   Group C — storage.objects policies from 0004_storage.sql (3):
--     14. roster_uploads_admin_insert           → roster_uploads_manager_insert             (storage.objects)
--     15. roster_uploads_admin_read             → roster_uploads_manager_read               (storage.objects)
--     16. certificates_learner_read_own         → (name UNCHANGED)                          (storage.objects; admin OR-branch flipped)
--
--   Renamed names: 15.  Bodies flipped: 16.
--
-- EXCLUDED (referenced 'admin' historically but NOT live — nothing to rename):
--   - restaurants_admin_update_own : defined in 0003, DROPPED by 0011, never recreated.
--   - exam_questions_learner_read  : used auth_role() in ('learner','admin','reviewer');
--     dropped together with the exam_questions table by 0018.
--
-- NOT A ROLE — DELIBERATELY UNTOUCHED:
--   - 0013_cert_state.sql certificates.revocation_reason in
--     ('refund','dispute_lost','admin','expired'). Here 'admin' is a revocation
--     REASON CODE ("revoked by an admin action"), not profiles.role. Renaming it
--     would corrupt revocation semantics. Left as-is.
--
-- VERIFICATION
--   `_admin_` still appears below only in (a) `drop policy if exists "<old>"`
--   statements — required to remove the existing policies, you must name them —
--   (b) this manifest, and (c) the commented rollback block. ZERO `create policy`
--   statements use an `_admin_` name. The authoritative post-migration check is
--   `select policyname from pg_policies where policyname like '%\_admin\_%'`
--   which returns zero rows (run in live-DB verification).
--
-- Run after 0021_partner_attribution_rls.sql.
-- ─────────────────────────────────────────────────────────────────────────────

begin;

-- ─── 1+2+3. Role check constraint + data ─────────────────────────────────────
-- Drop the old constraint BEFORE the data update (the old constraint forbids
-- 'manager'), update the data, then add the new constraint.
alter table profiles drop constraint if exists profiles_role_check;

update profiles set role = 'manager' where role = 'admin';

alter table profiles add constraint profiles_role_check
  check (role in ('manager','learner','reviewer','partner'));

-- ─── Group A — 0003_rls.sql table policies (renamed + role value → 'manager') ─

-- 1. restaurants_admin_read_own → restaurants_manager_read_own
drop policy if exists "restaurants_admin_read_own"   on restaurants;
drop policy if exists "restaurants_manager_read_own" on restaurants;
create policy "restaurants_manager_read_own"
  on restaurants for select
  using (id = auth_restaurant_id() and auth_role() = 'manager');

-- 2. profiles_admin_read_restaurant → profiles_manager_read_restaurant
drop policy if exists "profiles_admin_read_restaurant"   on profiles;
drop policy if exists "profiles_manager_read_restaurant" on profiles;
create policy "profiles_manager_read_restaurant"
  on profiles for select
  using (
    auth_role() = 'manager'
    and restaurant_id = auth_restaurant_id()
  );

-- 3. profiles_admin_insert_learner → profiles_manager_insert_learner
--    LOAD-BEARING (architecture doc §10 Q5): this policy is the defense-in-depth
--    that makes signup the ONLY path that creates a manager. It permits a
--    manager to insert profiles for their restaurant ONLY with role = 'learner'.
--    The role-value check stays 'learner' (NOT flipped); only the auth_role()
--    gate flips 'admin'→'manager' and the policy is renamed.
drop policy if exists "profiles_admin_insert_learner"   on profiles;
drop policy if exists "profiles_manager_insert_learner" on profiles;
create policy "profiles_manager_insert_learner"
  on profiles for insert
  with check (
    auth_role() = 'manager'
    and role = 'learner'
    and restaurant_id = auth_restaurant_id()
  );

-- 4. subscriptions_admin_read_own → subscriptions_manager_read_own
drop policy if exists "subscriptions_admin_read_own"   on subscriptions;
drop policy if exists "subscriptions_manager_read_own" on subscriptions;
create policy "subscriptions_manager_read_own"
  on subscriptions for select
  using (
    auth_role() = 'manager'
    and restaurant_id = auth_restaurant_id()
  );

-- 5. lesson_progress_admin_read_restaurant → lesson_progress_manager_read_restaurant
drop policy if exists "lesson_progress_admin_read_restaurant"   on lesson_progress;
drop policy if exists "lesson_progress_manager_read_restaurant" on lesson_progress;
create policy "lesson_progress_manager_read_restaurant"
  on lesson_progress for select
  using (
    auth_role() = 'manager'
    and exists (
      select 1 from profiles p
      where p.id = lesson_progress.profile_id
        and p.restaurant_id = auth_restaurant_id()
    )
  );

-- 6. exam_attempts_admin_read_restaurant → exam_attempts_manager_read_restaurant
drop policy if exists "exam_attempts_admin_read_restaurant"   on exam_attempts;
drop policy if exists "exam_attempts_manager_read_restaurant" on exam_attempts;
create policy "exam_attempts_manager_read_restaurant"
  on exam_attempts for select
  using (
    auth_role() = 'manager'
    and exists (
      select 1 from profiles p
      where p.id = exam_attempts.profile_id
        and p.restaurant_id = auth_restaurant_id()
    )
  );

-- 7. certificates_admin_read_restaurant → certificates_manager_read_restaurant
drop policy if exists "certificates_admin_read_restaurant"   on certificates;
drop policy if exists "certificates_manager_read_restaurant" on certificates;
create policy "certificates_manager_read_restaurant"
  on certificates for select
  using (
    auth_role() = 'manager'
    and restaurant_id = auth_restaurant_id()
  );

-- 8. submissions_admin_insert → submissions_manager_insert
drop policy if exists "submissions_admin_insert"   on submissions;
drop policy if exists "submissions_manager_insert" on submissions;
create policy "submissions_manager_insert"
  on submissions for insert
  with check (
    auth_role() = 'manager'
    and restaurant_id = auth_restaurant_id()
    and submitted_by = auth.uid()
  );

-- 9. submissions_admin_read_own → submissions_manager_read_own
drop policy if exists "submissions_admin_read_own"   on submissions;
drop policy if exists "submissions_manager_read_own" on submissions;
create policy "submissions_manager_read_own"
  on submissions for select
  using (
    auth_role() = 'manager'
    and restaurant_id = auth_restaurant_id()
  );

-- 10. reviews_admin_read_own_restaurant → reviews_manager_read_own_restaurant
drop policy if exists "reviews_admin_read_own_restaurant"   on reviews;
drop policy if exists "reviews_manager_read_own_restaurant" on reviews;
create policy "reviews_manager_read_own_restaurant"
  on reviews for select
  using (
    auth_role() = 'manager'
    and restaurant_id = auth_restaurant_id()
  );

-- 11. activity_events_admin_read_own → activity_events_manager_read_own
drop policy if exists "activity_events_admin_read_own"   on activity_events;
drop policy if exists "activity_events_manager_read_own" on activity_events;
create policy "activity_events_manager_read_own"
  on activity_events for select
  using (
    auth_role() = 'manager'
    and restaurant_id = auth_restaurant_id()
  );

-- ─── Group B — 0018_shared_question_bank.sql quiz policies (renamed) ──────────

-- 12. quiz_attempts_admin_read_restaurant → quiz_attempts_manager_read_restaurant
drop policy if exists "quiz_attempts_admin_read_restaurant"   on quiz_attempts;
drop policy if exists "quiz_attempts_manager_read_restaurant" on quiz_attempts;
create policy "quiz_attempts_manager_read_restaurant"
  on quiz_attempts for select
  using (
    auth_role() = 'manager'
    and exists (
      select 1 from profiles p
      where p.id = quiz_attempts.profile_id
        and p.restaurant_id = auth_restaurant_id()
    )
  );

-- 13. quiz_attempt_answers_admin_read_restaurant → quiz_attempt_answers_manager_read_restaurant
drop policy if exists "quiz_attempt_answers_admin_read_restaurant"   on quiz_attempt_answers;
drop policy if exists "quiz_attempt_answers_manager_read_restaurant" on quiz_attempt_answers;
create policy "quiz_attempt_answers_manager_read_restaurant"
  on quiz_attempt_answers for select
  using (
    auth_role() = 'manager'
    and exists (
      select 1
      from quiz_attempts qa
      join profiles p on p.id = qa.profile_id
      where qa.id = quiz_attempt_answers.attempt_id
        and p.restaurant_id = auth_restaurant_id()
    )
  );

-- ─── Group C — 0004_storage.sql storage.objects policies ──────────────────────
-- These are qualified `on storage.objects`. Policy #16's NAME is shared with a
-- certificates-TABLE policy that does NOT reference admin — the `on
-- storage.objects` qualifier targets only the storage one.

-- 14. roster_uploads_admin_insert → roster_uploads_manager_insert
drop policy if exists "roster_uploads_admin_insert"   on storage.objects;
drop policy if exists "roster_uploads_manager_insert" on storage.objects;
create policy "roster_uploads_manager_insert"
  on storage.objects for insert
  with check (
    bucket_id = 'roster-uploads'
    and auth.role() = 'authenticated'
    and auth_role() = 'manager'
    and (storage.foldername(name))[1] = (
      select id::text from restaurants where id = auth_restaurant_id()
    )
  );

-- 15. roster_uploads_admin_read → roster_uploads_manager_read
drop policy if exists "roster_uploads_admin_read"   on storage.objects;
drop policy if exists "roster_uploads_manager_read" on storage.objects;
create policy "roster_uploads_manager_read"
  on storage.objects for select
  using (
    bucket_id = 'roster-uploads'
    and auth.role() = 'authenticated'
    and auth_role() = 'manager'
    and (storage.foldername(name))[1] = (
      select id::text from restaurants where id = auth_restaurant_id()
    )
  );

-- 16. certificates_learner_read_own (storage.objects) — NAME UNCHANGED; the admin
--     OR-branch in the body is flipped to 'manager'.
drop policy if exists "certificates_learner_read_own" on storage.objects;
create policy "certificates_learner_read_own"
  on storage.objects for select
  using (
    bucket_id = 'certificates'
    and auth.role() = 'authenticated'
    and (
      -- learner: cert file named after cert_code, profile_id embedded in path
      exists (
        select 1 from certificates c
        where c.pdf_storage_path = name
          and c.profile_id = auth.uid()
      )
      or
      -- manager: any cert in their restaurant
      exists (
        select 1 from certificates c
        where c.pdf_storage_path = name
          and c.restaurant_id = auth_restaurant_id()
          and auth_role() = 'manager'
      )
      or
      -- reviewer: all certs
      auth_role() = 'reviewer'
    )
  );

-- ─── Group D — 0006_csv_drafts.sql policy NAME renames (added at 0022 landing) ─
-- These 3 policies do NOT gate on the role value (they gate on the admin_id
-- column = auth.uid()), so the original manifest correctly excluded them from
-- the role-flip set — but their NAMES carry `_admin_`, which breaks this
-- migration's verification invariant (zero %_admin_% policy names). Pure
-- rename: bodies identical, `admin_id` COLUMN intentionally untouched (column
-- renames are PR 2 scope).

drop policy if exists "csv_drafts_admin_select_own"   on csv_upload_drafts;
drop policy if exists "csv_drafts_manager_select_own" on csv_upload_drafts;
create policy "csv_drafts_manager_select_own"
  on csv_upload_drafts for select
  using (
    admin_id = auth.uid()
    and restaurant_id = auth_restaurant_id()
  );

drop policy if exists "csv_drafts_admin_insert_own"   on csv_upload_drafts;
drop policy if exists "csv_drafts_manager_insert_own" on csv_upload_drafts;
create policy "csv_drafts_manager_insert_own"
  on csv_upload_drafts for insert
  with check (
    admin_id = auth.uid()
    and restaurant_id = auth_restaurant_id()
  );

drop policy if exists "csv_drafts_admin_delete_own"   on csv_upload_drafts;
drop policy if exists "csv_drafts_manager_delete_own" on csv_upload_drafts;
create policy "csv_drafts_manager_delete_own"
  on csv_upload_drafts for delete
  using (
    admin_id = auth.uid()
    and restaurant_id = auth_restaurant_id()
  );

commit;

-- ─────────────────────────────────────────────────────────────────────────────
-- REVERSE MIGRATION (rollback) — run as a single transaction to revert PR 1.
--
-- Reverts the data, the constraint, all 16 policy BODIES, and the 15 policy NAME
-- renames back to the 'admin' role and the original `_admin_` names. Safe and
-- idempotent the same way the forward migration is. Apply only if PR 1 must be
-- backed out in production.
--
-- begin;
--
-- -- constraint + data (drop new constraint, restore data, re-add old constraint)
-- alter table profiles drop constraint if exists profiles_role_check;
-- update profiles set role = 'admin' where role = 'manager';
-- alter table profiles add constraint profiles_role_check
--   check (role in ('admin','learner','reviewer','partner'));
--
-- -- Group A
-- drop policy if exists "restaurants_manager_read_own" on restaurants;
-- create policy "restaurants_admin_read_own" on restaurants for select
--   using (id = auth_restaurant_id() and auth_role() = 'admin');
-- drop policy if exists "profiles_manager_read_restaurant" on profiles;
-- create policy "profiles_admin_read_restaurant" on profiles for select
--   using (auth_role() = 'admin' and restaurant_id = auth_restaurant_id());
-- drop policy if exists "profiles_manager_insert_learner" on profiles;
-- create policy "profiles_admin_insert_learner" on profiles for insert
--   with check (auth_role() = 'admin' and role = 'learner'
--               and restaurant_id = auth_restaurant_id());
-- drop policy if exists "subscriptions_manager_read_own" on subscriptions;
-- create policy "subscriptions_admin_read_own" on subscriptions for select
--   using (auth_role() = 'admin' and restaurant_id = auth_restaurant_id());
-- drop policy if exists "lesson_progress_manager_read_restaurant" on lesson_progress;
-- create policy "lesson_progress_admin_read_restaurant" on lesson_progress for select
--   using (auth_role() = 'admin' and exists (select 1 from profiles p
--     where p.id = lesson_progress.profile_id and p.restaurant_id = auth_restaurant_id()));
-- drop policy if exists "exam_attempts_manager_read_restaurant" on exam_attempts;
-- create policy "exam_attempts_admin_read_restaurant" on exam_attempts for select
--   using (auth_role() = 'admin' and exists (select 1 from profiles p
--     where p.id = exam_attempts.profile_id and p.restaurant_id = auth_restaurant_id()));
-- drop policy if exists "certificates_manager_read_restaurant" on certificates;
-- create policy "certificates_admin_read_restaurant" on certificates for select
--   using (auth_role() = 'admin' and restaurant_id = auth_restaurant_id());
-- drop policy if exists "submissions_manager_insert" on submissions;
-- create policy "submissions_admin_insert" on submissions for insert
--   with check (auth_role() = 'admin' and restaurant_id = auth_restaurant_id()
--               and submitted_by = auth.uid());
-- drop policy if exists "submissions_manager_read_own" on submissions;
-- create policy "submissions_admin_read_own" on submissions for select
--   using (auth_role() = 'admin' and restaurant_id = auth_restaurant_id());
-- drop policy if exists "reviews_manager_read_own_restaurant" on reviews;
-- create policy "reviews_admin_read_own_restaurant" on reviews for select
--   using (auth_role() = 'admin' and restaurant_id = auth_restaurant_id());
-- drop policy if exists "activity_events_manager_read_own" on activity_events;
-- create policy "activity_events_admin_read_own" on activity_events for select
--   using (auth_role() = 'admin' and restaurant_id = auth_restaurant_id());
--
-- -- Group B
-- drop policy if exists "quiz_attempts_manager_read_restaurant" on quiz_attempts;
-- create policy "quiz_attempts_admin_read_restaurant" on quiz_attempts for select
--   using (auth_role() = 'admin' and exists (select 1 from profiles p
--     where p.id = quiz_attempts.profile_id and p.restaurant_id = auth_restaurant_id()));
-- drop policy if exists "quiz_attempt_answers_manager_read_restaurant" on quiz_attempt_answers;
-- create policy "quiz_attempt_answers_admin_read_restaurant" on quiz_attempt_answers for select
--   using (auth_role() = 'admin' and exists (select 1 from quiz_attempts qa
--     join profiles p on p.id = qa.profile_id
--     where qa.id = quiz_attempt_answers.attempt_id and p.restaurant_id = auth_restaurant_id()));
--
-- -- Group C
-- drop policy if exists "roster_uploads_manager_insert" on storage.objects;
-- create policy "roster_uploads_admin_insert" on storage.objects for insert
--   with check (bucket_id = 'roster-uploads' and auth.role() = 'authenticated'
--     and auth_role() = 'admin'
--     and (storage.foldername(name))[1] = (select id::text from restaurants where id = auth_restaurant_id()));
-- drop policy if exists "roster_uploads_manager_read" on storage.objects;
-- create policy "roster_uploads_admin_read" on storage.objects for select
--   using (bucket_id = 'roster-uploads' and auth.role() = 'authenticated'
--     and auth_role() = 'admin'
--     and (storage.foldername(name))[1] = (select id::text from restaurants where id = auth_restaurant_id()));
-- drop policy if exists "certificates_learner_read_own" on storage.objects;
-- create policy "certificates_learner_read_own" on storage.objects for select
--   using (bucket_id = 'certificates' and auth.role() = 'authenticated' and (
--     exists (select 1 from certificates c where c.pdf_storage_path = name and c.profile_id = auth.uid())
--     or exists (select 1 from certificates c where c.pdf_storage_path = name
--       and c.restaurant_id = auth_restaurant_id() and auth_role() = 'admin')
--     or auth_role() = 'reviewer'));
--
-- commit;
-- ─────────────────────────────────────────────────────────────────────────────
