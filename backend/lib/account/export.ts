/**
 * lib/account/export.ts
 *
 * P1-16 — GDPR Art. 15 + 20 data portability export.
 *
 * Single service-role read across the seven PII-bearing surfaces,
 * issued in parallel and assembled into one JSON document with an
 * embedded `schema` block so the recipient (user or counsel) can
 * interpret each field.
 *
 * Snapshot semantics — reads happen at request time; no streaming.
 * The whole payload fits in a single HTTP response.
 */

import type { createServiceSupabase } from '@/lib/supabase/server';

type ServiceDb = ReturnType<typeof createServiceSupabase>;

export interface AccountExport {
  schema: {
    version: number;
    generatedAt: string;
    subject: {
      profileId: string;
      email: string;
    };
    fields: Record<string, string>;
  };
  profile: Record<string, unknown> | null;
  certificates: Record<string, unknown>[];
  examAttempts: Record<string, unknown>[];
  lessonProgress: Record<string, unknown>[];
  invitesSent: Record<string, unknown>[];
  invitesReceived: Record<string, unknown>[];
  activityEvents: Record<string, unknown>[];
}

/**
 * Top-level schema field documentation. Lives next to the data in the
 * exported JSON so a downstream reader doesn't need access to this
 * codebase to understand the export.
 */
const SCHEMA_FIELDS: Record<string, string> = {
  profile:
    "Your account record: full name, login email, role (admin / learner / reviewer), and timestamps. Roster CSVs you uploaded on behalf of a restaurant are governed by the restaurant's retention policy and are not included here.",
  certificates:
    'AllergenWise certifications issued to you, including cert code, status, dates, the restaurant they were issued for, and (when present) the link to the exam attempt that produced them.',
  examAttempts:
    'Each exam you started, when you submitted it, your score, pass/fail, and the answers you selected (if retained at the time of the attempt).',
  lessonProgress:
    'Per-lesson watch progress and completion timestamps across the five-module course.',
  invitesSent:
    'For admin accounts: every employee invite you issued, including invitee email, the date sent, and whether it was accepted.',
  invitesReceived:
    'If your account was created via an invite, the metadata of that invite (date, inviting user, acceptance date).',
  activityEvents:
    'Append-only audit log of every action you performed inside AllergenWise (lessons completed, exams passed/failed, invites sent, decisions made).',
};

export async function buildAccountExport(db: ServiceDb, profileId: string): Promise<AccountExport> {
  // Read all surfaces in parallel — snapshot semantics.
  const [profileRes, certsRes, attemptsRes, progressRes, invitesSentRes, activityRes] =
    await Promise.all([
      db.from('profiles').select('*').eq('id', profileId).single(),
      db
        .from('certificates')
        .select(
          'id, cert_code, status, issued_at, expires_at, restaurant_id, exam_attempt_id, fee_charged_cents, pdf_storage_path'
        )
        .eq('profile_id', profileId),
      db
        .from('exam_attempts')
        .select('id, started_at, submitted_at, time_limit_seconds, score_percent, passed, answers')
        .eq('profile_id', profileId),
      db
        .from('lesson_progress')
        .select('lesson_id, status, watched_seconds, completed_at')
        .eq('profile_id', profileId),
      db.from('profiles').select('id, email, invited_at, accepted_at').eq('invited_by', profileId),
      db
        .from('activity_events')
        .select('id, type, payload, created_at, restaurant_id')
        .eq('actor_id', profileId),
    ]);

  const profile = profileRes.data as
    | (Record<string, unknown> & {
        invited_by?: string | null;
        invited_at?: string | null;
        accepted_at?: string | null;
        email?: string;
      })
    | null;

  // invitesReceived: the profile row itself carries the invitation
  // metadata in `invited_at` / `accepted_at` / `invited_by`.
  const invitesReceived: Record<string, unknown>[] =
    profile && profile.invited_at
      ? [
          {
            invitedAt: profile.invited_at,
            invitedBy: profile.invited_by ?? null,
            acceptedAt: profile.accepted_at ?? null,
          },
        ]
      : [];

  return {
    schema: {
      version: 1,
      generatedAt: new Date().toISOString(),
      subject: {
        profileId,
        email: (profile?.email as string | undefined) ?? '',
      },
      fields: SCHEMA_FIELDS,
    },
    profile: profile ?? null,
    certificates: (certsRes.data ?? []) as Record<string, unknown>[],
    examAttempts: (attemptsRes.data ?? []) as Record<string, unknown>[],
    lessonProgress: (progressRes.data ?? []) as Record<string, unknown>[],
    invitesSent: (invitesSentRes.data ?? []) as Record<string, unknown>[],
    invitesReceived,
    activityEvents: (activityRes.data ?? []) as Record<string, unknown>[],
  };
}
