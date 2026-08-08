/**
 * lib/account/deletion-warnings.ts
 *
 * P1-16 Concern 1 — sole-admin pre-warning at request phase.
 *
 * Returns one entry per active-subscription restaurant where the
 * requesting user is the only admin. Surfaced in the request-phase
 * response so the UI can render the implication BEFORE the
 * confirmation email is sent. DOES NOT block deletion — GDPR Art. 17
 * right to erasure does not bend on internal admin convenience.
 *
 * Pure logic on top of a tiny query surface so it's trivially unit-
 * testable without a real DB. The integration test in
 * tests/integration/account-deletion-warnings.test.ts validates the
 * end-to-end shape with a mocked Supabase client.
 */

import type { createServiceSupabase } from '@/lib/supabase/server';

type ServiceDb = ReturnType<typeof createServiceSupabase>;

/**
 * Generate the user-facing warnings list for a profile that is about
 * to request its own deletion.
 *
 * Rule (per (g.bis) Concern 1):
 *   1. For the requesting profile, list restaurants where the user
 *      holds role='manager'.
 *   2. For each such restaurant, count other managers.
 *   3. For each restaurant where other-manager count is 0 AND the
 *      restaurant has an active subscription → append one warning.
 *
 * Returns an empty array if the user is not a sole manager of any
 * subscribed restaurant.
 */
export async function buildDeletionWarnings(db: ServiceDb, profileId: string): Promise<string[]> {
  // 1. Restaurants where this profile is a manager.
  const { data: adminships, error: e1 } = await db
    .from('profiles')
    .select('restaurant_id, role')
    .eq('id', profileId);

  if (e1 || !adminships) return [];

  const restaurantIds = adminships
    .filter((p) => (p as { role?: string }).role === 'manager')
    .map((p) => (p as { restaurant_id?: string }).restaurant_id)
    .filter((id): id is string => typeof id === 'string' && id.length > 0);

  if (restaurantIds.length === 0) return [];

  const warnings: string[] = [];

  for (const restaurantId of restaurantIds) {
    // 2. Count OTHER managers on this restaurant.
    const { data: peers } = await db
      .from('profiles')
      .select('id')
      .eq('restaurant_id', restaurantId)
      .eq('role', 'manager')
      .neq('id', profileId);

    const otherAdminCount = peers?.length ?? 0;
    if (otherAdminCount > 0) continue;

    // 3. Active subscription?
    const { data: subs } = await db
      .from('subscriptions')
      .select('id, status')
      .eq('restaurant_id', restaurantId)
      .eq('status', 'active')
      .limit(1);

    if (!subs || subs.length === 0) continue;

    // 4. Resolve restaurant name for the warning string.
    const { data: restaurant } = await db
      .from('restaurants')
      .select('name')
      .eq('id', restaurantId)
      .single();

    const name = (restaurant as { name?: string } | null)?.name ?? 'an active restaurant';

    warnings.push(
      `You are the sole admin on ${name}. Deleting your account will leave this restaurant without administrative access.`
    );
  }

  return warnings;
}
