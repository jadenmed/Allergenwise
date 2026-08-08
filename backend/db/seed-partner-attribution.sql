-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║  SYNTHETIC TEST DATA — NOT REAL COLLECTED REVENUE.                         ║
-- ║  Delete before production. Real invoice_payments rows come ONLY from the   ║
-- ║  Stripe invoice.paid webhook (a later phase). Every stripe_invoice_id      ║
-- ║  below is an obviously-fake 'TEST_in_*' value.                             ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝
--
-- AllergenWise — Partner Attribution seed
-- File: db/seed-partner-attribution.sql
--
-- PURPOSE: make commission_payouts testable end-to-end. Exercises:
--   • franchise rollup    — two restaurants under one brand (AC-1)
--   • collected 25%        — payout = round(0.25 * collected) (AC-3)
--   • effective_date gate  — a payment before effective_date is excluded
--   • commissionable=false — one-time charge excluded
--   • revoke               — a revoked attribution never appears in payouts
--   • empty-ledger ⇒ $0    — delete the TEST_in_* rows and every payout → 0 (AC-4)
--
-- RUN ORDER: after db/seed.sql (it creates restaurant demo-bistro = a1..0001,
--   which this file links to a brand and ties payments to). Idempotent: fixed
--   UUIDs + `on conflict do nothing`; the brand_id UPDATEs are naturally
--   idempotent. Re-running changes nothing.
--
-- TO RESET TO $0 (prove no test/contracted data leaks in):
--   delete from invoice_payments where stripe_invoice_id like 'TEST_in_%';
--
-- Fixed UUIDs:
--   Partner A   d1000000-0000-0000-0000-000000000001  (broad, effective 2020-01-01)
--   Partner B   d1000000-0000-0000-0000-000000000002  (new-only, effective today)
--   Brand 1     d2000000-0000-0000-0000-000000000001  (demo-group: 2 restaurants)
--   Brand 2     d2000000-0000-0000-0000-000000000002  (solo-brand: 1 restaurant)
--   Restaurant  a1000000-0000-0000-0000-000000000001  (demo-bistro — from seed.sql)
--   Restaurant  a1000000-0000-0000-0000-000000000002  (demo-bistro-downtown — NEW)
--   Restaurant  a1000000-0000-0000-0000-000000000003  (solo-eatery — NEW)
-- ─────────────────────────────────────────────────────────────────────────────

begin;

-- ─── Partners ────────────────────────────────────────────────────────────────

insert into partners (id, name, contact_email, default_commission_rate, status) values
  ('d1000000-0000-0000-0000-000000000001', 'Partner A (Broadline)', 'partner-a@example.test', 0.25, 'active'),
  ('d1000000-0000-0000-0000-000000000002', 'Partner B (Newcomer)',  'partner-b@example.test', 0.25, 'active')
on conflict (id) do nothing;

-- ─── Brands ──────────────────────────────────────────────────────────────────

insert into brands (id, slug, name) values
  ('d2000000-0000-0000-0000-000000000001', 'demo-group', 'Demo Group'),
  ('d2000000-0000-0000-0000-000000000002', 'solo-brand', 'Solo Brand')
on conflict (id) do nothing;

-- ─── Restaurants ─────────────────────────────────────────────────────────────
-- Two NEW synthetic restaurants (status default 'unlisted'). Plus link the
-- existing demo-bistro to Brand 1 so Brand 1 has TWO restaurants (rollup).

insert into restaurants (id, slug, name, brand_id) values
  ('a1000000-0000-0000-0000-000000000002', 'demo-bistro-downtown', 'Demo Bistro — Downtown',
     'd2000000-0000-0000-0000-000000000001'),
  ('a1000000-0000-0000-0000-000000000003', 'solo-eatery', 'Solo Eatery',
     'd2000000-0000-0000-0000-000000000002')
on conflict (id) do nothing;

-- Link the existing demo-bistro (created by db/seed.sql) to Brand 1.
update restaurants set brand_id = 'd2000000-0000-0000-0000-000000000001'
  where id = 'a1000000-0000-0000-0000-000000000001';

-- ─── Brand attributions ──────────────────────────────────────────────────────
-- A→Brand1 active since 2020-01-01 (broad: credits the whole tree).
-- B→Brand2 active effective TODAY (new-only: pre-today payments excluded).
-- A→Brand2 REVOKED (never surfaces in payouts; status<>'active'). Demonstrates
--   reassignment without violating the one-active-per-brand index (Brand2's only
--   ACTIVE attribution is B's).

insert into brand_attributions
  (id, partner_id, brand_id, commission_rate, effective_date, status, revoked_at) values
  ('d3000000-0000-0000-0000-000000000001',
     'd1000000-0000-0000-0000-000000000001', 'd2000000-0000-0000-0000-000000000001',
     0.25, date '2020-01-01', 'active', null),
  ('d3000000-0000-0000-0000-000000000002',
     'd1000000-0000-0000-0000-000000000002', 'd2000000-0000-0000-0000-000000000002',
     0.25, current_date, 'active', null),
  ('d3000000-0000-0000-0000-000000000003',
     'd1000000-0000-0000-0000-000000000001', 'd2000000-0000-0000-0000-000000000002',
     0.25, date '2020-01-01', 'revoked', now() - interval '400 days')
on conflict (id) do nothing;

-- ─── invoice_payments — SYNTHETIC COLLECTED LEDGER ROWS ──────────────────────
-- Brand 1 (demo-group, Partner A): collected commissionable = 5000 + 3000 + 2000
--   = 10000 ⇒ payout 2500. The 9900 one-time charge is commissionable=false
--   (excluded). Spread across BOTH restaurants to prove rollup (AC-1).
-- Brand 2 (solo-brand, Partner B, effective today): the 4000 paid today counts
--   ⇒ payout 1000; the 8000 paid ~1yr ago is BEFORE effective_date (excluded).

insert into invoice_payments
  (restaurant_id, stripe_invoice_id, amount_cents, currency, commissionable, paid_at) values
  -- Brand 1 / demo-bistro
  ('a1000000-0000-0000-0000-000000000001', 'TEST_in_0001', 5000, 'USD', true,  now() - interval '30 days'),
  ('a1000000-0000-0000-0000-000000000001', 'TEST_in_0002', 3000, 'USD', true,  now() - interval '10 days'),
  ('a1000000-0000-0000-0000-000000000001', 'TEST_in_0003', 9900, 'USD', false, now() - interval '5 days'),
  -- Brand 1 / demo-bistro-downtown
  ('a1000000-0000-0000-0000-000000000002', 'TEST_in_0004', 2000, 'USD', true,  now() - interval '15 days'),
  -- Brand 2 / solo-eatery
  ('a1000000-0000-0000-0000-000000000003', 'TEST_in_0005', 4000, 'USD', true,  now()),
  ('a1000000-0000-0000-0000-000000000003', 'TEST_in_0006', 8000, 'USD', true,  now() - interval '365 days')
on conflict (stripe_invoice_id) do nothing;

commit;

-- ─── Expected commission_payouts after this seed ─────────────────────────────
--   Partner A / Brand 1 (demo-group):  gross 10000, rate 0.25, payout 2500
--   Partner B / Brand 2 (solo-brand):  gross  4000, rate 0.25, payout 1000
--   (Partner A / Brand 2 revoked row → absent.)
-- After `delete from invoice_payments where stripe_invoice_id like 'TEST_in_%'`:
--   both rows → gross 0, payout 0.
