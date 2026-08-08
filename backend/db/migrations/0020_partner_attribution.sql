-- AllergenWise — Partner Attribution Foundation
-- Migration: 0020_partner_attribution.sql
--
-- WHAT THIS DOES (additive, idempotent — append-only; touches NO existing object
-- destructively):
--   1. brands            — grouping above restaurants (franchise rollup)
--   2. restaurants.brand_id  — nullable link restaurant → brand
--   3. partners          — channel partners earning commission
--   4. brand_attributions — partner ↔ brand link (one ACTIVE per brand)
--   5. invoice_payments  — THE COLLECTED-REVENUE LEDGER (source of truth for
--                          commission). Real rows arrive later via a Stripe
--                          invoice.paid webhook; until then it is empty/synthetic.
--   6. profiles.role     — add 'partner' (constraint swap, mirrors 0019 ordering)
--   7. profiles.partner_id + auth_partner_id() — partner identity, mirrors
--                          auth_restaurant_id() (0003_rls.sql)
--   8. commission_payouts view — 25% of COLLECTED payments only, gated by
--                          effective_date + revoke boundary, pricing-agnostic.
--
-- MONEY INVARIANT (do not regress): commission is paid on COLLECTED cash only.
--   The view sums invoice_payments ONLY — never subscriptions / contracted
--   amounts. Empty ledger ⇒ $0 payouts. No plan-name / price literals.
--
-- IDEMPOTENT: create table/index if not exists; trigger creation guarded via
--   pg_trigger lookup (mirrors 0001_init.sql); constraint dropped-then-added in
--   the correct order (drop BEFORE re-add, like 0019); create or replace for the
--   function and the view. Re-running is safe.
--
-- Run after 0019_rename_admin_to_manager.sql.
-- ─────────────────────────────────────────────────────────────────────────────

begin;

-- pgcrypto (gen_random_uuid) already installed by 0001_init.sql.

-- ─── 1. brands ───────────────────────────────────────────────────────────────

create table if not exists brands (
  id          uuid primary key default gen_random_uuid(),
  slug        text unique not null,
  name        text not null,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

do $$ begin
  if not exists (
    select 1 from pg_trigger where tgname = 'trg_brands_updated_at'
  ) then
    create trigger trg_brands_updated_at
      before update on brands
      for each row execute function set_updated_at();
  end if;
end $$;

-- ─── 2. restaurants.brand_id ─────────────────────────────────────────────────

alter table restaurants add column if not exists brand_id uuid references brands(id);

-- ─── 3. partners ─────────────────────────────────────────────────────────────

create table if not exists partners (
  id                       uuid primary key default gen_random_uuid(),
  name                     text not null,
  contact_email            text,
  default_commission_rate  numeric not null default 0.25
                             check (default_commission_rate >= 0 and default_commission_rate <= 1),
  status                   text not null default 'active'
                             check (status in ('active','inactive')),
  created_at               timestamptz default now(),
  updated_at               timestamptz default now()
);

do $$ begin
  if not exists (
    select 1 from pg_trigger where tgname = 'trg_partners_updated_at'
  ) then
    create trigger trg_partners_updated_at
      before update on partners
      for each row execute function set_updated_at();
  end if;
end $$;

-- ─── 4. brand_attributions ───────────────────────────────────────────────────

create table if not exists brand_attributions (
  id               uuid primary key default gen_random_uuid(),
  partner_id       uuid not null references partners(id),
  brand_id         uuid not null references brands(id),
  commission_rate  numeric not null default 0.25
                     check (commission_rate >= 0 and commission_rate <= 1),
  effective_date   date not null,
  status           text not null default 'active'
                     check (status in ('active','revoked')),
  revoked_at       timestamptz,
  created_at       timestamptz default now(),
  updated_at       timestamptz default now()
);

do $$ begin
  if not exists (
    select 1 from pg_trigger where tgname = 'trg_brand_attributions_updated_at'
  ) then
    create trigger trg_brand_attributions_updated_at
      before update on brand_attributions
      for each row execute function set_updated_at();
  end if;
end $$;

-- One ACTIVE attribution per brand → no double-paying the 25% (AC-2).
create unique index if not exists brand_attributions_one_active_per_brand
  on brand_attributions (brand_id)
  where status = 'active';

-- ─── 5. invoice_payments — THE COLLECTED-REVENUE LEDGER ──────────────────────
-- Source of truth for commission. paid_at = the collected timestamp = the gating
-- field. Real rows arrive only from the future Stripe invoice.paid webhook;
-- stripe_invoice_id is UNIQUE for that webhook's idempotency. Until then this
-- table is empty (synthetic seed rows only) and payouts correctly read $0.

create table if not exists invoice_payments (
  id                uuid primary key default gen_random_uuid(),
  restaurant_id     uuid not null references restaurants(id),
  subscription_id   uuid references subscriptions(id),
  stripe_invoice_id text unique not null,
  amount_cents      int not null check (amount_cents >= 0),
  currency          text not null default 'USD',
  commissionable    boolean not null default true,   -- one-time charges set false
  paid_at           timestamptz not null,            -- collected timestamp (gating)
  created_at        timestamptz default now()
);

create index if not exists invoice_payments_restaurant_paid_at
  on invoice_payments (restaurant_id, paid_at);

-- ─── 6. profiles.role — add 'partner' (drop BEFORE add) ──────────────────────
-- This branch does not include the 0019 admin→manager rename, so the admin
-- role keeps its original 'admin' spelling here.

alter table profiles drop constraint if exists profiles_role_check;
alter table profiles add constraint profiles_role_check
  check (role in ('admin','learner','reviewer','partner'));

-- ─── 7. profiles.partner_id + auth_partner_id() ──────────────────────────────
-- Nullable; NO cross-column CHECK (would risk rejecting existing rows).

alter table profiles add column if not exists partner_id uuid references partners(id);

-- Mirrors auth_restaurant_id() (0003_rls.sql): security definer, sql, stable.
create or replace function auth_partner_id()
returns uuid
language sql
stable
security definer
as $$
  select partner_id from profiles where id = auth.uid()
$$;

-- ─── 8. commission_payouts view ──────────────────────────────────────────────
-- COLLECTED-ONLY + PRICING-AGNOSTIC: reads ONLY invoice_payments, never
-- subscriptions; no plan-name / price literals. Per (partner, brand):
--   gross_collected_cents = sum(amount_cents) over payments where
--     commissionable = true
--     AND paid_at >= attribution.effective_date          (effective_date gate)
--     AND (revoked_at is null OR paid_at < revoked_at)   (revoke boundary)
--   payout_amount_cents = round(gross * commission_rate)
-- Only ACTIVE attributions are surfaced. LEFT JOINs to restaurants/payments mean
-- a brand with no collected payments yields gross 0 ⇒ payout 0 (AC-4). Integer
-- cents throughout.

create or replace view commission_payouts as
select
  partner_id,
  brand_id,
  gross_collected_cents,
  rate,
  round(gross_collected_cents * rate)::bigint as payout_amount_cents
from (
  select
    ba.partner_id,
    ba.brand_id,
    ba.commission_rate as rate,
    coalesce(
      sum(ip.amount_cents) filter (
        where ip.commissionable
          and ip.paid_at >= ba.effective_date
          and (ba.revoked_at is null or ip.paid_at < ba.revoked_at)
      ),
      0
    )::bigint as gross_collected_cents
  from brand_attributions ba
  join brands b              on b.id = ba.brand_id
  left join restaurants r    on r.brand_id = b.id
  left join invoice_payments ip on ip.restaurant_id = r.id
  where ba.status = 'active'
  group by ba.partner_id, ba.brand_id, ba.commission_rate
) sub;

commit;
