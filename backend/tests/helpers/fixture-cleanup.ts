/**
 * tests/integration/helpers/fixture-cleanup.ts
 *
 * T-30 — idempotent, prefix-scoped fixture teardown.
 *
 * WHY THIS EXISTS
 * ---------------
 * Integration suites seed rows through a service-role client and, before this
 * helper, either removed nothing or removed only part of what they made. Every
 * run accumulated. On 2026-07-28 that reached production and had to be cleaned
 * by hand (T-26). The rows were removed; nothing stopped them coming back.
 *
 * THE THREE RULES THIS FILE IMPLEMENTS
 * ------------------------------------
 * 1. SCOPE BY TOKEN, RESOLVED FROM THE DATABASE — NEVER BY MODULE-SCOPE IDS.
 *    A suite that throws or times out inside beforeAll never populates its
 *    `let learnerId` / `let restaurantId` variables, and that is precisely the
 *    run that leaves the most behind. Every id used below is re-derived here,
 *    at teardown time, by matching the suite's unique run token against the
 *    text columns that carry it (restaurants.slug, profiles.email, ...). The
 *    teardown therefore works when the suite body never finished, when it
 *    finished halfway, and when it created nothing at all.
 *
 * 2. THE TOKEN IS PER-RUN, NOT PER-FAMILY.
 *    Suites build their token as `<family>-${Date.now()}` (e.g.
 *    `w2a-1754212800000`). We match the WHOLE token, never the bare family
 *    prefix. Matching `w2a-` alone would delete the other lane's in-flight
 *    fixtures — we run two lanes against one local Postgres. Nothing here ever
 *    truncates, and nothing here deletes a row it cannot attribute to the
 *    calling suite's own run.
 *
 * 3. FK ORDER IS DERIVED FROM THE SCHEMA, NOT ASSUMED.
 *    Almost every FK in supabase/migrations/0001_init.sql is plain
 *    `references x` — i.e. NO ACTION, not ON DELETE CASCADE. A parent delete
 *    against a surviving child does not cascade; it fails. supabase-js returns
 *    that failure in `error` rather than throwing, and the pre-T-30 hooks never
 *    checked it — which is exactly how a suite could run a `restaurants`
 *    delete every time and still leak the restaurant on every run. Children go
 *    first, and `purgeFixtures` surfaces any residual error to the caller.
 *
 * auth.users is deleted LAST. `profiles.id references auth.users on delete
 * cascade` is the one true cascade in the tenant graph, but we do not lean on
 * it for correctness: profiles are deleted explicitly first, so the auth delete
 * is a cleanup of the identity row alone.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Rows resolved from the database for one suite's run token. */
export interface FixtureScope {
  restaurantIds: string[];
  profileIds: string[];
  brandIds: string[];
  partnerIds: string[];
  certificateIds: string[];
  subscriptionIds: string[];
  authUserIds: string[];
}

/** What a purge actually removed, for assertions and debugging. */
export interface PurgeReport {
  scope: FixtureScope;
  deleted: Record<string, number>;
  errors: string[];
}

const EMPTY_SCOPE: FixtureScope = {
  restaurantIds: [],
  profileIds: [],
  brandIds: [],
  partnerIds: [],
  certificateIds: [],
  subscriptionIds: [],
  authUserIds: [],
};

function uniq(values: (string | null | undefined)[]): string[] {
  return [...new Set(values.filter((v): v is string => typeof v === 'string' && v.length > 0))];
}

/**
 * `%token%` rather than `token%`: suites embed their token mid-string as often
 * as they lead with it (`departed-bistro-t46a-...`, `pa-rls-brand-pa-rls-...`).
 * ilike, not like, because tokens are upper-case in several suites
 * (`WAVE3-VFY-...`) while GoTrue lower-cases the addresses it stores.
 */
function contains(token: string): string {
  return `%${token}%`;
}

async function idsWhereIlike(
  db: SupabaseClient,
  table: string,
  column: string,
  token: string,
  errors: string[]
): Promise<string[]> {
  const { data, error } = await (db as any).from(table).select('id').ilike(column, contains(token));
  if (error) {
    errors.push(`resolve ${table}.${column}: ${error.message}`);
    return [];
  }
  return uniq((data ?? []).map((r: { id: string }) => r.id));
}

async function idsWhereIn(
  db: SupabaseClient,
  table: string,
  column: string,
  values: string[],
  errors: string[]
): Promise<string[]> {
  if (values.length === 0) return [];
  const { data, error } = await (db as any).from(table).select('id').in(column, values);
  if (error) {
    errors.push(`resolve ${table}.${column}: ${error.message}`);
    return [];
  }
  return uniq((data ?? []).map((r: { id: string }) => r.id));
}

/**
 * Every auth user whose address carries the token, plus every auth user backing
 * a profile we already resolved. The second half matters because a profile can
 * be seeded with an address that does not carry the token while its restaurant
 * does.
 *
 * listUsers is paginated and there is no server-side email filter on the admin
 * API, so we page through. The bound is generous but finite — a runaway local
 * database should not turn teardown into an unbounded scan.
 */
async function resolveAuthUserIds(
  db: SupabaseClient,
  token: string,
  profileIds: string[],
  errors: string[]
): Promise<string[]> {
  const needle = token.toLowerCase();
  const wanted = new Set(profileIds);
  const found = new Set<string>(profileIds);
  const PER_PAGE = 200;
  const MAX_PAGES = 50;

  for (let page = 1; page <= MAX_PAGES; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: PER_PAGE });
    if (error) {
      errors.push(`resolve auth.users (page ${page}): ${error.message}`);
      return [...found];
    }
    const users = data?.users ?? [];
    for (const u of users) {
      if (wanted.has(u.id)) continue;
      if ((u.email ?? '').toLowerCase().includes(needle)) found.add(u.id);
    }
    if (users.length < PER_PAGE) break;
    if (page === MAX_PAGES) {
      errors.push(
        `resolve auth.users: stopped at the ${MAX_PAGES}-page bound; some fixture users may remain`
      );
    }
  }
  return [...found];
}

/**
 * Re-derive everything the calling suite could have created, from the database,
 * using only its run token. Safe to call when the suite created nothing — every
 * list simply comes back empty.
 */
export async function resolveFixtureScope(
  db: SupabaseClient,
  token: string
): Promise<{ scope: FixtureScope; errors: string[] }> {
  const errors: string[] = [];
  if (!token) {
    errors.push('resolveFixtureScope: empty token — refusing to resolve an unbounded scope');
    return { scope: { ...EMPTY_SCOPE }, errors };
  }

  const restaurantIds = uniq([
    ...(await idsWhereIlike(db, 'restaurants', 'slug', token, errors)),
    ...(await idsWhereIlike(db, 'restaurants', 'name', token, errors)),
  ]);

  const brandIds = uniq([
    ...(await idsWhereIlike(db, 'brands', 'slug', token, errors)),
    ...(await idsWhereIlike(db, 'brands', 'name', token, errors)),
  ]);

  const partnerIds = uniq([
    ...(await idsWhereIlike(db, 'partners', 'name', token, errors)),
    ...(await idsWhereIlike(db, 'partners', 'contact_email', token, errors)),
  ]);

  // Profiles by their own address, plus every profile sitting under one of our
  // restaurants — app code under test creates profiles we never named.
  const profileIds = uniq([
    ...(await idsWhereIlike(db, 'profiles', 'email', token, errors)),
    ...(await idsWhereIlike(db, 'profiles', 'full_name', token, errors)),
    ...(await idsWhereIn(db, 'profiles', 'restaurant_id', restaurantIds, errors)),
    ...(await idsWhereIn(db, 'profiles', 'partner_id', partnerIds, errors)),
  ]);

  const certificateIds = uniq([
    ...(await idsWhereIn(db, 'certificates', 'restaurant_id', restaurantIds, errors)),
    ...(await idsWhereIn(db, 'certificates', 'profile_id', profileIds, errors)),
  ]);

  const subscriptionIds = await idsWhereIn(
    db,
    'subscriptions',
    'restaurant_id',
    restaurantIds,
    errors
  );

  const authUserIds = await resolveAuthUserIds(db, token, profileIds, errors);

  return {
    scope: {
      restaurantIds,
      profileIds,
      brandIds,
      partnerIds,
      certificateIds,
      subscriptionIds,
      authUserIds,
    },
    errors,
  };
}

/**
 * Counts via `{ count: 'exact' }` rather than a `.select('id')` returning-clause:
 * cert_warnings (0010) and review_rate_limits (0008) have composite keys and NO
 * `id` column, so asking for one made PostgREST reject the whole DELETE. Both
 * cascade from their parents, so nothing leaked — but the request failed, and a
 * teardown that reports an error it did not need to hit is a teardown nobody
 * will trust when the error is real.
 */
async function del(
  db: SupabaseClient,
  table: string,
  column: string,
  values: string[],
  deleted: Record<string, number>,
  errors: string[]
): Promise<void> {
  if (values.length === 0) return;
  const { count, error } = await (db as any)
    .from(table)
    .delete({ count: 'exact' })
    .in(column, values);
  if (error) {
    errors.push(`delete ${table} by ${column}: ${error.message}`);
    return;
  }
  deleted[table] = (deleted[table] ?? 0) + (count ?? 0);
}

async function delIlike(
  db: SupabaseClient,
  table: string,
  column: string,
  token: string,
  deleted: Record<string, number>,
  errors: string[]
): Promise<void> {
  const { count, error } = await (db as any)
    .from(table)
    .delete({ count: 'exact' })
    .ilike(column, contains(token));
  if (error) {
    errors.push(`delete ${table} by ${column}: ${error.message}`);
    return;
  }
  deleted[table] = (deleted[table] ?? 0) + (count ?? 0);
}

/**
 * Remove every row the calling suite's run created, children first.
 *
 * Idempotent in all three senses the task requires: running it twice is a
 * no-op the second time, running it after a suite that failed halfway removes
 * whatever did get created, and running it for a suite that created nothing
 * touches nothing.
 *
 * Returns rather than throws. An afterAll that throws masks the real test
 * failure, so callers get a report and decide.
 */
export async function purgeFixtures(db: SupabaseClient, token: string): Promise<PurgeReport> {
  const deleted: Record<string, number> = {};
  const { scope, errors } = await resolveFixtureScope(db, token);
  const { restaurantIds, profileIds, brandIds, partnerIds, certificateIds, subscriptionIds } =
    scope;

  // ── 1. Children of certificates ────────────────────────────────────────────
  // cert_warnings.cert_id cascades (0010), but deleting explicitly keeps this
  // function honest about what it removed rather than trusting a cascade.
  await del(db, 'cert_warnings', 'cert_id', certificateIds, deleted, errors);

  // ── 2. certificates — before exam_attempts (certificates.exam_attempt_id),
  //       before profiles and restaurants.
  await del(db, 'certificates', 'id', certificateIds, deleted, errors);

  // ── 3. activity_events — before profiles and restaurants.
  //       THE ONE EVERY PRE-T-30 HOOK MISSED. Route handlers and cron jobs
  //       under test write these rows themselves (verify, expire-certs,
  //       purge-stale, the Stripe webhook, roster departure), so they exist in
  //       suites whose own file contains no activity_events insert. Both FK
  //       columns are NO ACTION, so a surviving event is what silently failed
  //       the restaurants delete and leaked the tenant row.
  await del(db, 'activity_events', 'restaurant_id', restaurantIds, deleted, errors);
  await del(db, 'activity_events', 'actor_id', profileIds, deleted, errors);

  // ── 4. submissions — three FK columns into our scope.
  await del(db, 'submissions', 'restaurant_id', restaurantIds, deleted, errors);
  await del(db, 'submissions', 'submitted_by', profileIds, deleted, errors);
  await del(db, 'submissions', 'reviewer_id', profileIds, deleted, errors);

  // ── 5. Learner-progress children of profiles ───────────────────────────────
  await del(db, 'exam_attempts', 'profile_id', profileIds, deleted, errors);
  await del(db, 'lesson_progress', 'profile_id', profileIds, deleted, errors);
  await del(db, 'quiz_attempts', 'profile_id', profileIds, deleted, errors);
  await del(db, 'csv_upload_drafts', 'admin_id', profileIds, deleted, errors);
  await del(db, 'account_deletion_tokens', 'profile_id', profileIds, deleted, errors);

  // ── 6. Restaurant-scoped leaves ────────────────────────────────────────────
  await del(db, 'reviews', 'restaurant_id', restaurantIds, deleted, errors);
  await del(db, 'review_rate_limits', 'restaurant_id', restaurantIds, deleted, errors);
  await del(db, 'csv_upload_drafts', 'restaurant_id', restaurantIds, deleted, errors);

  // ── 7. Money rows — invoice_payments references BOTH restaurants and
  //       subscriptions, so it precedes subscriptions.
  await del(db, 'invoice_payments', 'restaurant_id', restaurantIds, deleted, errors);
  await del(db, 'invoice_payments', 'subscription_id', subscriptionIds, deleted, errors);
  await del(db, 'subscriptions', 'id', subscriptionIds, deleted, errors);

  // ── 8. Partner config — brand_attributions references partners and brands.
  await del(db, 'brand_attributions', 'brand_id', brandIds, deleted, errors);
  await del(db, 'brand_attributions', 'partner_id', partnerIds, deleted, errors);

  // ── 9. Break the two nullable parent links that would otherwise pin brands
  //       and partners alive (restaurants.brand_id, profiles.partner_id).
  if (brandIds.length > 0 && restaurantIds.length > 0) {
    const { error } = await (db as any)
      .from('restaurants')
      .update({ brand_id: null })
      .in('id', restaurantIds);
    if (error) errors.push(`clear restaurants.brand_id: ${error.message}`);
  }
  if (partnerIds.length > 0 && profileIds.length > 0) {
    const { error } = await (db as any)
      .from('profiles')
      .update({ partner_id: null })
      .in('id', profileIds);
    if (error) errors.push(`clear profiles.partner_id: ${error.message}`);
  }

  // ── 10. profiles — before restaurants (profiles.restaurant_id is NO ACTION).
  //        profiles.invited_by is a self-reference; a single DELETE ... IN (...)
  //        removes referrer and referred together, and Postgres checks the FK
  //        at end of statement, so the self-edge does not block us.
  await del(db, 'profiles', 'id', profileIds, deleted, errors);

  // ── 11. restaurants, then the brands/partners they pointed at.
  await del(db, 'restaurants', 'id', restaurantIds, deleted, errors);
  await del(db, 'brands', 'id', brandIds, deleted, errors);
  await del(db, 'partners', 'id', partnerIds, deleted, errors);

  // ── 12. stripe_events — no FK, text PK holding the fake event id. Only rows
  //        whose id carries this run's token; a real Stripe id never will.
  await delIlike(db, 'stripe_events', 'id', token, deleted, errors);

  // ── 13. auth.users LAST.
  let authDeleted = 0;
  for (const id of scope.authUserIds) {
    const { error } = await db.auth.admin.deleteUser(id);
    if (error) {
      // "not found" is the expected outcome on a second run — idempotent, not
      // an error worth reporting.
      if (!/not found/i.test(error.message)) {
        errors.push(`delete auth user ${id}: ${error.message}`);
      }
      continue;
    }
    authDeleted++;
  }
  if (authDeleted > 0) deleted['auth.users'] = authDeleted;

  return { scope, deleted, errors };
}

/**
 * ORPHAN EVENTS — activity_events written with BOTH restaurant_id and actor_id
 * NULL. They are unreachable through the tenant graph, so `purgeFixtures` can
 * never see them, and the run-1 measurement caught exactly five of them.
 *
 * Two writers produce them, and both stamp something identifying in `payload`:
 *
 *   - scripts/reconcile-cert-states.ts       → payload.cert_code
 *   - lib/stripe/cert-event-handlers.ts, on  → payload.stripe_event_id
 *     the deliberate "no matching cert or
 *     subscription" orphan paths
 *
 * So the caller passes needles (its run token, its cert codes) and we match
 * against the serialised payload. Matching the payload rather than the event
 * TYPE is the whole point: the pre-T-30 code deleted every row of
 * type='cert_state_reconciled' regardless of owner, which would have taken the
 * other lane's rows with it.
 *
 * Needles MUST come from module-scope constants, never from variables assigned
 * inside beforeAll, so this still works when the suite body never ran.
 *
 * Note what this deliberately does NOT delete: a reconcile event whose
 * cert_code belongs to some other suite's certificate. The reconcile script
 * scans the cert table globally, so it can emit events about rows this suite
 * does not own — those are not ours to remove. See the T-40 note in the task
 * report.
 */
export async function purgeOrphanEvents(
  db: SupabaseClient,
  needles: string[]
): Promise<{ deleted: number; errors: string[] }> {
  const errors: string[] = [];
  const wanted = needles.filter((n) => typeof n === 'string' && n.length > 0);
  if (wanted.length === 0) return { deleted: 0, errors };

  const { data, error } = await (db as any)
    .from('activity_events')
    .select('id, payload')
    .is('restaurant_id', null)
    .is('actor_id', null);
  if (error) {
    errors.push(`resolve orphan activity_events: ${error.message}`);
    return { deleted: 0, errors };
  }

  const ids = (data ?? [])
    .filter((r: { payload: unknown }) => {
      const blob = JSON.stringify(r.payload ?? {});
      return wanted.some((n) => blob.includes(n));
    })
    .map((r: { id: string }) => r.id);

  if (ids.length === 0) return { deleted: 0, errors };

  const { count, error: delErr } = await (db as any)
    .from('activity_events')
    .delete({ count: 'exact' })
    .in('id', ids);
  if (delErr) {
    errors.push(`delete orphan activity_events: ${delErr.message}`);
    return { deleted: 0, errors };
  }
  return { deleted: count ?? 0, errors };
}
