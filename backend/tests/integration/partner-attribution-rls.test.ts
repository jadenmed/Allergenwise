/**
 * tests/integration/partner-attribution-rls.test.ts
 *
 * RLS coverage for the partner-attribution objects (migration 0020 schema,
 * 0021 policies). Proves the reviewer=admin full-view gate and the
 * service-role-only ledger:
 *
 *   AC-1  reviewer has FULL CRUD on partners / brands / brand_attributions
 *   AC-2  non-reviewer roles (manager, learner) + anon see 0 rows, writes denied
 *   AC-3  invoice_payments: reviewer can READ; NOBODY (incl. reviewer) can write
 *         via a user JWT — writes are service-role only (the webhook path)
 *   AC-4  commission_payouts readable only by reviewer (security_invoker gate);
 *         non-reviewer / anon get 0 rows
 *
 * Pattern mirrors rls-hardening.test.ts: service-role client seeds fixtures in
 * beforeAll(); every ACTUAL policy assertion uses an anon-key client signed in
 * as the relevant role so RLS is exercised (service-role bypasses RLS).
 *
 * Skips cleanly when local Supabase env is absent.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { purgeFixtures } from '../helpers/fixture-cleanup';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { hasLocalSupabase as hasLocalDb } from '../helpers/local-db';

config({ path: '.env.local' });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

// T-25 — the gate below asks whether the target database is on THIS machine,
// not merely whether the vars are set. tests/helpers/local-db.ts is the one
// definition; it reads locality from tests/env-guard.ts, so "local" means the
// same thing here, in vitest.config.ts and in playwright.config.ts.
//
// This suite also drives an ANON client to prove a policy denies something, so
// it additionally requires a usable anon key — without one the assertion cannot
// be made at all, and running would be worse than skipping.
const hasLocalSupabase = () => hasLocalDb({ anonKey: true });

function makeServiceClient(): SupabaseClient {
  return createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function makeAnonClient(): SupabaseClient {
  return createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

const ts = `pa-rls-${Date.now()}`;
const pwd = 'PaRlsPassword!1234';

const reviewerEmail = `${ts}-reviewer@example.test`;
const managerEmail = `${ts}-manager@example.test`;
const learnerEmail = `${ts}-learner@example.test`;

let restaurantId: string;
let brandId: string;
let partnerId: string;
let attributionId: string;
let paymentId: string;

/** Sign a fresh anon client in as the given role; return the authed client. */
async function signedInAs(email: string): Promise<SupabaseClient> {
  const c = makeAnonClient();
  const { error } = await c.auth.signInWithPassword({ email, password: pwd });
  expect(error).toBeNull();
  return c;
}

// T-25 follow-up — this note is deliberately OUTSIDE the gated describe below.
// The suite used to guard each test with an early `return`, so a run without a
// local database reported every test as PASSED while asserting nothing. It now
// skips as a block — and this note still runs, so the refusal is stated out
// loud rather than disappearing with the block.
describe('partner-attribution-rls — environment', () => {
  it('reports when the real-database suite is not running', () => {
    if (!hasLocalSupabase()) {
      console.log('[partner-attribution-rls] No local Supabase — skipping');
    }
    expect(true).toBe(true);
  });
});

describe.skipIf(!hasLocalSupabase())(
  'Partner-attribution RLS (reviewer=admin full-view; service-role-only ledger)',
  () => {
    beforeAll(async () => {
      const svc = makeServiceClient();

      // Restaurant under a brand (rollup target for the ledger).
      const { data: rest, error: restErr } = await svc
        .from('restaurants')
        .insert({
          slug: `pa-rls-bistro-${ts}`,
          name: `PA RLS Bistro ${ts}`,
          address: '1 PA Way',
          city: 'San Diego',
          state: 'CA',
          zip: '92101',
          phone: '619-555-0300',
          cuisine: 'american',
          status: 'unlisted',
        })
        .select('id')
        .single();
      expect(restErr).toBeNull();
      restaurantId = (rest as { id: string }).id;

      // Brand + partner + active attribution (effective long ago → counts).
      const { data: brand } = await svc
        .from('brands')
        .insert({ slug: `pa-rls-brand-${ts}`, name: `PA RLS Brand ${ts}` })
        .select('id')
        .single();
      brandId = (brand as { id: string }).id;

      await svc.from('restaurants').update({ brand_id: brandId }).eq('id', restaurantId);

      const { data: partner } = await svc
        .from('partners')
        .insert({
          name: `PA RLS Partner ${ts}`,
          contact_email: `${ts}-partner@example.test`,
          default_commission_rate: 0.25,
          status: 'active',
        })
        .select('id')
        .single();
      partnerId = (partner as { id: string }).id;

      const { data: attribution } = await svc
        .from('brand_attributions')
        .insert({
          partner_id: partnerId,
          brand_id: brandId,
          commission_rate: 0.25,
          effective_date: '2020-01-01',
          status: 'active',
        })
        .select('id')
        .single();
      attributionId = (attribution as { id: string }).id;

      // COLLECTED ledger row → gross 4000, payout 1000 for this brand.
      const { data: payment } = await svc
        .from('invoice_payments')
        .insert({
          restaurant_id: restaurantId,
          stripe_invoice_id: `TEST_in_${ts}`,
          amount_cents: 4000,
          currency: 'USD',
          commissionable: true,
          paid_at: new Date().toISOString(),
        })
        .select('id')
        .single();
      paymentId = (payment as { id: string }).id;

      // Auth users: reviewer (platform admin), manager, learner.
      for (const [email, role] of [
        [reviewerEmail, 'reviewer'],
        [managerEmail, 'manager'],
        [learnerEmail, 'learner'],
      ] as const) {
        const { data: u, error: uErr } = await svc.auth.admin.createUser({
          email,
          password: pwd,
          email_confirm: true,
        });
        expect(uErr).toBeNull();
        const { error: pErr } = await svc.from('profiles').insert({
          id: u.user!.id,
          full_name: role,
          email,
          role,
          restaurant_id: restaurantId,
          accepted_at: new Date().toISOString(),
        });
        expect(pErr).toBeNull();
      }
    });

    // T-30: this suite had NO teardown and leaked every run. It is also the only
    // one that seeds the partner-config tables, so teardown has to unhook
    // restaurants.brand_id before brands can go. The throwaway `pa-rls-rw-${ts}`
    // brand that AC-1 creates and deletes inline is covered too — it carries the
    // token, so a failure between its insert and its delete no longer leaks it.
    afterAll(async () => {
      const { errors } = await purgeFixtures(makeServiceClient(), ts);
      if (errors.length > 0) console.error('[partner-attribution-rls] teardown:', errors);
    });

    // ── AC-1: reviewer FULL CRUD on config tables ──────────────────────────────
    it('AC-1 reviewer can SELECT/INSERT/UPDATE/DELETE partners, brands, brand_attributions', async () => {
      const rv = await signedInAs(reviewerEmail);

      // SELECT
      const { data: sel } = await rv.from('partners').select('id').eq('id', partnerId);
      expect((sel ?? []).length).toBe(1);

      // INSERT + UPDATE + DELETE a throwaway brand
      const { data: ins, error: insErr } = await rv
        .from('brands')
        .insert({ slug: `pa-rls-rw-${ts}`, name: 'rw' })
        .select('id')
        .single();
      expect(insErr).toBeNull();
      const rwId = (ins as { id: string }).id;

      const { error: updErr } = await rv.from('brands').update({ name: 'rw2' }).eq('id', rwId);
      expect(updErr).toBeNull();

      const { error: delErr } = await rv.from('brands').delete().eq('id', rwId);
      expect(delErr).toBeNull();

      const svc = makeServiceClient();
      const { data: gone } = await svc.from('brands').select('id').eq('id', rwId);
      expect((gone ?? []).length).toBe(0);
    });

    // ── AC-2: non-reviewer denied ──────────────────────────────────────────────
    it('AC-2 manager and learner see 0 rows and cannot write config tables', async () => {
      for (const email of [managerEmail, learnerEmail]) {
        const c = await signedInAs(email);

        for (const table of ['partners', 'brands', 'brand_attributions', 'invoice_payments']) {
          const { data } = await c.from(table).select('id').limit(100);
          expect((data ?? []).length).toBe(0);
        }

        // Write attempt is a no-op/denied: insert a partner → must not persist.
        await c.from('partners').insert({ name: `evil-${email}`, default_commission_rate: 0.25 });
      }
      const svc = makeServiceClient();
      const { data: leaked } = await svc.from('partners').select('id').like('name', 'evil-%');
      expect((leaked ?? []).length).toBe(0);
    });

    it('AC-2 anon sees 0 rows on all partner-attribution tables', async () => {
      const anon = makeAnonClient();
      for (const table of ['partners', 'brands', 'brand_attributions', 'invoice_payments']) {
        const { data, error } = await anon.from(table).select('id').limit(100);
        expect(error?.code === 'PGRST301' || (data ?? []).length === 0).toBe(true);
      }
    });

    // ── AC-3: ledger reviewer-read-only; writes service-role only ──────────────
    it('AC-3 reviewer can READ invoice_payments but CANNOT write it (service-role only)', async () => {
      const rv = await signedInAs(reviewerEmail);

      // READ ok
      const { data: read } = await rv.from('invoice_payments').select('id').eq('id', paymentId);
      expect((read ?? []).length).toBe(1);

      // INSERT denied (no write policy for any user role)
      const forgedId = `TEST_in_forge_${ts}`;
      await rv.from('invoice_payments').insert({
        restaurant_id: restaurantId,
        stripe_invoice_id: forgedId,
        amount_cents: 999999,
        paid_at: new Date().toISOString(),
      });

      // UPDATE denied — try to inflate the existing row
      await rv.from('invoice_payments').update({ amount_cents: 999999 }).eq('id', paymentId);

      const svc = makeServiceClient();
      const { data: forged } = await svc
        .from('invoice_payments')
        .select('id')
        .eq('stripe_invoice_id', forgedId);
      expect((forged ?? []).length).toBe(0); // insert did not persist

      const { data: row } = await svc
        .from('invoice_payments')
        .select('amount_cents')
        .eq('id', paymentId)
        .single();
      expect((row as { amount_cents: number }).amount_cents).toBe(4000); // update denied
    });

    // ── AC-4: commission_payouts reviewer-only via security_invoker ────────────
    it('AC-4 reviewer sees commission_payouts rows; manager/learner/anon see none', async () => {
      const rv = await signedInAs(reviewerEmail);
      const { data: payouts } = await rv
        .from('commission_payouts')
        .select('partner_id, brand_id, gross_collected_cents, payout_amount_cents')
        .eq('brand_id', brandId);
      expect((payouts ?? []).length).toBe(1);
      const row = (payouts as { gross_collected_cents: number; payout_amount_cents: number }[])[0];
      expect(Number(row.gross_collected_cents)).toBe(4000);
      expect(Number(row.payout_amount_cents)).toBe(1000);

      for (const email of [managerEmail, learnerEmail]) {
        const c = await signedInAs(email);
        const { data } = await c.from('commission_payouts').select('brand_id').limit(100);
        expect((data ?? []).length).toBe(0);
      }

      const anon = makeAnonClient();
      const { data: anonData, error: anonErr } = await anon
        .from('commission_payouts')
        .select('brand_id')
        .limit(100);
      expect(anonErr?.code === 'PGRST301' || (anonData ?? []).length === 0).toBe(true);
    });
  }
);
