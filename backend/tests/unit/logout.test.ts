/**
 * tests/unit/logout.test.ts
 *
 * Tests for POST /api/auth/logout — app/api/auth/logout/route.ts
 *
 * Coverage:
 * - Happy path (authed): signOut called, returns 200 { ok: true }
 * - Already signed out (no session): signOut still called (no-op), returns 200 { ok: true }
 * - signOut throws: returns 500 { ok: false }
 *
 * The route handler is unit-tested by directly calling the exported POST
 * function with a NextRequest — no HTTP server required.
 */

import { describe, it, expect, vi, beforeEach, type MockedFunction } from 'vitest';
import { NextRequest } from 'next/server';

// ─── Module mocks ─────────────────────────────────────────────────────────────

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabase: vi.fn(),
}));

import { createServerSupabase } from '@/lib/supabase/server';

const mockCreateServerSupabase = createServerSupabase as MockedFunction<
  typeof createServerSupabase
>;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Build a minimal Supabase client mock with a configurable signOut result. */
function buildSupabaseMock(
  options: {
    signOutError?: { message: string } | null;
    shouldThrow?: boolean;
  } = {}
) {
  const signOut = options.shouldThrow
    ? vi.fn().mockRejectedValue(new Error('Supabase network failure'))
    : vi.fn().mockResolvedValue({ error: options.signOutError ?? null });

  return {
    auth: { signOut },
    _signOut: signOut,
  };
}

function makeRequest() {
  return new NextRequest('http://localhost:3000/api/auth/logout', {
    method: 'POST',
  });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('POST /api/auth/logout', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('happy path: calls signOut and returns 200 { ok: true }', async () => {
    const db = buildSupabaseMock();
    mockCreateServerSupabase.mockResolvedValue(
      db as unknown as Awaited<ReturnType<typeof createServerSupabase>>
    );

    // Dynamic import so the vi.mock above is in effect when the module loads
    const { POST } = await import('@/app/api/auth/logout/route');
    const response = await POST();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ ok: true });
    expect(db._signOut).toHaveBeenCalledOnce();
  });

  it('no-session (already signed out): signOut still called, returns 200 { ok: true }', async () => {
    // Supabase signOut is a no-op when there is no active session — it still
    // resolves successfully (no error). This test confirms we handle that case.
    const db = buildSupabaseMock({ signOutError: null });
    mockCreateServerSupabase.mockResolvedValue(
      db as unknown as Awaited<ReturnType<typeof createServerSupabase>>
    );

    const { POST } = await import('@/app/api/auth/logout/route');
    const response = await POST();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ ok: true });
    expect(db._signOut).toHaveBeenCalledOnce();
  });

  it('signOut throws unexpectedly: returns 500 { ok: false }', async () => {
    const db = buildSupabaseMock({ shouldThrow: true });
    mockCreateServerSupabase.mockResolvedValue(
      db as unknown as Awaited<ReturnType<typeof createServerSupabase>>
    );

    const { POST } = await import('@/app/api/auth/logout/route');
    const response = await POST();
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({ ok: false });
  });

  it('createServerSupabase itself throws: returns 500 { ok: false }', async () => {
    mockCreateServerSupabase.mockRejectedValue(new Error('Cookie store unavailable'));

    const { POST } = await import('@/app/api/auth/logout/route');
    const response = await POST();
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({ ok: false });
  });
});
