-- AllergenWise — Webhook retryability + invoice uniqueness
-- Migration: 0023_webhook_retryability.sql
-- Idempotent: add column IF NOT EXISTS, drop constraint IF EXISTS, create index
-- IF NOT EXISTS. Safe to re-run.
--
-- Fixes three findings from the 2026-07-26 billing audit:
--
--   1. POISON PILL. The webhook wrote its stripe_events row BEFORE dispatching
--      the handler and never unwound it on failure, so Stripe's retry hit the
--      duplicate check and got a 200 — a transient fault dropped a paid event
--      permanently. Fix: rows carry a status, and ONLY 'completed' counts as a
--      duplicate. A pending/failed row is retryable by construction.
--
--   2. NO COMPLETION MARKER. processed_at defaulted to now() at INSERT, so it
--      recorded "seen", not "handled". Fix: the default is dropped and the
--      column is stamped by the handler on success only.
--
--   3. READ-THEN-WRITE on subscriptions. handlePlanPayment SELECTed by
--      stripe_invoice_id then INSERTed, which two concurrent deliveries can
--      both win. Fix: a UNIQUE index, matching the invoice_payments precedent
--      in 0020 (stripe_invoice_id text unique not null).

-- ─── 1. stripe_events.status ─────────────────────────────────────────────────
-- 'pending'   — row claimed, handler has not finished. RETRYABLE.
-- 'completed' — handler finished. The ONLY state that makes a redelivery a
--               duplicate.
-- 'failed'    — handler threw. RETRYABLE; kept (not deleted) so stuck events
--               stay queryable for alerting.

alter table stripe_events
  add column if not exists status text not null default 'pending';

alter table stripe_events drop constraint if exists stripe_events_status_check;
alter table stripe_events add constraint stripe_events_status_check
  check (status in ('pending','completed','failed'));

comment on column stripe_events.status is
  'pending|completed|failed. Only completed makes a redelivery a duplicate — see app/api/stripe/webhook/route.ts.';

-- ─── 2. processed_at becomes a COMPLETION marker ─────────────────────────────
-- Was `timestamptz default now()`, i.e. stamped at INSERT = "seen". The handler
-- now stamps it alongside status='completed'. NULL means "not handled yet".

alter table stripe_events alter column processed_at drop default;
alter table stripe_events alter column processed_at drop not null;

comment on column stripe_events.processed_at is
  'Set when the handler COMPLETES, never at insert. NULL = not yet handled.';

-- Backfill: every row that predates this migration was inserted with the old
-- now() default and was treated as a duplicate by the old code. Preserve that
-- verdict exactly — do not resurrect old events for reprocessing.
-- Idempotent: post-migration rows only carry processed_at once completed, so a
-- re-run can never promote a genuinely pending/failed row.
update stripe_events
   set status = 'completed'
 where processed_at is not null
   and status <> 'completed';

-- Ops: find deliveries that never finished.
create index if not exists stripe_events_unfinished
  on stripe_events (type, id)
  where status <> 'completed';

-- ─── 3. subscriptions.stripe_invoice_id UNIQUE ───────────────────────────────
-- Pre-flight. If duplicates already exist the CREATE UNIQUE INDEX below dies on
-- a bare 23505 that names an index nobody has heard of yet. Fail early instead,
-- naming the rows. These are BILLING rows: this migration deliberately does not
-- delete or merge them — that is a human call (keep the earliest, void/refund
-- the rest) and must not happen inside a schema migration.

do $$
declare
  dup_groups int;
  dup_list   text;
begin
  select count(*), coalesce(string_agg(stripe_invoice_id || ' (x' || c::text || ')', ', '), '')
    into dup_groups, dup_list
    from (
      select stripe_invoice_id, count(*) as c
        from subscriptions
       where stripe_invoice_id is not null
       group by stripe_invoice_id
      having count(*) > 1
    ) d;

  if dup_groups > 0 then
    raise exception
      'migration 0023: cannot add UNIQUE(subscriptions.stripe_invoice_id) — % invoice id(s) already duplicated: %',
      dup_groups, dup_list
      using
        errcode = 'unique_violation',
        hint    = 'Resolve by hand before re-running: keep the earliest created_at row per invoice id, void/refund the rest. Do NOT bulk-delete billing rows.';
  end if;
end $$;

-- NULLs are distinct in a Postgres unique index, so comped/manual subscriptions
-- (stripe_invoice_id IS NULL) are unaffected — any number of them may coexist.
-- This is the constraint handlePlanPayment now relies on instead of its old
-- SELECT-then-INSERT check.
create unique index if not exists subscriptions_stripe_invoice_id_key
  on subscriptions (stripe_invoice_id);
