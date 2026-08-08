/**
 * tests/integration/submission-checkout-idempotency.test.ts
 *
 * T-41b trap 6 — the idempotency claim, proved against the real local Postgres
 * rather than a mock that agrees with itself.
 *
 * Migration 0024 adds two UNIQUE indexes to `submissions`, and this file exists
 * because a mocked `{code:'23505'}` proves only that the handler reads an error
 * code — not that the database would ever produce one:
 *
 *   submissions_stripe_checkout_session_id_key
 *       UNIQUE (stripe_checkout_session_id). A redelivery of the same Checkout
 *       Session cannot insert a second submission. Same shape as
 *       subscriptions.stripe_invoice_id in 0023 (see
 *       tests/integration/subscriptions-invoice-unique.test.ts) and chosen for
 *       the same reason: a SELECT-then-INSERT lets two concurrent deliveries
 *       both see "not found" and both insert.
 *
 *   submissions_one_open_per_restaurant
 *       UNIQUE (restaurant_id) WHERE status IN
 *       ('pending','in_review','info_requested'). A manager who opens the form
 *       twice can create two Checkout Sessions that BOTH pass eligibility —
 *       that check runs before either submission row exists. Paying both would
 *       mean two charges and two entries in the reviewer queue.
 *
 * Skipped unless a local database is reachable, exactly like the other
 * real-DB suites in this directory.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { purgeFixtures } from '../helpers/fixture-cleanup';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { finalizeSubmission } from '@/lib/submissions/finalize';
import type { ServiceDb } from '@/lib/db/service';
import { hasLocalSupabase } from '../helpers/local-db';

vi.mock('@/lib/email/send', () => ({
  sendEmail: vi.fn().mockResolvedValue({ ok: true }),
}));

config({ path: '.env.local' });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

// T-25 — this gate was named HAS_DB rather than hasLocalSupabase, so a sweep
// for the dishonest flag by name missed it, and it was the weakest of the lot:
// `Boolean(SUPABASE_URL && SERVICE_KEY)` did not even check for a placeholder
// key, let alone locality. It seeds through the service-role client, which
// bypasses every RLS policy.
const HAS_DB = hasLocalSupabase();

const ts = Date.now();
const suffix = String(ts).slice(-12).padStart(12, '0');
const REST_ID = `d0d0d0d0-0000-4000-8000-${suffix}`;
/**
 * T-30: the teardown token. `ts` alone is a bare epoch, and every other suite
 * embeds an epoch in ITS token too (`w2a-1754212800000`), so a bare-epoch match
 * could reach across suites. Prefixing with the task id makes it unambiguous,
 * and both the slug and the address below carry it so teardown can resolve them
 * without any module-scope id.
 */
const FIXTURE_TOKEN = `t41b-${ts}`;
const MANAGER_EMAIL = `${FIXTURE_TOKEN}@example.test`;

describe.runIf(HAS_DB)('T-41b — submission idempotency is enforced by the database', () => {
  let db: SupabaseClient;
  let serviceDb: ServiceDb;
  /** profiles.id FKs to auth.users, so the manager needs a real auth user. */
  let managerId: string;

  beforeAll(async () => {
    db = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    serviceDb = { from: (t: string) => (db as any).from(t) } as unknown as ServiceDb;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: restErr } = await (db as any).from('restaurants').insert({
      id: REST_ID,
      slug: `${FIXTURE_TOKEN}-idempotency`,
      name: 'T-41b Idempotency Bistro',
      status: 'unlisted',
    });
    if (restErr) throw new Error(`seed restaurant failed: ${restErr.message}`);

    const { data: authData, error: authErr } = await db.auth.admin.createUser({
      email: MANAGER_EMAIL,
      password: 'T41bIdempotency!1234',
      email_confirm: true,
    });
    if (authErr || !authData.user) throw new Error(`seed auth user failed: ${authErr?.message}`);
    managerId = authData.user.id;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: profErr } = await (db as any).from('profiles').upsert({
      id: managerId,
      role: 'manager',
      restaurant_id: REST_ID,
      email: MANAGER_EMAIL,
      full_name: 'T41b Manager',
    });
    if (profErr) throw new Error(`seed profile failed: ${profErr.message}`);
  }, 30000);

  afterAll(async () => {
    if (!db) return;
    // T-30: was the most complete of the pre-existing hooks, but still keyed on
    // `managerId`, which is unset if beforeAll threw before createUser returned.
    // Re-resolved from the token instead.
    const { errors } = await purgeFixtures(db, FIXTURE_TOKEN);
    if (errors.length > 0) console.error('[submission-checkout-idempotency] teardown:', errors);
  });

  async function openSubmissionCount(): Promise<number> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data } = await (db as any)
      .from('submissions')
      .select('id')
      .eq('restaurant_id', REST_ID)
      .in('status', ['pending', 'in_review', 'info_requested']);
    return (data ?? []).length;
  }

  const call = (checkoutSessionId: string | null, certFeeTotalCents = 7000) =>
    finalizeSubmission({
      db: serviceDb,
      restaurantId: REST_ID,
      submittedBy: managerId,
      checkoutSessionId,
      paymentIntentId: checkoutSessionId ? `pi_for_${checkoutSessionId}` : null,
      certFeeTotalCents,
      activatedCount: 2,
      actorId: null,
    });

  it('records the submission and moves the restaurant into the queue', async () => {
    const result = await call(`cs_t41b_first_${ts}`);

    expect(result.outcome).toBe('created');

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: rest } = await (db as any)
      .from('restaurants')
      .select('status')
      .eq('id', REST_ID)
      .single();
    expect(rest.status).toBe('pending_review');

    expect(await openSubmissionCount()).toBe(1);
  });

  it('TRAP 6: redelivering the SAME Checkout Session inserts nothing', async () => {
    // Not a read-then-write check — the UNIQUE index rejects the INSERT, which
    // is the only guard two concurrent deliveries cannot both pass.
    const result = await call(`cs_t41b_first_${ts}`);

    expect(result.outcome).toBe('duplicate');
    expect(await openSubmissionCount(), 'still exactly one').toBe(1);
  });

  it('a DIFFERENT session cannot open a second concurrent submission', async () => {
    const result = await call(`cs_t41b_second_${ts}`);

    expect(result.outcome).toBe('conflict');
    expect(await openSubmissionCount(), 'still exactly one').toBe(1);
  });

  it('once the review is decided, the restaurant may submit again', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (db as any)
      .from('submissions')
      .update({ status: 'rejected' })
      .eq('restaurant_id', REST_ID)
      .eq('status', 'pending');

    expect(await openSubmissionCount()).toBe(0);

    // The zero-pending-certificates resubmission: no Session, so the session
    // column is NULL. NULLs are distinct in a Postgres unique index, so any
    // number of those may accumulate over a restaurant's lifetime.
    const result = await call(null, 0);
    expect(result.outcome).toBe('created');
    expect(await openSubmissionCount()).toBe(1);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: rows } = await (db as any)
      .from('submissions')
      .select('cert_fee_total_cents, stripe_checkout_session_id')
      .eq('restaurant_id', REST_ID)
      .is('stripe_checkout_session_id', null);
    expect(rows).toHaveLength(1);
    // 0 is a real charged amount, not a missing one.
    expect(rows[0].cert_fee_total_cents).toBe(0);
  });
});
