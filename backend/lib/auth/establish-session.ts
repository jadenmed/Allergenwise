import 'server-only';
import { createServerSupabase } from '@/lib/supabase/server';

/**
 * Signs a freshly-created (or freshly-activated) user in so the HTTP response
 * carries a Supabase session cookie.
 *
 * Why this exists: both `performSignup` and `acceptInvite` create/activate the
 * auth user with the SERVICE-ROLE client, whose cookie store is a no-op pair of
 * stubs (see `lib/supabase/server.ts` — `getAll()` returns `[]`, `setAll()` does
 * nothing). That client can create an account but physically cannot establish a
 * session. Without this call the client-side redirect to a protected route is
 * bounced straight back to `/login` by `middleware.ts`, which reads to the user
 * as "I signed up and it kicked me out".
 *
 * Best-effort by design: the account already exists by the time this runs, so a
 * failure here must never fail the request. Callers surface the boolean and fall
 * back to sending the user to /login.
 */
export async function establishSession(email: string, password: string): Promise<boolean> {
  try {
    const supabase = await createServerSupabase();
    const { error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      console.error('[auth] post-creation sign-in failed:', error.message);
      return false;
    }

    return true;
  } catch (err) {
    console.error('[auth] post-creation sign-in threw:', err);
    return false;
  }
}
