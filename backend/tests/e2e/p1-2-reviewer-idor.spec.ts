/**
 * tests/e2e/p1-2-reviewer-idor.spec.ts
 *
 * Gating test for P1-2 (Reviewer IDOR — defense in depth at the HTTP layer).
 *
 * Threat model:
 *   Reviewer A claims submission X (reviewer_id is set to A).
 *   Reviewer B knows X's UUID (or guesses it).
 *   Reviewer B must NOT be able to:
 *     - GET   /api/reviewer/queue/[X]              → must 404 (no enumeration)
 *     - POST  /api/reviewer/queue/[X]/decide       → must 403
 *
 * Reviewer A retains access:
 *     - GET   /api/reviewer/queue/[X]              → 200 (own assignment)
 *
 * Unclaimed submissions remain in the shared pickup pool (reviewer_id IS NULL):
 *     - GET   /api/reviewer/queue/[Y] from either A or B  → 200
 *
 * The list endpoint (/api/reviewer/queue) is also filtered: Reviewer B's queue
 * must not include submission X once it's claimed by Reviewer A.
 *
 * The shared review-moderation pool (/api/reviewer/reviews/**) is deliberately
 * NOT covered here — those resources have no per-reviewer assignment by
 * design. See route-file headers for the rationale.
 *
 * ─── Env requirements ───────────────────────────────────────────────────────
 *   NEXT_PUBLIC_SUPABASE_URL      (local Supabase, http://localhost:54321)
 *   NEXT_PUBLIC_SUPABASE_ANON_KEY (local anon key)
 *   SUPABASE_SERVICE_ROLE_KEY     (local service-role key — for seeding)
 *
 * The Next dev server must be reachable on the Playwright baseURL
 * (http://localhost:3000 by default). The spec creates the second reviewer +
 * the submission rows directly via the Supabase Admin API to avoid Stripe.
 *
 * Run after `pnpm db:seed` so the seeded reviewer profile (b1000000-...-002)
 * is present.
 */

import {
  test,
  expect,
  request as playwrightRequest,
  type APIRequestContext,
} from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { purgeFixtures } from '../helpers/fixture-cleanup';
import { hasLocalSupabase } from '../helpers/local-db';

// ─── Env / supabase admin client ─────────────────────────────────────────────

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://localhost:54321';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

// T-25 — the gate below asks whether the target database is on THIS machine,
// not merely whether the vars are set. tests/helpers/local-db.ts is the one
// definition; it reads locality from tests/env-guard.ts, so "local" means the
// same thing here, in vitest.config.ts and in playwright.config.ts.
//
// Supersedes the inline T-27 composition this file used to carry: same
// locality check, one copy instead of five, and it now covers DATABASE_URL as
// well as the REST URL.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function svc(): SupabaseClient<any, any, any> {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

interface SeededReviewer {
  id: string;
  email: string;
  password: string;
}

/**
 * Seeds a reviewer auth user + profile and returns its credentials.
 * Idempotent on email collision (re-uses the existing auth row, resets the
 * password to the known value).
 */
async function seedReviewer(label: string, ts: string): Promise<SeededReviewer> {
  const db = svc();
  const email = `reviewer.${label}.${ts}@test.allergenwise.local`;
  const password = `Reviewer${label.toUpperCase()}Pass123!`;
  const fullName = `Reviewer ${label.toUpperCase()} ${ts}`;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const adminAuth = (db.auth as any).admin;

  const { data: created, error: createErr } = await adminAuth.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  });

  if (createErr || !created?.user) {
    throw new Error(
      `seedReviewer(${label}): createUser failed: ${createErr?.message ?? 'no user'}`
    );
  }

  const userId: string = created.user.id;

  // Insert matching profile row with reviewer role.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: profErr } = await (db as any).from('profiles').insert({
    id: userId,
    full_name: fullName,
    email,
    role: 'reviewer',
    restaurant_id: null,
    accepted_at: new Date().toISOString(),
  });

  if (profErr) {
    throw new Error(`seedReviewer(${label}): profile insert: ${profErr.message}`);
  }

  return { id: userId, email, password };
}

/**
 * Seeds a restaurant + admin profile + pending submission. Returns submission
 * id (used for IDOR probe). No Stripe involved — inserts rows directly.
 */
async function seedSubmission(ts: string): Promise<{
  submissionId: string;
  restaurantId: string;
}> {
  const db = svc();

  // Owner admin auth user (for the FK on profiles + submissions.submitted_by)
  const adminEmail = `admin.idor.${ts}@test.allergenwise.local`;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const adminAuth = (db.auth as any).admin;
  const { data: created, error: createErr } = await adminAuth.createUser({
    email: adminEmail,
    password: 'AdminIdorPass123!',
    email_confirm: true,
    user_metadata: { full_name: `Admin IDOR ${ts}` },
  });

  if (createErr || !created?.user) {
    throw new Error(`seedSubmission: admin createUser failed: ${createErr?.message ?? 'no user'}`);
  }
  const adminUserId: string = created.user.id;

  // Restaurant
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: restData, error: restErr } = await (db as any)
    .from('restaurants')
    .insert({
      name: `IDOR Bistro ${ts}`,
      slug: `idor-bistro-${ts}`,
      address: '500 IDOR Way',
      city: 'San Diego',
      state: 'CA',
      zip: '92101',
      phone: '619-555-0177',
      cuisine: 'american',
      status: 'pending_review',
    })
    .select('id')
    .single();
  if (restErr || !restData) {
    throw new Error(`seedSubmission: restaurant insert: ${restErr?.message}`);
  }
  const restaurantId: string = (restData as { id: string }).id;

  // Admin profile attached to restaurant
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: adminProfErr } = await (db as any).from('profiles').insert({
    id: adminUserId,
    full_name: `Admin IDOR ${ts}`,
    email: adminEmail,
    role: 'manager',
    restaurant_id: restaurantId,
    accepted_at: new Date().toISOString(),
  });
  if (adminProfErr) {
    throw new Error(`seedSubmission: admin profile: ${adminProfErr.message}`);
  }

  // Submission
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: subData, error: subErr } = await (db as any)
    .from('submissions')
    .insert({
      restaurant_id: restaurantId,
      submitted_by: adminUserId,
      status: 'pending',
      cert_fee_total_cents: 3500,
      stripe_payment_intent_id: `pi_test_idor_${ts}`,
    })
    .select('id')
    .single();

  if (subErr || !subData) {
    throw new Error(`seedSubmission: submissions insert: ${subErr?.message}`);
  }

  return {
    submissionId: (subData as { id: string }).id,
    restaurantId,
  };
}

/** Logs a reviewer in via /api/auth/login. Returns an API context with cookies. */
async function loginContext(baseURL: string, reviewer: SeededReviewer): Promise<APIRequestContext> {
  const ctx = await playwrightRequest.newContext({ baseURL });
  const res = await ctx.post('/api/auth/login', {
    data: { email: reviewer.email, password: reviewer.password },
  });
  if (res.status() !== 200) {
    const body = await res.text();
    throw new Error(`login failed for ${reviewer.email}: ${res.status()} ${body}`);
  }
  return ctx;
}

/** Force-claim a submission for a given reviewer (sets reviewer_id, status=in_review). */
async function claimSubmissionAs(submissionId: string, reviewerId: string): Promise<void> {
  const db = svc();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (db as any)
    .from('submissions')
    .update({
      reviewer_id: reviewerId,
      status: 'in_review',
      updated_at: new Date().toISOString(),
    })
    .eq('id', submissionId);
  if (error) {
    throw new Error(`claimSubmissionAs: ${error.message}`);
  }
}

// ─── The spec ────────────────────────────────────────────────────────────────

// T-30: module scope, not assigned in beforeAll — a beforeAll that throws part
// way leaves rows behind and never sets the variable teardown would need.
// Prefixed because a bare base36 epoch is a weak needle to match on.
const ts = `idor-${Date.now().toString(36)}`;

test.describe('P1-2 — reviewer IDOR (defense in depth)', () => {
  // Sequential — each step depends on rows seeded above.
  test.describe.configure({ mode: 'serial' });

  let reviewerA: SeededReviewer;
  let reviewerB: SeededReviewer;
  let claimedSubmissionId: string;
  let unclaimedSubmissionId: string;
  let baseURL: string;

  let ctxA: APIRequestContext;
  let ctxB: APIRequestContext;

  test.beforeAll(async ({}, testInfo) => {
    if (!hasLocalSupabase()) {
      test.skip(
        true,
        'P1-2 spec needs a local Supabase (NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY).'
      );
      return;
    }

    baseURL = (testInfo.project.use.baseURL as string) ?? 'http://localhost:3000';

    reviewerA = await seedReviewer('a', ts);
    reviewerB = await seedReviewer('b', ts);

    const claimed = await seedSubmission(ts + '-c');
    claimedSubmissionId = claimed.submissionId;
    await claimSubmissionAs(claimedSubmissionId, reviewerA.id);

    const unclaimed = await seedSubmission(ts + '-u');
    unclaimedSubmissionId = unclaimed.submissionId;

    ctxA = await loginContext(baseURL, reviewerA);
    ctxB = await loginContext(baseURL, reviewerB);
  });

  test.afterAll(async () => {
    await ctxA?.dispose();
    await ctxB?.dispose();
    // T-30: the pre-existing hook disposed browser contexts only — it removed
    // no rows at all. This suite seeds two reviewers (real auth users), two
    // submissions and their restaurants on every run.
    if (!hasLocalSupabase()) return;
    const { errors } = await purgeFixtures(svc(), ts);
    if (errors.length > 0) console.error('[p1-2-reviewer-idor] teardown:', errors);
  });

  // ─── GET detail ─────────────────────────────────────────────────────────────

  test('reviewer A can GET their own claimed submission', async () => {
    const res = await ctxA.get(`/api/reviewer/queue/${claimedSubmissionId}`);
    expect(res.status()).toBe(200);
    const body = (await res.json()) as { submission: { id: string; reviewerId: string } };
    expect(body.submission.id).toBe(claimedSubmissionId);
    expect(body.submission.reviewerId).toBe(reviewerA.id);
  });

  test('reviewer B is denied GET on a submission claimed by A (404, no enumeration)', async () => {
    const res = await ctxB.get(`/api/reviewer/queue/${claimedSubmissionId}`);
    expect(res.status()).toBe(404);
  });

  test('either reviewer can GET an unclaimed submission (shared pickup pool)', async () => {
    const resA = await ctxA.get(`/api/reviewer/queue/${unclaimedSubmissionId}`);
    expect(resA.status()).toBe(200);

    const resB = await ctxB.get(`/api/reviewer/queue/${unclaimedSubmissionId}`);
    expect(resB.status()).toBe(200);
  });

  // ─── POST decide ────────────────────────────────────────────────────────────

  test('reviewer B is denied POST decide on a submission claimed by A (403)', async () => {
    const res = await ctxB.post(`/api/reviewer/queue/${claimedSubmissionId}/decide`, {
      data: { action: 'reject', notes: 'B attempting to override A' },
    });
    expect(res.status()).toBe(403);

    // And the submission must remain untouched (still in_review, still A's).
    const db = svc();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data } = await (db as any)
      .from('submissions')
      .select('status, reviewer_id')
      .eq('id', claimedSubmissionId)
      .single();
    expect((data as { status: string }).status).toBe('in_review');
    expect((data as { reviewer_id: string }).reviewer_id).toBe(reviewerA.id);
  });

  // ─── Queue list filter ──────────────────────────────────────────────────────

  test('queue list scopes to NULL-owner OR caller: B does not see A-claimed item', async () => {
    const resB = await ctxB.get('/api/reviewer/queue');
    expect(resB.status()).toBe(200);
    const bodyB = (await resB.json()) as { submissions: Array<{ id: string }> };
    const idsB = bodyB.submissions.map((s) => s.id);
    expect(idsB).not.toContain(claimedSubmissionId);
    expect(idsB).toContain(unclaimedSubmissionId);

    const resA = await ctxA.get('/api/reviewer/queue');
    expect(resA.status()).toBe(200);
    const bodyA = (await resA.json()) as { submissions: Array<{ id: string }> };
    const idsA = bodyA.submissions.map((s) => s.id);
    expect(idsA).toContain(claimedSubmissionId);
    expect(idsA).toContain(unclaimedSubmissionId);
  });
});
