-- AllergenWise — Initial Schema
-- Migration: 0001_init.sql
-- Idempotent: uses CREATE TABLE IF NOT EXISTS, CREATE OR REPLACE for functions/triggers.
-- Run AFTER creating the Supabase project. Extensions, tables, triggers.

-- ─── Extensions ────────────────────────────────────────────────────────────────

create extension if not exists "pgcrypto";
create extension if not exists "pg_trgm";

-- ─── updated_at trigger function ──────────────────────────────────────────────

create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ─── Restaurants (tenants) ─────────────────────────────────────────────────────

create table if not exists restaurants (
  id                  uuid primary key default gen_random_uuid(),
  slug                text unique not null,
  name                text not null,
  cuisine             text,
  address             text,
  city                text,
  state               text,
  zip                 text,
  lat                 numeric,
  lng                 numeric,
  phone               text,
  website             text,
  hero_photo_url      text,
  about               text,
  hours_json          jsonb,
  allergen_specialties text[],
  status              text not null default 'unlisted'
                        check (status in ('unlisted','pending_review','in_review','listed','paused','rejected')),
  listed_at           timestamptz,
  listing_expires_at  timestamptz,
  stripe_customer_id  text unique,
  created_at          timestamptz default now(),
  updated_at          timestamptz default now()
);

-- Trigger: only create if it doesn't already exist
do $$ begin
  if not exists (
    select 1 from pg_trigger where tgname = 'trg_restaurants_updated_at'
  ) then
    create trigger trg_restaurants_updated_at
      before update on restaurants
      for each row execute function set_updated_at();
  end if;
end $$;

-- ─── Profiles (all users: admin, learner, reviewer) ───────────────────────────

create table if not exists profiles (
  id            uuid primary key references auth.users on delete cascade,
  full_name     text not null,
  email         text not null unique,
  role          text not null check (role in ('admin','learner','reviewer')),
  restaurant_id uuid references restaurants,
  job_role      text,
  invited_at    timestamptz,
  invited_by    uuid references profiles,
  accepted_at   timestamptz,
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);

do $$ begin
  if not exists (
    select 1 from pg_trigger where tgname = 'trg_profiles_updated_at'
  ) then
    create trigger trg_profiles_updated_at
      before update on profiles
      for each row execute function set_updated_at();
  end if;
end $$;

-- ─── Subscriptions ────────────────────────────────────────────────────────────

create table if not exists subscriptions (
  id                      uuid primary key default gen_random_uuid(),
  restaurant_id           uuid not null references restaurants,
  plan                    text not null check (plan in ('quarterly','semiannual')),
  starts_at               date not null,
  ends_at                 date not null,
  amount_cents            int not null,
  status                  text not null check (status in ('active','expired','canceled')),
  stripe_subscription_id  text,
  stripe_invoice_id       text,
  auto_renew              boolean default false,
  created_at              timestamptz default now(),
  updated_at              timestamptz default now()
);

do $$ begin
  if not exists (
    select 1 from pg_trigger where tgname = 'trg_subscriptions_updated_at'
  ) then
    create trigger trg_subscriptions_updated_at
      before update on subscriptions
      for each row execute function set_updated_at();
  end if;
end $$;

-- ─── Course content ───────────────────────────────────────────────────────────

create table if not exists modules (
  id                  uuid primary key default gen_random_uuid(),
  order_index         int not null unique,
  title               text not null,
  description         text,
  estimated_minutes   int
);

create table if not exists lessons (
  id                        uuid primary key default gen_random_uuid(),
  module_id                 uuid not null references modules on delete cascade,
  order_index               int not null,
  title                     text not null,
  body_md                   text,
  video_mux_playback_id     text,
  video_duration_seconds    int,
  quick_check_question      text,
  quick_check_options       jsonb,
  unique (module_id, order_index)
);

create table if not exists exam_questions (
  id          uuid primary key default gen_random_uuid(),
  question    text not null,
  options     jsonb not null,
  module_id   uuid references modules,
  difficulty  text check (difficulty in ('easy','medium','hard'))
);

-- ─── Learner progress ─────────────────────────────────────────────────────────

create table if not exists lesson_progress (
  id              uuid primary key default gen_random_uuid(),
  profile_id      uuid not null references profiles,
  lesson_id       uuid not null references lessons,
  status          text not null default 'not_started'
                    check (status in ('not_started','in_progress','complete')),
  watched_seconds int default 0,
  completed_at    timestamptz,
  updated_at      timestamptz default now(),
  unique (profile_id, lesson_id)
);

do $$ begin
  if not exists (
    select 1 from pg_trigger where tgname = 'trg_lesson_progress_updated_at'
  ) then
    create trigger trg_lesson_progress_updated_at
      before update on lesson_progress
      for each row execute function set_updated_at();
  end if;
end $$;

create table if not exists exam_attempts (
  id                  uuid primary key default gen_random_uuid(),
  profile_id          uuid not null references profiles,
  started_at          timestamptz default now(),
  submitted_at        timestamptz,
  time_limit_seconds  int default 1800,
  score_percent       int,
  passed              boolean,
  answers             jsonb,
  updated_at          timestamptz default now()
);

do $$ begin
  if not exists (
    select 1 from pg_trigger where tgname = 'trg_exam_attempts_updated_at'
  ) then
    create trigger trg_exam_attempts_updated_at
      before update on exam_attempts
      for each row execute function set_updated_at();
  end if;
end $$;

-- ─── Certificates ─────────────────────────────────────────────────────────────

create table if not exists certificates (
  id                        uuid primary key default gen_random_uuid(),
  cert_code                 text unique not null,
  profile_id                uuid not null references profiles,
  restaurant_id             uuid not null references restaurants,
  exam_attempt_id           uuid references exam_attempts,
  issued_at                 timestamptz default now(),
  expires_at                timestamptz not null,
  pdf_storage_path          text,
  revoked                   boolean default false,
  fee_charged_cents         int,
  stripe_payment_intent_id  text,
  updated_at                timestamptz default now()
);

do $$ begin
  if not exists (
    select 1 from pg_trigger where tgname = 'trg_certificates_updated_at'
  ) then
    create trigger trg_certificates_updated_at
      before update on certificates
      for each row execute function set_updated_at();
  end if;
end $$;

-- ─── Submissions ──────────────────────────────────────────────────────────────

create table if not exists submissions (
  id                        uuid primary key default gen_random_uuid(),
  restaurant_id             uuid not null references restaurants,
  submitted_by              uuid not null references profiles,
  submitted_at              timestamptz default now(),
  status                    text not null default 'pending'
                              check (status in ('pending','in_review','approved','rejected','info_requested')),
  reviewer_id               uuid references profiles,
  reviewer_notes            text,
  decided_at                timestamptz,
  cert_fee_total_cents      int,
  stripe_payment_intent_id  text,
  updated_at                timestamptz default now()
);

do $$ begin
  if not exists (
    select 1 from pg_trigger where tgname = 'trg_submissions_updated_at'
  ) then
    create trigger trg_submissions_updated_at
      before update on submissions
      for each row execute function set_updated_at();
  end if;
end $$;

-- ─── Public reviews ───────────────────────────────────────────────────────────

create table if not exists reviews (
  id                uuid primary key default gen_random_uuid(),
  restaurant_id     uuid not null references restaurants,
  author_name       text not null,
  author_email      text,
  rating            int not null check (rating between 1 and 5),
  body              text not null,
  allergen_context  text,
  status            text not null default 'pending'
                      check (status in ('pending','published','hidden')),
  created_at        timestamptz default now(),
  updated_at        timestamptz default now()
);

do $$ begin
  if not exists (
    select 1 from pg_trigger where tgname = 'trg_reviews_updated_at'
  ) then
    create trigger trg_reviews_updated_at
      before update on reviews
      for each row execute function set_updated_at();
  end if;
end $$;

-- ─── Activity events (admin dashboard feed) ───────────────────────────────────

-- Append-only table — no updated_at trigger needed.
create table if not exists activity_events (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid references restaurants,
  actor_id      uuid references profiles,
  type          text not null,
  payload       jsonb,
  created_at    timestamptz default now()
);

-- ─── Stripe event idempotency ─────────────────────────────────────────────────

-- Append-only table — no updated_at trigger needed.
create table if not exists stripe_events (
  id            text primary key,
  type          text not null,
  processed_at  timestamptz default now()
);
