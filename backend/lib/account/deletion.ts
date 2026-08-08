/**
 * lib/account/deletion.ts
 *
 * P1-16 — execute the GDPR Path 1 deletion sequence.
 *
 * Ordering (matters for failure-recovery semantics):
 *
 *   1. Collect cert PDF storage paths BEFORE the SQL function deletes
 *      the certificate rows — otherwise we lose the paths and orphan
 *      the blobs in storage.
 *
 *   2. Ban + blank `auth.users` via the Supabase admin API.
 *      Idempotent on retry (Supabase tolerates re-bans).
 *
 *   3. Call the `account_delete_user` plpgsql function via rpc().
 *      Single Postgres transaction. Mid-failure → full rollback.
 *
 *   4. Best-effort storage cleanup for the PDF blobs we collected in
 *      step 1. Idempotent — Supabase storage `.remove([])` is a no-op
 *      on already-missing paths.
 *
 * Failure-recovery property: if step 2 succeeds and step 3 fails, the
 * user is banned but DB state is intact — operator can retry. If
 * step 2 fails, no DB-side change occurred and the user can be
 * informed. The pathological "data deleted but login still works"
 * state cannot arise.
 */

import type { createServiceSupabase } from '@/lib/supabase/server';

type ServiceDb = ReturnType<typeof createServiceSupabase>;

export interface DeletionInput {
  profileId: string;
  deletionRequestId: string;
}

export interface DeletionResult {
  ok: boolean;
  anonymizedEmail: string;
  removedPdfPaths: string[];
  error?: string;
}

/**
 * Build the anonymized email used to blank both `profiles.email` and
 * `auth.users.email`. Per the design doc: `deleted-<uuid>@deleted.invalid`.
 * The TLD `.invalid` is reserved by RFC 2606 — guaranteed to never
 * resolve, so no future email delivery can leak to it.
 */
export function buildAnonymizedEmail(profileId: string): string {
  return `deleted-${profileId}@deleted.invalid`;
}

export async function executeAccountDeletion(
  db: ServiceDb,
  input: DeletionInput
): Promise<DeletionResult> {
  const anonymizedEmail = buildAnonymizedEmail(input.profileId);

  // ── 1. Collect cert PDF paths before the SQL function deletes them ─────
  const { data: certPaths } = await db
    .from('certificates')
    .select('pdf_storage_path')
    .eq('profile_id', input.profileId);

  const pdfPaths: string[] = (certPaths ?? [])
    .map((c) => (c as { pdf_storage_path?: string | null }).pdf_storage_path)
    .filter((p): p is string => typeof p === 'string' && p.length > 0);

  // ── 2. Ban + blank the auth user FIRST so login is severed even if ─────
  // the SQL function fails. Recovery-safe: a banned user with intact
  // data can be unbanned by ops; the inverse (data deleted, login
  // working) is much worse.
  try {
    await db.auth.admin.updateUserById(input.profileId, {
      email: anonymizedEmail,
      ban_duration: '876600h', // 100 years — effectively forever.
      user_metadata: { deleted: true, deleted_at: new Date().toISOString() },
    } as unknown as Parameters<typeof db.auth.admin.updateUserById>[1]);
  } catch (err) {
    return {
      ok: false,
      anonymizedEmail,
      removedPdfPaths: [],
      error: err instanceof Error ? err.message : 'auth update failed',
    };
  }

  // ── 3. Single-transaction DB deletion via SECURITY DEFINER RPC ────────
  const rpcResult = await (
    db as unknown as {
      rpc(
        name: string,
        args: Record<string, unknown>
      ): Promise<{ error: { message: string } | null }>;
    }
  ).rpc('account_delete_user', {
    p_profile_id: input.profileId,
    p_anonymized_email: anonymizedEmail,
    p_deletion_request_id: input.deletionRequestId,
  });

  if (rpcResult.error) {
    return {
      ok: false,
      anonymizedEmail,
      removedPdfPaths: [],
      error: rpcResult.error.message,
    };
  }

  // ── 4. Best-effort PDF blob cleanup. Idempotent. Storage failures ─────
  // do not undo the DB-side deletion that already committed.
  const removed: string[] = [];
  if (pdfPaths.length > 0) {
    try {
      const { error: storageErr } = await db.storage.from('certificates').remove(pdfPaths);
      if (!storageErr) removed.push(...pdfPaths);
    } catch (err) {
      console.error('[account-deletion] storage cleanup failed:', err);
    }
  }

  return { ok: true, anonymizedEmail, removedPdfPaths: removed };
}
