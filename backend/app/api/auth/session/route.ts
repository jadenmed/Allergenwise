/**
 * GET /api/auth/session
 *
 * Returns the current authenticated user's identity for client-side consumption:
 *   { user: { id, email, fullName }, role, restaurantId }
 *
 * Returns 401 if not authenticated.
 * Used by client components to determine role-based UI state.
 *
 * Caching: force-dynamic — always reads the live Supabase session cookie.
 */
import 'server-only';
import { NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase/server';
import type { Role } from '@/lib/types/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  const supabase = await createServerSupabase();

  // getUser() verifies the JWT against Supabase Auth — not just a cookie read
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
  }

  // Cast through unknown: Supabase's generic types don't infer column sub-selects
  // without full codegen. Our Database type matches the schema shape but the
  // TypeScript query builder loses the column names in string literal parsing.
  const profileQuery = await (supabase
    .from('profiles')
    .select('role, restaurant_id, full_name')
    .eq('id', user.id)
    .maybeSingle() as unknown as Promise<{
    data: { role: Role; restaurant_id: string | null; full_name: string } | null;
    error: { message: string } | null;
  }>);

  if (profileQuery.error || !profileQuery.data) {
    return NextResponse.json({ error: 'Profile not found.' }, { status: 403 });
  }

  return NextResponse.json({
    user: {
      id: user.id,
      email: user.email,
      fullName: profileQuery.data.full_name,
    },
    role: profileQuery.data.role,
    restaurantId: profileQuery.data.restaurant_id,
  });
}
