/**
 * /api/reviewer/partners/[id]
 *
 * PATCH — update a partner (name / contact_email / status / commission rate).
 *
 * Auth: reviewer role required (shared requireReviewer guard).
 * Write uses the USER-scoped client so RLS (reviewer full CRUD on partners)
 * enforces alongside the app-layer check. `partners` is absent from the
 * hand-written db types, so we cast the client to a minimal `{ from }` shape.
 */
import 'server-only';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireReviewer } from '@/lib/auth/require-reviewer';
import { type PartnerRow } from '../route';

type AnyFromClient = { from: (table: string) => any }; // eslint-disable-line @typescript-eslint/no-explicit-any

const PatchSchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    contact_email: z.preprocess((v) => (v === '' ? undefined : v), z.string().email().optional()),
    status: z.enum(['active', 'inactive']).optional(),
    default_commission_rate: z.number().min(0).max(1).optional(),
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

  const update: Record<string, unknown> = {};
  if (parsed.data.name !== undefined) update.name = parsed.data.name;
  if (parsed.data.contact_email !== undefined) update.contact_email = parsed.data.contact_email;
  if (parsed.data.status !== undefined) update.status = parsed.data.status;
  if (parsed.data.default_commission_rate !== undefined) {
    update.default_commission_rate = parsed.data.default_commission_rate;
  }

  const db = guard.sb as unknown as AnyFromClient;

  const { data, error } = await db
    .from('partners')
    .update(update)
    .eq('id', params.id)
    .select('*')
    .single();

  if (error) {
    return NextResponse.json(
      { error: `Failed to update partner: ${error.message}` },
      { status: 500 }
    );
  }

  return NextResponse.json({ partner: data as PartnerRow });
}
