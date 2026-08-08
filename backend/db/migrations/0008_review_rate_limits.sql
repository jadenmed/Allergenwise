-- AllergenWise — Review Rate Limits
-- Migration: 0008_review_rate_limits.sql
-- Creates the rate-limit table used by POST /api/reviews/submit.
-- Idempotent: uses CREATE TABLE IF NOT EXISTS + DROP/CREATE POLICY IF EXISTS.
-- Run after 0003_rls.sql.
--
-- Purpose: Limit anonymous reviewers to 1 review per restaurant per IP per day.
-- The table uses (ip, restaurant_id) as primary key for efficient O(1) upserts.
-- The rate_limit check uses: last_at > now() - interval '24 hours'.
--
-- RLS: Only the service-role client (used by the API route) accesses this table.
-- No user-facing policies needed — deny all for user roles (RLS enabled, no
-- permissive policies created for anon/authenticated).

-- ─── Table ───────────────────────────────────────────────────────────────────

create table if not exists review_rate_limits (
  ip            text not null,
  restaurant_id uuid not null references restaurants on delete cascade,
  last_at       timestamptz not null default now(),
  primary key (ip, restaurant_id)
);

-- Index for cleanup queries (cron can delete rows older than 48h)
create index if not exists review_rate_limits_last_at_idx
  on review_rate_limits (last_at);

-- ─── RLS ─────────────────────────────────────────────────────────────────────

alter table review_rate_limits enable row level security;

-- No permissive policies for any user role.
-- Service-role key bypasses RLS entirely (used by the review submit route).
-- This effectively makes the table inaccessible to all JWT-authenticated users,
-- which is the correct behavior — this table is internal infrastructure only.
