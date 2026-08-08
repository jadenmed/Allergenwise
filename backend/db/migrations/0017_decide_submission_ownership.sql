-- AllergenWise — Reviewer Ownership Guard
-- Migration: 0017_decide_submission_ownership.sql
-- Closes:    P1-2 from audits/backend-security-handoff-RE-AUDIT-2026-05-11.md
-- Replaces:  decide_submission(uuid, uuid, text, text) from 0009_decide_submission_fn.sql
--
-- What changed:
--   Adds an ownership predicate: if submissions.reviewer_id is already set,
--   only that reviewer may finalize the decision. Otherwise the calling
--   reviewer claims it. Implements first-writer-wins semantics with a soft
--   ownership signal so a second reviewer cannot overwrite a first
--   reviewer's decision even in a race.
--
--   Specifically:
--     - SELECT ... FOR UPDATE still serializes concurrent calls.
--     - After the lock is acquired, we re-check (a) v_sub.status is decidable
--       AND (b) v_sub.reviewer_id is NULL or equals p_reviewer_id.
--     - If (b) fails, raise insufficient_privilege so the API route can
--       return 409 to the client.
--
-- Forward-only. Idempotent: uses CREATE OR REPLACE.
-- Must run AFTER 0009.

create or replace function decide_submission(
  p_submission_id uuid,
  p_reviewer_id   uuid,
  p_action        text,
  p_notes         text default null
)
returns json
language plpgsql
security definer   -- runs as owner; bypasses RLS so the reviewer rpc call works
as $$
declare
  v_sub               submissions%rowtype;
  v_restaurant        restaurants%rowtype;
  v_new_status        text;
  v_restaurant_slug   text;
  v_listing_expires   timestamptz;
  v_activity_type     text;
begin
  -- ── Validate action ────────────────────────────────────────────────────────
  if p_action not in ('approve', 'reject', 'request_info') then
    raise exception 'invalid action: %. Must be approve|reject|request_info.', p_action
      using errcode = 'check_violation';
  end if;

  -- ── Lock and load submission ───────────────────────────────────────────────
  select * into v_sub
    from submissions
   where id = p_submission_id
     for update;

  if not found then
    raise exception 'submission % not found', p_submission_id
      using errcode = 'no_data_found';
  end if;

  -- Guard: only pending/in_review can be decided.
  if v_sub.status not in ('pending', 'in_review') then
    raise exception 'submission is already in terminal state: %', v_sub.status
      using errcode = 'check_violation';
  end if;

  -- ── P1-2 ownership predicate ───────────────────────────────────────────────
  -- If a reviewer already claimed this submission, only that reviewer may
  -- finalize it. Closes the IDOR vector: Reviewer A's decision cannot be
  -- overwritten by Reviewer B even in a race or via direct RPC call.
  if v_sub.reviewer_id is not null and v_sub.reviewer_id <> p_reviewer_id then
    raise exception 'submission % is owned by another reviewer', p_submission_id
      using errcode = 'insufficient_privilege';
  end if;

  -- ── Map action → submission status + activity event type ──────────────────
  case p_action
    when 'approve'      then
      v_new_status    := 'approved';
      v_activity_type := 'submission_approved';
    when 'reject'       then
      v_new_status    := 'rejected';
      v_activity_type := 'submission_rejected';
    when 'request_info' then
      v_new_status    := 'info_requested';
      v_activity_type := 'submission_rejected';  -- closest available enum value;
                                                  -- payload.action='request_info' distinguishes it
    else null;
  end case;

  -- ── Update submission ──────────────────────────────────────────────────────
  -- WHERE clause defense-in-depth: even though we already raised above on
  -- ownership mismatch, this predicate makes the UPDATE physically incapable
  -- of overwriting another reviewer's row. Belt + suspenders for the IDOR fix.
  update submissions
     set status         = v_new_status,
         reviewer_id    = p_reviewer_id,
         reviewer_notes = p_notes,
         decided_at     = now(),
         updated_at     = now()
   where id = p_submission_id
     and (reviewer_id is null or reviewer_id = p_reviewer_id);

  if not found then
    -- Should be unreachable given the ownership check above, but if a
    -- concurrent transaction snuck in between the SELECT FOR UPDATE release
    -- and our UPDATE (which cannot happen in single-statement transactions
    -- but could in pathological isolation modes), surface as 409.
    raise exception 'submission % could not be updated (ownership lost)', p_submission_id
      using errcode = 'insufficient_privilege';
  end if;

  -- ── On approve: update restaurant + insert restaurant_listed event ─────────
  if p_action = 'approve' then
    -- Lock the restaurant row before generating slug (prevents concurrent dups).
    select * into v_restaurant
      from restaurants
     where id = v_sub.restaurant_id
       for update;

    v_restaurant_slug := unique_slug(v_restaurant.name, v_restaurant.city);
    v_listing_expires := now() + interval '12 months';

    update restaurants
       set status             = 'listed',
           slug               = v_restaurant_slug,
           listed_at          = now(),
           listing_expires_at = v_listing_expires,
           updated_at         = now()
     where id = v_sub.restaurant_id;

    insert into activity_events (restaurant_id, actor_id, type, payload)
    values (
      v_sub.restaurant_id,
      p_reviewer_id,
      'restaurant_listed',
      jsonb_build_object(
        'submission_id',      p_submission_id,
        'action',             p_action,
        'slug',               v_restaurant_slug,
        'listing_expires_at', v_listing_expires
      )
    );

    return json_build_object(
      'ok',               true,
      'restaurantSlug',   v_restaurant_slug,
      'listingExpiresAt', v_listing_expires
    );
  end if;

  -- ── Non-approve: log the event (reject or request_info) ───────────────────
  insert into activity_events (restaurant_id, actor_id, type, payload)
  values (
    v_sub.restaurant_id,
    p_reviewer_id,
    v_activity_type,
    jsonb_build_object(
      'submission_id', p_submission_id,
      'action',        p_action,
      'notes',         p_notes
    )
  );

  return json_build_object('ok', true);
end;
$$;

revoke all on function decide_submission(uuid, uuid, text, text) from public;
grant execute on function decide_submission(uuid, uuid, text, text) to service_role;

comment on function decide_submission is
  'Transactional reviewer decision. Action: approve|reject|request_info. '
  'Ownership-guarded (P1-2 2026-05-15): if reviewer_id is already set, only '
  'that reviewer may finalize. On approve: sets restaurant.status=listed, '
  'generates unique slug, sets 12-month expiry. Always inserts activity_events. '
  'Returns {ok,restaurantSlug?,listingExpiresAt?}. Email is sent by the caller '
  'AFTER this function returns (outside the transaction). '
  'unique_slug raises unique_violation if >999 collision variants exist.';
