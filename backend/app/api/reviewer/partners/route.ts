/**
 * /api/reviewer/partners
 *
 * GET  — list all partners (created_at desc) → { partners: PartnerRow[] }
 * POST — create a partner → { partner } 201
 *
 * Auth: reviewer role required (app-layer guard + RLS defense-in-depth).
 *
 * Partner writes use the USER-scoped client (createServerSupabase) so RLS
 * (migration 0021: reviewer has full CRUD on partners) enforces alongside the
 * app-layer check. The hand-written db types in lib/types/db.ts do NOT include
 * the `partners` table, so we cast the client to a minimal `{ from }` shape.
 */
import 'server-only';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireReviewer } from '@/lib/auth/require-reviewer';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PartnerRow {
  id: string;
  name: string;
  contact_email: string | null;
  default_commission_rate: number;
  status: 'active' | 'inactive';
  created_at: string;
  updated_at: string;
}

// `partners`/`brands` are absent from the hand-written Database type, so the
// typed client resolves their rows to `never`. This minimal shape gives us an
// `any`-typed query builder while keeping the user-scoped (RLS) client.
type AnyFromClient = { from: (table: string) => any }; // eslint-disable-line @typescript-eslint/no-explicit-any

// ─── Validation ─────────────────────────────────────────────────────────────

const CreateSchema = z.object({
  name: z.string().min(1).max(200),
  contact_email: z.preprocess((v) => (v === '' ? undefined : v), z.string().email().optional()),
  default_commission_rate: z.number().min(0).max(1).optional(),
});

// ─── GET ──────────────────────────────────────────────────────────────────────

export async function GET() {
  const guard = await requireReviewer();
  if (guard.res) return guard.res;

  const db = guard.sb as unknown as AnyFromClient;

  const { data, error } = await db
    .from('partners')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    return NextResponse.json(
      { error: `Failed to fetch partners: ${error.message}` },
      { status: 500 }
    );
  }

  return NextResponse.json({ partners: (data ?? []) as PartnerRow[] });
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

  const insert: Record<string, unknown> = { name: parsed.data.name };
  if (parsed.data.contact_email !== undefined) insert.contact_email = parsed.data.contact_email;
  if (parsed.data.default_commission_rate !== undefined) {
    insert.default_commission_rate = parsed.data.default_commission_rate;
  }

  const { data, error } = await db.from('partners').insert(insert).select('*').single();

  if (error) {
    return NextResponse.json(
      { error: `Failed to create partner: ${error.message}` },
      { status: 500 }
    );
  }

  return NextResponse.json({ partner: data as PartnerRow }, { status: 201 });
}
