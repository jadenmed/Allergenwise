/**
 * @vitest-environment node
 */
/**
 * tests/integration/departed-staff-rls.test.ts
 *
 * T-46a — the read-cut at the DATABASE layer, against real Postgres.
 *
 * tests/unit/departed-read-cut.test.ts proves the route handlers refuse a
 * departed caller. This file proves the thing underneath, which is the one that
 * would still have leaked had we stopped at TypeScript:
 *
 *   restaurant_id STAYS POPULATED after departure — certificates reference it,
 *   and it is what lets the database still state "certified while at X". So a
 *   departed person's row continues to LOOK like a member of that restaurant.
 *   All 19 live policies scope on auth_restaurant_id(), and before 0026 that
 *   helper was `select restaurant_id from profiles where id = auth.uid()` with
 *   no membership predicate. Their Postgres session therefore kept satisfying
 *   every one of those policies even when no route would hand them anything.
 *
 * 0026 redefines that single function to return NULL for departed staff. Every
 * dependent clause is a positive equality or a positive EXISTS, so all 19 fail
 * closed at once and not one policy is rewritten.
 *
 * WHICH ACCOUNT ACTUALLY HOLDS THOSE GRANTS — checked, not assumed. All 19
 * restaurant-scoped policies are `auth_role() = 'manager' AND … =
 * auth_restaurant_id()`. A LEARNER therefore never held one: their access is
 * entirely auth.uid()-based. An earlier draft of this file asserted "a departed
 * learner reads no colleagues" and passed identically against a reverted
 * pre-0026 helper — a vacuous test. The MANAGER assertions below are the ones
 * that fail without the migration, so they are the ones that matter.
 *
 * Asserted here with anon-key clients signed in as real users:
 *   1. BEFORE departure the manager reads colleagues, the restaurant,
 *      submissions, certificates, billing and activity (the control — without
 *      it, an always-empty result would prove nothing).
 *   2. AFTER departure every one of those returns nothing, and the one WITH
 *      CHECK clause among the 19 rejects an insert.
 *   3. auth_restaurant_id() goes from the restaurant id to NULL.
 *   4. The departed learner's OWN profile, certificate and exam attempt stay
 *      readable — profiles_read_self and friends key on auth.uid().
 *   5. The certificate row is untouched: still status='active', same
 *      expires_at, still naming the restaurant it was earned at.
 *   6. The PUBLIC directory denominator shrinks — through a real route call.
 *
 * Skips cleanly when local Supabase is not configured.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { purgeFixtures } from '../helpers/fixture-cleanup';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { generateCertCode } from '@/lib/learner/cert-code';
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

const ts = `t46a-${Date.now()}`;
const slug = `departed-bistro-${ts}`;
const learnerEmail = `${ts}-learner@example.test`;
const colleagueEmail = `${ts}-colleague@example.test`;
const managerEmail = `${ts}-manager@example.test`;
const password = 'DepartedPassword!1234';

let learnerId: string;
let managerId: string;
let restaurantId: string;
let certId: string;
let certExpiresAt: string;
let attemptId: string;

/** Signs in and returns an RLS-scoped client for that person. */
async function signedInAs(email: string): Promise<SupabaseClient> {
  const anon = makeAnonClient();
  const { error } = await anon.auth.signInWithPassword({ email, password });
  expect(error).toBeNull();
  return anon;
}

const signedInAsLearner = () => signedInAs(learnerEmail);
const signedInAsManager = () => signedInAs(managerEmail);

async function setDeparted(profileId: string, departedAt: string | null): Promise<void> {
  const svc = makeServiceClient();
  const { error } = await svc
    .from('profiles')
    .update({ departed_at: departedAt })
    .eq('id', profileId);
  expect(error).toBeNull();
}

const departLearner = (at: string | null) => setDeparted(learnerId, at);
const departManager = (at: string | null) => setDeparted(managerId, at);

// T-25 follow-up — this note is deliberately OUTSIDE the gated describe below.
// The suite used to guard each test with an early `return`, so a run without a
// local database reported every test as PASSED while asserting nothing. It now
// skips as a block — and this note still runs, so the refusal is stated out
// loud rather than disappearing with the block.
describe('departed-staff-rls — environment', () => {
  it('reports when the real-database suite is not running', () => {
    if (!hasLocalSupabase()) {
      console.log('[departed-staff-rls] No local Supabase — skipping');
    }
    expect(true).toBe(true);
  });
});

describe.skipIf(!hasLocalSupabase())(
  'T-46a — departed staff lose restaurant scope in the database',
  () => {
    beforeAll(async () => {
      const svc = makeServiceClient();

      const { data: rest, error: restErr } = await svc
        .from('restaurants')
        .insert({
          slug,
          name: `Departed Bistro ${ts}`,
          address: '9 Departure Row',
          city: 'Austin',
          state: 'TX',
          zip: '78701',
          phone: '512-555-0900',
          cuisine: 'american',
          status: 'listed',
          listed_at: new Date().toISOString(),
          listing_expires_at: new Date(Date.now() + 365 * 86400_000).toISOString(),
        })
        .select('id')
        .single();
      expect(restErr).toBeNull();
      restaurantId = (rest as { id: string }).id;

      // The learner who will leave — a real auth user, so we can sign in as them.
      const { data: authData, error: authErr } = await svc.auth.admin.createUser({
        email: learnerEmail,
        password,
        email_confirm: true,
        user_metadata: { full_name: 'Departing Learner' },
      });
      expect(authErr).toBeNull();
      learnerId = authData.user!.id;

      await svc.from('profiles').insert({
        id: learnerId,
        full_name: 'Departing Learner',
        email: learnerEmail,
        role: 'learner',
        restaurant_id: restaurantId,
        accepted_at: new Date().toISOString(),
      });

      // A colleague who stays. Without them the denominator could not shrink and
      // an empty colleague read would be ambiguous.
      const { data: colleagueAuth } = await svc.auth.admin.createUser({
        email: colleagueEmail,
        password,
        email_confirm: true,
        user_metadata: { full_name: 'Remaining Colleague' },
      });

      await svc.from('profiles').insert({
        id: colleagueAuth.user!.id,
        full_name: 'Remaining Colleague',
        email: colleagueEmail,
        role: 'learner',
        restaurant_id: restaurantId,
        accepted_at: new Date().toISOString(),
      });

      // The MANAGER. This is the account that actually holds restaurant-scoped
      // RLS grants — see the "who this cut is really for" note below.
      const { data: managerAuth } = await svc.auth.admin.createUser({
        email: managerEmail,
        password,
        email_confirm: true,
        user_metadata: { full_name: 'Departing Manager' },
      });
      managerId = managerAuth.user!.id;

      await svc.from('profiles').insert({
        id: managerId,
        full_name: 'Departing Manager',
        email: managerEmail,
        role: 'manager',
        restaurant_id: restaurantId,
        accepted_at: new Date().toISOString(),
      });

      // Submission state — one of the three things the task names as data a
      // departed person must stop reading.
      await svc.from('submissions').insert({
        restaurant_id: restaurantId,
        submitted_by: managerId,
        status: 'pending',
      });

      // Subscription + activity, so the after-departure assertions on those two
      // policies are proving an absence rather than restating an empty table.
      const startsAt = new Date();
      const endsAt = new Date();
      endsAt.setMonth(endsAt.getMonth() + 3);
      await svc.from('subscriptions').insert({
        restaurant_id: restaurantId,
        plan: 'quarterly',
        starts_at: startsAt.toISOString(),
        ends_at: endsAt.toISOString(),
        amount_cents: 9000,
        status: 'active',
        stripe_invoice_id: `in_test_${ts}`,
      });

      await svc.from('activity_events').insert({
        type: 'invite_sent',
        restaurant_id: restaurantId,
        actor_id: managerId,
        payload: {},
      });

      // The exam they passed — preserved, never deleted, on departure.
      const { data: attempt } = await svc
        .from('exam_attempts')
        .insert({
          profile_id: learnerId,
          started_at: new Date(Date.now() - 3_600_000).toISOString(),
          submitted_at: new Date(Date.now() - 1_800_000).toISOString(),
          time_limit_seconds: 1800,
          score_percent: 92,
          passed: true,
          answers: {},
        })
        .select('id')
        .single();
      attemptId = (attempt as { id: string }).id;

      // The credential the restaurant paid for.
      const expiresAt = new Date();
      expiresAt.setFullYear(expiresAt.getFullYear() + 1);
      certExpiresAt = expiresAt.toISOString();

      const { data: cert } = await svc
        .from('certificates')
        .insert({
          cert_code: generateCertCode(),
          profile_id: learnerId,
          restaurant_id: restaurantId,
          expires_at: certExpiresAt,
          status: 'active',
          fee_charged_cents: 3500,
        })
        .select('id')
        .single();
      certId = (cert as { id: string }).id;

      // Every test starts from "current staff".
      await departLearner(null);
    });

    // T-30: this suite had NO teardown and leaked every run — including four real
    // auth users. Only `learnerId` and `managerId` are held in module scope; the
    // colleague and the "Legitimate Hire" created inside a test body are not, so
    // an id-based teardown could never have removed them. All four addresses carry
    // the token, so auth.users resolution reaches every one.
    afterAll(async () => {
      const { errors } = await purgeFixtures(makeServiceClient(), ts);
      if (errors.length > 0) console.error('[departed-staff-rls] teardown:', errors);
    });

    // ─── The helper itself ──────────────────────────────────────────────────────

    it('CONTROL — auth_restaurant_id() resolves while they are current staff', async () => {
      await departLearner(null);

      const anon = await signedInAsLearner();
      const { data, error } = await anon.rpc('auth_restaurant_id');

      expect(error).toBeNull();
      expect(data).toBe(restaurantId);
    });

    it('auth_restaurant_id() returns NULL once they are departed', async () => {
      await departLearner(new Date().toISOString());

      const anon = await signedInAsLearner();
      const { data, error } = await anon.rpc('auth_restaurant_id');

      expect(error).toBeNull();
      expect(data).toBeNull();

      // …and restaurant_id is STILL POPULATED. The membership predicate is the
      // only thing that changed; the "certified while at X" link is intact.
      const svc = makeServiceClient();
      const { data: row } = await svc
        .from('profiles')
        .select('restaurant_id, departed_at')
        .eq('id', learnerId)
        .single();
      expect((row as { restaurant_id: string }).restaurant_id).toBe(restaurantId);
      expect((row as { departed_at: string | null }).departed_at).not.toBeNull();
    });

    // ─── Restaurant-scoped reads are gone ───────────────────────────────────────
    //
    // WHO THIS CUT IS REALLY FOR — verified, not assumed.
    //
    // A departed LEARNER was never the RLS exposure. Every learner-facing policy
    // keys on auth.uid() (lesson_progress_learner_read_own,
    // exam_attempts_learner_read_own, certificates_learner_read_own,
    // profiles_read_self); the restaurant-scoped ones are all
    // `auth_role() = 'manager' AND … = auth_restaurant_id()`, so a learner holds
    // no restaurant grant to lose. Asserting "a departed learner reads no
    // colleagues" passes identically against the OLD helper and proves nothing —
    // it was checked against a reverted auth_restaurant_id() and did exactly that.
    // Their read-cut lives in the route layer and is proved in
    // tests/unit/departed-read-cut.test.ts.
    //
    // The MANAGER is the account that holds those 19 grants, so the manager is
    // where this migration is load-bearing, and these are the assertions that
    // fail against the pre-0026 helper.

    it('CONTROL — a CURRENT manager reads colleagues, the restaurant and submissions', async () => {
      await departManager(null);

      const anon = await signedInAsManager();

      const { data: colleagues } = await anon
        .from('profiles')
        .select('id')
        .eq('restaurant_id', restaurantId);
      expect((colleagues ?? []).length, 'the roster is readable').toBeGreaterThan(1);

      const { data: restaurants } = await anon
        .from('restaurants')
        .select('id')
        .eq('id', restaurantId);
      expect((restaurants ?? []).length).toBe(1);

      const { data: submissions } = await anon
        .from('submissions')
        .select('id')
        .eq('restaurant_id', restaurantId);
      expect((submissions ?? []).length, 'submission state is readable').toBe(1);

      const { data: certs } = await anon
        .from('certificates')
        .select('id')
        .eq('restaurant_id', restaurantId);
      expect((certs ?? []).length).toBe(1);

      const { data: subs } = await anon
        .from('subscriptions')
        .select('id')
        .eq('restaurant_id', restaurantId);
      expect((subs ?? []).length, 'billing state is readable').toBe(1);

      const { data: events } = await anon
        .from('activity_events')
        .select('id')
        .eq('restaurant_id', restaurantId);
      expect((events ?? []).length, 'activity is readable').toBeGreaterThan(0);
    });

    it("AFTER departure the manager's restaurant-scoped SELECTs return nothing", async () => {
      await departManager(new Date().toISOString());

      const anon = await signedInAsManager();

      // Colleagues — profiles_manager_read_restaurant.
      const { data: colleagues } = await anon
        .from('profiles')
        .select('id, full_name, email')
        .eq('restaurant_id', restaurantId)
        .neq('id', managerId);
      expect(colleagues ?? [], 'no colleague rows').toEqual([]);

      // The restaurant itself — restaurants_manager_read_own.
      const { data: restaurants } = await anon
        .from('restaurants')
        .select('id, name, status')
        .eq('id', restaurantId);
      expect(restaurants ?? [], 'no restaurant rows').toEqual([]);

      // Submission state — submissions_manager_read_own.
      const { data: submissions } = await anon
        .from('submissions')
        .select('id, status')
        .eq('restaurant_id', restaurantId);
      expect(submissions ?? [], 'no submission rows').toEqual([]);

      // Other people's certificates — certificates_manager_read_restaurant.
      const { data: otherCerts } = await anon
        .from('certificates')
        .select('id')
        .eq('restaurant_id', restaurantId);
      expect(otherCerts ?? [], 'no staff certificates').toEqual([]);

      // Subscriptions and activity — subscriptions_manager_read_own,
      // activity_events_manager_read_own. Same shape, same failure mode.
      const { data: subs } = await anon
        .from('subscriptions')
        .select('id')
        .eq('restaurant_id', restaurantId);
      expect(subs ?? []).toEqual([]);

      const { data: events } = await anon
        .from('activity_events')
        .select('id')
        .eq('restaurant_id', restaurantId);
      expect(events ?? []).toEqual([]);
    });

    it('a departed manager can no longer INSERT staff into the restaurant', async () => {
      // profiles_manager_insert_learner is the one WITH CHECK clause among the
      // 19. It must fail closed too, or a departed manager could keep staffing a
      // restaurant they have left.
      //
      // The hire needs a REAL auth user first: profiles.id references
      // auth.users(id), so inserting a made-up uuid fails on the foreign key and
      // would pass this test whatever RLS did. Checked by reverting
      // auth_restaurant_id() — the made-up-uuid version passed against the old
      // helper too, which is exactly the vacuum this setup removes.
      const svc = makeServiceClient();
      const hireEmail = `${ts}-hire@example.test`;
      const { data: hireAuth } = await svc.auth.admin.createUser({
        email: hireEmail,
        password,
        email_confirm: true,
      });
      const hireId = hireAuth.user!.id;

      // CONTROL: while current, the manager CAN hire.
      await departManager(null);
      const current = await signedInAsManager();
      const { error: allowedErr } = await current.from('profiles').insert({
        id: hireId,
        full_name: 'Legitimate Hire',
        email: hireEmail,
        role: 'learner',
        restaurant_id: restaurantId,
      });
      expect(allowedErr, 'a current manager may add a learner').toBeNull();

      // Now remove that row and depart the manager.
      await svc.from('profiles').delete().eq('id', hireId);
      await departManager(new Date().toISOString());

      const departed = await signedInAsManager();
      const { error } = await departed.from('profiles').insert({
        id: hireId,
        full_name: 'Should Not Exist',
        email: hireEmail,
        role: 'learner',
        restaurant_id: restaurantId,
      });

      try {
        expect(error, 'the WITH CHECK clause rejects it').not.toBeNull();

        const { data } = await svc.from('profiles').select('id').eq('id', hireId);
        expect(data ?? [], 'and no row was created').toEqual([]);
      } finally {
        // `finally`, not a trailing statement: if the insert HAD succeeded — which
        // is exactly what a missing 0026 looks like — the assertion above throws
        // and a trailing cleanup would never run. The stray learner would then
        // change the headcount the denominator test asserts on, and one real
        // failure would be reported as two.
        await svc.from('profiles').delete().eq('id', hireId);
      }
    });

    it('a departed LEARNER holds no restaurant grant either — for a different reason', async () => {
      // Recorded so the asymmetry is documented rather than rediscovered: this
      // passes before AND after 0026, because learners never had these grants.
      await departLearner(new Date().toISOString());

      const anon = await signedInAsLearner();
      const { data: colleagues } = await anon
        .from('profiles')
        .select('id')
        .eq('restaurant_id', restaurantId)
        .neq('id', learnerId);

      expect(colleagues ?? []).toEqual([]);
    });

    // ─── Their own records stay theirs ──────────────────────────────────────────

    it('their OWN profile is still readable — profiles_read_self keys on auth.uid()', async () => {
      await departLearner(new Date().toISOString());

      const anon = await signedInAsLearner();
      const { data } = await anon.from('profiles').select('id, full_name').eq('id', learnerId);

      expect((data ?? []).length, 'they can still see themselves').toBe(1);
    });

    it('their certificate is STILL ACTIVE and still readable by them', async () => {
      await departLearner(new Date().toISOString());

      const anon = await signedInAsLearner();
      const { data } = await anon
        .from('certificates')
        .select('id, status, expires_at, restaurant_id')
        .eq('id', certId);

      const rows = (data ?? []) as Array<{
        id: string;
        status: string;
        expires_at: string;
        restaurant_id: string;
      }>;

      expect(rows.length, 'certificates_learner_read_own survives departure').toBe(1);
      expect(rows[0].status, 'removal changes membership, never the credential').toBe('active');
      expect(new Date(rows[0].expires_at).toISOString()).toBe(
        new Date(certExpiresAt).toISOString()
      );
      expect(rows[0].restaurant_id, '"certified while at X" is still true').toBe(restaurantId);
    });

    it('their exam attempt is preserved, not deleted, and still readable by them', async () => {
      // exam_attempts rather than lesson_progress deliberately: lesson_progress
      // has an FK to `lessons`, so asserting on it would mean either seeding a
      // module into the shared curriculum — which other integration tests count —
      // or skipping when none is seeded, and a test that skips itself proves
      // nothing. exam_attempts has no such FK and is governed by the same policy
      // shape (exam_attempts_learner_read_own, `profile_id = auth.uid()`), which
      // is the property under test. The lesson-progress half is covered through
      // GET /api/learner/home-data in tests/unit/departed-read-cut.test.ts.
      await departLearner(new Date().toISOString());

      const anon = await signedInAsLearner();
      const { data } = await anon
        .from('exam_attempts')
        .select('id, score_percent, passed')
        .eq('id', attemptId);

      const rows = (data ?? []) as Array<{ id: string; score_percent: number; passed: boolean }>;
      expect(rows.length, 'the attempt still exists and is still theirs to read').toBe(1);
      expect(rows[0].score_percent, 'the score they earned, unchanged').toBe(92);
      expect(rows[0].passed).toBe(true);
    });

    // ─── The public denominator ─────────────────────────────────────────────────

    it('the PUBLIC directory denominator shrinks when someone is marked departed', async () => {
      const { GET } = await import('@/app/api/directory/[slug]/route');
      const params = { params: { slug } };

      await departLearner(null);
      const before = (await (await GET({} as never, params)).json()) as {
        totalEmployees: number | null;
        certifiedCount: number | null;
      };
      expect(before.totalEmployees, 'two current learners').toBe(2);
      expect(before.certifiedCount, 'one of them certified').toBe(1);

      await departLearner(new Date().toISOString());
      const after = (await (await GET({} as never, params)).json()) as {
        totalEmployees: number | null;
        certifiedCount: number | null;
      };

      expect(after.totalEmployees, 'the denominator shrank by exactly one').toBe(1);

      // T-23 — THIS LINE MOVED, deliberately. It read `toBe(1)`, on the reasoning
      // that the numerator counts CERTIFICATES and a departure leaves the
      // certificate untouched. The certificate is indeed untouched (asserted
      // elsewhere in this file, and that stays true). But the person holding it
      // in this fixture is the one who LEFT, so the old arithmetic published
      // "1 of 1" — 100%, all staff certified — about a restaurant whose one
      // remaining learner holds no certificate at all. An optimistic display
      // concealing bad data, on an unauthenticated page: the T-18/T-23 class.
      //
      // The numerator counts distinct CURRENT LEARNERS holding an active
      // certificate. The departed learner is not one, so it is 0 of 1: the
      // colleague who stayed is not certified and the page now says so. The
      // certificate itself keeps existing, keeps verifying, and keeps naming the
      // restaurant it was earned at — it just stops counting as this
      // restaurant's current staff.
      expect(after.certifiedCount, 'the departed learner was the certified one').toBe(0);
    });

    it('the counts stay numbers — the membership filter introduced no `?? 0`', async () => {
      const { GET } = await import('@/app/api/directory/[slug]/route');

      await departLearner(null);
      const res = await GET({} as never, { params: { slug } });
      const body = (await res.json()) as { totalEmployees: number | null };

      expect(typeof body.totalEmployees).toBe('number');
      expect(body.totalEmployees).not.toBeNull();
    });
  }
);
