/**
 * tests/unit/invite.test.ts
 *
 * Tests for lib/auth/invite.ts — token generation, validation, and acceptance.
 *
 * Test coverage:
 * - generateInviteToken: produces unique, URL-safe, correct-length tokens
 * - validateInviteToken: not_found, expired, already_accepted, valid
 * - Expiry boundary: exactly at 7 days is expired; just under is valid
 * - acceptInvite: sets password, clears invite_token, sets accepted_at
 * - Double-accept: second call to validateInviteToken sees already_accepted
 */
import { describe, it, expect, vi, beforeEach, type MockedFunction } from 'vitest';
import { generateInviteToken, validateInviteToken, acceptInvite } from '@/lib/auth/invite';
import type { InviteTokenRow } from '@/lib/auth/invite';

// ─── Module mock ──────────────────────────────────────────────────────────────

vi.mock('@/lib/supabase/server', () => ({
  createServiceSupabase: vi.fn(),
}));

import { createServiceSupabase } from '@/lib/supabase/server';
const mockCreateServiceSupabase = createServiceSupabase as MockedFunction<
  typeof createServiceSupabase
>;

// ─── Helpers ──────────────────────────────────────────────────────────────────

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

function buildProfile(overrides: Partial<InviteTokenRow> = {}): InviteTokenRow {
  return {
    id: 'profile-abc',
    full_name: 'Test Employee',
    email: 'employee@test.com',
    role: 'learner',
    restaurant_id: 'rest-123',
    job_role: 'server',
    invite_token: 'valid-token-abc',
    invited_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(), // 1 hour ago
    invited_by: null,
    accepted_at: null,
    partner_id: null,
    departed_at: null, // 0026 — an invited employee is current staff
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

function buildDbMock(
  profileResult: InviteTokenRow | null,
  updateResult = { data: null, error: null }
) {
  const updateEq = vi.fn().mockResolvedValue(updateResult);
  const updateFn = vi.fn().mockReturnValue({ eq: updateEq });

  return {
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({ data: profileResult, error: null }),
        }),
      }),
      update: updateFn,
    }),
    auth: {
      admin: {
        updateUserById: vi.fn().mockResolvedValue({ data: {}, error: null }),
      },
    },
    _updateFn: updateFn,
    _updateEq: updateEq,
  };
}

// ─── generateInviteToken ──────────────────────────────────────────────────────

describe('generateInviteToken', () => {
  it('produces a non-empty string', () => {
    const token = generateInviteToken();
    expect(typeof token).toBe('string');
    expect(token.length).toBeGreaterThan(0);
  });

  it('produces URL-safe base64url characters only', () => {
    const token = generateInviteToken();
    // base64url uses A-Z, a-z, 0-9, -, _  (no +, /, =)
    expect(token).toMatch(/^[A-Za-z0-9\-_]+$/);
  });

  it('produces at least 43 characters (256 bits in base64url)', () => {
    const token = generateInviteToken();
    // 32 bytes = 43 base64url chars (padded to 44 with =, but base64url drops padding)
    expect(token.length).toBeGreaterThanOrEqual(43);
  });

  it('generates unique tokens on repeated calls', () => {
    const tokens = new Set(Array.from({ length: 100 }, () => generateInviteToken()));
    expect(tokens.size).toBe(100);
  });
});

// ─── validateInviteToken ──────────────────────────────────────────────────────

describe('validateInviteToken', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns not_found when token does not exist in DB', async () => {
    const db = buildDbMock(null);
    mockCreateServiceSupabase.mockReturnValue(
      db as unknown as ReturnType<typeof createServiceSupabase>
    );

    const result = await validateInviteToken('nonexistent-token');
    expect(result.valid).toBe(false);
    if (result.valid) throw new Error('Expected invalid');
    expect(result.reason).toBe('not_found');
  });

  it('returns already_accepted when accepted_at is set', async () => {
    const profile = buildProfile({ accepted_at: new Date().toISOString() });
    const db = buildDbMock(profile);
    mockCreateServiceSupabase.mockReturnValue(
      db as unknown as ReturnType<typeof createServiceSupabase>
    );

    const result = await validateInviteToken('valid-token-abc');
    expect(result.valid).toBe(false);
    if (result.valid) throw new Error('Expected invalid');
    expect(result.reason).toBe('already_accepted');
  });

  it('returns expired when invited_at is more than 7 days ago', async () => {
    const profile = buildProfile({
      invited_at: new Date(Date.now() - SEVEN_DAYS_MS - 1000).toISOString(),
    });
    const db = buildDbMock(profile);
    mockCreateServiceSupabase.mockReturnValue(
      db as unknown as ReturnType<typeof createServiceSupabase>
    );

    const result = await validateInviteToken('valid-token-abc');
    expect(result.valid).toBe(false);
    if (result.valid) throw new Error('Expected invalid');
    expect(result.reason).toBe('expired');
  });

  it('returns expired when invited_at is exactly 7 days ago', async () => {
    const profile = buildProfile({
      invited_at: new Date(Date.now() - SEVEN_DAYS_MS).toISOString(),
    });
    const db = buildDbMock(profile);
    mockCreateServiceSupabase.mockReturnValue(
      db as unknown as ReturnType<typeof createServiceSupabase>
    );

    const result = await validateInviteToken('valid-token-abc');
    expect(result.valid).toBe(false);
    if (result.valid) throw new Error('Expected invalid');
    expect(result.reason).toBe('expired');
  });

  it('returns valid when invited_at is just under 7 days ago', async () => {
    const profile = buildProfile({
      invited_at: new Date(Date.now() - SEVEN_DAYS_MS + 60_000).toISOString(), // 1 min before expiry
    });
    const db = buildDbMock(profile);
    mockCreateServiceSupabase.mockReturnValue(
      db as unknown as ReturnType<typeof createServiceSupabase>
    );

    const result = await validateInviteToken('valid-token-abc');
    expect(result.valid).toBe(true);
    if (!result.valid) throw new Error('Expected valid');
    expect(result.profile.id).toBe('profile-abc');
  });

  it('returns valid for fresh invite (1 hour ago)', async () => {
    const profile = buildProfile();
    const db = buildDbMock(profile);
    mockCreateServiceSupabase.mockReturnValue(
      db as unknown as ReturnType<typeof createServiceSupabase>
    );

    const result = await validateInviteToken('valid-token-abc');
    expect(result.valid).toBe(true);
  });

  it('returns expired when invited_at is null', async () => {
    const profile = buildProfile({ invited_at: null });
    const db = buildDbMock(profile);
    mockCreateServiceSupabase.mockReturnValue(
      db as unknown as ReturnType<typeof createServiceSupabase>
    );

    const result = await validateInviteToken('valid-token-abc');
    expect(result.valid).toBe(false);
    if (result.valid) throw new Error('Expected invalid');
    expect(result.reason).toBe('expired');
  });
});

// ─── acceptInvite ─────────────────────────────────────────────────────────────

describe('acceptInvite', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls updateUserById with the provided password', async () => {
    const profile = buildProfile();
    const db = buildDbMock(profile);
    mockCreateServiceSupabase.mockReturnValue(
      db as unknown as ReturnType<typeof createServiceSupabase>
    );

    await acceptInvite(profile, 'NewPassword123!');

    expect(db.auth.admin.updateUserById).toHaveBeenCalledWith('profile-abc', {
      password: 'NewPassword123!',
      email_confirm: true,
    });
  });

  it('sets accepted_at and clears invite_token on the profile', async () => {
    const profile = buildProfile();
    const db = buildDbMock(profile);
    mockCreateServiceSupabase.mockReturnValue(
      db as unknown as ReturnType<typeof createServiceSupabase>
    );

    await acceptInvite(profile, 'NewPassword123!');

    expect(db._updateFn).toHaveBeenCalledWith(
      expect.objectContaining({
        accepted_at: expect.any(String),
        invite_token: null,
      })
    );
    expect(db._updateEq).toHaveBeenCalledWith('id', 'profile-abc');
  });

  it('returns /learner/courses redirect for learner role', async () => {
    const profile = buildProfile({ role: 'learner' });
    const db = buildDbMock(profile);
    mockCreateServiceSupabase.mockReturnValue(
      db as unknown as ReturnType<typeof createServiceSupabase>
    );

    const { redirectUrl } = await acceptInvite(profile, 'Password1!');
    expect(redirectUrl).toBe('/learner/courses');
  });

  it('returns /admin/dashboard redirect for admin role', async () => {
    const profile = buildProfile({ role: 'manager' });
    const db = buildDbMock(profile);
    mockCreateServiceSupabase.mockReturnValue(
      db as unknown as ReturnType<typeof createServiceSupabase>
    );

    const { redirectUrl } = await acceptInvite(profile, 'Password1!');
    expect(redirectUrl).toBe('/admin/dashboard');
  });

  it('returns /reviewer/queue redirect for reviewer role', async () => {
    const profile = buildProfile({ role: 'reviewer' });
    const db = buildDbMock(profile);
    mockCreateServiceSupabase.mockReturnValue(
      db as unknown as ReturnType<typeof createServiceSupabase>
    );

    const { redirectUrl } = await acceptInvite(profile, 'Password1!');
    expect(redirectUrl).toBe('/reviewer/queue');
  });
});

// ─── Double-accept simulation ─────────────────────────────────────────────────

describe('double-accept rejection', () => {
  it('after accepting, re-validating the token returns already_accepted', async () => {
    const profile = buildProfile({ accepted_at: new Date().toISOString() });
    const db = buildDbMock(profile);
    mockCreateServiceSupabase.mockReturnValue(
      db as unknown as ReturnType<typeof createServiceSupabase>
    );

    const result = await validateInviteToken('valid-token-abc');
    expect(result.valid).toBe(false);
    if (result.valid) throw new Error('Expected invalid');
    expect(result.reason).toBe('already_accepted');
  });
});
