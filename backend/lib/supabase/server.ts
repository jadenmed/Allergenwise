import 'server-only';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import type { Database } from '@/lib/types/db';

/**
 * Server-side Supabase client scoped to the current user session.
 * Use this in Server Components, Route Handlers, and Server Actions.
 * Respects RLS — only accesses rows the authenticated user is allowed to see.
 */
export async function createServerSupabase() {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options?: Parameters<typeof cookieStore.set>[2] }[]) {
          try {
            // P0 #8 — auth cookie hardening. Override @supabase/ssr's default
            // `httpOnly: false` so any XSS cannot read `document.cookie` to
            // exfil the session. See lib/supabase/middleware.ts for the
            // matching override on the middleware-side write path.
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, {
                ...options,
                httpOnly: true,
                secure: process.env.NODE_ENV === 'production',
                sameSite: 'lax',
              })
            );
          } catch {
            // Server Component context: cookies are read-only. Middleware handles refresh.
          }
        },
      },
    }
  );
}

/**
 * Service-role Supabase client — bypasses RLS entirely.
 * Use ONLY for trusted server-only operations (cron jobs, webhook processing, seeding).
 * NEVER import this in Client Components or expose via NEXT_PUBLIC_.
 * Throws at runtime if SUPABASE_SERVICE_ROLE_KEY is missing.
 */
export function createServiceSupabase() {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) {
    throw new Error(
      'SUPABASE_SERVICE_ROLE_KEY is not set. This client must only run server-side.'
    );
  }

  // Dynamically import to ensure this cannot be tree-shaken into a client bundle.
  // We use createServerClient with a no-op cookie store since service-role
  // does not read session cookies.
  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceRoleKey,
    {
      cookies: {
        getAll() {
          return [];
        },
        setAll() {
          // Service-role clients don't write cookies
        },
      },
    }
  );
}
