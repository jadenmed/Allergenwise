/**
 * GET /api/directory/[slug]
 *
 * Anonymous-callable. Returns one listed restaurant with:
 *  - Full restaurant detail
 *  - Published reviews (most recent 50)
 *  - Certified staff count (non-revoked certificates)
 *
 * Returns 404 if:
 *  - Restaurant not found
 *  - Restaurant not status='listed'
 *  - listing_expires_at is in the past (treats as not listed)
 *
 * Count contract (certifiedCount / totalEmployees):
 *  - A number means the database returned that number. `0` means genuinely zero.
 *  - `null` means the COUNT query failed or returned no count. It NEVER means 0.
 *  - Callers must not apply `?? 0`; derive display state via
 *    lib/directory/cert-stat.ts. Collapsing null into 0 previously caused a
 *    failed count to render as "100% of staff certified" on a public page.
 *  - A response with any null count is degraded and returns `Cache-Control:
 *    no-store` so neither the CDN nor a browser retains it.
 *
 * Devil's advocate notes:
 *  - Uses service-role client for raw data access, but WHERE status='listed' is
 *    explicit in the query (defense-in-depth alongside RLS).
 *  - Reviews are filtered to status='published' explicitly (RLS backstop exists).
 *  - No private data (author_email, stripe IDs) is returned.
 *  - Slug is validated as safe alphanumeric-dash string before DB query.
 *  - Response is cached at CDN edge for 60s — acceptable for directory detail pages.
 *  - Explicit type assertions on Supabase query results because the Supabase JS
 *    v2.x select-string type parser does not always resolve correctly under strict
 *    mode. Service-role is trusted; assertions are safe here.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createServiceDb } from '@/lib/db/service';
import {
  DEPARTED_AT_COLUMN,
  LEARNER_ROLE,
  deriveStaffCounts,
  onlyCurrentStaff,
  type CertHolderRow,
  type StaffIdentityRow,
} from '@/lib/staff/membership';
import type { Restaurant, Review } from '@/lib/types/db';

// ---------------------------------------------------------------------------
// Slug validation
// ---------------------------------------------------------------------------

const SlugSchema = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[a-z0-9-]+$/, 'Invalid slug format');

// ---------------------------------------------------------------------------
// Response types
// ---------------------------------------------------------------------------

interface PublishedReview {
  id: string;
  authorName: string;
  rating: number;
  body: string;
  allergenContext: string | null;
  createdAt: string;
}

export interface RestaurantDetail {
  id: string;
  slug: string;
  name: string;
  cuisine: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  lat: number | null;
  lng: number | null;
  phone: string | null;
  website: string | null;
  heroPhotoUrl: string | null;
  about: string | null;
  hoursJson: Record<string, { open: string; close: string }> | null;
  allergenSpecialties: string[] | null;
  listedAt: string | null;
  listingExpiresAt: string | null;
  /**
   * Active certificates. `null` means the count query failed — NOT zero. See
   * lib/directory/cert-stat.ts for the contract; consumers must never apply
   * `?? 0` to these fields.
   */
  certifiedCount: number | null;
  /** Learner-role profiles. `null` means the count query failed — NOT zero. */
  totalEmployees: number | null;
  /**
   * Current learner staff who are not yet certified — "3 new team members in
   * training" (T-45a). Same null contract as the two counts above: `null` means
   * we did not receive a number, never that the answer is zero.
   *
   * `certifiedCount + inTrainingCount === totalEmployees` whenever all three are
   * numbers. It is deliberately NOT frozen while a restaurant is inside its
   * top-up grace period: a grace period governs consequences, never a displayed
   * number. See lib/billing/grace-period.ts.
   */
  inTrainingCount: number | null;
  avgRating: number | null;
  reviewCount: number;
  reviews: PublishedReview[];
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function GET(
  _request: NextRequest,
  { params }: { params: { slug: string } }
): Promise<NextResponse> {
  // Validate slug
  const slugParse = SlugSchema.safeParse(params.slug);
  if (!slugParse.success) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  const slug = slugParse.data;

  const supabase = createServiceDb();
  const now = new Date().toISOString();

  // Fetch the restaurant (must be listed + non-expired).
  // Explicit `as Restaurant | null` because the Supabase JS v2.x type parser
  // does not always infer the Row type correctly for chains with .or().
  const { data: restaurantRaw, error: restaurantError } = await supabase
    .from('restaurants')
    .select('*')
    .eq('slug', slug)
    .eq('status', 'listed')
    .or(`listing_expires_at.is.null,listing_expires_at.gt.${now}`)
    .maybeSingle();

  if (restaurantError) {
    console.error('[/api/directory/[slug]] Restaurant query error:', restaurantError);
    return NextResponse.json({ error: 'Failed to fetch restaurant' }, { status: 500 });
  }

  const restaurant = restaurantRaw as Restaurant | null;

  if (!restaurant) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  // Three independent reads keyed only on restaurant.id, run concurrently.
  // A failed review read stays non-fatal (the listing renders without reviews).
  // The two COUNT reads are fatal to the certification stat block ONLY: they
  // surface as `null`, never as 0, so a failed query can never be laundered
  // into "0 of 0 staff certified". Explicit `as Review[]` for the Supabase
  // type-parser reason.
  const [
    { data: rawReviewsData, error: reviewsError },
    { data: certRowsRaw, count: certCountRaw, error: certError },
    { data: learnerRowsRaw, count: profileCountRaw, error: profileError },
  ] = await Promise.all([
    // Published reviews (most recent 50).
    supabase
      .from('reviews')
      .select('id, author_name, rating, body, allergen_context, created_at')
      .eq('restaurant_id', restaurant.id)
      .eq('status', 'published')
      .order('created_at', { ascending: false })
      .limit(50),
    // Wave 2C — only publicly-active certs (status='active') count. The
    // canonical predicate is isPubliclyActiveCert (lib/learner/cert-state.ts);
    // expired/revoked/disputed/pending are excluded structurally.
    //
    // T-23 — this was `select('id', { count:'exact', head:true })`, a count of
    // certificate ROWS set over a denominator of distinct learner PROFILES.
    // Two learners holding two certificates each displayed 200%. It now reads
    // the holders and counts distinct people. `count:'exact'` is kept without
    // `head` so the row set can be checked for truncation below — PostgREST
    // caps a body at supabase/config.toml `max_rows` while still reporting the
    // true total in Content-Range.
    supabase
      .from('certificates')
      .select('profile_id, status', { count: 'exact' })
      .eq('restaurant_id', restaurant.id)
      .eq('status', 'active'),
    // Total CURRENT learner employees — the public denominator.
    // T-46a — a departed employee is not this restaurant's staff any more, so
    // they must not inflate the "N of M certified" figure a diner reads. Their
    // certificate is untouched; it simply stops being counted here.
    // T-23 — the ids come back too, because the numerator is the subset of
    // THESE people who hold a certificate. `role` and `departed_at` are in the
    // select so membership is decided by lib/staff/membership.ts rather than
    // inferred from the filters (see its TRAP note).
    onlyCurrentStaff(
      supabase
        .from('profiles')
        .select(`id, role, ${DEPARTED_AT_COLUMN}`, { count: 'exact' })
        .eq('restaurant_id', restaurant.id)
        .eq('role', LEARNER_ROLE)
    ),
  ]);

  if (reviewsError) {
    console.error('[/api/directory/[slug]] Reviews query error:', reviewsError);
    // Non-fatal: return restaurant without reviews
  }

  if (certError) {
    console.error('[/api/directory/[slug]] Certificate read error:', certError);
  }

  if (profileError) {
    console.error('[/api/directory/[slug]] Learner read error:', profileError);
  }

  // ── Count → public field ──────────────────────────────────────────────────
  // The discriminator is "did a number arrive", not "is the number zero".
  //
  //   query OK, no rows  → Supabase returns count 0, error null → 0    ("none")
  //   query failed       → error set, count null                → null ("unknown")
  //   count absent       → count null (e.g. no content-range)   → null ("unknown")
  //
  // A successful count of zero yields the NUMBER 0 and can never yield null, so
  // "no learners enrolled" and "the count failed" remain distinguishable all the
  // way to the render boundary. There is deliberately no `?? 0` here — that
  // fallback is what let a failed query render as full certification.
  //
  // The denominator is still the exact COUNT, not `rows.length`: PostgREST
  // truncates a body at `max_rows` but always reports the true total, so the
  // count survives a restaurant with more staff than one page.
  const totalEmployees: number | null =
    profileError || profileCountRaw == null ? null : profileCountRaw;

  // The numerator needs the row sets themselves, so it has a failure mode the
  // denominator does not: a TRUNCATED page. `rows.length !== count` means we
  // hold only part of the data and any intersection computed from it would be
  // an undercount presented as fact. Same discriminator as above — we know
  // nothing, so we claim nothing, and deriveCertStat renders `unavailable`
  // rather than a number that looks authoritative. No `?? 0`, no partial count.
  const learnerRows = (learnerRowsRaw ?? null) as StaffIdentityRow[] | null;
  const certRows = (certRowsRaw ?? null) as CertHolderRow[] | null;

  const learnersUsable =
    !profileError && learnerRows !== null && profileCountRaw === learnerRows.length;
  const certsUsable = !certError && certRows !== null && certCountRaw === certRows.length;

  if (!certError && !certsUsable) {
    console.error(
      '[/api/directory/[slug]] Certificate rows truncated or absent — numerator suppressed',
      { rows: certRows?.length ?? null, count: certCountRaw }
    );
  }
  if (!profileError && !learnersUsable) {
    console.error(
      '[/api/directory/[slug]] Learner rows truncated or absent — numerator suppressed',
      { rows: learnerRows?.length ?? null, count: profileCountRaw }
    );
  }

  // T-45a — all three public numbers come from ONE derivation over the row sets
  // above, so "certified", "total" and "in training" cannot be computed from
  // three different ideas of who counts. `inTraining` is the complement of the
  // certified set WITHIN the current-learner set, which is what makes
  // `certified + inTraining === total` structural rather than arithmetic, and
  // what keeps a departed employee out of all three.
  //
  // It rides on exactly the same usability gate as `certifiedCount`: if either
  // row set failed or arrived truncated we know nothing, so we claim nothing.
  // A number here would be a claim about how many untrained people are on the
  // floor, and there is no safe default for that.
  const staffCounts =
    learnersUsable && certsUsable ? deriveStaffCounts(learnerRows!, certRows!) : null;

  const certifiedCount: number | null = staffCounts === null ? null : staffCounts.certified;
  const inTrainingCount: number | null = staffCounts === null ? null : staffCounts.inTraining;

  // A response carrying an unknown count is degraded. It must not be stored by
  // the CDN, or "certification data unavailable" would be served to every
  // visitor for up to s-maxage 60s + stale-while-revalidate 300s. The page's
  // own Data Cache is handled separately (see fetchRestaurant) because a
  // positive `next.revalidate` is not overridden by this header.
  const degraded = certifiedCount === null || totalEmployees === null;

  const rawReviews = (rawReviewsData ?? []) as Pick<
    Review,
    'id' | 'author_name' | 'rating' | 'body' | 'allergen_context' | 'created_at'
  >[];

  const reviews: PublishedReview[] = rawReviews.map((r) => ({
    id: r.id,
    authorName: r.author_name,
    rating: r.rating,
    body: r.body,
    allergenContext: r.allergen_context ?? null,
    createdAt: r.created_at,
  }));

  // Aggregate review stats
  const reviewCount = reviews.length;
  const avgRating =
    reviewCount > 0
      ? parseFloat((reviews.reduce((sum, r) => sum + r.rating, 0) / reviewCount).toFixed(1))
      : null;

  // Shape response — no private data exposed
  const detail: RestaurantDetail = {
    id: restaurant.id,
    slug: restaurant.slug,
    name: restaurant.name,
    cuisine: restaurant.cuisine ?? null,
    address: restaurant.address ?? null,
    city: restaurant.city ?? null,
    state: restaurant.state ?? null,
    zip: restaurant.zip ?? null,
    lat: restaurant.lat != null ? Number(restaurant.lat) : null,
    lng: restaurant.lng != null ? Number(restaurant.lng) : null,
    phone: restaurant.phone ?? null,
    website: restaurant.website ?? null,
    heroPhotoUrl: restaurant.hero_photo_url ?? null,
    about: restaurant.about ?? null,
    hoursJson:
      (restaurant.hours_json as Record<string, { open: string; close: string }> | null) ?? null,
    allergenSpecialties: restaurant.allergen_specialties ?? null,
    listedAt: restaurant.listed_at ?? null,
    listingExpiresAt: restaurant.listing_expires_at ?? null,
    certifiedCount,
    totalEmployees,
    inTrainingCount,
    avgRating,
    reviewCount,
    reviews,
  };

  return NextResponse.json(detail, {
    status: 200,
    headers: {
      'Cache-Control': degraded
        ? 'no-store, must-revalidate'
        : 'public, s-maxage=60, stale-while-revalidate=300',
    },
  });
}
