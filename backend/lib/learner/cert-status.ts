/**
 * lib/learner/cert-status.ts
 *
 * Single source of truth for "is this cert publicly active?" reads.
 *
 * Every consumer (verify endpoint, directory count, search count, learner
 * certificate page, learner home-data) MUST go through this helper. No
 * route handler does ad-hoc `.eq('status', 'active')` or in-memory status
 * computation.
 *
 * The helper exists to make the F-S2/F-S3/F-S4/F-S5 anti-pattern (naked
 * status reads + missing expiry pair) physically uncallable. Combined with
 * migration 0013 dropping the `revoked` column, every old call site that
 * read `revoked = false` fails at compile time.
 *
 * For raw-SQL contexts (lib/directory/search.ts) where the helper can't be
 * called, the WHERE predicate `status = 'active'` is the same canonical
 * predicate this helper uses internally.
 */

import 'server-only';
import type { ServiceDb } from '@/lib/db/service';
import type { CertStatus } from '@/lib/learner/cert-state';

// ─── Public-active set ────────────────────────────────────────────────────────

/**
 * The publicly-active set now lives in lib/learner/cert-state.ts and is
 * re-exported here so this stays its documented home. It moved because this
 * file is `server-only`: the constant could not be imported by
 * lib/staff/membership.ts (shared) or lib/directory/search.ts (a pure SQL
 * builder), which is why four count sites hand-wrote 'active' rather than
 * importing it. See T-23.
 */
export { PUBLICLY_ACTIVE_STATUSES, isPubliclyActiveCert } from '@/lib/learner/cert-state';

// ─── Returned shapes ──────────────────────────────────────────────────────────

export interface LearnerCertSummary {
  id: string;
  cert_code: string;
  status: CertStatus;
  issued_at: string;
  expires_at: string;
  pdf_storage_path: string | null;
  restaurant_id: string;
}

export interface LatestActiveCert {
  id: string;
  cert_code: string;
  issued_at: string;
  expires_at: string;
  pdf_storage_path: string | null;
  restaurant_id: string;
}

// ─── countPubliclyActiveCerts ────────────────────────────────────────────────

/**
 * Returns the count of currently-publicly-active certs for a restaurant.
 * Backs the directory + search + verify surfaces.
 */
export async function countPubliclyActiveCerts(
  db: ServiceDb,
  restaurantId: string
): Promise<number> {
  const { count, error } = await db
    .from('certificates')
    .select('id', { count: 'exact', head: true })
    .eq('restaurant_id', restaurantId)
    .eq('status', 'active');

  if (error) {
    throw new Error(`countPubliclyActiveCerts failed: ${error.message}`);
  }
  return (count as number | null) ?? 0;
}

// ─── getLatestActiveCertForLearner ───────────────────────────────────────────

/**
 * Returns the latest (by issued_at desc) cert for a learner whose status is
 * `active`. Returns null if none.
 */
export async function getLatestActiveCertForLearner(
  db: ServiceDb,
  profileId: string
): Promise<LatestActiveCert | null> {
  const { data, error } = await db
    .from('certificates')
    .select('id, cert_code, issued_at, expires_at, pdf_storage_path, restaurant_id')
    .eq('profile_id', profileId)
    .eq('status', 'active')
    .order('issued_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`getLatestActiveCertForLearner failed: ${error.message}`);
  }
  return (data as LatestActiveCert | null) ?? null;
}

// ─── getAllCertsForLearner ────────────────────────────────────────────────────

/**
 * Returns ALL certs for a learner, including pending/expired/revoked, so the
 * learner dashboard can show the full history with appropriate UI state.
 * Used by /api/learner/home-data and /api/learner/certificate.
 */
export async function getAllCertsForLearner(
  db: ServiceDb,
  profileId: string
): Promise<LearnerCertSummary[]> {
  const { data, error } = await db
    .from('certificates')
    .select('id, cert_code, status, issued_at, expires_at, pdf_storage_path, restaurant_id')
    .eq('profile_id', profileId)
    .order('issued_at', { ascending: false });

  if (error) {
    throw new Error(`getAllCertsForLearner failed: ${error.message}`);
  }
  return (data as LearnerCertSummary[] | null) ?? [];
}
