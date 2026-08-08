/**
 * POST /api/auth/login
 *
 * Email + password login for admins and reviewers.
 * Uses Supabase Auth signInWithPassword — never a custom JWT.
 * Supabase @supabase/ssr manages the session cookie automatically.
 *
 * Returns { user: { id, email }, role, restaurantId } on success.
 * Returns { error } with a generic message on failure (no field-level hints).
 *
 * Rate limiting: handled upstream by Supabase Auth (429 on brute-force).
 * We surface the 429 faithfully but never reveal which field is wrong.
 */
import 'server-only';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createServerSupabase } from '@/lib/supabase/server';
import type { Role } from '@/lib/types/db';

// ─── Request schema ───────────────────────────────────────────────────────────

const loginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required').max(72),
});

// Generic error message — never reveal which field is wrong
const GENERIC_AUTH_ERROR = 'Invalid credentials.';

// ─── Handler ──────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) {
    // Still return a generic message to avoid field enumeration
    return NextResponse.json({ error: GENERIC_AUTH_ERROR }, { status: 400 });
  }

  const supabase = await createServerSupabase();

  // signInWithPassword sets the session cookie via @supabase/ssr cookie callbacks
  const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });

  if (authError || !authData.user) {
    // Supabase returns 429 for rate-limited requests
    const status = (authError as { status?: number } | null)?.status === 429 ? 429 : 401;
    return NextResponse.json({ error: GENERIC_AUTH_ERROR }, { status });
  }

  // Fetch role + restaurant_id from profiles
  // Cast through unknown because the Supabase generated type for string column selects
  // requires the generated DB schema; we use our own Database type without full codegen.
  const profileQuery = await (supabase
    .from('profiles')
    .select('role, restaurant_id')
    .eq('id', authData.user.id)
    .maybeSingle() as unknown as Promise<{
    data: { role: Role; restaurant_id: string | null } | null;
    error: { message: string } | null;
  }>);

  if (profileQuery.error || !profileQuery.data) {
    // Auth succeeded but no profile — account partially created, treat as error
    return NextResponse.json(
      { error: 'Account setup incomplete. Contact support.' },
      { status: 403 }
    );
  }

  return NextResponse.json({
    user: {
      id: authData.user.id,
      email: authData.user.email,
    },
    role: profileQuery.data.role,
    restaurantId: profileQuery.data.restaurant_id,
  });
}
