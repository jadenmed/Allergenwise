import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import type { Database } from '@/lib/types/db';

/**
 * Refreshes the Supabase session in middleware.
 * Must be called from root middleware.ts before any role checks.
 * Returns the (possibly updated) response with refreshed cookies.
 */
export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options?: Record<string, unknown> }[]) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({ request });
          // P0 #8 — auth cookie hardening. @supabase/ssr defaults `httpOnly: false`
          // (so the browser-side createBrowserClient can read the cookie). We
          // override to `httpOnly: true` so any XSS cannot exfil the session.
          // Trade-off: SubmitClient.tsx's browser-side Supabase Storage upload
          // breaks (logged as F-S6); proper fix is a server-side upload route.
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, {
              ...(options as Parameters<typeof supabaseResponse.cookies.set>[2]),
              httpOnly: true,
              secure: process.env.NODE_ENV === 'production',
              sameSite: 'lax',
            })
          );
        },
      },
    }
  );

  // Refresh session — do NOT add logic between createServerClient and getUser().
  // It could result in hard-to-debug auth issues.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return { supabaseResponse, user };
}
