/**
 * POST /api/reviews/submit
 *
 * Anonymous-callable review submission endpoint.
 *
 * Body:
 *   restaurantSlug   - slug of the target restaurant
 *   authorName       - reviewer display name (1–100 chars)
 *   authorEmail?     - optional email (not displayed; used for moderation)
 *   rating           - integer 1–5
 *   body             - review text 50–2000 chars
 *   allergenContext? - which allergen this reviewer has (e.g. "tree_nut")
 *   hpField          - honeypot field: MUST be empty string
 *
 * Behavior:
 *   1. Validate body via Zod. Return 400 on failure.
 *   2. Check honeypot: if hpField non-empty, return silent 200 (don't reveal filter).
 *   3. Look up restaurant by slug — must be status='listed'. Return 404 if not.
 *   4. Rate-limit by IP + restaurant_id (1 review per restaurant per IP per 24h).
 *      If rate-limited, return 200 with same "pending moderation" message
 *      (don't leak rate-limit info to abusers).
 *   5. Add tiny random delay 100–300ms to all responses (prevent timing attacks).
 *   6. Insert review (status='pending').
 *   7. Return { message: 'Your review is pending moderation' }.
 *
 * Devil's advocate notes:
 *  - Honeypot silent 200: bots see success, don't retry or adapt. Correct behavior.
 *  - Rate limit uses service-role upsert on review_rate_limits:
 *      ON CONFLICT (ip, restaurant_id) DO UPDATE SET last_at = now()
 *    Before upsert, we SELECT the current row — if last_at > now() - 24h, bail.
 *    No crash on first-time IP (no row exists → SELECT returns null → allowed).
 *  - RLS on reviews INSERT: WITH CHECK (status = 'pending') — we always insert
 *    with status='pending', so this is satisfied. Service-role bypasses RLS anyway.
 *  - IP extraction: uses X-Forwarded-For (Vercel sets this). Falls back to a
 *    placeholder — rate limiting degrades gracefully rather than blocking all.
 *  - authorEmail is stored but not returned in any API response.
 *  - body length bounds: 50 (meaningful minimum) to 2000 (prevent abuse).
 *  - Random delay applied unconditionally so timing doesn't reveal honeypot/rate-limit.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createServiceDb } from '@/lib/db/service';
import { secureRandomInt } from '@/lib/security/secure-random';
import type { Restaurant, ReviewRateLimit } from '@/lib/types/db';

// ---------------------------------------------------------------------------
// Zod schema
// ---------------------------------------------------------------------------

const ReviewSubmitSchema = z.object({
  restaurantSlug: z
    .string()
    .min(1)
    .max(120)
    .regex(/^[a-z0-9-]+$/, 'Invalid restaurant slug'),
  authorName: z.string().min(1, 'Name is required').max(100, 'Name too long').trim(),
  authorEmail: z
    .string()
    .email('Invalid email')
    .max(255)
    .optional()
    .or(z.literal(''))
    .transform((v) => (v === '' ? undefined : v)),
  rating: z
    .number()
    .int('Rating must be an integer')
    .min(1, 'Rating must be at least 1')
    .max(5, 'Rating must be at most 5'),
  body: z
    .string()
    .min(50, 'Review must be at least 50 characters')
    .max(2000, 'Review must be at most 2000 characters')
    .trim(),
  allergenContext: z
    .string()
    .max(50)
    .optional()
    .or(z.literal(''))
    .transform((v) => (v === '' ? undefined : v)),
  hpField: z.string().optional().default(''),
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Extracts the real client IP from Vercel's X-Forwarded-For header. */
function extractIp(request: NextRequest): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    // X-Forwarded-For can be a comma-separated list; first is the client IP
    return forwarded.split(',')[0].trim();
  }
  // Fallback: in local dev, use a placeholder (rate limit degrades gracefully)
  return 'unknown';
}

/** Adds a random delay between 100–300ms to all responses. */
async function jitterDelay(): Promise<void> {
  // P1-9: CSPRNG-backed jitter (no non-cryptographic PRNG anywhere in
  // app/ or lib/). The jitter itself is a timing-oracle defense, not a
  // security primitive, but routing it through the central helper costs
  // nothing and keeps the grep regression test clean.
  const ms = 100 + secureRandomInt(201);
  await new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest): Promise<NextResponse> {
  // Always apply jitter delay — regardless of outcome (prevents timing oracle)
  const delayPromise = jitterDelay();

  // 1. Parse body
  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    await delayPromise;
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parseResult = ReviewSubmitSchema.safeParse(rawBody);
  if (!parseResult.success) {
    await delayPromise;
    return NextResponse.json(
      {
        error: 'Validation failed',
        details: parseResult.error.flatten().fieldErrors,
      },
      { status: 400 }
    );
  }

  const body = parseResult.data;

  // 2. Honeypot check — silent 200 if filled in
  if (body.hpField && body.hpField.trim().length > 0) {
    await delayPromise;
    // Silent success — bot thinks it succeeded
    return NextResponse.json({ message: 'Your review is pending moderation' });
  }

  const supabase = createServiceDb();

  // 3. Resolve restaurant (must be listed).
  // Explicit `as Restaurant | null` because the Supabase JS v2.x select-string
  // type parser does not always resolve union-typed columns under strict mode.
  const now = new Date().toISOString();
  const { data: restaurantRaw, error: restaurantError } = await supabase
    .from('restaurants')
    .select('id, status, listing_expires_at')
    .eq('slug', body.restaurantSlug)
    .eq('status', 'listed')
    .or(`listing_expires_at.is.null,listing_expires_at.gt.${now}`)
    .maybeSingle();

  if (restaurantError) {
    console.error('[/api/reviews/submit] Restaurant lookup error:', restaurantError);
    await delayPromise;
    return NextResponse.json({ error: 'Service error' }, { status: 500 });
  }

  const restaurant = restaurantRaw as Pick<
    Restaurant,
    'id' | 'status' | 'listing_expires_at'
  > | null;

  if (!restaurant) {
    await delayPromise;
    return NextResponse.json({ error: 'Restaurant not found' }, { status: 404 });
  }

  // 4. Rate-limit check (1 review per IP per restaurant per 24h)
  const ip = extractIp(request);
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const { data: existingLimitRaw } = await supabase
    .from('review_rate_limits')
    .select('last_at')
    .eq('ip', ip)
    .eq('restaurant_id', restaurant.id)
    .maybeSingle();

  const existingLimit = existingLimitRaw as Pick<ReviewRateLimit, 'last_at'> | null;

  // If a rate-limit record exists and was created/updated within the last 24h, bail
  if (existingLimit && existingLimit.last_at > cutoff) {
    await delayPromise;
    // Silent success — don't leak rate-limit state
    return NextResponse.json({ message: 'Your review is pending moderation' });
  }

  // 5. Upsert rate-limit record (insert or update last_at to now)
  const { error: rlError } = await supabase.from('review_rate_limits').upsert(
    {
      ip,
      restaurant_id: restaurant.id,
      last_at: new Date().toISOString(),
    } satisfies ReviewRateLimit,
    { onConflict: 'ip,restaurant_id' }
  );

  if (rlError) {
    // Rate-limit write failure is non-fatal — log and proceed
    // (acceptable: a single review slips through if the rate-limit table is down)
    console.error('[/api/reviews/submit] Rate-limit upsert error:', rlError);
  }

  // 6. Insert review (status='pending')
  const { error: insertError } = await supabase.from('reviews').insert({
    restaurant_id: restaurant.id,
    author_name: body.authorName,
    author_email: body.authorEmail ?? null,
    rating: body.rating,
    body: body.body,
    allergen_context: body.allergenContext ?? null,
    status: 'pending' as const,
  });

  if (insertError) {
    console.error('[/api/reviews/submit] Review insert error:', insertError);
    await delayPromise;
    return NextResponse.json({ error: 'Failed to submit review' }, { status: 500 });
  }

  await delayPromise;
  return NextResponse.json({ message: 'Your review is pending moderation' });
}
