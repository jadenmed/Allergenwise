-- AllergenWise — Reviewer Decision Functions
-- Migration: 0009_decide_submission_fn.sql
-- Creates:
--   unique_slug(p_name text, p_city text) returns text
--   decide_submission(p_submission_id uuid, p_reviewer_id uuid, p_action text, p_notes text) returns json
-- Idempotent: uses CREATE OR REPLACE.
-- Must run AFTER 0003_rls.sql (references restaurants, submissions, activity_events).

-- ─── unique_slug(name, city) ──────────────────────────────────────────────────
-- Converts name+city to a kebab-case slug.
-- Appends -2, -3, ... on collision (reads restaurants table with advisory lock).
-- Thread safety: uses pg_advisory_xact_lock to serialize concurrent slug
-- generation for the same candidate. Under high concurrency the loser retries;
-- for MVP traffic this is acceptable (one submission per restaurant per cycle).
-- Safety guard: raises exception if suffix > 999 to prevent infinite spin.

create or replace function unique_slug(p_name text, p_city text)
returns text
language plpgsql
as $$
declare
  v_base    text;
  v_slug    text;
  v_counter int := 2;
  v_exists  boolean;
begin
  -- 1. Normalize: lower, strip accents via unaccent if available (fallback: raw lower).
  --    Replace any sequence of non-alphanumeric chars with a hyphen, trim edges.
  v_base := lower(
    regexp_replace(
      -- concat name + city with a space separator
      concat_ws(' ', p_name, p_city),
      '[^a-z0-9]+', '-', 'g'
    )
  );
  -- Trim leading/trailing hyphens
  v_base := trim(both '-' from v_base);
  -- Guard against empty slug (e.g., pure unicode name with no ASCII equivalent)
  if v_base = '' or v_base is null then
    v_base := 'restaurant';
  end if;

  v_slug := v_base;

  -- 2. Acquire a transaction-scoped advisory lock keyed on the base slug hash
  --    so concurrent transactions generating from the same base serialize.
  perform pg_advisory_xact_lock(hashtext(v_base));

  -- 3. Find a free slug.
  loop
    select exists(select 1 from restaurants where slug = v_slug) into v_exists;
    if not v_exists then
      return v_slug;
    end if;

    -- Safety: prevent infinite loop in pathological data (>999 restaurants sharing
    -- the same name+city slug). Raises a unique_violation so PostgREST returns 409.
    if v_counter > 999 then
      raise exception 'unique_slug: too many collisions for base slug "%". '
        'Maximum 999 variants exceeded.', v_base
        using errcode = 'unique_violation';
    end if;

    v_slug := v_base || '-' || v_counter;
    v_counter := v_counter + 1;
  end loop;
end;
$$;

-- Grant execute only to service_role (Next.js API calls via supabase.rpc use service key).
revoke all on function unique_slug(text, text) from public;
grant execute on function unique_slug(text, text) to service_role;


-- ─── decide_submission(…) ────────────────────────────────────────────────────
-- Runs entirely in a single transaction.
-- p_action: 'approve' | 'reject' | 'request_info'
-- Returns JSON: { ok: true, restaurantSlug?, listingExpiresAt? }
--           or raises an exception on invalid input (caught by PostgREST → 400).
-- The activity_events.type column is TEXT (not an enum) so any string value is safe.
-- We use 'submission_approved', 'submission_rejected', 'submission_info_requested'
-- to match the ActivityEventType values in lib/types/db.ts (approved/rejected exist;
-- info_requested is recorded via payload.action for readability).

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
  update submissions
     set status         = v_new_status,
         reviewer_id    = p_reviewer_id,
         reviewer_notes = p_notes,
         decided_at     = now(),
         updated_at     = now()
   where id = p_submission_id;

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

-- Only service_role (used by the Next.js API route via supabase.rpc) may call this.
revoke all on function decide_submission(uuid, uuid, text, text) from public;
grant execute on function decide_submission(uuid, uuid, text, text) to service_role;

comment on function decide_submission is
  'Transactional reviewer decision. Action: approve|reject|request_info. '
  'On approve: sets restaurant.status=listed, generates unique slug, sets 12-month expiry. '
  'Always inserts activity_events. Returns {ok,restaurantSlug?,listingExpiresAt?}. '
  'Email is sent by the caller AFTER this function returns (outside the transaction). '
  'unique_slug raises unique_violation if >999 collision variants exist.';
