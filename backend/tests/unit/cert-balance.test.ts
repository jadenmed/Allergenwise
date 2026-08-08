/**
 * tests/unit/cert-balance.test.ts
 *
 * T-45a — the balance a restaurant owes for staff certified after it was listed,
 * and the three numbers a diner reads.
 *
 * THE SCENARIO EVERY TEST HERE IS ABOUT
 * ─────────────────────────────────────
 * A restaurant submits, pays for the staff it has, gets listed. Two months later
 * it hires someone. That person passes the exam, their certificate lands
 * `pending`, and nothing charges for it — payment was attached to submission,
 * which already happened. $35 goes uncollected, and the public listing keeps
 * asserting a fully-certified roster while an untrained person takes orders from
 * someone with a life-threatening allergy.
 *
 * What is asserted:
 *   1. The balance after a new hire passes: 1 pending certificate, $35, and when.
 *   2. The counts: 13 current staff, 10 certified, 3 in training — and that
 *      certified + inTraining === total, asserted rather than assumed.
 *   3. A DEPARTED employee appears in none of the three numbers and is not
 *      billed for (T-46a is not undone).
 *   4. A failed or truncated count renders as an ABSENCE. Never as 0. The
 *      `?? 0` that laundered a failed query into "100% certified" (T-18) must
 *      not be reachable from here.
 *   5. Nothing in this module writes to `certificates` — or to anything.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  billablePendingCerts,
  deriveCertBalance,
  deriveStaffCounts,
  isBillablePendingCert,
  readCertSnapshot,
  type BillableCertRow,
} from '@/lib/billing/cert-balance';
import { CERT_FEE_CENTS } from '@/lib/billing/pricing';
import type { StaffIdentityRow } from '@/lib/staff/membership';
import type { ServiceDb } from '@/lib/db/service';

vi.mock('server-only', () => ({}));

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const REST_ID = '22222222-2222-4222-8222-222222222222';

const FUTURE = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();
const PAST = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
const LONG_AGO = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();

const learner = (id: string, departedAt: string | null = null): StaffIdentityRow => ({
  id,
  role: 'learner',
  departed_at: departedAt,
});

const cert = (
  profileId: string,
  status: string,
  overrides: Partial<BillableCertRow> = {}
): BillableCertRow => ({
  profile_id: profileId,
  status,
  expires_at: FUTURE,
  issued_at: PAST,
  ...overrides,
});

// ─── Fake PostgREST ───────────────────────────────────────────────────────────

interface DbFixture {
  learners: StaffIdentityRow[];
  certs: BillableCertRow[];
  learnerError?: { message: string };
  certError?: { message: string };
  /** Simulates a body truncated at `max_rows` while Content-Range reports more. */
  learnerCount?: number;
  certCount?: number;
}

interface DbProbe {
  db: ServiceDb;
  /** Every mutating call the module made. MUST stay empty. */
  writes: Array<{ table: string; op: string; values: unknown }>;
}

function makeDb(fixture: DbFixture): DbProbe {
  const writes: DbProbe['writes'] = [];

  const from = (table: string) => {
    const isCerts = table === 'certificates';
    const data = isCerts ? fixture.certs : fixture.learners;
    const error = isCerts ? fixture.certError : fixture.learnerError;
    const countOverride = isCerts ? fixture.certCount : fixture.learnerCount;

    const chain: Record<string, unknown> = {};
    for (const method of ['select', 'eq', 'in', 'is', 'gt', 'gte', 'order', 'limit']) {
      chain[method] = () => chain;
    }

    // Any of these being reached at all is the failure — see the write test.
    for (const op of ['insert', 'update', 'upsert', 'delete']) {
      chain[op] = (values: unknown) => {
        writes.push({ table, op, values });
        return chain;
      };
    }

    chain.then = (onF: (v: unknown) => unknown) =>
      Promise.resolve({
        data: error ? null : data,
        count: error ? null : (countOverride ?? data.length),
        error: error ?? null,
      }).then(onF);

    return chain;
  };

  return { db: { from } as unknown as ServiceDb, writes };
}

// ─── 1. The balance after a new hire passes ───────────────────────────────────

describe('the balance after a new hire passes the exam', () => {
  it('one pending certificate is $35 owed, dated from when it was issued', async () => {
    // The restaurant was listed with two certified staff. It hired a third, who
    // has just passed. Nothing charged them, because payment rode on submission.
    const { db } = makeDb({
      learners: [learner('a'), learner('b'), learner('new-hire')],
      certs: [
        cert('a', 'active'),
        cert('b', 'active'),
        cert('new-hire', 'pending', { issued_at: LONG_AGO }),
      ],
    });

    const snapshot = await readCertSnapshot(db, REST_ID);

    expect(snapshot.kind).toBe('known');
    if (snapshot.kind !== 'known') return;

    expect(snapshot.pendingCertCount, 'only the new hire is unpaid').toBe(1);
    expect(snapshot.amountOwedCents).toBe(3500);
    expect(snapshot.amountOwedCents).toBe(CERT_FEE_CENTS * 1);
    expect(snapshot.owedSince, 'the clock runs from when the debt started').toBe(LONG_AGO);
  });

  it('owedSince is the OLDEST unpaid certificate, not the newest', async () => {
    // T-45b's grace clock reads this. Taking the newest would restart the clock
    // every time another employee passed, so a restaurant that keeps hiring
    // would never leave its grace period.
    const { db } = makeDb({
      learners: [learner('a'), learner('b')],
      certs: [
        cert('a', 'pending', { issued_at: PAST }),
        cert('b', 'pending', { issued_at: LONG_AGO }),
      ],
    });

    const snapshot = await readCertSnapshot(db, REST_ID);
    if (snapshot.kind !== 'known') throw new Error('expected a known snapshot');

    expect(snapshot.pendingCertCount).toBe(2);
    expect(snapshot.amountOwedCents).toBe(7000);
    expect(snapshot.owedSince).toBe(LONG_AGO);
  });

  it('nothing owed when every certificate is already paid for', async () => {
    const { db } = makeDb({
      learners: [learner('a'), learner('b')],
      certs: [cert('a', 'active'), cert('b', 'active')],
    });

    const snapshot = await readCertSnapshot(db, REST_ID);
    if (snapshot.kind !== 'known') throw new Error('expected a known snapshot');

    expect(snapshot.pendingCertCount).toBe(0);
    expect(snapshot.amountOwedCents).toBe(0);
    expect(snapshot.owedSince, 'no debt, no clock').toBeNull();
  });

  it('an already-active certificate is never billable — no re-charge, ever', () => {
    const ids = new Set(['a']);
    expect(isBillablePendingCert(cert('a', 'active'), ids)).toBe(false);
    expect(isBillablePendingCert(cert('a', 'pending'), ids)).toBe(true);
  });

  it('an expired pending certificate is not billable', () => {
    // Mirrors the `.gt('expires_at', now)` lib/admin/eligibility.ts applies in
    // SQL. Charging for a certificate that can never activate is charging for
    // nothing.
    const ids = new Set(['a']);
    const expired = cert('a', 'pending', { expires_at: PAST });
    expect(isBillablePendingCert(expired, ids)).toBe(false);
  });

  it('a certificate with no usable expiry is not billable — errs away from over-billing', () => {
    const ids = new Set(['a']);
    expect(isBillablePendingCert(cert('a', 'pending', { expires_at: null }), ids)).toBe(false);
    expect(isBillablePendingCert(cert('a', 'pending', { expires_at: 'nonsense' }), ids)).toBe(
      false
    );
  });
});

// ─── 2. The counts ────────────────────────────────────────────────────────────

describe('the three numbers a diner reads', () => {
  it('13 current staff, 10 certified, 3 in training — and the sum holds', async () => {
    // "10 of 13 staff certified · 3 new team members in training".
    const learners = Array.from({ length: 13 }, (_, i) => learner(`emp-${i}`));
    const certs = [
      // Ten paid-for, publicly-active certificates.
      ...Array.from({ length: 10 }, (_, i) => cert(`emp-${i}`, 'active')),
      // Two of the three new hires have passed but are unpaid — still in
      // training as far as the public is concerned, because `pending` is not
      // publicly active. The thirteenth has not sat the exam at all.
      cert('emp-10', 'pending'),
      cert('emp-11', 'pending'),
    ];

    const { db } = makeDb({ learners, certs });
    const snapshot = await readCertSnapshot(db, REST_ID);
    if (snapshot.kind !== 'known') throw new Error('expected a known snapshot');

    expect(snapshot.total).toBe(13);
    expect(snapshot.certified).toBe(10);
    expect(snapshot.inTraining).toBe(3);

    // The identity, asserted rather than assumed.
    expect(snapshot.certified + snapshot.inTraining).toBe(snapshot.total);

    // And the balance that goes with it: two unpaid certificates.
    expect(snapshot.pendingCertCount).toBe(2);
    expect(snapshot.amountOwedCents).toBe(7000);
  });

  it('the count is never frozen — it moves the moment a person is added', () => {
    // The T-45a decision: a grace period governs consequences, never a displayed
    // number. Hiring changes the denominator immediately, with nothing paid and
    // no exam sat.
    const before = deriveStaffCounts(
      [learner('a'), learner('b')],
      [cert('a', 'active'), cert('b', 'active')]
    );
    expect(before).toEqual({ total: 2, certified: 2, inTraining: 0 });

    const after = deriveStaffCounts(
      [learner('a'), learner('b'), learner('brand-new')],
      [cert('a', 'active'), cert('b', 'active')]
    );
    expect(after).toEqual({ total: 3, certified: 2, inTraining: 1 });
    expect(after.certified + after.inTraining).toBe(after.total);
  });

  it('a learner holding two certificates is still one person (T-23 not undone)', () => {
    const counts = deriveStaffCounts(
      [learner('a'), learner('b')],
      [cert('a', 'active'), cert('a', 'active')]
    );

    expect(counts.certified, 'people, not certificate rows').toBe(1);
    expect(counts.total).toBe(2);
    expect(counts.inTraining).toBe(1);
    expect(counts.certified + counts.inTraining).toBe(counts.total);
  });
});

// ─── 3. Departed staff ────────────────────────────────────────────────────────

describe('a departed employee appears in none of the three numbers', () => {
  it('is absent from total, certified and inTraining alike', async () => {
    const { db } = makeDb({
      learners: [learner('stays'), learner('quit', '2026-06-01T00:00:00.000Z')],
      certs: [
        cert('stays', 'active'),
        // Their certificate is still valid and untouched — it simply stops
        // being this restaurant's to count (T-46a, migration 0026).
        cert('quit', 'active'),
      ],
    });

    const snapshot = await readCertSnapshot(db, REST_ID);
    if (snapshot.kind !== 'known') throw new Error('expected a known snapshot');

    expect(snapshot.total, 'the denominator drops them').toBe(1);
    expect(snapshot.certified, 'and so does the numerator').toBe(1);
    expect(snapshot.inTraining, 'and they are not "in training" either').toBe(0);
    expect(snapshot.certified + snapshot.inTraining).toBe(snapshot.total);
  });

  it("is not billed for — a departed learner's PENDING certificate is not owed", async () => {
    const { db } = makeDb({
      learners: [learner('stays'), learner('quit', '2026-06-01T00:00:00.000Z')],
      certs: [cert('stays', 'pending'), cert('quit', 'pending')],
    });

    const snapshot = await readCertSnapshot(db, REST_ID);
    if (snapshot.kind !== 'known') throw new Error('expected a known snapshot');

    expect(snapshot.pendingCertCount, 'only the employee who still works here').toBe(1);
    expect(snapshot.amountOwedCents).toBe(3500);
  });

  it('the billable filter is not a blanket zero', () => {
    const current = new Set(['stays']);
    const rows = [cert('stays', 'pending'), cert('quit', 'pending')];

    expect(billablePendingCerts(rows, current)).toHaveLength(1);
    expect(deriveCertBalance([learner('stays')], rows).amountOwedCents).toBe(3500);
  });
});

// ─── 4. A failed count is an absence, never a zero ────────────────────────────

describe('a failed count renders as an absence, not as 0', () => {
  it('a failed learner read is unavailable', async () => {
    const { db } = makeDb({
      learners: [],
      certs: [],
      learnerError: { message: 'connection reset' },
    });

    const snapshot = await readCertSnapshot(db, REST_ID);

    expect(snapshot.kind).toBe('unavailable');
    // The whole point: no number of any kind escapes.
    expect(snapshot).not.toHaveProperty('total');
    expect(snapshot).not.toHaveProperty('certified');
    expect(snapshot).not.toHaveProperty('pendingCertCount');
    expect(snapshot).not.toHaveProperty('amountOwedCents');
  });

  it('a failed certificate read is unavailable', async () => {
    const { db } = makeDb({
      learners: [learner('a')],
      certs: [],
      certError: { message: 'boom' },
    });

    const snapshot = await readCertSnapshot(db, REST_ID);
    expect(snapshot.kind).toBe('unavailable');
    expect(snapshot).not.toHaveProperty('certified');
  });

  it('a TRUNCATED row set is unavailable, not a partial answer presented as fact', async () => {
    // PostgREST caps a body at `max_rows` while still reporting the true total.
    // Ten learners exist; two arrived. Counting from what arrived would say
    // "2 of 10" — an undercount rendered with the authority of a fact.
    const { db } = makeDb({
      learners: [learner('a'), learner('b')],
      certs: [cert('a', 'active')],
      learnerCount: 10,
    });

    const snapshot = await readCertSnapshot(db, REST_ID);
    expect(snapshot.kind).toBe('unavailable');
  });

  it('a truncated CERTIFICATE set is unavailable too', async () => {
    const { db } = makeDb({
      learners: [learner('a')],
      certs: [cert('a', 'active')],
      certCount: 9,
    });

    const snapshot = await readCertSnapshot(db, REST_ID);
    expect(snapshot.kind).toBe('unavailable');
  });

  it('a genuine zero is still the NUMBER zero — absence and emptiness stay distinct', async () => {
    // The discriminator is "did a number arrive", not "is the number zero". A
    // brand-new restaurant with no staff must not be indistinguishable from one
    // whose query failed.
    const { db } = makeDb({ learners: [], certs: [] });

    const snapshot = await readCertSnapshot(db, REST_ID);

    expect(snapshot.kind).toBe('known');
    if (snapshot.kind !== 'known') return;
    expect(snapshot.total).toBe(0);
    expect(snapshot.certified).toBe(0);
    expect(snapshot.inTraining).toBe(0);
    expect(snapshot.pendingCertCount).toBe(0);
    expect(snapshot.amountOwedCents).toBe(0);
  });
});

// ─── 5. It never writes ───────────────────────────────────────────────────────

describe('nothing here modifies a certificate', () => {
  it('reading a balance performs no insert, update, upsert or delete', async () => {
    // Enforcement belongs on the LISTING, never on the credential. Revoking a
    // paid certificate over a billing dispute would tell a diner that a trained
    // employee is untrained.
    const { db, writes } = makeDb({
      learners: [learner('a'), learner('b')],
      certs: [cert('a', 'active'), cert('b', 'pending')],
    });

    const snapshot = await readCertSnapshot(db, REST_ID);

    expect(snapshot.kind).toBe('known');
    expect(writes, 'the balance is a READ').toEqual([]);
  });

  it('performs no write even when the reads fail', async () => {
    const { db, writes } = makeDb({
      learners: [],
      certs: [],
      learnerError: { message: 'down' },
      certError: { message: 'down' },
    });

    await readCertSnapshot(db, REST_ID);
    expect(writes).toEqual([]);
  });
});
