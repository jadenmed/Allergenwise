-- AllergenWise — Seed Data
-- File: db/seed.sql
-- Purpose: demo/test data for local development. Uses fixed UUIDs for repeatability.
-- WARNING: do NOT run against production. Uses hard-coded UUIDs.
--
-- IMPORTANT — auth.users requirement:
-- The profile UUIDs (b1000000-*) reference auth.users rows. Because auth.users is
-- managed by Supabase Auth (not writable by raw SQL in production), you must create
-- matching auth.users rows before this seed will work in a real Supabase project.
--
-- Options:
--   A. Run via Supabase CLI: supabase db reset (runs migrations + seed in service-role context;
--      supabase local dev mode creates auth.users automatically for seeded profiles).
--   B. Run via psql with service-role context: psql $SERVICE_ROLE_DATABASE_URL -f db/seed.sql
--      Then manually create matching auth.users via Supabase Dashboard or Auth API.
--   C. For unit tests: mock the FK constraint or use a Supabase test project.
--
-- Seed UUIDs (fixed for repeatability):
--   Restaurant: a1000000-0000-0000-0000-000000000001
--   Admin:      b1000000-0000-0000-0000-000000000001  (email: admin@example.test)
--   Reviewer:   b1000000-0000-0000-0000-000000000002  (email: reviewer@example.test)
--   Learner:    b1000000-0000-0000-0000-000000000003  (email: learner@example.test)

-- ─── Demo restaurant ──────────────────────────────────────────────────────────

insert into restaurants (
  id, slug, name, cuisine, address, city, state, zip,
  lat, lng, phone, website, about,
  allergen_specialties, status, listed_at, listing_expires_at
) values (
  'a1000000-0000-0000-0000-000000000001',
  'demo-bistro',
  'Demo Bistro',
  'american',
  '1234 Harbor Dr',
  'San Diego',
  'CA',
  '92101',
  32.7157,
  -117.1611,
  '619-555-0100',
  'https://demobistro.example.test',
  'Demo Bistro is a family-friendly American restaurant committed to allergen-safe dining. Our entire staff is AllergenWise certified.',
  array['tree_nut_aware','gluten_free_menu','peanut_free_kitchen'],
  'listed',
  now(),
  now() + interval '12 months'
)
on conflict (id) do nothing;

-- ─── Admin profile (placeholder auth.users UUID) ──────────────────────────────
-- In real setup, this user must first be created in auth.users.
-- For seeding, we insert without FK enforcement (or use a known test UUID).

insert into profiles (
  id, full_name, email, role, restaurant_id, accepted_at
) values (
  'b1000000-0000-0000-0000-000000000001',
  'Admin User',
  'admin@example.test',
  'manager',
  'a1000000-0000-0000-0000-000000000001',
  now()
)
on conflict (id) do nothing;

-- ─── Reviewer profile (no restaurant_id) ─────────────────────────────────────

insert into profiles (
  id, full_name, email, role, restaurant_id
) values (
  'b1000000-0000-0000-0000-000000000002',
  'Reviewer User',
  'reviewer@example.test',
  'reviewer',
  null
)
on conflict (id) do nothing;

-- ─── Learner profile linked to demo restaurant ────────────────────────────────

insert into profiles (
  id, full_name, email, role, restaurant_id, job_role,
  invited_at, invited_by, accepted_at
) values (
  'b1000000-0000-0000-0000-000000000003',
  'Learner Staff',
  'learner@example.test',
  'learner',
  'a1000000-0000-0000-0000-000000000001',
  'server',
  now() - interval '5 days',
  'b1000000-0000-0000-0000-000000000001',
  now() - interval '4 days'
)
on conflict (id) do nothing;

-- ─── Curriculum (modules, lessons, checkpoint quizzes, exam pool) ───────────
-- Single source of truth: db/seed-curriculum.sql. Included here (relative to
-- this file via \ir) so `pnpm db:seed` and a direct
-- `psql -f db/seed-curriculum.sql` always produce the identical 5-section /
-- 20-lesson / 25-exam-question architecture from the Master Course Build Packet.
\ir seed-curriculum.sql

-- ─── Published review on demo restaurant ─────────────────────────────────────

insert into reviews (
  id, restaurant_id, author_name, author_email, rating, body, allergen_context, status
) values (
  'e1000000-0000-0000-0000-000000000001',
  'a1000000-0000-0000-0000-000000000001',
  'Sarah M.',
  'sarah@example.test',
  5,
  'Absolutely fantastic experience. The staff was knowledgeable about my tree nut allergy and went above and beyond to ensure my meal was safe. I finally found a place I can eat without anxiety.',
  'tree_nut',
  'published'
)
on conflict (id) do nothing;

-- ─── Sample activity events ───────────────────────────────────────────────────

insert into activity_events (id, restaurant_id, actor_id, type, payload) values
  ('f1000000-0000-0000-0000-000000000001',
   'a1000000-0000-0000-0000-000000000001',
   'b1000000-0000-0000-0000-000000000001',
   'invite_sent',
   '{"invitee_email": "learner@example.test"}'::jsonb),
  ('f1000000-0000-0000-0000-000000000002',
   'a1000000-0000-0000-0000-000000000001',
   'b1000000-0000-0000-0000-000000000003',
   'invite_accepted',
   '{"invitee_name": "Learner Staff"}'::jsonb),
  ('f1000000-0000-0000-0000-000000000003',
   'a1000000-0000-0000-0000-000000000001',
   'b1000000-0000-0000-0000-000000000003',
   'lesson_completed',
   '{"lesson_title": "The 9 Major Allergens", "module_title": "Understanding Food Allergens"}'::jsonb)
on conflict (id) do nothing;

-- ─── Sample certificates (Wave 2C — every state, Wave 4B — new format) ───────
--
-- Five demo certs, one per state, all owned by the seeded learner profile and
-- linked to the seeded restaurant. Useful for surface coverage in dev
-- (CertBadge, verify endpoint, learner certificate page, admin roster).
--
-- Wave 4B (P0 #10.a): cert codes use the new random Crockford Base32 format
-- with ISO 7064 Mod 37,36 check digit. See lib/learner/cert-code.ts. The
-- DB-level CHECK constraint in migration 0015 enforces the format — any
-- attempt to use the legacy AW-YYYY-NNNNNN form fails the INSERT.
--
-- These five codes are CHECKED-IN STATIC VALUES. They are NOT regenerated
-- on every `pnpm db:reset` because keeping them stable makes manual
-- smoke tests against the dev DB reliable (operator can navigate to
-- /verify/AW-MQSAZ-772BH-4 and expect the active cert every time). Each
-- code was generated once via generateCertCode() and pasted; if the
-- format ever changes again, regenerate via:
--   node -e "console.log(require('./lib/learner/cert-code.ts').generateCertCode())"
-- and update the values below. These are seed/test data ONLY — production
-- cert codes are minted by exam/submit via the same generator with
-- non-deterministic randomBytes input.

insert into certificates (
  id, cert_code, profile_id, restaurant_id, issued_at, expires_at,
  status, fee_charged_cents, stripe_payment_intent_id, revocation_reason, dispute_id
) values
  -- Active — paid, in-window. The default "happy path" demo cert.
  ('c1000000-0000-0000-0000-000000000001',
   'AW-MQSAZ-772BH-4',
   'b1000000-0000-0000-0000-000000000003',
   'a1000000-0000-0000-0000-000000000001',
   now() - interval '30 days',
   now() + interval '335 days',
   'active', 3500, 'pi_seed_active', NULL, NULL),
  -- Pending — awaiting cert-fee PI. Recently issued so TTL won't purge.
  ('c1000000-0000-0000-0000-000000000002',
   'AW-FG8ED-1TVVX-T',
   'b1000000-0000-0000-0000-000000000003',
   'a1000000-0000-0000-0000-000000000001',
   now() - interval '2 days',
   now() + interval '363 days',
   'pending', NULL, NULL, NULL, NULL),
  -- Expired — past expires_at, persisted by expire-certs cron.
  ('c1000000-0000-0000-0000-000000000003',
   'AW-G7TZJ-VBYJ8-R',
   'b1000000-0000-0000-0000-000000000003',
   'a1000000-0000-0000-0000-000000000001',
   now() - interval '400 days',
   now() - interval '35 days',
   'expired', 3500, 'pi_seed_expired', NULL, NULL),
  -- Revoked — refund-driven revocation.
  ('c1000000-0000-0000-0000-000000000004',
   'AW-WDZ2T-GQM6D-Y',
   'b1000000-0000-0000-0000-000000000003',
   'a1000000-0000-0000-0000-000000000001',
   now() - interval '60 days',
   now() + interval '305 days',
   'revoked', 3500, 'pi_seed_revoked', 'refund', NULL),
  -- Disputed — chargeback open. Public surfaces mask this to revoked.
  ('c1000000-0000-0000-0000-000000000005',
   'AW-19DGE-VGJPZ-N',
   'b1000000-0000-0000-0000-000000000003',
   'a1000000-0000-0000-0000-000000000001',
   now() - interval '15 days',
   now() + interval '350 days',
   'disputed', 3500, 'pi_seed_disputed', NULL, 'dp_seed_disputed')
on conflict (id) do nothing;
