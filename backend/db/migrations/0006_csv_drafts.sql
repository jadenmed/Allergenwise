-- AllergenWise — CSV Upload Drafts
-- Migration: 0006_csv_drafts.sql
-- Adds: csv_upload_drafts table for storing parsed-but-uncommitted CSV rows.
-- Row lifetime: 1 hour (expires_at). Cron or DELETE on commit cleans up.
-- Idempotent: CREATE TABLE IF NOT EXISTS + idempotent policy drops.

-- ─── Table ────────────────────────────────────────────────────────────────────

create table if not exists csv_upload_drafts (
  id            uuid primary key default gen_random_uuid(),
  admin_id      uuid not null references profiles(id) on delete cascade,
  restaurant_id uuid not null references restaurants(id) on delete cascade,
  parsed        jsonb not null,           -- array of {email, fullName, jobRole}
  created_at    timestamptz default now(),
  expires_at    timestamptz not null      -- created_at + 1 hour
);

-- ─── Index for expiry cleanup ─────────────────────────────────────────────────

create index if not exists idx_csv_upload_drafts_expires_at on csv_upload_drafts (expires_at);
create index if not exists idx_csv_upload_drafts_admin_id   on csv_upload_drafts (admin_id);

-- ─── RLS ─────────────────────────────────────────────────────────────────────

alter table csv_upload_drafts enable row level security;

drop policy if exists "csv_drafts_admin_select_own" on csv_upload_drafts;
drop policy if exists "csv_drafts_admin_insert_own" on csv_upload_drafts;
drop policy if exists "csv_drafts_admin_delete_own" on csv_upload_drafts;

-- Admin can select their own drafts
create policy "csv_drafts_admin_select_own"
  on csv_upload_drafts for select
  using (
    admin_id = auth.uid()
    and restaurant_id = auth_restaurant_id()
  );

-- Admin can insert new drafts
create policy "csv_drafts_admin_insert_own"
  on csv_upload_drafts for insert
  with check (
    admin_id = auth.uid()
    and restaurant_id = auth_restaurant_id()
  );

-- Admin can delete their own drafts (e.g. cancel a pending upload)
create policy "csv_drafts_admin_delete_own"
  on csv_upload_drafts for delete
  using (
    admin_id = auth.uid()
    and restaurant_id = auth_restaurant_id()
  );

-- Service role bypasses RLS — used by route handler for commit/cleanup.
