-- ─── Migration 0016 — Wave-gate P1-16 GDPR account deletion ────────────────
--
-- Two artifacts:
--
--   1. `account_deletion_tokens` table — append-only ledger of every
--      issued deletion-request token. The raw token is never stored;
--      `token_hash` is sha256(token).hex. Single-use (`used_at`),
--      time-bounded (`expires_at`), per-profile lookup by hash.
--
--   2. `account_delete_user(p_profile_id, p_anonymized_email,
--      p_deletion_request_id)` — SECURITY DEFINER plpgsql function that
--      executes the entire GDPR Path 1 deletion sequence in a single
--      Postgres transaction. Mid-failure → full rollback, never partial.
--
-- Per the approved P1-16 design (audits/p1-16-gdpr-design.md):
--   - certificates / exam_attempts / lesson_progress: hard-delete rows
--     where profile_id = subject.
--   - profiles where invited_by = subject: null `invited_by` (preserve
--     the invitee's profile — it belongs to the restaurant, not subject).
--   - activity_events split by tenancy:
--       * solo events (lesson_completed / exam_passed / exam_failed)
--         where actor_id = subject → hard-delete.
--       * cross-tenant events (invite_sent / submission_* / restaurant_*
--         / cert_* / review_* / subscription_*) where actor_id = subject
--         → set actor_id = null AND merge
--           { actor_anonymized: true, anonymized_at: now() } into payload.
--   - subject's own profile: anonymize full_name + email + invite_token.
--   - subject's outstanding account_deletion_tokens: hard-delete.
--   - INSERT one `account_deleted` activity_event with
--       payload = { profile_id, deletion_request_id, timestamp }.
--
-- Auth-side cleanup (banning + email-blanking on auth.users) is performed
-- by the route handler via the Supabase admin REST API — that is OUTSIDE
-- this transaction. Route ordering: ban auth user FIRST → call this
-- function. Failure of this function with auth already banned leaves a
-- recoverable state (user can't log in; data still intact; retry-safe).

-- ─── Table: account_deletion_tokens ─────────────────────────────────────────

create table if not exists account_deletion_tokens (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid not null references profiles on delete cascade,
  token_hash  text not null unique,
  issued_at   timestamptz not null default now(),
  expires_at  timestamptz not null,
  used_at     timestamptz,
  used_reason text,
  ip_hash     text
);

create index if not exists idx_account_deletion_tokens_profile_unused
  on account_deletion_tokens (profile_id) where used_at is null;

-- Concern 2 — deny-by-default RLS. No user-role policy is created;
-- service-role bypasses RLS, which is the only legitimate access path.
alter table account_deletion_tokens enable row level security;

-- ─── Function: account_delete_user ──────────────────────────────────────────

create or replace function account_delete_user(
  p_profile_id           uuid,
  p_anonymized_email     text,
  p_deletion_request_id  uuid
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := now();
  v_solo_event_types text[] := array[
    'lesson_completed', 'exam_passed', 'exam_failed'
  ];
begin
  -- 1. Hard-delete the subject's certificates (Option A — strict GDPR).
  delete from certificates where profile_id = p_profile_id;

  -- 2. Hard-delete exam attempts.
  delete from exam_attempts where profile_id = p_profile_id;

  -- 3. Hard-delete lesson progress.
  delete from lesson_progress where profile_id = p_profile_id;

  -- 4. Null `invited_by` on every profile this user invited so the FK
  -- chain stays valid after the subject's profile is anonymized.
  -- Those profiles belong to the restaurant (controller), not the
  -- subject — per OQ-G4 legal framing they are not deleted.
  update profiles set invited_by = null where invited_by = p_profile_id;

  -- 5. Activity events — solo events hard-deleted; cross-tenant events
  -- retained but actor_id nulled + payload augmented per OQ-G3
  -- modification (Concern 3 in the design review).
  delete from activity_events
   where actor_id = p_profile_id
     and type = any(v_solo_event_types);

  update activity_events
     set actor_id = null,
         payload  = coalesce(payload, '{}'::jsonb)
                    || jsonb_build_object(
                         'actor_anonymized', true,
                         'anonymized_at',    v_now
                       )
   where actor_id = p_profile_id;

  -- 6. Subject's own profile — anonymize in place. Path 1 keeps the
  -- row to preserve the FK chain on already-anonymized cross-tenant
  -- activity_events references (actor_id = null + payload marker).
  update profiles
     set full_name    = '[deleted]',
         email        = p_anonymized_email,
         invite_token = null
   where id = p_profile_id;

  -- 7. Outstanding deletion tokens for this profile — hard-delete
  -- (the cascade FK fires only if the profile row is deleted, which
  -- it isn't under Path 1).
  delete from account_deletion_tokens where profile_id = p_profile_id;

  -- 8. Audit-trail row for the deletion itself. Uses the
  -- post-anonymization placeholder profile_id only — P1-8 alignment.
  insert into activity_events (actor_id, type, payload)
  values (
    null,
    'account_deleted',
    jsonb_build_object(
      'profile_id',           p_profile_id,
      'deletion_request_id',  p_deletion_request_id,
      'timestamp',            v_now
    )
  );
end;
$$;

-- Service-role + authenticated callers gain EXECUTE so the
-- supabase-js rpc() path from the route handler resolves. The
-- function still runs as its owner (SECURITY DEFINER) so the deletes
-- bypass RLS; the route handler's own admin-role check governs
-- whether the function should be invoked at all.
grant execute on function account_delete_user(uuid, text, uuid) to service_role;
grant execute on function account_delete_user(uuid, text, uuid) to authenticated;
