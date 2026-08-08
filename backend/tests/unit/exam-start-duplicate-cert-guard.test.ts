/**
 * tests/unit/exam-start-duplicate-cert-guard.test.ts
 *
 * T-49 — /api/exam/start refuses entry to a learner who already holds a current
 * certificate, and keeps letting everyone else in.
 *
 * WHY THE REFUSAL IS HERE AND NOT ONLY AT SUBMIT
 * ─────────────────────────────────────────────
 * Blocking only at submit would leave a certified learner able to sit a full
 * thirty-minute exam whose result can never be banked. Refusing entry is the
 * difference between a clear message and a wasted half hour.
 *
 * THE RENEWAL CASES BELOW USED TO CARRY A CAVEAT. T-52 REMOVED IT.
 * ────────────────────────────────────────────────────────────────
 * This block previously warned that "an EXPIRED certificate does not block" and
 * "a REVOKED certificate does not block" were green only for learners with one
 * or two prior submitted attempts — because renewal had a SECOND gate that T-49
 * did not remove. `checkCooldown` counted submitted attempts over a learner's
 * entire lifetime and refused a fourth, so anyone who failed twice before
 * passing carried three attempts forever and was refused at renewal with
 * "Maximum attempts reached. Please contact your administrator.", permanently,
 * with no in-product escape. Their restaurant then failed `checkEligibility`
 * condition 2 for good — the T-46 deadlock, on a two-year timer.
 *
 * T-52 fixed that: MAX_ATTEMPTS now counts attempts in the CURRENT
 * certification period, bounded by the learner's most recent PASS. The caveat
 * is therefore false and has been deleted rather than left to mislead someone
 * reading this file in 2028.
 *
 * The case it was warning about is now covered here, in the renewal describe
 * below: a learner with three LIFETIME attempts and an expired certificate
 * starts a new exam. The period arithmetic itself lives in
 * tests/unit/exam-attempt-period.test.ts.
 *
 * WHAT DID NOT CHANGE, and is still pinned at the bottom of this file: the
 * 24-hour post-failure cooldown, MAX_ATTEMPTS itself, and the refusal copy. A
 * learner who exhausts three attempts INSIDE one period is still refused and
 * still told to contact their administrator — which is now a true statement
 * about a live cycle rather than a permanent sentence.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { COOLDOWN_HOURS, MAX_ATTEMPTS } from '@/lib/learner/exam';
import { ALREADY_CERTIFIED_MESSAGE } from '@/lib/learner/issuance-guard';

// ─── Hoisted mocks ────────────────────────────────────────────────────────────

const { mockGetUser, mockServiceFrom } = vi.hoisted(() => ({
  mockGetUser: vi.fn(),
  mockServiceFrom: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabase: vi.fn(async () => ({ auth: { getUser: mockGetUser } })),
}));

vi.mock('@/lib/db/service', () => ({
  createServiceDb: vi.fn(() => ({ from: mockServiceFrom })),
}));

vi.mock('server-only', () => ({}));

vi.mock('@/lib/learner/progress', () => ({
  areAllModulesComplete: vi.fn(() => true),
}));

// NOTE: lib/learner/exam is deliberately NOT mocked. The cooldown and
// max-attempts cases below have to exercise the real `checkCooldown`, or they
// prove nothing about it having survived this change.

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const USER_ID = '11111111-1111-1111-1111-111111111111';
const HELD_CERT_ID = '55555555-5555-5555-5555-555555555555';
const HELD_CERT_CODE = 'AW-T49AA-BBBB1-2';
const NEW_ATTEMPT_ID = '66666666-6666-4666-8666-666666666666';

const FUTURE = '2028-08-05T12:00:00.000Z';
const PAST = '2025-08-05T12:00:00.000Z';

const HOUR_MS = 60 * 60 * 1000;
const hoursAgo = (h: number) => new Date(Date.now() - h * HOUR_MS).toISOString();

const MODULES = Array.from({ length: 5 }, (_, m) => ({ id: `mod-${m + 1}`, order_index: m + 1 }));

/** Five drawable questions per module — enough for the 25-question pool gate. */
function poolFor(moduleId: string) {
  return Array.from({ length: 5 }, (_, i) => ({
    id: `${moduleId}-q${i}`,
    prompt: `Question ${i}`,
    question_choices: [
      { id: `${moduleId}-q${i}-a`, text: 'A', order_index: 0 },
      { id: `${moduleId}-q${i}-b`, text: 'B', order_index: 1 },
    ],
  }));
}

type PastAttempt = { started_at: string; submitted_at: string | null; passed: boolean | null };

interface Fixture {
  /** Rows the T-49 guard read returns (already filtered to pending|active). */
  certs?: Array<Record<string, unknown>>;
  attempts?: PastAttempt[];
}

/** The status list the route asked the certificates table for. */
let certQueryStatuses: string[] | null = null;
/** Rows inserted into exam_attempts — empty means no exam was started. */
let attemptInserts: Array<Record<string, unknown>> = [];
/** Profile ids the exam_attempts read was filtered by (T-52 trap 5). */
let attemptQueryProfileIds: string[] = [];

function buildDispatcher(fixture: Fixture) {
  certQueryStatuses = null;
  attemptInserts = [];
  attemptQueryProfileIds = [];

  const certs = fixture.certs ?? [];
  const attempts = fixture.attempts ?? [];

  mockServiceFrom.mockImplementation((table: string) => {
    if (table === 'profiles') {
      return {
        select: () => ({
          eq: () => ({
            single: vi
              .fn()
              .mockResolvedValue({ data: { id: USER_ID, role: 'learner' }, error: null }),
          }),
        }),
      };
    }
    if (table === 'modules') {
      return {
        select: () => ({ order: vi.fn().mockResolvedValue({ data: MODULES, error: null }) }),
      };
    }
    if (table === 'lessons') {
      return { select: vi.fn().mockResolvedValue({ data: [], error: null }) };
    }
    if (table === 'lesson_progress') {
      return { select: () => ({ eq: vi.fn().mockResolvedValue({ data: [], error: null }) }) };
    }
    if (table === 'certificates') {
      return {
        select: () => ({
          eq: () => ({
            in: (_col: string, statuses: string[]) => {
              certQueryStatuses = statuses;
              return { order: vi.fn().mockResolvedValue({ data: certs, error: null }) };
            },
          }),
        }),
      };
    }
    if (table === 'exam_attempts') {
      return {
        select: () => ({
          eq: (_col: string, value: string) => {
            attemptQueryProfileIds.push(value);
            return { order: vi.fn().mockResolvedValue({ data: attempts, error: null }) };
          },
        }),
        insert: (row: Record<string, unknown>) => {
          attemptInserts.push(row);
          return {
            select: () => ({
              single: vi.fn().mockResolvedValue({
                data: { id: NEW_ATTEMPT_ID, started_at: new Date().toISOString() },
                error: null,
              }),
            }),
          };
        },
      };
    }
    if (table === 'questions') {
      return {
        select: () => ({
          eq: () => ({
            eq: (_col: string, moduleId: string) => ({
              limit: vi.fn().mockResolvedValue({ data: poolFor(moduleId), error: null }),
            }),
          }),
        }),
      };
    }
    throw new Error(`Unexpected table: ${table}`);
  });
}

function makeRequest() {
  return new NextRequest('http://localhost:3000/api/exam/start', { method: 'POST' });
}

async function start() {
  const { POST } = await import('@/app/api/exam/start/route');
  return POST(makeRequest());
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetUser.mockResolvedValue({ data: { user: { id: USER_ID } }, error: null });
});

// ─── The headline: a learner who passed cannot start another exam ─────────────

describe('POST /api/exam/start — T-49 duplicate-certificate guard', () => {
  it('refuses a learner holding a PENDING certificate, and starts no attempt', async () => {
    buildDispatcher({
      certs: [
        { id: HELD_CERT_ID, cert_code: HELD_CERT_CODE, status: 'pending', expires_at: FUTURE },
      ],
      // One prior attempt, passed — exactly the state the old code let through.
      attempts: [{ started_at: hoursAgo(3), submitted_at: hoursAgo(2), passed: true }],
    });

    const res = await start();
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.error).toBe(ALREADY_CERTIFIED_MESSAGE);
    expect(body.certCode).toBe(HELD_CERT_CODE);

    // The assertion that matters: no second exam, so no second certificate.
    expect(attemptInserts).toHaveLength(0);
  });

  it('refuses a learner holding an unexpired ACTIVE certificate', async () => {
    buildDispatcher({
      certs: [
        { id: HELD_CERT_ID, cert_code: HELD_CERT_CODE, status: 'active', expires_at: FUTURE },
      ],
      attempts: [{ started_at: hoursAgo(3), submitted_at: hoursAgo(2), passed: true }],
    });

    const res = await start();
    expect(res.status).toBe(403);
    expect(attemptInserts).toHaveLength(0);
  });

  it('asks the database only for pending and active certificates', async () => {
    // The shape assertion. A future edit that drops the status filter would let
    // an expired certificate block a renewal, and this catches it.
    buildDispatcher({ certs: [] });
    await start();
    expect(certQueryStatuses).toEqual(['pending', 'active']);
  });
});

// ─── Renewal: the flow a naive guard would have broken ────────────────────────

describe('POST /api/exam/start — renewal works, including the case T-52 closed', () => {
  it('ALLOWS a learner with 3 LIFETIME attempts whose certificate has EXPIRED', async () => {
    // THE CASE THE OLD CAVEAT WARNED ABOUT. Fail, fail, pass — two years ago.
    // The certificate has since expired, so T-49's guard read comes back empty
    // and lets them through. Before T-52 the lifetime tally then refused them
    // "Maximum attempts reached", permanently. This is the whole point of the
    // fix, asserted at the route rather than only in the pure function.
    buildDispatcher({
      certs: [],
      attempts: [
        { started_at: hoursAgo(20050), submitted_at: hoursAgo(20049), passed: false },
        { started_at: hoursAgo(20030), submitted_at: hoursAgo(20029), passed: false },
        { started_at: hoursAgo(20010), submitted_at: hoursAgo(20009), passed: true },
      ],
    });

    const res = await start();
    const body = await res.json();

    expect(res.status).toBe(200);
    // Period-scoped: the pass closed the old cycle, so this is attempt 1 of a
    // new one — not a fourth.
    expect(body.attemptNumber).toBe(1);
    expect(attemptInserts).toHaveLength(1);
  });

  it('ALLOWS a learner whose PENDING certificate was hard-deleted by the purge cron', async () => {
    // app/api/cron/purge-stale-pending-certs deletes the certificate ROW when a
    // restaurant never pays the fee. This learner passed, the cert was purged,
    // and no certificate record of them exists anywhere — the `certs: []` here
    // is that absence, not an expiry.
    //
    // A period boundary keyed on the certificate would find nothing for exactly
    // these learners and fall back to lifetime counting, locking out the most
    // common real instance of the bug. The boundary is the PASS, which lives in
    // exam_attempts and is never purged.
    buildDispatcher({
      certs: [],
      attempts: [
        { started_at: hoursAgo(2200), submitted_at: hoursAgo(2199), passed: false },
        { started_at: hoursAgo(2150), submitted_at: hoursAgo(2149), passed: false },
        { started_at: hoursAgo(2100), submitted_at: hoursAgo(2099), passed: true },
      ],
    });

    const res = await start();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.attemptNumber).toBe(1);
    expect(attemptInserts).toHaveLength(1);
  });

  it('ALLOWS a REVOKED-certificate holder who has 3 lifetime attempts', async () => {
    // The near-term path rather than the two-year one: a revoked certificate
    // does not count toward checkEligibility, so refusing the retake would leave
    // the restaurant permanently unable to list. T-49 grants the permission;
    // lifetime counting used to cancel it.
    buildDispatcher({
      certs: [],
      attempts: [
        { started_at: hoursAgo(700), submitted_at: hoursAgo(699), passed: false },
        { started_at: hoursAgo(650), submitted_at: hoursAgo(649), passed: false },
        { started_at: hoursAgo(600), submitted_at: hoursAgo(599), passed: true },
      ],
    });

    const res = await start();
    expect(res.status).toBe(200);
    expect(attemptInserts).toHaveLength(1);
  });

  it('still refuses 3 failures INSIDE the current period, expired certificate or not', async () => {
    // The counterweight. Period scoping must not become "everyone always gets
    // more attempts": a learner who passed long ago and has since failed three
    // times renewing is genuinely out, and the administrator message is now
    // accurate rather than permanent.
    buildDispatcher({
      certs: [],
      attempts: [
        { started_at: hoursAgo(20010), submitted_at: hoursAgo(20009), passed: true },
        { started_at: hoursAgo(120), submitted_at: hoursAgo(119), passed: false },
        { started_at: hoursAgo(80), submitted_at: hoursAgo(79), passed: false },
        { started_at: hoursAgo(40), submitted_at: hoursAgo(39), passed: false },
      ],
    });

    const res = await start();
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.error).toMatch(/Maximum attempts reached/i);
    expect(attemptInserts).toHaveLength(0);
  });
});

describe('POST /api/exam/start — the attempts query is learner-scoped', () => {
  it('filters exam_attempts by the authenticated profile id', async () => {
    // Trap 5. The period boundary is derived from the rows the route hands over,
    // so it is per-learner only if this query is. Two colleagues at one
    // restaurant have independent periods, and that holds because of this
    // filter — a restaurant-wide read would let one person's pass reset
    // another's attempt count.
    buildDispatcher({ certs: [], attempts: [] });
    await start();

    expect(attemptQueryProfileIds, 'never a restaurant-wide read').toEqual([USER_ID]);
  });
});

describe('POST /api/exam/start — renewal still works (T-49 cases)', () => {
  it('ALLOWS a learner whose only certificate has EXPIRED', async () => {
    // Retaking the exam IS the renewal flow — the product says so in the
    // learner certificate page, the pricing FAQ, the verify page and the
    // CertExpiringSoon email. Expired certificates never reach the predicate:
    // the SQL status filter excludes them, so the guard read comes back empty.
    buildDispatcher({
      certs: [],
      attempts: [{ started_at: hoursAgo(20000), submitted_at: hoursAgo(20000), passed: true }],
    });

    const res = await start();
    expect(res.status).toBe(200);
    expect(attemptInserts).toHaveLength(1);
  });

  it('ALLOWS a learner whose certificate is ACTIVE but already past its expiry', async () => {
    // expire-certs is a cron. Between lapsing and being swept, the row still
    // reads `active`; refusing here would block a renewal for up to a day.
    buildDispatcher({
      certs: [{ id: HELD_CERT_ID, cert_code: HELD_CERT_CODE, status: 'active', expires_at: PAST }],
      attempts: [{ started_at: hoursAgo(20000), submitted_at: hoursAgo(20000), passed: true }],
    });

    const res = await start();
    expect(res.status).toBe(200);
    expect(attemptInserts).toHaveLength(1);
  });

  it('ALLOWS a learner whose certificate was REVOKED', async () => {
    // A revoked certificate does not count toward checkEligibility, so blocking
    // the retake would leave the restaurant permanently unable to list.
    buildDispatcher({
      certs: [],
      attempts: [{ started_at: hoursAgo(500), submitted_at: hoursAgo(500), passed: true }],
    });

    const res = await start();
    expect(res.status).toBe(200);
    expect(attemptInserts).toHaveLength(1);
  });
});

// ─── The attempt state machine is untouched ───────────────────────────────────

describe('POST /api/exam/start — MAX_ATTEMPTS and the failure cooldown are unchanged', () => {
  it(`still refuses within ${COOLDOWN_HOURS}h of a FAILED attempt, with the cooldown message`, async () => {
    buildDispatcher({
      certs: [],
      attempts: [{ started_at: hoursAgo(3), submitted_at: hoursAgo(2), passed: false }],
    });

    const res = await start();
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.error).toMatch(/must wait 24 hours after a failed attempt/i);
    expect(body.error, 'a failer must not be told they are certified').not.toBe(
      ALREADY_CERTIFIED_MESSAGE
    );
    expect(body.retryAvailableAt).toBeDefined();
    expect(attemptInserts).toHaveLength(0);
  });

  it(`grants the retry once ${COOLDOWN_HOURS}h have elapsed since the failure`, async () => {
    buildDispatcher({
      certs: [],
      attempts: [{ started_at: hoursAgo(30), submitted_at: hoursAgo(25), passed: false }],
    });

    const res = await start();
    expect(res.status).toBe(200);
    expect(attemptInserts).toHaveLength(1);
  });

  it('still grants a THIRD attempt to a learner who has failed twice', async () => {
    // The explicit regression case: adding a condition must not cost anyone an
    // attempt they were entitled to.
    buildDispatcher({
      certs: [],
      attempts: [
        { started_at: hoursAgo(80), submitted_at: hoursAgo(79), passed: false },
        { started_at: hoursAgo(40), submitted_at: hoursAgo(39), passed: false },
      ],
    });

    const res = await start();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.attemptNumber).toBe(3);
    expect(attemptInserts).toHaveLength(1);
  });

  it(`still refuses a ${MAX_ATTEMPTS + 1}th attempt after ${MAX_ATTEMPTS} submitted ones`, async () => {
    buildDispatcher({
      certs: [],
      attempts: [
        { started_at: hoursAgo(120), submitted_at: hoursAgo(119), passed: false },
        { started_at: hoursAgo(80), submitted_at: hoursAgo(79), passed: false },
        { started_at: hoursAgo(40), submitted_at: hoursAgo(39), passed: false },
      ],
    });

    const res = await start();
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.error).toMatch(/Maximum attempts reached/i);
    expect(attemptInserts).toHaveLength(0);
  });

  it('tells a certified learner they are certified, not that they are out of attempts', async () => {
    // Precedence. This learner is BOTH at MAX_ATTEMPTS and certified — they
    // failed twice, then passed. "Contact your administrator" would send them to
    // support over a situation that needs no support at all.
    buildDispatcher({
      certs: [
        { id: HELD_CERT_ID, cert_code: HELD_CERT_CODE, status: 'active', expires_at: FUTURE },
      ],
      attempts: [
        { started_at: hoursAgo(120), submitted_at: hoursAgo(119), passed: false },
        { started_at: hoursAgo(80), submitted_at: hoursAgo(79), passed: false },
        { started_at: hoursAgo(40), submitted_at: hoursAgo(39), passed: true },
      ],
    });

    const res = await start();
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.error).toBe(ALREADY_CERTIFIED_MESSAGE);
    expect(body.error).not.toMatch(/Maximum attempts reached/i);
  });
});
