-- ─── Migration 0011 — Wave 2A RLS hardening ─────────────────────────────────
--
-- Drops policies that are dead code from an app-route perspective but live
-- attack surface for direct anon-key / user-role-JWT Supabase calls. Every
-- production write to the affected tables uses a service-role client (which
-- bypasses RLS by design) or a SECURITY DEFINER RPC. Verified per-callsite
-- in audits/wave-2a-write-path-verification.md before this migration ran.
--
-- Findings closed:
--   P0 #3  certificates_public_read_by_cert_code      using(true)
--   P0 #4  exam_attempts_learner_update_own           no WITH CHECK on UPDATE
--   F-S1   restaurants_public_read_listed             using(status='listed') only
-- Audit follow-ons (same class as P0 #4, found while auditing UPDATE policies):
--   profiles_update_self                              role-escalation vector
--   lesson_progress_learner_update_own                lesson-completion forgery
--   restaurants_admin_update_own                      bypass listing/status flow
--   submissions_reviewer_update_all                   bypass decide_submission RPC
--   reviews_reviewer_update_all                       same shape

-- ─── P0 #3 — certificates ─────────────────────────────────────────────────────
-- Verify endpoint at /api/certs/[certCode]/verify uses createServiceSupabase
-- and projects only { status, restaurantName, issuedAt, expiresAt }. The other
-- three certificates SELECT policies (learner_read_own, admin_read_restaurant,
-- reviewer_read_all) remain in place for authed in-app surfaces.
drop policy if exists "certificates_public_read_by_cert_code" on certificates;

-- ─── F-S1 — restaurants public SELECT ────────────────────────────────────────
-- Every public consumer (/api/directory/[slug], /api/search,
-- lib/directory/search.ts, /api/reviews/submit) uses service-role and
-- additionally filters listing_expires_at. The remaining restaurants SELECT
-- policies (admin_read_own, reviewer_read_all) cover authed in-app paths.
drop policy if exists "restaurants_public_read_listed" on restaurants;

-- ─── P0 #4 — exam_attempts UPDATE ─────────────────────────────────────────────
-- /api/exam/submit and /api/cron/exam-timeout-sweep both write via service-role.
-- Learners never need direct UPDATE access; the policy only enabled forgery.
drop policy if exists "exam_attempts_learner_update_own" on exam_attempts;

-- ─── Audit follow-on — profiles UPDATE ───────────────────────────────────────
-- All profile writes (/api/auth/signup, /api/auth/invite/accept, /api/invites/*,
-- /api/admin/csv-upload) use service-role. The self-UPDATE policy enabled
-- learners to promote themselves to role='admin' via direct Supabase client.
drop policy if exists "profiles_update_self" on profiles;

-- ─── Audit follow-on — lesson_progress UPDATE ────────────────────────────────
-- /api/lesson/progress and /api/lesson/[id]/complete both write via service-role
-- after handler-level watched_seconds + module-lock checks. Direct user-role
-- UPDATE allowed bypassing those checks to mark all lessons complete.
drop policy if exists "lesson_progress_learner_update_own" on lesson_progress;

-- ─── Audit follow-on — restaurants admin UPDATE ──────────────────────────────
-- All restaurant mutations route through /api/submissions/create (service-role)
-- or the decide_submission SECURITY DEFINER RPC. The direct admin-update
-- policy allowed bypassing the reviewer flow to set status='listed'.
drop policy if exists "restaurants_admin_update_own" on restaurants;

-- ─── Audit follow-on — submissions reviewer UPDATE ───────────────────────────
-- decide_submission is the canonical reviewer write path; webhook updates
-- payment fields via service-role. The reviewer-update policy let any
-- reviewer overwrite arbitrary submission fields (cert_fee_total_cents,
-- stripe_payment_intent_id, etc.) bypassing the RPC's transition guards.
drop policy if exists "submissions_reviewer_update_all" on submissions;

-- ─── Audit follow-on — reviews reviewer UPDATE ───────────────────────────────
-- /api/reviewer/reviews/[id]/decide writes via service-role. The reviewer-
-- update policy allowed broad mutation of review rows including author fields.
drop policy if exists "reviews_reviewer_update_all" on reviews;

-- Note: storage policy `restaurant_photos_admin_update` (0004_storage.sql:52)
-- is the same class but its only consumer (SubmitClient.tsx browser-side
-- Supabase Storage upload) breaks anyway under P0 #8 cookie hardening. The
-- right fix is a server-side upload route (logged as F-S6 in followups).
-- That migration does NOT touch storage policies; do that in Wave 2A.5.
