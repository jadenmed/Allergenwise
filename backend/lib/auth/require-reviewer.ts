/**
 * lib/auth/require-reviewer.ts
 *
 * Reviewer guard for the partner/brand admin routes (Track B). Thin wrapper
 * over the audited requireRole (lib/auth/require-role) that ALSO returns the
 * user-scoped Supabase client, so route queries run under RLS (defense in
 * depth alongside the app-layer role check — migration 0021 gives reviewer
 * full CRUD on partners/brands).
 *
 * Lives in lib/ (not in a route file): Next.js App Router route modules may
 * only export HTTP methods + route config; exporting helpers from route.ts
 * fails the build.
 */
import 'server-only';
import { NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase/server';
import { requireRole } from '@/lib/auth/require-role';

export async function requireReviewer(): Promise<
  | { sb: Awaited<ReturnType<typeof createServerSupabase>>; res: null }
  | { sb: null; res: NextResponse }
> {
  const auth = await requireRole({
    roles: ['reviewer'],
    profileClient: 'session',
    columns: 'role',
    unauthorizedMessage: 'Unauthorized.',
    forbiddenMessage: 'Forbidden.',
    onMissingProfile: 'forbidden',
  });
  if (auth instanceof NextResponse) return { sb: null, res: auth };
  const sb = await createServerSupabase();
  return { sb, res: null };
}
