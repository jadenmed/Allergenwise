/**
 * tests/unit/directory-slug-count-contract.test.ts
 *
 * Route-level tests for GET /api/directory/[slug] — the origin of the count
 * contract that the public detail page renders.
 *
 * The contract:
 *   a number → the database returned that number. `0` means genuinely zero.
 *   `null`   → the count could not be established. NEVER 0.
 *
 * The route previously wrote `certifiedCount: certifiedCount ?? 0` and
 * `totalEmployees: totalEmployees ?? 0`, which collapsed a failed query into a
 * genuine zero. Combined with the page's `: 100` percentage fallback, a failed
 * COUNT rendered as "100% of staff certified" on a public page.
 *
 * A failed count must be fatal to the certification stat block ONLY — the rest
 * of the listing (name, address, contact, reviews) must still be returned.
 *
 * T-23 — THE UNIT OF THE NUMERATOR CHANGED
 * ────────────────────────────────────────
 * The certificate query was `select('id', { count:'exact', head:true })`: a
 * count of certificate ROWS set over a denominator of distinct learner
 * PROFILES. Nothing in the schema stops one learner holding two active
 * certificates, so two learners with two each rendered 200% — clamped to 100%
 * by deriveCertStat, which turned an obviously-broken number into a
 * plausible-looking lie.
 *
 * Both queries now return rows AND an exact count. The numerator is the count
 * of distinct CURRENT LEARNERS holding at least one active certificate, so it
 * cannot exceed the denominator. The count-vs-rows pair is what lets the route
 * detect a TRUNCATED page (PostgREST caps a body at `max_rows` while still
 * reporting the true total) and suppress the numerator rather than publish an
 * undercount as fact — the same "absence, not zero" discipline as above.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { deriveCertStat } from '@/lib/directory/cert-stat';

// ─── Mock the service DB ──────────────────────────────────────────────────────

const { createServiceDb } = vi.hoisted(() => ({ createServiceDb: vi.fn() }));

vi.mock('@/lib/db/service', () => ({ createServiceDb }));

import { GET } from '@/app/api/directory/[slug]/route';
import type { NextRequest } from 'next/server';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const SLUG = 'bellas-kitchen';
const RESTAURANT_ID = '11111111-1111-1111-1111-111111111111';

const RESTAURANT_ROW = {
  id: RESTAURANT_ID,
  slug: SLUG,
  name: "Bella's Kitchen",
  cuisine: 'Italian',
  address: '123 Main St',
  city: 'Austin',
  state: 'TX',
  zip: '78701',
  lat: null,
  lng: null,
  phone: '(512) 555-0100',
  website: 'https://example.com',
  hero_photo_url: null,
  about: 'A neighbourhood trattoria.',
  hours_json: null,
  allergen_specialties: ['peanut'],
  status: 'listed',
  listed_at: '2026-01-15T00:00:00.000Z',
  listing_expires_at: '2027-01-15T00:00:00.000Z',
};

/** Stable synthetic learner ids — `learner(1)` … `learner(n)`. */
const learner = (n: number) => `aaaaaaaa-0000-4000-8000-${String(n).padStart(12, '0')}`;

interface ProfileRow {
  id: string;
  role: string;
  departed_at: string | null;
}

interface CertRow {
  profile_id: string;
  status: string;
}

/**
 * What a PostgREST read returns: the rows, the exact total, and an error.
 * `count` defaults to `rows.length` — the untruncated case — so a test only
 * states it when deliberately modelling truncation or a failure.
 */
interface ReadOutcome<T> {
  rows: T[] | null;
  count?: number | null;
  error?: { message: string } | null;
}

/** Records every filter applied, so we can assert the scoping. */
interface RecordedCall {
  table: string;
  filters: Array<[string, unknown]>;
  select?: string;
}

/** N current learners, `learner(1)` … `learner(n)`. */
function learners(n: number): ProfileRow[] {
  return Array.from({ length: n }, (_, i) => ({
    id: learner(i + 1),
    role: 'learner',
    departed_at: null,
  }));
}

/** One active certificate for each of the given learner numbers. */
function activeCerts(...learnerNumbers: number[]): CertRow[] {
  return learnerNumbers.map((n) => ({ profile_id: learner(n), status: 'active' }));
}

function resolve<T>(outcome: ReadOutcome<T>) {
  const error = outcome.error ?? null;
  const count =
    outcome.count !== undefined
      ? outcome.count
      : outcome.rows === null
        ? null
        : outcome.rows.length;
  return { data: outcome.rows, count, error };
}

function buildDb(opts: {
  certificates: ReadOutcome<CertRow>;
  profiles: ReadOutcome<ProfileRow>;
  reviews?: { data: unknown[]; error: unknown };
  recorded?: RecordedCall[];
}) {
  const reviews = opts.reviews ?? { data: [], error: null };

  return {
    from(table: string) {
      const record: RecordedCall = { table, filters: [] };
      opts.recorded?.push(record);

      const result =
        table === 'restaurants'
          ? { data: RESTAURANT_ROW, error: null }
          : table === 'certificates'
            ? resolve(opts.certificates)
            : table === 'profiles'
              ? resolve(opts.profiles)
              : reviews;

      const builder: Record<string, unknown> = {
        select: (columns?: string) => {
          record.select = columns;
          return builder;
        },
        eq: (col: string, val: unknown) => {
          record.filters.push([col, val]);
          return builder;
        },
        // T-46a — the membership filter arrives as .is('departed_at', null).
        // Recorded alongside the .eq() filters so it can be asserted the same way.
        is: (col: string, val: unknown) => {
          record.filters.push([col, val]);
          return builder;
        },
        or: () => builder,
        order: () => builder,
        limit: () => builder,
        maybeSingle: () => Promise.resolve(result),
        // Thenable so `await builder` / Promise.all resolves to the result.
        then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
          Promise.resolve(result).then(res, rej),
      };
      return builder;
    },
  };
}

function request(): NextRequest {
  return {} as NextRequest;
}

async function callRoute(db: unknown) {
  createServiceDb.mockReturnValue(db);
  const res = await GET(request(), { params: { slug: SLUG } });
  return { res, body: (await res.json()) as Record<string, unknown> };
}

/** The stat the public page actually renders from a route response. */
function statOf(body: Record<string, unknown>) {
  return deriveCertStat(body.certifiedCount as number | null, body.totalEmployees as number | null);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

// ─── THE HEADLINE (T-23) ──────────────────────────────────────────────────────

describe('one learner holding two active certificates', () => {
  const twoCertsOneLearner = {
    certificates: { rows: [...activeCerts(1), ...activeCerts(1)] },
    profiles: { rows: learners(1) },
  };

  it('counts the PERSON once — certified reads 1, not 2', async () => {
    const { body } = await callRoute(buildDb(twoCertsOneLearner));

    expect(body.certifiedCount).toBe(1);
    expect(body.totalEmployees).toBe(1);
  });

  it('renders 100%, not 200% — and gets there without the clamp', async () => {
    const { body } = await callRoute(buildDb(twoCertsOneLearner));

    const stat = statOf(body);
    expect(stat.kind).toBe('known');
    expect(stat).toMatchObject({ certified: 1, total: 1, percent: 100 });

    // The clamp is Math.min(100, …). Proving it UNREACHABLE means proving the
    // raw ratio is already ≤ 1 before clamping — otherwise this assertion would
    // pass on the old code too, which is exactly how the defect hid.
    const raw = Math.round(
      ((body.certifiedCount as number) / (body.totalEmployees as number)) * 100
    );
    expect(raw, 'the unclamped ratio').toBe(100);
    expect(raw).toBeLessThanOrEqual(100);
  });

  it('two learners with two certificates each is 100%, not 200%', async () => {
    // The exact fixture from the defect report.
    const { body } = await callRoute(
      buildDb({
        certificates: { rows: [...activeCerts(1, 2), ...activeCerts(1, 2)] },
        profiles: { rows: learners(2) },
      })
    );

    expect(body.certifiedCount).toBe(2);
    expect(body.totalEmployees).toBe(2);
    expect(statOf(body)).toMatchObject({ percent: 100 });
  });

  it('does NOT round up a genuinely partial restaurant — 1 of 2 stays 50%', async () => {
    // The failure the clamp was hiding: with row-counting, one learner holding
    // two certificates in a two-learner restaurant read "2 of 2 = 100%".
    const { body } = await callRoute(
      buildDb({
        certificates: { rows: [...activeCerts(1), ...activeCerts(1)] },
        profiles: { rows: learners(2) },
      })
    );

    expect(body.certifiedCount).toBe(1);
    expect(body.totalEmployees).toBe(2);
    expect(statOf(body)).toMatchObject({ percent: 50 });
  });
});

// ─── Mixed certificate states for one learner ─────────────────────────────────

describe('a mix of active and expired certificates for the same learner', () => {
  it('counts the learner once, on the strength of the active one', async () => {
    const { body } = await callRoute(
      buildDb({
        certificates: {
          rows: [
            { profile_id: learner(1), status: 'active' },
            { profile_id: learner(1), status: 'expired' },
            { profile_id: learner(1), status: 'revoked' },
          ],
        },
        profiles: { rows: learners(1) },
      })
    );

    expect(body.certifiedCount).toBe(1);
    expect(statOf(body)).toMatchObject({ percent: 100 });
  });

  it('a learner whose only certificates are expired or revoked is not certified', async () => {
    const { body } = await callRoute(
      buildDb({
        certificates: {
          rows: [
            { profile_id: learner(1), status: 'expired' },
            { profile_id: learner(2), status: 'revoked' },
            { profile_id: learner(2), status: 'pending' },
            { profile_id: learner(2), status: 'disputed' },
          ],
        },
        profiles: { rows: learners(2) },
      })
    );

    expect(body.certifiedCount).toBe(0);
    expect(body.totalEmployees).toBe(2);
    expect(statOf(body)).toMatchObject({ percent: 0 });
  });

  it('an unrecognised status is not publicly active', async () => {
    const { body } = await callRoute(
      buildDb({
        certificates: { rows: [{ profile_id: learner(1), status: 'wat' }] },
        profiles: { rows: learners(1) },
      })
    );

    expect(body.certifiedCount).toBe(0);
  });
});

// ─── Departed holders (T-46a ∩ T-23) ──────────────────────────────────────────

describe('a departed learner holding an active certificate', () => {
  it('is excluded from the numerator, not just the denominator', async () => {
    // The second, independent route past 100%: certificates carry no membership
    // of their own and are deliberately untouched on departure (0026), so a
    // restaurant-scoped cert count keeps counting people the denominator has
    // already dropped. Here the ONLY certified person has left.
    const { body } = await callRoute(
      buildDb({
        certificates: { rows: activeCerts(1) },
        profiles: {
          // The query filters departed staff, so only the current learner comes
          // back — and the exact count agrees with the rows.
          rows: [{ id: learner(2), role: 'learner', departed_at: null }],
        },
      })
    );

    expect(body.totalEmployees).toBe(1);
    expect(body.certifiedCount, 'the certified person left').toBe(0);
    expect(statOf(body)).toMatchObject({ percent: 0 });
  });

  it('is excluded even if the query hands back the departed row anyway', async () => {
    // Belt and braces: the predicate is re-applied in memory by the module that
    // owns it, so a drifted query filter cannot resurrect a departed holder.
    const { body } = await callRoute(
      buildDb({
        certificates: { rows: activeCerts(1) },
        profiles: {
          rows: [
            { id: learner(1), role: 'learner', departed_at: '2026-07-01T00:00:00.000Z' },
            { id: learner(2), role: 'learner', departed_at: null },
          ],
        },
      })
    );

    expect(body.certifiedCount).toBe(0);
  });
});

// ─── Zero learners ────────────────────────────────────────────────────────────

describe('count is genuinely 0', () => {
  it('returns 0, not null, when the profiles read succeeds with zero rows', async () => {
    const { res, body } = await callRoute(
      buildDb({
        certificates: { rows: [] },
        profiles: { rows: [] },
      })
    );

    expect(res.status).toBe(200);
    expect(body.totalEmployees).toBe(0);
    expect(body.certifiedCount).toBe(0);
    expect(body.totalEmployees).not.toBeNull();
  });

  it('renders as no-denominator — a percentage is undefined, not 100', async () => {
    const { body } = await callRoute(
      buildDb({
        certificates: { rows: [] },
        profiles: { rows: [] },
      })
    );

    expect(statOf(body)).toEqual({ kind: 'no-denominator', certified: 0 });
  });

  it('stays fully cacheable — a genuine zero is not a degraded response', async () => {
    const { res } = await callRoute(
      buildDb({
        certificates: { rows: [] },
        profiles: { rows: [] },
      })
    );

    expect(res.headers.get('Cache-Control')).toBe(
      'public, s-maxage=60, stale-while-revalidate=300'
    );
  });
});

// ─── All-manager restaurant ───────────────────────────────────────────────────

describe('all-manager restaurant', () => {
  it('scopes the employee count to role=learner and current staff', async () => {
    const recorded: RecordedCall[] = [];
    await callRoute(
      buildDb({
        certificates: { rows: [] },
        profiles: { rows: [] },
        recorded,
      })
    );

    const profilesCall = recorded.find((c) => c.table === 'profiles');
    expect(profilesCall).toBeDefined();
    expect(profilesCall!.filters).toContainEqual(['role', 'learner']);
    expect(profilesCall!.filters).toContainEqual(['restaurant_id', RESTAURANT_ID]);
    expect(profilesCall!.filters).toContainEqual(['departed_at', null]);
  });

  it('selects the columns the membership predicate needs to judge a row', async () => {
    // The TRAP in lib/staff/membership.ts: a row whose `departed_at` was never
    // selected is `undefined`, not `null`, and is judged NOT current. Same for
    // `role`. If this select regresses, the counts collapse toward zero.
    const recorded: RecordedCall[] = [];
    await callRoute(buildDb({ certificates: { rows: [] }, profiles: { rows: [] }, recorded }));

    const profilesCall = recorded.find((c) => c.table === 'profiles');
    expect(profilesCall!.select).toContain('departed_at');
    expect(profilesCall!.select).toContain('role');
    expect(profilesCall!.select).toContain('id');

    const certCall = recorded.find((c) => c.table === 'certificates');
    expect(certCall!.select).toContain('profile_id');
    expect(certCall!.select).toContain('status');
  });

  it('reports a genuine 0 denominator, never null, when all staff are managers', async () => {
    // T-23 — the numerator moved with it. Certificates belonging to nobody on
    // the current learner roster used to be counted anyway (this asserted 3
    // certified out of 0 employees). A restaurant with no learners has no
    // certified learners; the pair is coherent now.
    const { body } = await callRoute(
      buildDb({
        certificates: { rows: activeCerts(1, 2, 3) },
        profiles: { rows: [] },
      })
    );

    expect(body.totalEmployees).toBe(0);
    expect(body.certifiedCount).toBe(0);
    expect(statOf(body)).toEqual({ kind: 'no-denominator', certified: 0 });
  });
});

// ─── Failed reads ─────────────────────────────────────────────────────────────

describe('profiles read errored', () => {
  it('surfaces null, never 0', async () => {
    const { body } = await callRoute(
      buildDb({
        certificates: { rows: activeCerts(1, 2, 3, 4) },
        profiles: { rows: null, count: null, error: { message: 'connection reset' } },
      })
    );

    expect(body.totalEmployees).toBeNull();
    expect(body.totalEmployees).not.toBe(0);
  });

  it('takes the numerator down with it — it cannot be computed without the roster', async () => {
    // The numerator is the INTERSECTION of certificate holders with current
    // learners. With no learner set there is no intersection to take, and
    // publishing the raw certificate count instead is precisely the
    // people-vs-rows confusion T-23 removes.
    const { body } = await callRoute(
      buildDb({
        certificates: { rows: activeCerts(1, 2, 3, 4) },
        profiles: { rows: null, count: null, error: { message: 'connection reset' } },
      })
    );

    expect(body.certifiedCount).toBeNull();
    expect(statOf(body)).toEqual({ kind: 'unavailable' });
  });

  it('is fatal to the stat block ONLY — the rest of the listing is still returned', async () => {
    const { res, body } = await callRoute(
      buildDb({
        certificates: { rows: activeCerts(1, 2, 3, 4) },
        profiles: { rows: null, count: null, error: { message: 'connection reset' } },
      })
    );

    expect(res.status).toBe(200);
    expect(body.name).toBe("Bella's Kitchen");
    expect(body.address).toBe('123 Main St');
    expect(body.phone).toBe('(512) 555-0100');
    expect(body.about).toBe('A neighbourhood trattoria.');
    expect(body.listedAt).toBe('2026-01-15T00:00:00.000Z');
    expect(body.reviews).toEqual([]);
  });

  it('marks the degraded response no-store so the CDN cannot serve it', async () => {
    const { res } = await callRoute(
      buildDb({
        certificates: { rows: activeCerts(1, 2, 3, 4) },
        profiles: { rows: null, count: null, error: { message: 'connection reset' } },
      })
    );

    const cacheControl = res.headers.get('Cache-Control');
    expect(cacheControl).toContain('no-store');
    expect(cacheControl).not.toContain('s-maxage=60');
  });

  it('treats a missing count with no error as unknown, not zero', async () => {
    const { body } = await callRoute(
      buildDb({
        certificates: { rows: activeCerts(1, 2) },
        profiles: { rows: [], count: null },
      })
    );

    expect(body.totalEmployees).toBeNull();
  });
});

describe('certificates read errored', () => {
  it('surfaces null and marks the response degraded', async () => {
    const { res, body } = await callRoute(
      buildDb({
        certificates: { rows: null, count: null, error: { message: 'timeout' } },
        profiles: { rows: learners(10) },
      })
    );

    expect(res.status).toBe(200);
    expect(body.certifiedCount).toBeNull();
    expect(body.totalEmployees).toBe(10);
    expect(res.headers.get('Cache-Control')).toContain('no-store');
    expect(statOf(body)).toEqual({ kind: 'unavailable' });
  });
});

// ─── Truncation ───────────────────────────────────────────────────────────────

describe('a truncated page of rows', () => {
  it('suppresses the numerator when certificate rows are capped below the true total', async () => {
    // PostgREST caps a response body at supabase/config.toml `max_rows` while
    // still reporting the true total in Content-Range. Intersecting a partial
    // page would publish an undercount as though it were the whole truth.
    const { res, body } = await callRoute(
      buildDb({
        certificates: { rows: activeCerts(1, 2), count: 900 },
        profiles: { rows: learners(3) },
      })
    );

    expect(body.certifiedCount).toBeNull();
    expect(body.totalEmployees, 'the denominator is the exact COUNT and survives').toBe(3);
    expect(res.headers.get('Cache-Control')).toContain('no-store');
  });

  it('suppresses the numerator when learner rows are capped, but keeps the denominator', async () => {
    const { body } = await callRoute(
      buildDb({
        certificates: { rows: activeCerts(1) },
        profiles: { rows: learners(2), count: 1200 },
      })
    );

    expect(body.totalEmployees).toBe(1200);
    expect(body.certifiedCount).toBeNull();
    expect(statOf(body)).toEqual({ kind: 'unavailable' });
  });
});

// ─── Normal path ──────────────────────────────────────────────────────────────

describe('normal path', () => {
  it('returns both counts and the cacheable header', async () => {
    const { res, body } = await callRoute(
      buildDb({
        certificates: { rows: activeCerts(1, 2, 3, 4, 5) },
        profiles: { rows: learners(8) },
      })
    );

    expect(res.status).toBe(200);
    expect(body.certifiedCount).toBe(5);
    expect(body.totalEmployees).toBe(8);
    expect(statOf(body)).toMatchObject({ percent: 63 });
    expect(res.headers.get('Cache-Control')).toBe(
      'public, s-maxage=60, stale-while-revalidate=300'
    );
  });

  it('every learner certified is 100% — the honest kind', async () => {
    const { body } = await callRoute(
      buildDb({
        certificates: { rows: activeCerts(1, 2, 3) },
        profiles: { rows: learners(3) },
      })
    );

    expect(body.certifiedCount).toBe(3);
    expect(body.totalEmployees).toBe(3);
    expect(statOf(body)).toMatchObject({ percent: 100 });
  });

  it('still filters certificates to status=active', async () => {
    const recorded: RecordedCall[] = [];
    await callRoute(
      buildDb({
        certificates: { rows: activeCerts(1, 2, 3, 4, 5) },
        profiles: { rows: learners(8) },
        recorded,
      })
    );

    const certCall = recorded.find((c) => c.table === 'certificates');
    expect(certCall!.filters).toContainEqual(['status', 'active']);
    expect(certCall!.filters).toContainEqual(['restaurant_id', RESTAURANT_ID]);
  });

  it('leaves the listed-status visibility gate untouched', async () => {
    const recorded: RecordedCall[] = [];
    await callRoute(
      buildDb({
        certificates: { rows: activeCerts(1, 2, 3, 4, 5) },
        profiles: { rows: learners(8) },
        recorded,
      })
    );

    const restaurantCall = recorded.find((c) => c.table === 'restaurants');
    expect(restaurantCall!.filters).toContainEqual(['slug', SLUG]);
    expect(restaurantCall!.filters).toContainEqual(['status', 'listed']);
  });
});
