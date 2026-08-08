/**
 * tests/integration/rls-hardening.test.ts
 *
 * Wave 2A regression tests covering:
 *   - P0 #3 — `certificates_public_read_by_cert_code using(true)` dropped
 *   - P0 #4 — `exam_attempts_learner_update_own` (no WITH CHECK) dropped
 *   - F-S1 — `restaurants_public_read_listed using(status='listed')` dropped
 *   - Audit follow-ons — UPDATE policies missing WITH CHECK on `profiles`
 *     and `lesson_progress` dropped (same class as P0 #4)
 *
 * Each test uses the **anon** Supabase client (NOT service-role) plus, where
 * needed, an authed JWT signed in as a learner. Service-role is used only
 * in beforeAll() for fixture seeding.
 *
 * Pre-fix expectation: all assertions fail (or pass when they shouldn't —
 * e.g. anon read returns rows). Post-fix: every assertion passes.
 *
 * The tests skip cleanly when local Supabase env is not present.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { purgeFixtures } from '../helpers/fixture-cleanup';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { generateCertCode } from '@/lib/learner/cert-code';
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

const ts = `w2a-${Date.now()}`;
const learnerEmail = `${ts}-learner@example.test`;
const learnerPassword = 'W2APassword!1234';
let learnerId: string;
let restaurantId: string;
let attemptId: string;
let certId: string;

// T-25 follow-up — this note is deliberately OUTSIDE the gated describe below.
// The suite used to guard each test with an early `return`, so a run without a
// local database reported every test as PASSED while asserting nothing. It now
// skips as a block — and this note still runs, so the refusal is stated out
// loud rather than disappearing with the block.
describe('rls-hardening — environment', () => {
  it('reports when the real-database suite is not running', () => {
    if (!hasLocalSupabase()) {
      console.log('[rls-hardening] No local Supabase — skipping');
    }
    expect(true).toBe(true);
  });
});

describe.skipIf(!hasLocalSupabase())('Wave 2A RLS hardening', () => {
  beforeAll(async () => {
    const svc = makeServiceClient();

    // Seed: restaurant + admin profile + learner profile + active subscription
    const { data: rest, error: restErr } = await svc
      .from('restaurants')
      .insert({
        slug: `rls-bistro-${ts}`,
        name: `RLS Bistro ${ts}`,
        address: '1 RLS Way',
        city: 'San Diego',
        state: 'CA',
        zip: '92101',
        phone: '619-555-0200',
        cuisine: 'american',
        status: 'unlisted',
      })
      .select('id')
      .single();
    expect(restErr).toBeNull();
    restaurantId = (rest as { id: string }).id;

    // Auth user for learner — used to sign in with anon client + grab JWT
    const { data: authData, error: authErr } = await svc.auth.admin.createUser({
      email: learnerEmail,
      password: learnerPassword,
      email_confirm: true,
      user_metadata: { full_name: 'RLS Learner' },
    });
    expect(authErr).toBeNull();
    learnerId = authData.user!.id;

    const { error: profErr } = await svc.from('profiles').insert({
      id: learnerId,
      full_name: 'RLS Learner',
      email: learnerEmail,
      role: 'learner',
      restaurant_id: restaurantId,
      accepted_at: new Date().toISOString(),
    });
    expect(profErr).toBeNull();

    // Active subscription (eligibility) — also a control that we can read it via anon WHERE expected to be denied
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
      stripe_invoice_id: `in_test_w2a_${ts}`,
    });

    // Cert (used by P0 #3 test)
    const expiresAt = new Date();
    expiresAt.setFullYear(expiresAt.getFullYear() + 1);
    const { data: cert } = await svc
      .from('certificates')
      .insert({
        cert_code: generateCertCode(),
        profile_id: learnerId,
        restaurant_id: restaurantId,
        expires_at: expiresAt.toISOString(),
        // Wave 2C — `revoked` boolean dropped; use the new status column.
        status: 'active',
        fee_charged_cents: 3500,
      })
      .select('id')
      .single();
    certId = (cert as { id: string }).id;

    // Submitted (failed) exam attempt — used by P0 #4 test
    const { data: attempt } = await svc
      .from('exam_attempts')
      .insert({
        profile_id: learnerId,
        started_at: new Date(Date.now() - 3_600_000).toISOString(),
        submitted_at: new Date(Date.now() - 1_000_000).toISOString(),
        time_limit_seconds: 1800,
        score_percent: 60,
        passed: false,
        answers: {},
      })
      .select('id')
      .single();
    attemptId = (attempt as { id: string }).id;

    // Set up an EXPIRED listed restaurant for F-S1 — direct read should be denied
    await svc.from('restaurants').insert({
      slug: `rls-expired-${ts}`,
      name: `RLS Expired ${ts}`,
      address: '2 Expired St',
      city: 'San Diego',
      state: 'CA',
      zip: '92101',
      phone: '619-555-0201',
      cuisine: 'american',
      status: 'listed',
      listed_at: new Date(Date.now() - 365 * 86400_000).toISOString(),
      listing_expires_at: new Date(Date.now() - 86400_000).toISOString(), // 1 day ago
    });
  });

  // T-30: this suite had NO teardown and leaked every run. Note the second
  // restaurant (`rls-expired-${ts}`) is inserted without capturing its id, so an
  // id-based teardown could never have reached it; resolving from the token does.
  afterAll(async () => {
    const { errors } = await purgeFixtures(makeServiceClient(), ts);
    if (errors.length > 0) console.error('[rls-hardening] teardown:', errors);
  });

  it('P0 #3 — anon-key client cannot read certificates table', async () => {
    const anon = makeAnonClient();
    const { data, error } = await anon
      .from('certificates')
      .select('id, cert_code, profile_id, restaurant_id')
      .limit(100);

    // Either the policy denies (data is empty array) or RLS error is set.
    // Both prove the public read scope is gone.
    expect(error?.code === 'PGRST301' || (data ?? []).length === 0).toBe(true);
  });

  it('P0 #4 — anon-key learner cannot UPDATE own exam_attempts row to forge passed=true', async () => {
    const anon = makeAnonClient();

    // Sign in as the learner to get a learner-role JWT
    const { error: signInErr } = await anon.auth.signInWithPassword({
      email: learnerEmail,
      password: learnerPassword,
    });
    expect(signInErr).toBeNull();

    // Try to forge a passing score on own attempt
    const { error: updateErr } = await anon
      .from('exam_attempts')
      .update({ passed: true, score_percent: 100 })
      .eq('id', attemptId);

    // After fix: RLS denies (error set OR no rows updated)
    // Confirm by re-reading the row via service-role and ensuring score_percent unchanged
    const svc = makeServiceClient();
    const { data: row } = await svc
      .from('exam_attempts')
      .select('passed, score_percent')
      .eq('id', attemptId)
      .single();

    const r = row as { passed: boolean; score_percent: number } | null;
    expect(r).toBeTruthy();
    // Pre-fix: passed=true, score_percent=100 (forgery succeeded)
    // Post-fix: passed=false, score_percent=60 (RLS denied the UPDATE)
    expect(r!.passed).toBe(false);
    expect(r!.score_percent).toBe(60);

    // Also: explicit error or no-op
    if (!updateErr) {
      // Some Postgres returns no error for a no-op UPDATE under RLS — that's still safe;
      // the row-state check above is the authoritative assertion.
    }
  });

  it('audit follow-on — anon-key learner cannot UPDATE own profile to set role=admin', async () => {
    const anon = makeAnonClient();
    const { error: signInErr } = await anon.auth.signInWithPassword({
      email: learnerEmail,
      password: learnerPassword,
    });
    expect(signInErr).toBeNull();

    await anon.from('profiles').update({ role: 'manager' }).eq('id', learnerId);

    const svc = makeServiceClient();
    const { data: row } = await svc.from('profiles').select('role').eq('id', learnerId).single();

    expect((row as { role: string } | null)?.role).toBe('learner');
  });

  it('audit follow-on — anon-key learner cannot UPDATE lesson_progress to mark complete', async () => {
    const svc = makeServiceClient();

    // First seed a not-started lesson_progress row for this learner
    const { data: lessons } = await svc.from('lessons').select('id').limit(1);
    const lessonId = (lessons as { id: string }[] | null)?.[0]?.id;
    if (!lessonId) {
      console.warn('[rls-hardening] No lessons seeded — skipping lesson_progress test');
      return;
    }

    await svc.from('lesson_progress').upsert(
      {
        profile_id: learnerId,
        lesson_id: lessonId,
        status: 'not_started',
        watched_seconds: 0,
      },
      { onConflict: 'profile_id,lesson_id' }
    );

    const anon = makeAnonClient();
    await anon.auth.signInWithPassword({ email: learnerEmail, password: learnerPassword });
    await anon
      .from('lesson_progress')
      .update({ status: 'complete', watched_seconds: 999 })
      .eq('profile_id', learnerId)
      .eq('lesson_id', lessonId);

    const { data: row } = await svc
      .from('lesson_progress')
      .select('status, watched_seconds')
      .eq('profile_id', learnerId)
      .eq('lesson_id', lessonId)
      .single();

    const r = row as { status: string; watched_seconds: number } | null;
    expect(r?.status).toBe('not_started');
    expect(r?.watched_seconds).toBe(0);
  });

  it('F-S1 — anon-key client cannot read restaurants table directly (no public SELECT policy)', async () => {
    const anon = makeAnonClient();
    const { data, error } = await anon
      .from('restaurants')
      .select('id, slug, name, status, listing_expires_at')
      .limit(100);

    // Public read policy dropped — anon read denied or empty
    expect(error?.code === 'PGRST301' || (data ?? []).length === 0).toBe(true);
  });
});
