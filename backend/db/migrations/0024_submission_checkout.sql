-- AllergenWise — Certification fees are paid at submission, through Checkout
-- Migration: 0024_submission_checkout.sql
-- Idempotent: add column IF NOT EXISTS, create index IF NOT EXISTS. Safe to re-run.
--
-- T-41b moves the cert fee off an off-session PaymentIntent and onto a Stripe
-- Checkout Session created when the manager submits for a directory listing.
-- The submission row is no longer written by the route handler — it is written
-- by the `checkout.session.completed` webhook, which can be delivered more than
-- once. Two things therefore have to become DB truth rather than app intent:
--
--   1. IDEMPOTENCY. A redelivery of the same Checkout Session must not create a
--      second submission. Same shape as subscriptions.stripe_invoice_id in
--      0023: a UNIQUE index on the Stripe id is the only guard two concurrent
--      deliveries cannot both pass, because a SELECT-then-INSERT lets both see
--      "not found".
--
--   2. ONE OPEN SUBMISSION PER RESTAURANT. lib/admin/eligibility.ts already
--      refuses to start a submission while one is pending/in_review/
--      info_requested, but that check now runs BEFORE the row exists — the row
--      appears seconds later, when the webhook lands. A manager who opens the
--      form twice can therefore create two Checkout Sessions that both pass
--      eligibility. Paying both would mean two charges and two listings in the
--      reviewer queue. The partial unique index makes the second one impossible
--      to record; the webhook turns that rejection into a loud
--      `submission_payment_orphaned` event so the extra charge is refundable by
--      hand rather than invisible.

-- ─── 1. submissions.stripe_checkout_session_id ───────────────────────────────
-- `cs_…`. NULL for the one path that creates no Session at all: a resubmission
-- with zero pending certificates, where there is nothing to charge. NULLs are
-- distinct in a Postgres unique index, so any number of those may coexist.

alter table submissions
  add column if not exists stripe_checkout_session_id text;

comment on column submissions.stripe_checkout_session_id is
  'Stripe Checkout Session (cs_…) that paid this submission''s cert fees. UNIQUE — this is the webhook''s idempotency key. NULL when no Session was needed (zero pending certificates).';

-- Pre-flight, same posture as 0023: fail early and NAME the rows rather than
-- dying on a bare 23505 that mentions an index nobody has heard of yet. These
-- are billing rows — resolving a duplicate is a human call, not something a
-- schema migration gets to do.
do $$
declare
  dup_groups int;
  dup_list   text;
begin
  select count(*), coalesce(string_agg(stripe_checkout_session_id || ' (x' || c::text || ')', ', '), '')
    into dup_groups, dup_list
    from (
      select stripe_checkout_session_id, count(*) as c
        from submissions
       where stripe_checkout_session_id is not null
       group by stripe_checkout_session_id
      having count(*) > 1
    ) d;

  if dup_groups > 0 then
    raise exception
      'migration 0024: cannot add UNIQUE(submissions.stripe_checkout_session_id) — % session id(s) already duplicated: %',
      dup_groups, dup_list
      using
        errcode = 'unique_violation',
        hint    = 'Resolve by hand before re-running: keep the earliest submitted_at row per session id, refund/void the rest. Do NOT bulk-delete submission rows.';
  end if;
end $$;

create unique index if not exists submissions_stripe_checkout_session_id_key
  on submissions (stripe_checkout_session_id);

-- ─── 2. One open submission per restaurant ───────────────────────────────────
-- 'pending' | 'in_review' | 'info_requested' are exactly the statuses
-- lib/admin/eligibility.ts treats as "a review is already underway".
-- approved/rejected rows are closed and any number may accumulate, which is
-- what makes resubmission after a rejection still work.

do $$
declare
  dup_groups int;
  dup_list   text;
begin
  select count(*), coalesce(string_agg(restaurant_id::text || ' (x' || c::text || ')', ', '), '')
    into dup_groups, dup_list
    from (
      select restaurant_id, count(*) as c
        from submissions
       where status in ('pending', 'in_review', 'info_requested')
       group by restaurant_id
      having count(*) > 1
    ) d;

  if dup_groups > 0 then
    raise exception
      'migration 0024: cannot add UNIQUE(submissions.restaurant_id) WHERE open — % restaurant(s) already hold more than one open submission: %',
      dup_groups, dup_list
      using
        errcode = 'unique_violation',
        hint    = 'Decide or reject the surplus submissions for each restaurant before re-running, keeping the earliest submitted_at open.';
  end if;
end $$;

create unique index if not exists submissions_one_open_per_restaurant
  on submissions (restaurant_id)
  where status in ('pending', 'in_review', 'info_requested');
