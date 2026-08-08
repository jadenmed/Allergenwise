/**
 * /api/reviewer/brands/[id]
 *
 * PATCH — update a brand (name / slug) and/or change restaurant membership
 *         (assign/unassign restaurants to this brand).
 *
 * Auth: reviewer role required (shared requireReviewer guard).
 *
 * name/slug updates use the USER-scoped client so RLS (reviewer full CRUD on
 * brands) enforces alongside the app-layer check; 23505 → 409.
 *
 * Membership (restaurants.brand_id) uses the SERVICE-ROLE client: reviewer is
 * SELECT-only on restaurants via RLS, so a user-scoped write would affect 0
 * rows. This is an intentional, in-scope deviation (no migration allowed;
 * brand_id is platform-admin data), STILL gated by the app-layer reviewer check.
 */
import 'server-only';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireReviewer } from '@/lib/auth/require-reviewer';
import { type BrandRow } from '../route';
import { createServiceDb } from '@/lib/db/service';

type AnyFromClient = { from: (table: string) => any }; // eslint-disable-line @typescript-eslint/no-explicit-any

const SLUG_REGEX = /^[a-z0-9-]+$/;

const PatchSchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    slug: z.string().regex(SLUG_REGEX).min(1).max(120).optional(),
    assignRestaurantIds: z.array(z.string()).optional(),
    unassignRestaurantIds: z.array(z.string()).optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), {
    message: 'At least one field is required.',
  });

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const guard = await requireReviewer();
  if (guard.res) return guard.res;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed.', details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const { name, slug, assignRestaurantIds, unassignRestaurantIds } = parsed.data;
  const db = guard.sb as unknown as AnyFromClient;

  // ── name / slug update (user-scoped, RLS-enforced) ────────────────────────
  if (name !== undefined || slug !== undefined) {
    const update: Record<string, unknown> = {};
    if (name !== undefined) update.name = name;
    if (slug !== undefined) update.slug = slug;

    const { error } = await db.from('brands').update(update).eq('id', params.id);

    if (error) {
      if (error.code === '23505') {
        return NextResponse.json({ error: 'Slug already in use.' }, { status: 409 });
      }
      return NextResponse.json(
        { error: `Failed to update brand: ${error.message}` },
        { status: 500 }
      );
    }
  }

  // ── membership changes (service-role — reviewer is SELECT-only on restaurants) ─
  const service = createServiceDb();

  if (assignRestaurantIds && assignRestaurantIds.length > 0) {
    const { error } = await service
      .from('restaurants')
      .update({ brand_id: params.id })
      .in('id', assignRestaurantIds);
    if (error) {
      return NextResponse.json(
        { error: `Failed to assign restaurants: ${error.message}` },
        { status: 500 }
      );
    }
  }

  if (unassignRestaurantIds && unassignRestaurantIds.length > 0) {
    const { error } = await service
      .from('restaurants')
      .update({ brand_id: null })
      .in('id', unassignRestaurantIds);
    if (error) {
      return NextResponse.json(
        { error: `Failed to unassign restaurants: ${error.message}` },
        { status: 500 }
      );
    }
  }

  // ── re-fetch the brand (user-scoped) ──────────────────────────────────────
  const { data: brand } = await db.from('brands').select('*').eq('id', params.id).single();

  return NextResponse.json({ brand: (brand ?? null) as BrandRow | null });
}
