/**
 * lib/db/service.ts
 *
 * Type-safe wrapper around createServiceSupabase() that works correctly with
 * hand-written Database schemas.
 *
 * ROOT CAUSE:
 * Supabase @supabase/postgrest-js v2 PostgREST v12 requires Table.Row to satisfy
 * `Record<string, unknown>` (i.e., have an explicit index signature).
 * TypeScript `interface` declarations do NOT implicitly satisfy `Record<string, unknown>`
 * — you need `{ [key: string]: unknown }`. Our hand-written interfaces in
 * lib/types/db.ts (Profile, Restaurant, etc.) are plain interfaces without index
 * signatures, so they fail the GenericTable constraint and every query result
 * resolves to `never`.
 *
 * This wrapper bypasses the broken type inference by returning the `from()` builder
 * typed as `any`. Runtime behavior is 100% identical — only the TypeScript
 * static typing changes. The data shapes are verified at read points with explicit
 * inline type assertions.
 *
 * READ-ONLY CONSTRAINT: lib/types/db.ts and lib/supabase/* cannot be modified.
 * This wrapper is the correct solution within those constraints.
 *
 * Usage:
 *   import { createServiceDb } from '@/lib/db/service';
 *   const db = createServiceDb();
 *   const { data, error } = await db.from('profiles').select('id, role').single();
 *   // data is typed as `any` — add inline type assertion where needed:
 *   //   as DbRow<'profiles'>
 */
import 'server-only';
import { createServiceSupabase } from '@/lib/supabase/server';
import type {
  Profile,
  Restaurant,
  Subscription,
  Module,
  Lesson,
  LessonProgress,
  ExamAttempt,
  Question,
  QuestionChoice,
  QuizAttempt,
  QuizAttemptAnswer,
  Certificate,
  Submission,
  Review,
  ActivityEvent,
  StripeEvent,
  CsvUploadDraft,
  ReviewRateLimit,
} from '@/lib/types/db';

// ─── Row type helpers ─────────────────────────────────────────────────────────
// Use these for inline type assertions on query results.

export type DbTables = {
  profiles: Profile;
  restaurants: Restaurant;
  subscriptions: Subscription;
  modules: Module;
  lessons: Lesson;
  lesson_progress: LessonProgress;
  exam_attempts: ExamAttempt;
  questions: Question;
  question_choices: QuestionChoice;
  quiz_attempts: QuizAttempt;
  quiz_attempt_answers: QuizAttemptAnswer;
  certificates: Certificate;
  submissions: Submission;
  reviews: Review;
  activity_events: ActivityEvent;
  stripe_events: StripeEvent;
  csv_upload_drafts: CsvUploadDraft;
  review_rate_limits: ReviewRateLimit;
};

export type DbRow<T extends keyof DbTables> = DbTables[T];

// ─── Wrapper ──────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyBuilder = any;

/**
 * Returns the service-role Supabase client with `from()` typed as `any`.
 * All other methods (auth.admin, storage, rpc) retain their proper types.
 * Use explicit type assertions at read points for type safety.
 */
export function createServiceDb() {
  const client = createServiceSupabase();

  return {
    // Pass through all client methods at their original types
    auth: client.auth,
    storage: client.storage,
    rpc: client.rpc.bind(client) as typeof client.rpc,
    channel: client.channel.bind(client) as typeof client.channel,
    removeChannel: client.removeChannel.bind(client) as typeof client.removeChannel,
    removeAllChannels: client.removeAllChannels.bind(client) as typeof client.removeAllChannels,
    getChannels: client.getChannels.bind(client) as typeof client.getChannels,

    // Override `from` with `any` typing to bypass broken PostgREST v12 inference
    from: (table: string): AnyBuilder => client.from(table as Parameters<typeof client.from>[0]),
  };
}

export type ServiceDb = ReturnType<typeof createServiceDb>;
