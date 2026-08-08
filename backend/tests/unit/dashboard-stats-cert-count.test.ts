/**
 * @vitest-environment node
 */
/**
 * tests/unit/dashboard-stats-cert-count.test.ts
 *
 * T-23 — the manager's dashboard numbers, through the real route handler.
 *
 * GET /api/admin/dashboard-stats returned `certifiedCount = certRows.length`:
 * certificate ROWS, over an `employeesTotal` of distinct learner PROFILES. The
 * route was already building the distinct profile set right beside it (for
 * `inProgressCount`) and simply did not use it for the count. Two learners
 * holding two active certificates each produced `certReadinessPct` of 200.
 *
 * Unlike the public surfaces there is no deriveCertStat clamp here — this route
 * computes its own percentage — so the defect reached the manager's screen
 * unclamped. `certReadinessPct` is asserted directly below.
 *
 * `inProgressCount` = accepted the invite AND not certified. It shares the
 * certified set with the count, so the two can never disagree about who holds
 * a certificate.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Hoisted mocks ────────────────────────────────────────────────────────────

const { mockCreateServiceDb, mockRequireRole } = vi.hoisted(() => ({
  mockCreateServiceDb: vi.fn(),
  mockRequireRole: vi.fn(),
}));

vi.mock('@/lib/db/service', () => ({ createServiceDb: mockCreateServiceDb }));
vi.mock('@/lib/auth/require-role', () => ({ requireRole: mockRequireRole }));

import { GET } from '@/app/api/admin/dashboard-stats/route';
import type { DashboardStats } from '@/app/api/admin/dashboard-stats/route';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const RESTAURANT_ID = 'b1000000-0000-4000-8000-000000000001';
const MANAGER_ID = 'a1000000-0000-4000-8000-000000000002';

const learner = (n: number) => `aaaaaaaa-0000-4000-8000-${String(n).padStart(12, '0')}`;

const ACCEPTED_AT = '2026-06-01T00:00:00.000Z';
const DEPARTED_AT = '2026-07-01T00:00:00.000Z';

interface ProfileRow {
  id: string;
  accepted_at: string | null;
  invited_at: string | null;
  role: string;
  departed_at: string | null;
}

interface CertRow {
  profile_id: string;
  status: string;
}

/** A learner who accepted their invite and is still on the roster. */
const current = (n: number): ProfileRow => ({
  id: learner(n),
  accepted_at: ACCEPTED_AT,
  invited_at: ACCEPTED_AT,
  role: 'learner',
  departed_at: null,
});

/** Invited, never accepted — counts in pendingInvites, not inProgress. */
const invited = (n: number): ProfileRow => ({ ...current(n), accepted_at: null });

/** Removed from the roster. */
const departed = (n: number): ProfileRow => ({ ...current(n), departed_at: DEPARTED_AT });

const cert = (n: number, status = 'active'): CertRow => ({ profile_id: learner(n), status });

/**
 * Models the real database closely enough for the counts: the profiles query
 * applies its membership filter for real, while the certificates query returns
 * whatever it was given (certificates have no membership of their own — that is
 * the whole reason the intersection exists).
 */
function buildDb(fixture: { profiles: ProfileRow[]; certs: CertRow[] }) {
  return {
    from(table: string) {
      let filterDeparted = false;

      const rowsFor = (): unknown[] => {
        switch (table) {
          case 'profiles':
            return filterDeparted
              ? fixture.profiles.filter((p) => p.departed_at === null)
              : fixture.profiles;
          case 'certificates':
            return fixture.certs;
          default:
            return [];
        }
      };

      const builder: Record<string, unknown> = {
        select: () => builder,
        eq: () => builder,
        in: () => builder,
        gt: () => builder,
        gte: () => builder,
        lte: () => builder,
        order: () => builder,
        limit: () => builder,
        is: (column: string, value: unknown) => {
          if (column === 'departed_at' && value === null) filterDeparted = true;
          return builder;
        },
        then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
          Promise.resolve({ data: rowsFor(), error: null }).then(res, rej),
      };
      return builder;
    },
  };
}

async function stats(fixture: {
  profiles: ProfileRow[];
  certs: CertRow[];
}): Promise<DashboardStats> {
  mockRequireRole.mockResolvedValue({
    user: { id: MANAGER_ID },
    profile: { id: MANAGER_ID, role: 'manager', restaurant_id: RESTAURANT_ID },
  });
  mockCreateServiceDb.mockReturnValue(buildDb(fixture));

  const res = await GET();
  expect(res.status).toBe(200);
  return (await res.json()) as DashboardStats;
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── THE HEADLINE ─────────────────────────────────────────────────────────────

describe('one learner holding two active certificates', () => {
  it('certifiedCount reads 1, not 2', async () => {
    const body = await stats({ profiles: [current(1)], certs: [cert(1), cert(1)] });

    expect(body.certifiedCount).toBe(1);
    expect(body.employeesTotal).toBe(1);
  });

  it('certReadinessPct is 100, not 200 — there is no clamp on this route', async () => {
    const body = await stats({ profiles: [current(1)], certs: [cert(1), cert(1)] });

    expect(body.certReadinessPct).toBe(100);
  });

  it('two learners with two certificates each is 100, not 200', async () => {
    const body = await stats({
      profiles: [current(1), current(2)],
      certs: [cert(1), cert(1), cert(2), cert(2)],
    });

    expect(body.certifiedCount).toBe(2);
    expect(body.employeesTotal).toBe(2);
    expect(body.certReadinessPct).toBe(100);
  });

  it('one certified learner of two stays 50 even with duplicate certificates', async () => {
    const body = await stats({
      profiles: [current(1), current(2)],
      certs: [cert(1), cert(1), cert(1)],
    });

    expect(body.certifiedCount).toBe(1);
    expect(body.certReadinessPct).toBe(50);
    expect(body.inProgressCount, 'the uncertified learner is in progress').toBe(1);
  });
});

// ─── Certificate states and membership ────────────────────────────────────────

describe('who counts', () => {
  it('a mix of active and expired for one learner counts once', async () => {
    const body = await stats({
      profiles: [current(1)],
      certs: [cert(1, 'expired'), cert(1, 'active'), cert(1, 'revoked')],
    });

    expect(body.certifiedCount).toBe(1);
    expect(body.inProgressCount).toBe(0);
  });

  it('a learner with only a pending certificate is in progress, not certified', async () => {
    const body = await stats({ profiles: [current(1)], certs: [cert(1, 'pending')] });

    expect(body.certifiedCount).toBe(0);
    expect(body.inProgressCount).toBe(1);
    expect(body.certReadinessPct).toBe(0);
  });

  it('a departed learner drops out of every number', async () => {
    const body = await stats({
      profiles: [current(1), departed(2)],
      certs: [cert(1), cert(2)],
    });

    expect(body.employeesTotal).toBe(1);
    expect(body.certifiedCount).toBe(1);
    expect(body.certReadinessPct).toBe(100);
  });

  it('pending invites are counted but are not in progress', async () => {
    const body = await stats({
      profiles: [current(1), invited(2)],
      certs: [cert(1)],
    });

    expect(body.employeesTotal).toBe(2);
    expect(body.pendingInvites).toBe(1);
    expect(body.certifiedCount).toBe(1);
    expect(body.inProgressCount, 'invited-but-not-accepted is not in progress').toBe(0);
    expect(body.certReadinessPct).toBe(50);
  });
});

// ─── Ordinary shapes ──────────────────────────────────────────────────────────

describe('the ordinary cases still hold', () => {
  it('no learners is 0 across the board', async () => {
    const body = await stats({ profiles: [], certs: [] });

    expect(body.employeesTotal).toBe(0);
    expect(body.certifiedCount).toBe(0);
    expect(body.certReadinessPct).toBe(0);
    expect(body.inProgressCount).toBe(0);
  });

  it('three of four certified is 75', async () => {
    const body = await stats({
      profiles: [current(1), current(2), current(3), current(4)],
      certs: [cert(1), cert(2), cert(3)],
    });

    expect(body.certifiedCount).toBe(3);
    expect(body.employeesTotal).toBe(4);
    expect(body.certReadinessPct).toBe(75);
    expect(body.inProgressCount).toBe(1);
  });

  it('certReadinessPct can never exceed 100', async () => {
    const body = await stats({
      profiles: [current(1), current(2)],
      certs: [cert(1), cert(1), cert(1), cert(2), cert(2), cert(3), cert(4)],
    });

    expect(body.certReadinessPct).toBeLessThanOrEqual(100);
    expect(body.certifiedCount).toBeLessThanOrEqual(body.employeesTotal);
  });
});
