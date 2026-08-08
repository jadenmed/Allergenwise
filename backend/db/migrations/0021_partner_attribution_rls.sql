-- AllergenWise — Partner Attribution Row Level Security
-- Migration: 0021_partner_attribution_rls.sql
--
-- WHAT THIS DOES (additive, idempotent): locks down the partner-attribution
-- objects created in 0020 so ONLY the platform-admin audience can see partner /
-- commission data.
--   1. enable RLS on brands, partners, brand_attributions, invoice_payments
--   2. reviewer FULL CRUD on partners / brands / brand_attributions (config tables)
--   3. invoice_payments — reviewer READ ONLY; NO user write policy at all
--   4. commission_payouts view → security_invoker = on (so underlying RLS applies)
--
-- AUDIENCE: reviewer = client/admin full-view (confirmed at 01-01 checkpoint). This
--   is platform-owner data, NOT tenant data — manager/learner/partner get nothing.
--   Partner-scoped read (a partner seeing only their own payouts) is Phase 2.
--
-- MONEY INVARIANT GUARD: invoice_payments is the COLLECTED-revenue ledger and is
--   the source of truth for commission. There is NO human/admin write path here —
--   rows arrive ONLY from the Stripe invoice.paid webhook via the service-role key
--   (which bypasses RLS). RLS-enabled + zero write policy = users cannot write.
--   Any future real-world correction goes through a separate AUDITED adjustment
--   path, never a raw write to this table.
--
-- SECURITY DEFINER LEAK FIX: a Postgres view runs with the view OWNER's rights by
--   default (security definer), which would let any caller with SELECT on the view
--   read EVERY partner's payouts, bypassing the base-table RLS. Setting
--   security_invoker = on makes the view run with the CALLER's rights, so the
--   reviewer-only policies on brand_attributions / brands / restaurants /
--   invoice_payments are enforced through the view. Non-reviewers get zero rows.
--
-- IDEMPOTENT: enable RLS is a no-op if already enabled; every policy is dropped
--   (drop policy if exists) before create, mirroring 0003_rls.sql; alter view ...
--   set is naturally idempotent. Re-running is safe.
--
-- Avoid: referencing role 'admin' (renamed to 'manager' in 0019 — would silently
--   never match); any write policy on invoice_payments; security definer on view.
--
-- Run after 0020_partner_attribution.sql.
-- ─────────────────────────────────────────────────────────────────────────────

begin;

-- ─── 1. Enable RLS ───────────────────────────────────────────────────────────

alter table brands              enable row level security;
alter table partners            enable row level security;
alter table brand_attributions  enable row level security;
alter table invoice_payments    enable row level security;

-- ─── 2. partners — reviewer FULL CRUD ────────────────────────────────────────

drop policy if exists "partners_reviewer_select"  on partners;
drop policy if exists "partners_reviewer_insert"  on partners;
drop policy if exists "partners_reviewer_update"  on partners;
drop policy if exists "partners_reviewer_delete"  on partners;

create policy "partners_reviewer_select"
  on partners for select
  using (auth_role() = 'reviewer');

create policy "partners_reviewer_insert"
  on partners for insert
  with check (auth_role() = 'reviewer');

create policy "partners_reviewer_update"
  on partners for update
  using (auth_role() = 'reviewer')
  with check (auth_role() = 'reviewer');

create policy "partners_reviewer_delete"
  on partners for delete
  using (auth_role() = 'reviewer');

-- ─── 3. brands — reviewer FULL CRUD ──────────────────────────────────────────

drop policy if exists "brands_reviewer_select"  on brands;
drop policy if exists "brands_reviewer_insert"  on brands;
drop policy if exists "brands_reviewer_update"  on brands;
drop policy if exists "brands_reviewer_delete"  on brands;

create policy "brands_reviewer_select"
  on brands for select
  using (auth_role() = 'reviewer');

create policy "brands_reviewer_insert"
  on brands for insert
  with check (auth_role() = 'reviewer');

create policy "brands_reviewer_update"
  on brands for update
  using (auth_role() = 'reviewer')
  with check (auth_role() = 'reviewer');

create policy "brands_reviewer_delete"
  on brands for delete
  using (auth_role() = 'reviewer');

-- ─── 4. brand_attributions — reviewer FULL CRUD ──────────────────────────────

drop policy if exists "brand_attributions_reviewer_select"  on brand_attributions;
drop policy if exists "brand_attributions_reviewer_insert"  on brand_attributions;
drop policy if exists "brand_attributions_reviewer_update"  on brand_attributions;
drop policy if exists "brand_attributions_reviewer_delete"  on brand_attributions;

create policy "brand_attributions_reviewer_select"
  on brand_attributions for select
  using (auth_role() = 'reviewer');

create policy "brand_attributions_reviewer_insert"
  on brand_attributions for insert
  with check (auth_role() = 'reviewer');

create policy "brand_attributions_reviewer_update"
  on brand_attributions for update
  using (auth_role() = 'reviewer')
  with check (auth_role() = 'reviewer');

create policy "brand_attributions_reviewer_delete"
  on brand_attributions for delete
  using (auth_role() = 'reviewer');

-- ─── 5. invoice_payments — reviewer READ ONLY (no user write path) ────────────
-- Reviewer can read the ledger. NO insert/update/delete policy exists for ANY
-- user role — writes are service-role only (the Stripe invoice.paid webhook).

drop policy if exists "invoice_payments_reviewer_select" on invoice_payments;

create policy "invoice_payments_reviewer_select"
  on invoice_payments for select
  using (auth_role() = 'reviewer');

-- ─── 6. commission_payouts view → invoker security ───────────────────────────
-- Run with the CALLER's rights so base-table RLS (reviewer-only) is enforced.
-- restaurants already has "restaurants_reviewer_read_all" (0003); brands /
-- brand_attributions / invoice_payments get reviewer select above.

alter view commission_payouts set (security_invoker = on);

commit;
