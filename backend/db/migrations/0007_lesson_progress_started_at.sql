-- AllergenWise — Add started_at to lesson_progress
-- Migration: 0007_lesson_progress_started_at.sql
-- Adds `started_at` for anti-cheat: wall-clock elapsed time check.
-- Idempotent: uses IF NOT EXISTS guard.

alter table lesson_progress
  add column if not exists started_at timestamptz default now();

-- Backfill existing rows so NOT NULL constraint could be added later
update lesson_progress
set started_at = coalesce(started_at, updated_at, now())
where started_at is null;
