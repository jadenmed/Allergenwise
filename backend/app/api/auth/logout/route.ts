/**
 * POST /api/auth/logout
 *
 * Server-side sign-out. Calls supabase.auth.signOut() which clears the
 * session cookie via @supabase/ssr cookie callbacks.
 *
 * Public-route-accessible: /api/auth/ prefix is already in middleware PUBLIC_PREFIXES,
 * so unauthenticated requests (e.g. double-click on sign-out) are handled gracefully
 * — signOut() on an already-cleared session is a no-op.
 *
 * Response: 200 { ok: true } on success, 500 { ok: false } on unexpected error.
 */
import 'server-only';
import { NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase/server';

export async function POST() {
  try {
    const supabase = await createServerSupabase();
    // signOut() clears the session cookies via the @supabase/ssr cookie callbacks
    // already wired in createServerSupabase. Errors here are non-fatal — the
    // client will still navigate away.
    await supabase.auth.signOut();
    return NextResponse.json({ ok: true });
  } catch (err) {
    // Log but never expose internals — client should still navigate to '/'
    console.error('[logout] unexpected error:', err);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
