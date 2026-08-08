/**
 * lib/auth/require-auth.ts
 *
 * Shared session guard + error-response helpers (audit B1+B8).
 *
 * Behavior contract: these helpers reproduce the per-route inline guards they
 * replaced byte-for-byte. Message strings are parameterized because the
 * historical routes drifted ('Unauthorized' vs 'Unauthorized.') and this
 * extraction is strictly behavior-preserving — do NOT normalize messages here.
 */
import 'server-only';
import { NextResponse } from 'next/server';
import type { User } from '@supabase/supabase-js';
import { createServerSupabase } from '@/lib/supabase/server';

/** `{ error: message }` JSON body with the given status — the shape every API route uses. */
export function jsonError(status: number, message: string): NextResponse {
  return NextResponse.json({ error: message }, { status });
}

export function unauthorized(message = 'Unauthorized'): NextResponse {
  return jsonError(401, message);
}

export function forbidden(message = 'Forbidden'): NextResponse {
  return jsonError(403, message);
}

/**
 * Session-only guard: resolves the authenticated user or a 401 response.
 * Role checks live in requireRole (lib/auth/require-role.ts).
 *
 * Callers use the discriminating pattern:
 *   const auth = await requireAuth();
 *   if (auth instanceof NextResponse) return auth;
 */
export async function requireAuth(opts?: {
  message?: string;
}): Promise<{ user: User } | NextResponse> {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return unauthorized(opts?.message);
  }

  return { user };
}
