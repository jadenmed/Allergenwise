/**
 * /api/reviewer/brands
 *
 * GET  — list brands (created_at desc) with a restaurantCount per brand
 *        → { brands: BrandRow[] }
 * POST — create a brand → { brand } 201 (409 on duplicate slug)
 *
 * Auth: reviewer role required (app-layer guard + RLS defense-in-depth).
 *
 * Brand writes use the USER-scoped client (createServerSupabase) so RLS
 * (migration 0021: reviewer has full CRUD on brands) enforces alongside the
 * app-layer check. `brands` is absent from the hand-written db types, so we cast
 * the client to a minimal `{ from }` shape.
 */
import 'server-only';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireReviewer } from '@/lib/auth/require-reviewer';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface BrandRow {
  id: string;
  slug: string;
  name: string;
  created_at: string;
  updated_at: string;
  restaurantCount?: number;
}

type AnyFromClient = { from: (table: string) => any }; // eslint-disable-line @typescript-eslint/no-explicit-any

const SLUG_REGEX = /^[a-z0-9-]+$/;

const CreateSchema = z.object({
  name: z.string().min(1).max(200),
  slug: z.string().regex(SLUG_REGEX).min(1).max(120),
});

// ─── GET ──────────────────────────────────────────────────────────────────────

export async function GET() {
  const guard = await requireReviewer();
  if (guard.res) return guard.res;

  const db = guard.sb as unknown as AnyFromClient;

  const { data: brands, error } = await db
    .from('brands')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    return NextResponse.json(
      { error: `Failed to fetch brands: ${error.message}` },
      { status: 500 }
    );
  }

  const { data: restaurants } = await db.from('restaurants').select('id, brand_id');

  const countByBrand = new Map<string, number>();
  for (const r of (restaurants ?? []) as { id: string; brand_id: string | null }[]) {
    if (r.brand_id) countByBrand.set(r.brand_id, (countByBrand.get(r.brand_id) ?? 0) + 1);
  }

  const result: BrandRow[] = ((brands ?? []) as BrandRow[]).map((b) => ({
    ...b,
    restaurantCount: countByBrand.get(b.id) ?? 0,
  }));

  return NextResponse.json({ brands: result });
}

// ─── POST ─────────────────────────────────────────────────────────────────────

export async function POST(request: Request) {
  const guard = await requireReviewer();
  if (guard.res) return guard.res;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const parsed = CreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed.', details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const db = guard.sb as unknown as AnyFromClient;

  const { data, error } = await db
    .from('brands')
    .insert({ name: parsed.data.name, slug: parsed.data.slug })
    .select('*')
    .single();

  if (error) {
    if (error.code === '23505') {
      return NextResponse.json({ error: 'Slug already in use.' }, { status: 409 });
    }
    return NextResponse.json(
      { error: `Failed to create brand: ${error.message}` },
      { status: 500 }
    );
  }

  return NextResponse.json({ brand: data as BrandRow }, { status: 201 });
}
