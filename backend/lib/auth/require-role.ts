/**
 * lib/auth/require-role.ts
 *
 * Shared role guard (audit B1). One audited implementation of the
 * "getUser → re-read role from profiles → 401/403" sequence that was
 * copy-pasted across 21 route handlers.
 *
 * Security invariants (do not weaken):
 * - Role is ALWAYS re-read from `profiles` server-side; the JWT claim is never
 *   trusted alone.
 * - The profile read uses the SAME client the original route used
 *   (`session` = RLS-scoped, `service` = service-role) so RLS assumptions are
 *   unchanged.
 * - Message strings / status codes are parameterized to preserve each route's
 *   historical responses exactly. Do not normalize.
 * - Departed staff are refused BY DEFAULT (T-46a). A route that must keep
 *   serving someone after they leave — their own certificate, their own
 *   progress — opts in explicitly with `allowDeparted: true`. Default-deny is
 *   the point: a route added later is cut off until someone decides otherwise.
 */
import 'server-only';
import { NextResponse } from 'next/server';
import type { User } from '@supabase/supabase-js';
import { createServerSupabase } from '@/lib/supabase/server';
import { createServiceDb } from '@/lib/db/service';
import { DEPARTED_AT_COLUMN, isCurrentStaff } from '@/lib/staff/membership';
import { forbidden, jsonError, unauthorized } from './require-auth';

/**
 * 403 body for a caller whose profile is marked departed. Deliberately says
 * nothing about the restaurant — the caller has just lost the right to read
 * anything about it, including whether it still exists.
 */
export const DEPARTED_FORBIDDEN_MESSAGE =
  'This account is no longer active staff at this restaurant.';

/** Loosely-typed profile row — mirrors the route-local `as any` casts this replaces. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type GuardProfile = Record<string, any>;

export interface RequireRoleOptions {
  /** Allowed `profiles.role` values (exact strings, e.g. ['reviewer'] or ['learner', 'manager']). */
  roles: readonly string[];
  /** Which client reads `profiles`: 'session' (RLS-scoped) or 'service' (service-role). Must match the original route. */
  profileClient: 'session' | 'service';
  /** Exact column list for the `profiles` select (e.g. 'id, role, restaurant_id'). */
  columns: string;
  /** 401 body message for missing session. Default 'Unauthorized'. */
  unauthorizedMessage?: string;
  /** 403 body message for a role mismatch. Default 'Forbidden'. */
  forbiddenMessage?: string;
  /**
   * Response when the profile row is missing or the read errors.
   * 'unauthorized' (default) → 401 with unauthorizedMessage.
   * 'forbidden' → 403 with forbiddenMessage (routes that folded the null
   * profile into the role check).
   * Or an explicit { status, message }.
   */
  onMissingProfile?: 'unauthorized' | 'forbidden' | { status: number; message: string };
  /** If set, requires profile.restaurant_id to be non-null AFTER the role check. */
  requireRestaurant?: { status: number; message: string };
  /**
   * T-46a — set true ONLY for routes that must keep serving someone after they
   * have left the restaurant, and that read nothing but that person's own
   * records: their certificate, their own lesson progress. Everything else
   * (roster, colleagues, submission state, and any write that would resume the
   * course or start an exam) leaves this unset and gets a 403.
   */
  allowDeparted?: boolean;
}

/**
 * Resolves `{ user, profile }` for an authenticated caller with an allowed
 * role, or the exact NextResponse the original inline guard produced.
 *
 * Caller pattern:
 *   const auth = await requireRole({ ... });
 *   if (auth instanceof NextResponse) return auth;
 *   const { user, profile } = auth;
 */
export async function requireRole(
  opts: RequireRoleOptions
): Promise<{ user: User; profile: GuardProfile } | NextResponse> {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return unauthorized(opts.unauthorizedMessage);
  }

  // Re-read role from profiles — do not trust the JWT claim alone.
  const profileDb = opts.profileClient === 'service' ? createServiceDb() : supabase;

  // T-46a — membership is read on every guarded request, so `departed_at` is
  // appended to whatever column list the route asked for. Appending rather than
  // requiring each of the 22 call sites to remember it is the whole point: a
  // route that forgets cannot accidentally skip the check.
  const columns = opts.columns
    .split(',')
    .map((c) => c.trim())
    .includes(DEPARTED_AT_COLUMN)
    ? opts.columns
    : `${opts.columns}, ${DEPARTED_AT_COLUMN}`;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: profileRaw, error } = await (profileDb as any)
    .from('profiles')
    .select(columns)
    .eq('id', user.id)
    .single();

  if (error || !profileRaw) {
    const missing = opts.onMissingProfile ?? 'unauthorized';
    if (missing === 'unauthorized') return unauthorized(opts.unauthorizedMessage);
    if (missing === 'forbidden') return forbidden(opts.forbiddenMessage);
    return jsonError(missing.status, missing.message);
  }

  const profile = profileRaw as GuardProfile;

  if (!opts.roles.includes(profile.role)) {
    return forbidden(opts.forbiddenMessage);
  }

  // T-46a — THE READ-CUT. This runs before the route touches the database, so a
  // departed caller never reaches a restaurant-scoped query at all. Cutting the
  // query rather than disabling a button is the requirement: a page that still
  // fetches the restaurant's rows is a data leak whatever it renders.
  //
  // Ordering is deliberate. It sits AFTER the role check so a departed learner
  // hitting a manager-only route still gets the historical 403-for-wrong-role
  // rather than leaking that this specific account is departed, and BEFORE
  // requireRestaurant because departure is the stronger refusal of the two.
  // The `?? null` is the one place an absent property is normalised to
  // "current", and it is safe only here: this function appends the column
  // itself, and if the column did not exist in the database PostgREST would
  // have failed the select above (42703) rather than returning a row without
  // it. Everywhere else the strict predicate applies unchanged, so there is
  // still exactly one definition of membership.
  const departedAt = (profile as { departed_at?: string | null }).departed_at ?? null;
  if (!opts.allowDeparted && !isCurrentStaff({ departed_at: departedAt })) {
    return forbidden(DEPARTED_FORBIDDEN_MESSAGE);
  }

  if (opts.requireRestaurant && !profile.restaurant_id) {
    return jsonError(opts.requireRestaurant.status, opts.requireRestaurant.message);
  }

  return { user, profile };
}
