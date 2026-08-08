/**
 * lib/reviewer/decide.ts
 *
 * Pure decision orchestration for reviewer submission decisions.
 *
 * Responsibilities:
 *  1. Call the decide_submission Postgres RPC (single transaction).
 *  2. After the transaction commits, send the appropriate Resend email.
 *     Email failure is logged but does NOT roll back the already-committed decision.
 *     The caller receives `{ ok: true, emailQueued: false }` when email fails.
 *
 * This module is pure server-side orchestration — no HTTP, no Next.js primitives.
 * Route handlers call decideSubmission(); tests mock its dependencies.
 *
 * Note: All supabase queries use explicit local types because the Database interface
 * in lib/types/db.ts omits `Relationships` arrays required for @supabase/supabase-js
 * v2 generics to infer column subsets.
 */

import { createServiceSupabase } from '@/lib/supabase/server';
import { sendEmail } from '@/lib/email/send';

// ─── Types ────────────────────────────────────────────────────────────────────

export type DecisionAction = 'approve' | 'reject' | 'request_info';

export interface DecisionInput {
  submissionId: string;
  reviewerId: string;
  action: DecisionAction;
  notes?: string;
}

export interface DecisionResult {
  ok: true;
  restaurantSlug?: string;
  listingExpiresAt?: string;
  emailQueued: boolean;
}

/** Shape returned by the decide_submission RPC */
interface RpcResult {
  ok: boolean;
  restaurantSlug?: string;
  listingExpiresAt?: string;
}

/** Local row shapes for supabase queries (explicit — bypasses broken generic inference) */
interface SubmissionContactRow {
  restaurant_id: string;
  submitted_by: string;
}

interface RestaurantNameRow {
  name: string;
}
interface ProfileContactRow {
  email: string;
  full_name: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

interface AdminContact {
  email: string;
  fullName: string;
  restaurantName: string;
}

/**
 * Loads the admin contact for a given submission.
 * Uses service-role to bypass RLS.
 */
async function loadAdminContact(submissionId: string): Promise<AdminContact | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = createServiceSupabase() as any;

  // Load submission → restaurant name + submitter profile
  const { data: submissionRaw, error: subErr } = await supabase
    .from('submissions')
    .select('restaurant_id, submitted_by')
    .eq('id', submissionId)
    .single();

  if (subErr || !submissionRaw) return null;
  const submission = submissionRaw as SubmissionContactRow;

  const [restaurantRes, profileRes] = await Promise.all([
    supabase
      .from('restaurants')
      .select('name')
      .eq('id', submission.restaurant_id)
      .single() as Promise<{ data: RestaurantNameRow | null; error: { message: string } | null }>,
    supabase
      .from('profiles')
      .select('email, full_name')
      .eq('id', submission.submitted_by)
      .single() as Promise<{ data: ProfileContactRow | null; error: { message: string } | null }>,
  ]);

  if (restaurantRes.error || !restaurantRes.data) return null;
  if (profileRes.error || !profileRes.data) return null;

  return {
    email: profileRes.data.email,
    fullName: profileRes.data.full_name,
    restaurantName: restaurantRes.data.name,
  };
}

// ─── Main export ──────────────────────────────────────────────────────────────

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://allergenwise.com';

/**
 * Executes a reviewer decision on a submission.
 *
 * Transaction safety: the entire DB mutation runs in decide_submission() — a
 * Postgres function in a single transaction. The email is sent AFTER the
 * transaction commits. If the email fails, the decision stands (per plan §5.5).
 * Email failure is logged; the returned result signals `emailQueued: false`.
 *
 * @throws Error if the RPC call fails (DB error, invalid action, bad submissionId).
 *         Does NOT throw if email delivery fails (logs instead, returns emailQueued: false).
 */
export async function decideSubmission(input: DecisionInput): Promise<DecisionResult> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = createServiceSupabase() as any;

  // ── 1. Execute the transactional DB decision ──────────────────────────────
  const { data: rpcData, error: rpcError } = await (supabase.rpc('decide_submission', {
    p_submission_id: input.submissionId,
    p_reviewer_id: input.reviewerId,
    p_action: input.action,
    p_notes: input.notes ?? null,
  }) as Promise<{ data: unknown; error: { message: string } | null }>);

  if (rpcError) {
    throw new Error(`decide_submission RPC failed: ${rpcError.message}`);
  }

  const result = rpcData as RpcResult;
  if (!result?.ok) {
    throw new Error('decide_submission returned ok=false');
  }

  // ── 2. Enqueue email after transaction commits ─────────────────────────────
  let emailQueued = false;
  let contact: AdminContact | null = null;

  try {
    contact = await loadAdminContact(input.submissionId);
  } catch (err) {
    console.error('[decide] Failed to load admin contact for email:', err);
  }

  if (contact) {
    try {
      await sendDecisionEmail({
        action: input.action,
        contact,
        notes: input.notes,
        restaurantSlug: result.restaurantSlug,
        listingExpiresAt: result.listingExpiresAt,
      });
      emailQueued = true;
    } catch (err) {
      // Email failure is intentionally non-fatal — the decision is already committed.
      console.error('[decide] Email delivery failed (decision already committed):', err);
    }
  }

  return {
    ok: true,
    restaurantSlug: result.restaurantSlug,
    listingExpiresAt: result.listingExpiresAt,
    emailQueued,
  };
}

// ─── Email dispatch ───────────────────────────────────────────────────────────

interface SendEmailParams {
  action: DecisionAction;
  contact: AdminContact;
  notes?: string;
  restaurantSlug?: string;
  listingExpiresAt?: string;
}

async function sendDecisionEmail({
  action,
  contact,
  notes,
  restaurantSlug,
  listingExpiresAt,
}: SendEmailParams): Promise<void> {
  const { email, fullName, restaurantName } = contact;
  const dashboardUrl = `${APP_URL}/admin/dashboard`;
  let result: Awaited<ReturnType<typeof sendEmail>>;

  switch (action) {
    case 'approve': {
      if (!restaurantSlug || !listingExpiresAt) {
        throw new Error('approve email missing slug or expiry');
      }
      const listingUrl = `${APP_URL}/directory/${restaurantSlug}`;
      const expiresFormatted = new Date(listingExpiresAt).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      });

      result = await sendEmail('RestaurantApproved', email, {
        adminName: fullName,
        restaurantName,
        listingUrl,
        listingExpiresAt: expiresFormatted,
      });
      break;
    }

    case 'reject': {
      result = await sendEmail('RestaurantRejected', email, {
        adminName: fullName,
        restaurantName,
        reviewerNotes: notes ?? 'No specific notes were provided.',
      });
      break;
    }

    case 'request_info': {
      result = await sendEmail('RestaurantInfoRequested', email, {
        adminName: fullName,
        restaurantName,
        reviewerNotes: notes ?? 'Please contact us for more details.',
        resubmitLink: `${dashboardUrl}/submit`,
      });
      break;
    }

    default: {
      result = { ok: false, error: `Unknown action: ${action as string}` };
    }
  }

  if (!result.ok) {
    throw new Error(`Email send failed: ${result.error}`);
  }
}
