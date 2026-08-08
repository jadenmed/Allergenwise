-- ─── Migration 0013 — Wave 2C cert state machine ───────────────────────────
--
-- Adds the canonical `status` enum-via-CHECK column to certificates so the
-- public directory + verify + learner surfaces stop drifting (F-S2/F-S3/F-S4/
-- F-S5). Drops the `revoked` boolean — its information is fully encoded by
-- `status='revoked'`, and keeping both columns is the structural source of
-- the naked `.eq('revoked', false)` anti-pattern.
--
-- Per audits/cert-payment-state-design.md, the 5 states are:
--   pending  — cert exists, no payment confirmed yet (invisible publicly)
--   active   — paid, valid, within window
--   expired  — past expires_at (cron-flipped, not in-memory-computed)
--   revoked  — manual admin OR refund OR dispute_lost
--   disputed — chargeback dispute open; publicly displayed as revoked

-- Step 1: add the status column with a temporary default so existing rows
-- get a value, then we'll backfill with the right state.
alter table certificates
  add column if not exists status text not null default 'pending'
    check (status in ('pending', 'active', 'expired', 'revoked', 'disputed'));

alter table certificates
  add column if not exists status_changed_at timestamptz not null default now();

alter table certificates
  add column if not exists revocation_reason text
    check (revocation_reason in ('refund', 'dispute_lost', 'admin', 'expired')
           or revocation_reason is null);

alter table certificates
  add column if not exists dispute_id text;

alter table certificates
  add column if not exists disputed_at timestamptz;

-- Step 2: backfill from the legacy `revoked` boolean + expires_at signal.
-- Pre-launch, this is the dev-DB transition. Production launch uses the
-- reconciliation script (scripts/reconcile-cert-states.ts) which is more
-- thorough — it cross-references stripe_events for refunds/disputes.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'certificates'
      and column_name = 'revoked'
  ) then
    update certificates
    set status = case
      when revoked = true then 'revoked'
      when expires_at < now() then 'expired'
      else 'active'
    end,
    status_changed_at = coalesce(updated_at, issued_at, now()),
    revocation_reason = case
      when revoked = true then 'admin'
      else null
    end
    where status = 'pending';
  end if;
end $$;

-- Step 3: drop the legacy `revoked` boolean.
-- Forces every naked `.eq('revoked', false)` anywhere in app code to fail
-- at TypeScript compile time, which is the structural F-S2/F-S3/F-S4/F-S5
-- closure.
alter table certificates drop column if exists revoked;

-- Step 4: the canonical-hot-path index. Backs the
-- `countPubliclyActiveCerts(restaurantId)` helper.
create index if not exists certificates_restaurant_status_idx
  on certificates (restaurant_id, status)
  where status = 'active';

-- Step 5: secondary index for the per-learner reads (F-S4 / F-S5 helper).
create index if not exists certificates_profile_status_issued_at_idx
  on certificates (profile_id, status, issued_at desc);

-- Step 6: index for the TTL purge cron (purge-stale-pending-certs).
create index if not exists certificates_pending_issued_at_idx
  on certificates (issued_at)
  where status = 'pending';

-- Step 7: index for the refund/dispute reverse lookup
-- (charge.refunded → certs WHERE stripe_payment_intent_id = pi_id).
create index if not exists certificates_stripe_pi_idx
  on certificates (stripe_payment_intent_id)
  where stripe_payment_intent_id is not null;
