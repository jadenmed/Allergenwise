/**
 * @vitest-environment node
 */
/**
 * tests/unit/search-cert-count.test.ts
 *
 * T-23 — the certification counts GET /api/search publishes on the public
 * directory cards, asserted through the real route handler.
 *
 * This is the one count site that aggregates in TypeScript rather than SQL: the
 * route selects certificates and profiles as embedded joins and reduces them
 * per restaurant. It used to count certificate ROWS with a filter-and-length
 * over the joined certificates, while the denominator beside it counted
 * distinct current-learner PROFILES. One learner holding two active
 * certificates was two, and the card rendered above 100% until deriveCertStat
 * clamped it back to a plausible-looking "all staff certified".
 *
 * The numerator is now distinct CURRENT LEARNERS holding an active
 * certificate — the same set the denominator is drawn from, so it cannot
 * exceed it.
 *
 * The SQL twin of these counts lives in lib/directory/search.ts and must return
 * the same numbers for the same data; that equivalence is proved against a real
 * database in tests/integration/search-count-parity.test.ts.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Hoisted mocks ────────────────────────────────────────────────────────────

const { mockCreateServiceSupabase } = vi.hoisted(() => ({
  mockCreateServiceSupabase: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createServiceSupabase: mockCreateServiceSupabase,
}));

import { GET } from '@/app/api/search/route';
import { NextRequest } from 'next/server';
import { deriveCertStat } from '@/lib/directory/cert-stat';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const learner = (n: number) => `aaaaaaaa-0000-4000-8000-${String(n).padStart(12, '0')}`;

const DEPARTED_AT = '2026-07-01T00:00:00.000Z';

interface JoinedProfile {
  id: string;
  role: string;
  departed_at: string | null;
}

interface JoinedCert {
  profile_id: string;
  status: string;
}

/** A current learner. */
const current = (n: number): JoinedProfile => ({
  id: learner(n),
  role: 'learner',
  departed_at: null,
});

/** A learner who has been taken off the roster. */
const departed = (n: number): JoinedProfile => ({
  id: learner(n),
  role: 'learner',
  departed_at: DEPARTED_AT,
});

const cert = (n: number, status = 'active'): JoinedCert => ({
  profile_id: learner(n),
  status,
});

function restaurantRow(opts: { profiles: JoinedProfile[]; certificates: JoinedCert[] }) {
  return {
    slug: 'bellas-kitchen',
    name: "Bella's Kitchen",
    cuisine: 'Italian',
    city: 'Austin',
    state: 'TX',
    lat: null,
    lng: null,
    hero_photo_url: null,
    allergen_specialties: ['peanut'],
    listed_at: '2026-01-15T00:00:00.000Z',
    certificates: opts.certificates,
    profiles: opts.profiles,
    reviews: [],
  };
}

/** A Supabase stub whose whole chain returns itself and resolves to `rows`. */
function stubClient(rows: unknown[]) {
  const result = { data: rows, error: null };
  const builder: Record<string, unknown> = {};
  for (const method of [
    'select',
    'eq',
    'or',
    'textSearch',
    'ilike',
    'overlaps',
    'gte',
    'lte',
    'order',
    'limit',
  ]) {
    builder[method] = () => builder;
  }
  builder.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
    Promise.resolve(result).then(res, rej);

  return { from: () => builder };
}

interface SearchItem {
  slug: string;
  certifiedCount: number;
  totalEmployees: number;
}

async function search(opts: {
  profiles: JoinedProfile[];
  certificates: JoinedCert[];
}): Promise<SearchItem> {
  mockCreateServiceSupabase.mockReturnValue(stubClient([restaurantRow(opts)]));
  const res = await GET(new NextRequest('http://localhost/api/search'));
  expect(res.status).toBe(200);
  const body = (await res.json()) as SearchItem[];
  expect(body).toHaveLength(1);
  return body[0];
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── THE HEADLINE ─────────────────────────────────────────────────────────────

describe('one learner holding two active certificates', () => {
  it('counts the person once — certified reads 1, not 2', async () => {
    const item = await search({
      profiles: [current(1)],
      certificates: [cert(1), cert(1)],
    });

    expect(item.certifiedCount).toBe(1);
    expect(item.totalEmployees).toBe(1);
  });

  it('renders 100%, not 200%, and the ratio is ≤ 1 before any clamp', async () => {
    const item = await search({
      profiles: [current(1)],
      certificates: [cert(1), cert(1)],
    });

    const raw = Math.round((item.certifiedCount / item.totalEmployees) * 100);
    expect(raw).toBe(100);
    expect(deriveCertStat(item.certifiedCount, item.totalEmployees)).toMatchObject({
      percent: 100,
    });
  });

  it('two learners with two certificates each is 2 of 2, not 4 of 2', async () => {
    const item = await search({
      profiles: [current(1), current(2)],
      certificates: [cert(1), cert(1), cert(2), cert(2)],
    });

    expect(item.certifiedCount).toBe(2);
    expect(item.totalEmployees).toBe(2);
  });

  it('one learner with three certificates among two staff stays 50%', async () => {
    const item = await search({
      profiles: [current(1), current(2)],
      certificates: [cert(1), cert(1), cert(1)],
    });

    expect(item.certifiedCount).toBe(1);
    expect(item.totalEmployees).toBe(2);
    expect(deriveCertStat(item.certifiedCount, item.totalEmployees)).toMatchObject({ percent: 50 });
  });
});

// ─── Certificate states ───────────────────────────────────────────────────────

describe('only publicly-active certificates count', () => {
  it('a learner with an active and an expired certificate counts once', async () => {
    const item = await search({
      profiles: [current(1)],
      certificates: [cert(1, 'expired'), cert(1, 'active')],
    });

    expect(item.certifiedCount).toBe(1);
  });

  it('pending, expired, revoked and disputed are all excluded', async () => {
    const item = await search({
      profiles: [current(1), current(2)],
      certificates: [
        cert(1, 'pending'),
        cert(1, 'expired'),
        cert(2, 'revoked'),
        cert(2, 'disputed'),
      ],
    });

    expect(item.certifiedCount).toBe(0);
    expect(item.totalEmployees).toBe(2);
  });
});

// ─── Membership (T-46a ∩ T-23) ────────────────────────────────────────────────

describe('membership decides both halves of the ratio', () => {
  it("a departed learner's active certificate leaves the numerator too", async () => {
    const item = await search({
      profiles: [departed(1), current(2)],
      certificates: [cert(1)],
    });

    expect(item.totalEmployees, 'the departed learner is not staff').toBe(1);
    expect(item.certifiedCount, 'and neither is their certificate').toBe(0);
  });

  it('a manager holding a certificate counts in neither half', async () => {
    const item = await search({
      profiles: [{ id: learner(9), role: 'manager', departed_at: null }, current(1)],
      certificates: [cert(9), cert(1)],
    });

    expect(item.totalEmployees).toBe(1);
    expect(item.certifiedCount).toBe(1);
  });

  it('a certificate whose holder is not on the roster at all is not counted', async () => {
    const item = await search({
      profiles: [current(1)],
      certificates: [cert(7)],
    });

    expect(item.certifiedCount).toBe(0);
  });
});

// ─── Ordinary shapes ──────────────────────────────────────────────────────────

describe('the ordinary cases still hold', () => {
  it('no learners is 0 of 0 — and renders as no-denominator, never 100%', async () => {
    const item = await search({ profiles: [], certificates: [] });

    expect(item.certifiedCount).toBe(0);
    expect(item.totalEmployees).toBe(0);
    expect(deriveCertStat(item.certifiedCount, item.totalEmployees)).toEqual({
      kind: 'no-denominator',
      certified: 0,
    });
  });

  it('a restaurant with no certificates is 0 of 3', async () => {
    const item = await search({
      profiles: [current(1), current(2), current(3)],
      certificates: [],
    });

    expect(item.certifiedCount).toBe(0);
    expect(item.totalEmployees).toBe(3);
  });

  it('every learner certified is 3 of 3', async () => {
    const item = await search({
      profiles: [current(1), current(2), current(3)],
      certificates: [cert(1), cert(2), cert(3)],
    });

    expect(item.certifiedCount).toBe(3);
    expect(item.totalEmployees).toBe(3);
    expect(deriveCertStat(item.certifiedCount, item.totalEmployees)).toMatchObject({
      percent: 100,
    });
  });

  it('the numerator never exceeds the denominator, whatever the join returns', async () => {
    const item = await search({
      profiles: [current(1), current(2), departed(3)],
      certificates: [
        cert(1),
        cert(1),
        cert(2),
        cert(2),
        cert(2),
        cert(3),
        cert(4),
        cert(1, 'expired'),
      ],
    });

    expect(item.certifiedCount).toBeLessThanOrEqual(item.totalEmployees);
    expect(item.certifiedCount).toBe(2);
    expect(item.totalEmployees).toBe(2);
  });
});
