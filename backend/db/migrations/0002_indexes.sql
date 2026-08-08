-- AllergenWise — Performance Indexes
-- Migration: 0002_indexes.sql
-- Run after 0001_init.sql. All indexes from MVP_BUILD §4.
-- Idempotent: all indexes use CREATE INDEX IF NOT EXISTS.

-- ─── profiles ─────────────────────────────────────────────────────────────────

create index if not exists profiles_restaurant_role_idx
  on profiles (restaurant_id, role);

-- ─── lesson_progress ──────────────────────────────────────────────────────────

create index if not exists lesson_progress_profile_status_idx
  on lesson_progress (profile_id, status);

-- ─── certificates ─────────────────────────────────────────────────────────────

create index if not exists certificates_cert_code_idx
  on certificates (cert_code);

create index if not exists certificates_profile_active_idx
  on certificates (profile_id) where revoked = false;

-- ─── restaurants ──────────────────────────────────────────────────────────────

-- Listed restaurants filtered by date — used by directory queries
create index if not exists restaurants_status_listed_at_idx
  on restaurants (status, listed_at) where status = 'listed';

-- Full-text search on name + cuisine + city
create index if not exists restaurants_fts_idx
  on restaurants using gin (
    to_tsvector('english',
      name || ' ' || coalesce(cuisine, '') || ' ' || coalesce(city, '')
    )
  );

-- Geo proximity lookups (haversine via lat/lng)
create index if not exists restaurants_geo_idx
  on restaurants (lat, lng) where status = 'listed';

-- Trigram fuzzy search on name (pg_trgm required)
create index if not exists restaurants_name_trgm_idx
  on restaurants using gin (name gin_trgm_ops);

-- ─── submissions ──────────────────────────────────────────────────────────────

create index if not exists submissions_status_submitted_at_idx
  on submissions (status, submitted_at);

-- ─── stripe_events ────────────────────────────────────────────────────────────

create index if not exists stripe_events_processed_at_idx
  on stripe_events (processed_at);

-- ─── activity_events ──────────────────────────────────────────────────────────

create index if not exists activity_events_restaurant_created_idx
  on activity_events (restaurant_id, created_at desc);

-- ─── reviews ──────────────────────────────────────────────────────────────────

create index if not exists reviews_restaurant_status_idx
  on reviews (restaurant_id, status);

-- ─── exam_attempts ────────────────────────────────────────────────────────────

create index if not exists exam_attempts_profile_started_idx
  on exam_attempts (profile_id, started_at desc);
