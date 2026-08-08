/**
 * lib/auth/invite.ts
 * Invite token generation and validation.
 *
 * Token strategy: crypto.randomBytes(32).toString('base64url') — 256 bits of
 * randomness, URL-safe, stored in profiles.invite_token (unique index).
 * Not a JWT: we don't need tamper-proof payloads (the DB row is the authority).
 * The token IS the key — it's unguessable without DB access.
 *
 * Expiry: 7 days from profiles.invited_at.
 * Single-use: accepted_at is set to now() on accept; repeated calls return 'already_accepted'.
 *
 * Migration note: profiles.invite_token column is added in 0005_invite_tokens.sql.
 * Guillermo must run this migration before Agent B's invite route (/api/invites/send) goes live.
 *
 * Tested by: tests/unit/invite.test.ts
 */
import 'server-only';
import { randomBytes } from 'crypto';
import { createServiceSupabase } from '@/lib/supabase/server';
import type { Profile } from '@/lib/types/db';

// ─── Constants ────────────────────────────────────────────────────────────────

const TOKEN_BYTES = 32;
const TOKEN_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// ─── Types ────────────────────────────────────────────────────────────────────

export interface InviteTokenRow extends Profile {
  invite_token: string | null;
}

export type ValidateResult =
  | { valid: true; profile: InviteTokenRow }
  | { valid: false; reason: 'not_found' | 'expired' | 'already_accepted' };

// ─── Token generation ─────────────────────────────────────────────────────────

/**
 * Generates a cryptographically random, URL-safe invite token.
 * Pure function — no DB side-effects.
 */
export function generateInviteToken(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url');
}

// ─── Token validation ─────────────────────────────────────────────────────────

/**
 * Validates an invite token.
 * Looks up the profile row, checks expiry and single-use constraints.
 * Uses service-role to read profiles.invite_token (bypasses RLS — token is the auth).
 */
export async function validateInviteToken(token: string): Promise<ValidateResult> {
  const db = createServiceSupabase();

  const { data, error } = await db
    .from('profiles')
    .select('*')
    .eq('invite_token', token)
    .maybeSingle();

  if (error || !data) {
    return { valid: false, reason: 'not_found' };
  }

  // Single-use check
  if (data.accepted_at !== null) {
    return { valid: false, reason: 'already_accepted' };
  }

  // Expiry check
  if (!data.invited_at) {
    // invited_at should always be set when invite_token is set; treat as expired
    return { valid: false, reason: 'expired' };
  }

  const invitedAt = new Date(data.invited_at).getTime();
  const now = Date.now();

  if (now - invitedAt >= TOKEN_EXPIRY_MS) {
    return { valid: false, reason: 'expired' };
  }

  return { valid: true, profile: data };
}

// ─── Accept invite ────────────────────────────────────────────────────────────

/**
 * Marks an invite as accepted by setting accepted_at = now().
 * Sets Supabase Auth password for the user via admin API.
 * Clears the invite_token (single-use enforcement at DB level).
 * Returns the redirectUrl based on role.
 */
export async function acceptInvite(
  profile: InviteTokenRow,
  password: string
): Promise<{ redirectUrl: string }> {
  const db = createServiceSupabase();

  // Set password + confirm email on the Supabase Auth user.
  // The invite was created with email_confirm:false (recipient hadn't proven ownership yet);
  // accepting the invite via the unguessable token IS the proof, so confirm now.
  // Without email_confirm:true, signInWithPassword returns 401 for unconfirmed users.
  await db.auth.admin.updateUserById(profile.id, { password, email_confirm: true });

  // Mark accepted + clear token.
  // Cast .from('profiles') to a loose type: invite_token is not in the Database type's
  // Update shape (it's added by migration 0005), so the strict Supabase builder rejects it.
  type ProfileUpdateTable = {
    update(values: Record<string, unknown>): {
      eq(col: string, val: string): Promise<{ data: null; error: unknown }>;
    };
  };
  const profileTable = db.from('profiles') as unknown as ProfileUpdateTable;
  await profileTable
    .update({
      accepted_at: new Date().toISOString(),
      invite_token: null, // Clear token — single-use enforcement
    })
    .eq('id', profile.id);

  // Role-based redirect
  const roleRedirects: Record<string, string> = {
    learner: '/learner/courses',
    // role key is looked up by profile.role (now 'manager'); URL stays /admin/* (renamed in PR 2)
    manager: '/admin/dashboard',
    reviewer: '/reviewer/queue',
  };

  const redirectUrl = roleRedirects[profile.role] ?? '/';
  return { redirectUrl };
}
