/**
 * tests/integration/invites-cannot-create-manager.test.ts
 *
 * Manager Course architecture, PR 1 — §10 Q5 bootstrapping invariant.
 *
 * INVARIANT UNDER TEST
 *   Signup is the ONLY production path that creates a `manager`-role profile.
 *   The invite path (/api/invites/send) hardcodes role='learner', and the
 *   `profiles_manager_insert_learner` RLS policy (recreated by migration
 *   0022_rename_admin_to_manager.sql — renamed from profiles_admin_insert_learner)
 *   is the defense-in-depth that holds even if a caller bypasses the route
 *   handler and hits Supabase directly. The policy's WITH CHECK is:
 *       auth_role() = 'manager' AND role = 'learner' AND restaurant_id = auth_restaurant_id()
 *   so a manager may insert ONLY learner profiles for their own restaurant.
 *
 * WHAT THIS ASSERTS
 *   1. NEGATIVE — an authenticated manager performing a DIRECT insert of a
 *      profile with role='manager' is rejected by RLS (no row is created).
 *   2. POSITIVE CONTROL — the same manager CAN insert a role='learner' profile
 *      for their restaurant. This proves the policy is correctly SCOPED (it
 *      blocks the privileged role specifically) rather than failing closed on
 *      every insert, which would make the negative assertion meaningless.
 *   3. NEGATIVE — a manager cannot insert role='reviewer' either (only 'learner'
 *      is permitted).
 *
 * RLS can only be enforced by a real Postgres with the policies applied, so —
 * exactly like tests/integration/rls-hardening.test.ts and the pre-existing
 * reconcile-cert-states test — this suite SKIPS cleanly when local Supabase env
 * is not present. It is meaningful in CI / local `supabase start` where
 * migrations 0001..0022 are applied.
 *
 * profiles.id is a FK to auth.users(id); each attempted insert therefore uses a
 * real auth user id created via service-role in beforeAll, so a failure is
 * attributable to RLS and not to a foreign-key violation.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { purgeFixtures } from '../helpers/fixture-cleanup';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { hasLocalSupabase as hasLocalDb } from '../helpers/local-db';

// Load .env.local for vitest (vitest doesn't auto-load it like Next does).
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

const ts = `q5-${Date.now()}`;
const managerEmail = `${ts}-manager@example.test`;
const managerPassword = 'Q5Password!1234';

let restaurantId: string;
let managerId: string;
// Pre-created auth users (no profile yet) that the manager will TRY to back with
// a profile row of various roles.
let targetManagerAuthId: string; // for the role='manager' negative test
let targetLearnerAuthId: string; // for the role='learner' positive control
let targetReviewerAuthId: string; // for the role='reviewer' negative test

// T-25 follow-up — this note is deliberately OUTSIDE the gated describe below.
// The suite used to guard each test with an early `return`, so a run without a
// local database reported every test as PASSED while asserting nothing. It now
// skips as a block — and this note still runs, so the refusal is stated out
// loud rather than disappearing with the block.
describe('invites-cannot-create-manager — environment', () => {
  it('reports when the real-database suite is not running', () => {
    if (!hasLocalSupabase()) {
      console.log('[invites-cannot-create-manager] No local Supabase — skipping');
    }
    expect(true).toBe(true);
  });
});

describe.skipIf(!hasLocalSupabase())(
  'Q5 invariant — a manager cannot create a manager-role profile (RLS)',
  () => {
    beforeAll(async () => {
      const svc = makeServiceClient();

      // Restaurant the manager belongs to.
      const { data: rest, error: restErr } = await svc
        .from('restaurants')
        .insert({
          slug: `q5-bistro-${ts}`,
          name: `Q5 Bistro ${ts}`,
          address: '1 Q5 Way',
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

      // The acting manager: auth user + manager profile (created via service-role,
      // mirroring how signup bootstraps the first manager).
      const { data: mgrAuth, error: mgrAuthErr } = await svc.auth.admin.createUser({
        email: managerEmail,
        password: managerPassword,
        email_confirm: true,
        user_metadata: { full_name: 'Q5 Manager' },
      });
      expect(mgrAuthErr).toBeNull();
      managerId = mgrAuth.user!.id;

      const { error: mgrProfErr } = await svc.from('profiles').insert({
        id: managerId,
        full_name: 'Q5 Manager',
        email: managerEmail,
        role: 'manager',
        restaurant_id: restaurantId,
        accepted_at: new Date().toISOString(),
      });
      expect(mgrProfErr).toBeNull();

      // Three auth users WITHOUT profiles — the FK targets for the insert attempts.
      const mk = async (label: string) => {
        const { data, error } = await svc.auth.admin.createUser({
          email: `${ts}-${label}@example.test`,
          password: 'Q5Password!1234',
          email_confirm: true,
        });
        expect(error).toBeNull();
        return data.user!.id;
      };
      targetManagerAuthId = await mk('target-manager');
      targetLearnerAuthId = await mk('target-learner');
      targetReviewerAuthId = await mk('target-reviewer');
    });

    // T-30: this suite had NO teardown and leaked every run. Three of the four
    // auth users it creates deliberately have no profile row, so nothing in the
    // tenant graph points at them — they are reachable only by matching the token
    // against auth.users.email, which is what purgeFixtures does.
    afterAll(async () => {
      const { errors } = await purgeFixtures(makeServiceClient(), ts);
      if (errors.length > 0) console.error('[invites-cannot-create-manager] teardown:', errors);
    });

    it('NEGATIVE — authed manager cannot direct-insert a role=manager profile', async () => {
      const anon = makeAnonClient();
      const { error: signInErr } = await anon.auth.signInWithPassword({
        email: managerEmail,
        password: managerPassword,
      });
      expect(signInErr).toBeNull();

      // Bypass the route handler: attempt a raw insert of a SECOND manager.
      const { error: insertErr } = await anon.from('profiles').insert({
        id: targetManagerAuthId,
        full_name: 'Smuggled Manager',
        email: `${ts}-target-manager@example.test`,
        role: 'manager',
        restaurant_id: restaurantId,
        accepted_at: new Date().toISOString(),
      });

      // RLS should reject. PostgREST may surface an explicit policy error (42501 /
      // PGRST...) OR a no-op; the authoritative check is that NO row was created.
      const svc = makeServiceClient();
      const { data: row } = await svc
        .from('profiles')
        .select('id, role')
        .eq('id', targetManagerAuthId)
        .maybeSingle();

      expect(row, 'no manager profile may be created via a direct insert').toBeNull();
      // And the insert should not have silently succeeded.
      if (!insertErr) {
        // Some configs return no error on an RLS-blocked insert; the null row above
        // is the binding assertion. If a row DID exist, the expect above already failed.
      }
    });

    it('NEGATIVE — authed manager cannot direct-insert a role=reviewer profile', async () => {
      const anon = makeAnonClient();
      const { error: signInErr } = await anon.auth.signInWithPassword({
        email: managerEmail,
        password: managerPassword,
      });
      expect(signInErr).toBeNull();

      await anon.from('profiles').insert({
        id: targetReviewerAuthId,
        full_name: 'Smuggled Reviewer',
        email: `${ts}-target-reviewer@example.test`,
        role: 'reviewer',
        restaurant_id: restaurantId,
        accepted_at: new Date().toISOString(),
      });

      const svc = makeServiceClient();
      const { data: row } = await svc
        .from('profiles')
        .select('id')
        .eq('id', targetReviewerAuthId)
        .maybeSingle();

      expect(row, 'only role=learner inserts are permitted for a manager').toBeNull();
    });

    it('POSITIVE CONTROL — the same manager CAN insert a role=learner profile', async () => {
      const anon = makeAnonClient();
      const { error: signInErr } = await anon.auth.signInWithPassword({
        email: managerEmail,
        password: managerPassword,
      });
      expect(signInErr).toBeNull();

      const { error: insertErr } = await anon.from('profiles').insert({
        id: targetLearnerAuthId,
        full_name: 'Invited Learner',
        email: `${ts}-target-learner@example.test`,
        role: 'learner',
        restaurant_id: restaurantId,
        accepted_at: new Date().toISOString(),
      });
      // The policy explicitly permits this — proves the negative tests above are
      // about the ROLE value, not a blanket insert denial.
      expect(
        insertErr,
        'manager inserting a learner for their own restaurant must be allowed'
      ).toBeNull();

      const svc = makeServiceClient();
      const { data: row } = await svc
        .from('profiles')
        .select('id, role')
        .eq('id', targetLearnerAuthId)
        .maybeSingle();

      expect((row as { role: string } | null)?.role).toBe('learner');
    });
  }
);
