-- AllergenWise — Invite Tokens
-- Migration: 0005_invite_tokens.sql
-- Adds invite_token column to profiles for employee invite flow.
-- Idempotent: uses IF NOT EXISTS guards.
--
-- MUST be run before Agent B's /api/invites/send route goes live.
-- Run after 0004_storage.sql.

-- ─── Add invite_token column if it does not already exist ────────────────────

do $$ begin
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name   = 'profiles'
      and column_name  = 'invite_token'
  ) then
    alter table profiles
      add column invite_token text;
  end if;
end $$;

-- ─── Unique index (enforces single-use at DB level) ───────────────────────────
-- Only index non-null values — null allowed for rows without a pending invite.

create unique index if not exists profiles_invite_token_unique
  on profiles (invite_token)
  where invite_token is not null;

-- ─── B-tree index for fast lookup by token ────────────────────────────────────

create index if not exists profiles_invite_token_idx
  on profiles (invite_token)
  where invite_token is not null;

-- ─── Backfill note ────────────────────────────────────────────────────────────
-- Existing profiles rows have invite_token = NULL (no action needed).
-- New invites will have invite_token set by lib/auth/invite.ts::generateInviteToken().
