-- AllergenWise — Certificate Warning Tracking
-- Migration: 0010_cert_warnings.sql
-- Purpose: tracks which (cert, threshold) pairs have already had a warning
--          email sent, so the expire-certs cron is fully idempotent.
-- Idempotent: uses CREATE TABLE IF NOT EXISTS.

create table if not exists cert_warnings (
  cert_id    uuid    not null references certificates(id) on delete cascade,
  threshold  int     not null,   -- days remaining at which warning was sent: 30, 14, or 7
  sent_at    timestamptz not null default now(),
  primary key (cert_id, threshold)
);

-- Index helps the cron join: find certs that have NOT had a warning yet
-- at a given threshold without a sequential scan of cert_warnings.
create index if not exists idx_cert_warnings_cert_id on cert_warnings(cert_id);

-- Enable RLS — service-role cron bypasses; no user-facing access needed.
alter table cert_warnings enable row level security;
-- No permissive policies: only service-role (via SUPABASE_SERVICE_ROLE_KEY)
-- should read or write cert_warnings.
