/**
 * tests/unit/directory-detail-cert-block.test.tsx
 *
 * Render-level tests for the certification stat block on the PUBLIC,
 * UNAUTHENTICATED restaurant detail page.
 *
 * Regression under test
 * ---------------------
 * page.tsx computed certPercent with a `: 100` fallback when totalEmployees was
 * 0. Because the API collapsed a failed COUNT into 0 via `?? 0`, three distinct
 * situations all rendered "100% of staff certified" next to a certifiedCount of
 * 0:
 *
 *   1. a restaurant with no learners
 *   2. a restaurant whose staff are all role='manager' (the count filters
 *      .eq('role','learner'))
 *   3. a failed profiles COUNT query
 *
 * certPercent drove four render sites — aria-valuenow, the progressbar
 * aria-label, the bar width, and the visible text — so every one of them lied.
 *
 * These tests assert on the rendered aria-label, not just the number, and
 * assert the ABSENCE of any percentage machinery in the degraded states.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
}));

// ReviewForm is a client component ('use client') with form state; the cert
// stat block is what's under test, so stub it out.
vi.mock('@/components/directory/ReviewForm', () => ({
  ReviewForm: () => null,
}));

import RestaurantDetailPage, { generateMetadata } from '@/app/(public)/directory/[slug]/page';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const SLUG = 'bellas-kitchen';

/**
 * A listed, non-expired restaurant. Counts are supplied per-test — they are the
 * only thing that varies across the four required cases.
 */
function payload(overrides: {
  certifiedCount: number | null;
  totalEmployees: number | null;
  name?: string;
}) {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    slug: SLUG,
    name: overrides.name ?? "Bella's Kitchen",
    cuisine: 'Italian',
    address: '123 Main St',
    city: 'Austin',
    state: 'TX',
    zip: '78701',
    lat: null,
    lng: null,
    phone: '(512) 555-0100',
    website: 'https://example.com',
    heroPhotoUrl: null,
    about: 'A neighbourhood trattoria.',
    hoursJson: null,
    allergenSpecialties: ['peanut'],
    listedAt: '2026-01-15T00:00:00.000Z',
    listingExpiresAt: '2027-01-15T00:00:00.000Z',
    certifiedCount: overrides.certifiedCount,
    totalEmployees: overrides.totalEmployees,
    avgRating: null,
    reviewCount: 0,
    reviews: [],
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

/** Render the page for a given API payload and return the static HTML. */
async function renderPage(body: ReturnType<typeof payload>): Promise<string> {
  const fetchMock = vi.fn().mockResolvedValue(jsonResponse(body));
  vi.stubGlobal('fetch', fetchMock);

  const element = await RestaurantDetailPage({ params: { slug: SLUG } });
  return renderToStaticMarkup(element as React.ReactElement);
}

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'http://localhost:3000');
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

// ─── 1. Normal path ───────────────────────────────────────────────────────────

describe('cert stat block — normal path (positive denominator)', () => {
  it('renders the real percentage in the aria-label', async () => {
    const html = await renderPage(payload({ certifiedCount: 5, totalEmployees: 8 }));
    // 5/8 = 62.5 → 63
    expect(html).toContain('aria-label="63% of staff certified"');
  });

  it('renders aria-valuenow, the bar width and the visible text from the same value', async () => {
    const html = await renderPage(payload({ certifiedCount: 5, totalEmployees: 8 }));

    expect(html).toContain('aria-valuenow="63"');
    expect(html).toContain('width:63%');
    expect(html).toContain('63% of staff');
    expect(html).toContain('role="progressbar"');
  });

  it('renders the "N of M staff certified" line with the real counts', async () => {
    const html = await renderPage(payload({ certifiedCount: 5, totalEmployees: 8 }));
    const text = html.replace(/<[^>]+>/g, '');
    expect(text).toContain('5');
    expect(text).toContain('8');
    expect(text).toContain('staff certified');
  });

  it('renders 100% only when every learner really is certified', async () => {
    const html = await renderPage(payload({ certifiedCount: 8, totalEmployees: 8 }));
    expect(html).toContain('aria-label="100% of staff certified"');
    expect(html).toContain('aria-valuenow="100"');
  });

  it('renders 0% for a genuine zero numerator over a real denominator', async () => {
    const html = await renderPage(payload({ certifiedCount: 0, totalEmployees: 6 }));
    expect(html).toContain('aria-label="0% of staff certified"');
    expect(html).toContain('aria-valuenow="0"');
    expect(html).not.toContain('100% of staff certified');
  });
});

// ─── 2. totalEmployees = 0, query SUCCEEDED ───────────────────────────────────

describe('cert stat block — totalEmployees=0 with the query succeeding', () => {
  it('never renders "100% of staff certified"', async () => {
    const html = await renderPage(payload({ certifiedCount: 0, totalEmployees: 0 }));
    expect(html).not.toContain('100% of staff certified');
    expect(html).not.toContain('aria-label="100% of staff certified"');
  });

  it('renders no progressbar, no aria-valuenow and no percentage at all', async () => {
    const html = await renderPage(payload({ certifiedCount: 0, totalEmployees: 0 }));

    expect(html).not.toContain('role="progressbar"');
    expect(html).not.toContain('aria-valuenow');
    expect(html).not.toContain('of staff certified');
    expect(html).not.toMatch(/\d+%/);
  });

  it('renders the explicit no-learners state, not the unavailable state', async () => {
    const html = await renderPage(payload({ certifiedCount: 0, totalEmployees: 0 }));

    expect(html).toContain('No staff enrolled yet');
    expect(html).not.toContain('unavailable');
  });

  it('does not render a misleading "0 of 0"', async () => {
    const html = await renderPage(payload({ certifiedCount: 0, totalEmployees: 0 }));
    const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    expect(text).not.toContain('0 of 0');
  });

  it('still renders the rest of the listing', async () => {
    const html = await renderPage(payload({ certifiedCount: 0, totalEmployees: 0 }));

    expect(html).toContain('Bella&#x27;s Kitchen');
    expect(html).toContain('123 Main St');
    expect(html).toContain('A neighbourhood trattoria.');
    // The Certification card survives, carrying the listed date.
    expect(html).toContain('Certification');
    expect(html).toContain('Listed');
  });
});

// ─── 3. All-manager restaurant ────────────────────────────────────────────────

describe('cert stat block — all-manager restaurant', () => {
  /**
   * The profiles COUNT filters .eq('role','learner'), so a restaurant staffed
   * entirely by role='manager' produces a genuine totalEmployees of 0 while the
   * query succeeds. Certificates may still exist and be counted, so the
   * numerator can be non-zero with a zero denominator — the exact shape that
   * previously produced a 100% bar.
   */
  it('never renders 100% when managers hold certificates but no learners exist', async () => {
    const html = await renderPage(payload({ certifiedCount: 3, totalEmployees: 0 }));

    expect(html).not.toContain('100% of staff certified');
    expect(html).not.toContain('role="progressbar"');
    expect(html).not.toContain('aria-valuenow');
    expect(html).not.toMatch(/\d+%/);
  });

  it('states the certified headcount honestly without implying a ratio', async () => {
    const html = await renderPage(payload({ certifiedCount: 3, totalEmployees: 0 }));
    const text = html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ');

    expect(text).toContain('3 certified staff members');
    expect(html).not.toContain('unavailable');
  });

  it('singularises a lone certified staff member', async () => {
    const html = await renderPage(payload({ certifiedCount: 1, totalEmployees: 0 }));
    const text = html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ');

    expect(text).toContain('1 certified staff member');
    expect(text).not.toContain('1 certified staff members');
  });

  it('is rendered as the no-learners state, never the unavailable state', async () => {
    const html = await renderPage(payload({ certifiedCount: 3, totalEmployees: 0 }));
    expect(html).not.toContain('Staff certification data unavailable');
  });
});

// ─── 4. Profiles COUNT query errored ──────────────────────────────────────────

describe('cert stat block — profiles count query errored (null)', () => {
  it('never renders "100% of staff certified"', async () => {
    const html = await renderPage(payload({ certifiedCount: 0, totalEmployees: null }));
    expect(html).not.toContain('100% of staff certified');
    expect(html).not.toContain('aria-label="100% of staff certified"');
  });

  it('renders no progressbar, no aria-valuenow and no percentage at all', async () => {
    const html = await renderPage(payload({ certifiedCount: 0, totalEmployees: null }));

    expect(html).not.toContain('role="progressbar"');
    expect(html).not.toContain('aria-valuenow');
    expect(html).not.toContain('of staff certified');
    expect(html).not.toMatch(/\d+%/);
  });

  it('renders the explicit unavailable state, NOT the no-learners state', async () => {
    const html = await renderPage(payload({ certifiedCount: 0, totalEmployees: null }));

    expect(html).toContain('Staff certification data unavailable');
    expect(html).not.toContain('No staff enrolled yet');
  });

  it('does not launder the failed count into a rendered 0', async () => {
    const html = await renderPage(payload({ certifiedCount: 0, totalEmployees: null }));
    const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    expect(text).not.toContain('0 of 0');
  });

  it('is fatal to the stat block ONLY — the rest of the listing still renders', async () => {
    const html = await renderPage(payload({ certifiedCount: null, totalEmployees: null }));

    expect(html).toContain('Bella&#x27;s Kitchen');
    expect(html).toContain('123 Main St');
    expect(html).toContain('(512) 555-0100');
    expect(html).toContain('A neighbourhood trattoria.');
    expect(html).toContain('Diner reviews');
    // Listing date survives inside the Certification card.
    expect(html).toContain('Listed');
  });

  it('treats a failed CERT count the same way', async () => {
    const html = await renderPage(payload({ certifiedCount: null, totalEmployees: 10 }));

    expect(html).toContain('Staff certification data unavailable');
    expect(html).not.toContain('role="progressbar"');
    expect(html).not.toMatch(/\d+%/);
  });
});

// ─── The two degraded states must never collide ───────────────────────────────

describe('no-learners and count-failed stay distinguishable at the render boundary', () => {
  it('renders different copy for each, with neither leaking into the other', async () => {
    const noLearners = await renderPage(payload({ certifiedCount: 0, totalEmployees: 0 }));
    const countFailed = await renderPage(payload({ certifiedCount: 0, totalEmployees: null }));

    expect(noLearners).toContain('No staff enrolled yet');
    expect(noLearners).not.toContain('Staff certification data unavailable');

    expect(countFailed).toContain('Staff certification data unavailable');
    expect(countFailed).not.toContain('No staff enrolled yet');
  });
});

// ─── Caching: a degraded response must not be cached or prerendered ───────────

describe('degraded responses are refetched uncached', () => {
  it('refetches with cache:no-store when a count is null', async () => {
    const degraded = payload({ certifiedCount: 0, totalEmployees: null });
    const recovered = payload({ certifiedCount: 4, totalEmployees: 8 });

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(degraded))
      .mockResolvedValueOnce(jsonResponse(recovered));
    vi.stubGlobal('fetch', fetchMock);

    const element = await RestaurantDetailPage({ params: { slug: SLUG } });
    const html = renderToStaticMarkup(element as React.ReactElement);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    // First call is the cached path.
    expect(fetchMock.mock.calls[0][1]).toEqual({ next: { revalidate: 60 } });
    // Second call opts the render out of the Data Cache and static generation.
    expect(fetchMock.mock.calls[1][1]).toEqual({ cache: 'no-store' });

    // The retry recovered, so real numbers render — 4/8 = 50%.
    expect(html).toContain('aria-label="50% of staff certified"');
  });

  it('does NOT refetch when both counts arrived', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(payload({ certifiedCount: 0, totalEmployees: 0 })));
    vi.stubGlobal('fetch', fetchMock);

    await RestaurantDetailPage({ params: { slug: SLUG } });

    // A genuine zero is not degraded — it stays on the cached path.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1]).toEqual({ next: { revalidate: 60 } });
  });

  it('falls back to the unavailable state when the uncached retry also fails', async () => {
    const degraded = payload({ certifiedCount: null, totalEmployees: null });

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(degraded))
      .mockResolvedValueOnce(jsonResponse({ error: 'boom' }, 500));
    vi.stubGlobal('fetch', fetchMock);

    const element = await RestaurantDetailPage({ params: { slug: SLUG } });
    const html = renderToStaticMarkup(element as React.ReactElement);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(html).toContain('Staff certification data unavailable');
    expect(html).not.toMatch(/\d+%/);
  });
});

// ─── SEO metadata — same defect class ─────────────────────────────────────────

describe('generateMetadata title', () => {
  async function titleFor(body: ReturnType<typeof payload>): Promise<string> {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(body)));
    const meta = await generateMetadata({ params: { slug: SLUG } });
    return String(meta.title ?? '');
  }

  it('claims certification in the headline only when there are certified staff', async () => {
    const title = await titleFor(payload({ certifiedCount: 7, totalEmployees: 9 }));

    expect(title).toContain('AllergenWise Certified');
    expect(title).toContain("Bella's Kitchen");
    expect(title).toContain('Austin, TX');
  });

  it('does NOT claim "AllergenWise Certified" when certifiedCount is 0', async () => {
    const title = await titleFor(payload({ certifiedCount: 0, totalEmployees: 5 }));

    expect(title).not.toContain('AllergenWise Certified');
    expect(title).toContain('Listed on AllergenWise');
  });

  it('does NOT claim "AllergenWise Certified" when the cert count failed', async () => {
    const title = await titleFor(payload({ certifiedCount: null, totalEmployees: null }));

    expect(title).not.toContain('AllergenWise Certified');
    expect(title).toContain('Listed on AllergenWise');
  });

  it('keeps the location suffix in every state', async () => {
    for (const counts of [
      { certifiedCount: 7, totalEmployees: 9 },
      { certifiedCount: 0, totalEmployees: 5 },
      { certifiedCount: null, totalEmployees: null },
    ]) {
      const title = await titleFor(payload(counts));
      expect(title).toContain('· Austin, TX');
    }
  });

  it('does not leak count-query failure state into the headline', async () => {
    // 'zero' and 'unknown' must be indistinguishable in the title — a distinct
    // third headline would publish internal query failure into search results.
    const zero = await titleFor(payload({ certifiedCount: 0, totalEmployees: 5 }));
    const unknown = await titleFor(payload({ certifiedCount: null, totalEmployees: null }));

    expect(unknown).toBe(zero);
    expect(unknown).not.toMatch(/unavailable|error|unknown/i);
  });

  it('still returns the not-found title when the listing is absent', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: 'Not found' }, 404)));
    const meta = await generateMetadata({ params: { slug: SLUG } });

    expect(String(meta.title)).toBe('Restaurant not found · AllergenWise');
  });
});

describe('generateMetadata description', () => {
  async function metaFor(body: ReturnType<typeof payload>): Promise<string> {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(body)));
    const meta = await generateMetadata({ params: { slug: SLUG } });
    return String(meta.description ?? '');
  }

  it('claims certification only when there are certified staff', async () => {
    const description = await metaFor(payload({ certifiedCount: 7, totalEmployees: 9 }));

    expect(description).toContain('is AllergenWise certified');
    expect(description).toContain('7 certified staff members');
  });

  it('does NOT claim "is AllergenWise certified" when certifiedCount is 0', async () => {
    const description = await metaFor(payload({ certifiedCount: 0, totalEmployees: 5 }));

    expect(description).not.toContain('is AllergenWise certified');
    expect(description).not.toContain('0 certified staff members');
    expect(description).toContain('is listed on AllergenWise');
  });

  it('does NOT claim certification when the cert count failed', async () => {
    const description = await metaFor(payload({ certifiedCount: null, totalEmployees: null }));

    expect(description).not.toContain('is AllergenWise certified');
    expect(description).not.toMatch(/\d+ certified staff/);
    expect(description).toContain('is listed on AllergenWise');
  });

  it('singularises a single certified staff member', async () => {
    const description = await metaFor(payload({ certifiedCount: 1, totalEmployees: 3 }));

    expect(description).toContain('1 certified staff member.');
    expect(description).not.toContain('1 certified staff members');
  });
});
