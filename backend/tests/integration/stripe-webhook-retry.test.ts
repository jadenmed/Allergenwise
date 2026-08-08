/**
 * tests/integration/stripe-webhook-retry.test.ts
 *
 * REGRESSION: the poison-pill webhook drop (audit 2026-07-26, defect 1).
 *
 * Old behavior: the stripe_events row was written BEFORE the handler ran, and a
 * throwing handler returned 500 without unwinding it. Stripe's retry then hit
 * the duplicate check, got {duplicate:true} + 200, and the event was dropped
 * forever — one transient DB blip silently lost a paid subscription.
 *
 * What this file proves:
 *   1. Delivery #1 with a failing handler → 500 AND the event stays retryable.
 *   2. Delivery #2 of the SAME event id → processes for real (subscription row
 *      created), not {duplicate:true}.
 *   3. Only AFTER a handler completes does the event become a duplicate —
 *      i.e. processed_at is a completion marker, not a "seen" marker (defect 2).
 *
 * The DB fake here is STATEFUL on purpose: the bug only appears when the second
 * delivery observes what the first delivery left behind. A per-call mock that
 * returns a canned count can never catch it — which is why the existing
 * webhook-idempotency tests passed while the bug was live.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import Stripe from 'stripe';
import { buildPlanMetadata, toStripeMetadata } from '@/lib/stripe/metadata';

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('@/lib/supabase/server', () => ({
  createServiceSupabase: vi.fn(),
}));

vi.mock('@/lib/stripe', () => ({
  stripe: new Stripe('sk_test_fake', { apiVersion: '2025-02-24.acacia' }),
}));

vi.mock('@/lib/email/send', () => ({
  sendEmail: vi.fn().mockResolvedValue({ ok: true }),
}));

// ─── Constants ────────────────────────────────────────────────────────────────

const TEST_WEBHOOK_SECRET = 'whsec_test_allergenwise_retry_secret_value';
const REST_ID = '33333333-3333-4333-8333-333333333333';
const ADMIN_ID = '44444444-4444-4444-8444-444444444444';

// ─── Stateful DB fake ─────────────────────────────────────────────────────────

type Row = Record<string, unknown>;
type Filter = { col: string; val: unknown; op: 'eq' | 'neq' };

interface FakeDb {
  from: ReturnType<typeof vi.fn>;
  tables: Record<string, Row[]>;
  fromCalls: string[];
}

/**
 * An in-memory stand-in for the service Supabase client that keeps rows between
 * calls and enforces the two constraints this fix depends on:
 *   - stripe_events.id is a PRIMARY KEY  → re-insert yields count:0
 *   - subscriptions.stripe_invoice_id is UNIQUE (migration 0023) → re-insert
 *     yields Postgres error 23505
 *
 * @param subscriptionInsertFailures how many leading subscriptions INSERTs
 *        should fail with a transient (non-23505) error, simulating the blip
 *        that produced the poison pill.
 */
function makeStatefulDb(subscriptionInsertFailures = 0): FakeDb {
  const tables: Record<string, Row[]> = {
    stripe_events: [],
    subscriptions: [],
    activity_events: [],
    profiles: [],
    restaurants: [],
  };
  const fromCalls: string[] = [];
  let failuresLeft = subscriptionInsertFailures;

  const matches = (row: Row, filters: Filter[]): boolean =>
    filters.every((f) => (f.op === 'eq' ? row[f.col] === f.val : row[f.col] !== f.val));

  type Envelope = { data: unknown; error: unknown; count: number };

  const from = (table: string) => {
    fromCalls.push(table);
    const filters: Filter[] = [];
    let action: (() => Envelope) | null = null;

    const runInsert = (row: Row): Envelope => {
      if (table === 'stripe_events') {
        // PRIMARY KEY (id) + Prefer: resolution=ignore-duplicates
        if (tables.stripe_events.some((r) => r.id === row.id)) {
          return { data: [], error: null, count: 0 };
        }
        tables.stripe_events.push({ status: 'pending', processed_at: null, ...row });
        return { data: [{ id: row.id }], error: null, count: 1 };
      }

      if (table === 'subscriptions') {
        if (failuresLeft > 0) {
          failuresLeft -= 1;
          return {
            data: null,
            error: { code: '08006', message: 'connection failure (injected)' },
            count: 0,
          };
        }
        const invoiceId = row.stripe_invoice_id;
        if (
          invoiceId != null &&
          tables.subscriptions.some((r) => r.stripe_invoice_id === invoiceId)
        ) {
          return {
            data: null,
            error: {
              code: '23505',
              message:
                'duplicate key value violates unique constraint "subscriptions_stripe_invoice_id_key"',
            },
            count: 0,
          };
        }
        tables.subscriptions.push({ ...row });
        return { data: [{ ...row }], error: null, count: 1 };
      }

      tables[table] = tables[table] ?? [];
      tables[table].push({ ...row });
      return { data: [{ ...row }], error: null, count: 1 };
    };

    const readRows = (): Row[] => (tables[table] ?? []).filter((r) => matches(r, filters));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const builder: any = {
      insert(row: Row) {
        action = () => runInsert(row);
        return builder;
      },
      update(patch: Row) {
        action = () => {
          const hits = readRows();
          hits.forEach((r) => Object.assign(r, patch));
          return { data: hits, error: null, count: hits.length };
        };
        return builder;
      },
      select() {
        // A .select() chained onto .insert() is the returning-clause, not a read.
        if (!action) {
          action = () => {
            const hits = readRows();
            return { data: hits, error: null, count: hits.length };
          };
        }
        return builder;
      },
      eq(col: string, val: unknown) {
        filters.push({ col, val, op: 'eq' });
        return builder;
      },
      neq(col: string, val: unknown) {
        filters.push({ col, val, op: 'neq' });
        return builder;
      },
      limit() {
        return Promise.resolve(action ? action() : { data: [], error: null, count: 0 });
      },
      maybeSingle() {
        const env = action ? action() : { data: [], error: null, count: 0 };
        const arr = Array.isArray(env.data) ? (env.data as Row[]) : [];
        return Promise.resolve({ data: arr[0] ?? null, error: env.error });
      },
      then(onF: (v: Envelope) => unknown, onR?: (e: unknown) => unknown) {
        return Promise.resolve(action ? action() : { data: [], error: null, count: 0 }).then(
          onF,
          onR
        );
      },
    };

    return builder;
  };

  return { from: vi.fn(from), tables, fromCalls };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function planMetadata(): Stripe.MetadataParam {
  return toStripeMetadata(
    buildPlanMetadata({ restaurantId: REST_ID, adminId: ADMIN_ID, plan: 'quarterly' })
  );
}

/**
 * A completed Checkout Session. T-41a moved plan provisioning here from
 * payment_intent.succeeded; the retryability property this file guards is
 * unchanged, so only the carrier event changed.
 */
function buildPayload(eventId: string, sessionId: string): string {
  return JSON.stringify({
    id: eventId,
    type: 'checkout.session.completed',
    data: {
      object: {
        id: sessionId,
        object: 'checkout.session',
        amount_total: 9000,
        currency: 'usd',
        status: 'complete',
        payment_status: 'paid',
        payment_intent: `pi_for_${sessionId}`,
        metadata: planMetadata(),
      },
    },
  });
}

async function deliver(payload: string): Promise<Response> {
  const sig = Stripe.webhooks.generateTestHeaderString({
    payload,
    secret: TEST_WEBHOOK_SECRET,
  });
  const { POST } = await import('@/app/api/stripe/webhook/route');
  return POST(
    new NextRequest('http://localhost/api/stripe/webhook', {
      method: 'POST',
      headers: { 'stripe-signature': sig, 'content-type': 'application/json' },
      body: payload,
    })
  );
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Stripe webhook — a failed handler must leave the event retryable', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    process.env.STRIPE_WEBHOOK_SECRET = TEST_WEBHOOK_SECRET;
  });

  it('delivery #1 throws → 500; delivery #2 of the same event processes for real', async () => {
    const { createServiceSupabase } = await import('@/lib/supabase/server');
    const db = makeStatefulDb(1); // first subscriptions INSERT blows up
    vi.mocked(createServiceSupabase).mockReturnValue(
      db as unknown as ReturnType<typeof createServiceSupabase>
    );

    const payload = buildPayload('evt_retry_001', 'cs_retry_001');

    // ── Delivery #1: handler throws ─────────────────────────────────────────
    const first = await deliver(payload);
    expect(first.status).toBe(500);
    expect(db.tables.subscriptions).toHaveLength(0);

    // The event must NOT be sitting there marked as done.
    const afterFirst = db.tables.stripe_events.find((r) => r.id === 'evt_retry_001');
    expect(afterFirst, 'stripe_events row missing entirely').toBeDefined();
    expect(
      afterFirst!.status,
      'a failed delivery left the event marked completed — Stripe retry will be dropped'
    ).not.toBe('completed');
    expect(
      afterFirst!.processed_at,
      'processed_at was stamped even though no handler completed'
    ).toBeNull();

    // ── Delivery #2: Stripe retries the SAME event id ───────────────────────
    const second = await deliver(payload);
    const secondBody = (await second.json()) as { received: boolean; duplicate?: boolean };

    expect(second.status).toBe(200);
    expect(
      secondBody.duplicate,
      'retry was rejected as a duplicate — the event is permanently lost'
    ).toBeUndefined();
    expect(secondBody.received).toBe(true);

    // The whole point: the subscription the customer paid for now exists.
    expect(db.tables.subscriptions).toHaveLength(1);
    expect(db.tables.subscriptions[0]).toMatchObject({
      restaurant_id: REST_ID,
      plan: 'quarterly',
      status: 'active',
      stripe_invoice_id: 'cs_retry_001',
    });
  });

  it('completion is what makes an event a duplicate (processed_at = completion marker)', async () => {
    const { createServiceSupabase } = await import('@/lib/supabase/server');
    const db = makeStatefulDb(0);
    vi.mocked(createServiceSupabase).mockReturnValue(
      db as unknown as ReturnType<typeof createServiceSupabase>
    );

    const payload = buildPayload('evt_retry_002', 'cs_retry_002');

    const first = await deliver(payload);
    expect(first.status).toBe(200);

    const row = db.tables.stripe_events.find((r) => r.id === 'evt_retry_002');
    expect(row!.status).toBe('completed');
    expect(row!.processed_at, 'processed_at must be stamped on completion').not.toBeNull();

    // Replaying a completed event stays a no-op.
    const replay = await deliver(payload);
    const replayBody = (await replay.json()) as { received: boolean; duplicate?: boolean };
    expect(replay.status).toBe(200);
    expect(replayBody.duplicate).toBe(true);
    expect(db.tables.subscriptions).toHaveLength(1);
  });

  it('a delivery that races a completed one cannot double-insert the subscription', async () => {
    // Defect 3: the read-then-write check was replaced by the UNIQUE constraint
    // on subscriptions.stripe_invoice_id. Simulate the losing racer by handing
    // the handler an event id it has never seen for a Session already subscribed.
    const { createServiceSupabase } = await import('@/lib/supabase/server');
    const db = makeStatefulDb(0);
    vi.mocked(createServiceSupabase).mockReturnValue(
      db as unknown as ReturnType<typeof createServiceSupabase>
    );

    const ok = await deliver(buildPayload('evt_race_a', 'cs_race_shared'));
    expect(ok.status).toBe(200);

    // Different event id, same Checkout Session → the DB constraint is the only guard.
    const racer = await deliver(buildPayload('evt_race_b', 'cs_race_shared'));
    expect(racer.status, '23505 must be swallowed as already-done, not bubbled as 500').toBe(200);
    expect(db.tables.subscriptions).toHaveLength(1);
  });
});
