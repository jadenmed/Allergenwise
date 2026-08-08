// ─── AllergenWise — Database Type Definitions ─────────────────────────────────
// Keep in sync with db/migrations/0001_init.sql.
// Phase 1 agents import from here; do not duplicate types in feature files.

// ─── Enums ────────────────────────────────────────────────────────────────────

export type Role = 'manager' | 'learner' | 'reviewer';

export type RestaurantStatus =
  | 'unlisted'
  | 'pending_review'
  | 'in_review'
  | 'listed'
  | 'paused'
  | 'rejected';

export type SubscriptionStatus = 'active' | 'expired' | 'canceled';

export type SubscriptionPlan = 'quarterly' | 'semiannual';

export type LessonStatus = 'not_started' | 'in_progress' | 'complete';

export type SubmissionStatus = 'pending' | 'in_review' | 'approved' | 'rejected' | 'info_requested';

/**
 * Wave 2C cert state machine (5 states).
 *
 *   pending  — cert exists, no payment confirmed yet (invisible publicly)
 *   active   — paid, valid, within window
 *   expired  — past expires_at (cron-flipped, not in-memory-computed)
 *   revoked  — manual admin OR refund OR dispute_lost
 *   disputed — chargeback dispute open; publicly displayed as revoked
 *
 * The legacy 'valid' state has been replaced by 'active'. Helpers in
 * `lib/learner/cert-status.ts` are the single source of truth for "is this
 * cert publicly active?" reads.
 */
export type CertificateStatus = 'pending' | 'active' | 'expired' | 'revoked' | 'disputed';

export type CertRevocationReason = 'refund' | 'dispute_lost' | 'admin' | 'expired';

export type ReviewStatus = 'pending' | 'published' | 'hidden';

export type ExamDifficulty = 'easy' | 'medium' | 'hard';

export type Allergen =
  | 'peanut'
  | 'tree_nut'
  | 'dairy'
  | 'egg'
  | 'wheat'
  | 'soy'
  | 'fish'
  | 'shellfish'
  | 'sesame';

export type ActivityEventType =
  | 'lesson_completed'
  | 'lesson_quiz_completed' // shared question bank (0018) — quiz submitted
  | 'exam_passed'
  | 'exam_failed'
  | 'invite_sent'
  | 'invite_accepted'
  // ─── Auth / invite rate limits (Wave-gate P1 — P1-14) ────────────────────
  | 'signup_rate_limited'
  | 'signup_rate_limiter_down'
  | 'signup_email_exists'
  | 'signup_auth_error'
  | 'invite_accept_rate_limited'
  | 'invite_accept_rate_limiter_down'
  | 'invite_send_rate_limited'
  | 'invite_send_rate_limiter_down'
  // ─── Account deletion / export (Wave-gate P1 — P1-16) ───────────────────
  | 'account_deletion_requested'
  | 'account_deletion_confirmed'
  | 'account_deletion_cancelled'
  | 'account_deletion_confirm_invalid'
  | 'account_deletion_request_rate_limited'
  | 'account_deletion_confirm_rate_limited'
  | 'account_deletion_request_rate_limiter_down'
  | 'account_deletion_confirm_rate_limiter_down'
  | 'account_deleted'
  | 'account_export_requested'
  | 'account_export_rate_limited'
  | 'account_export_rate_limiter_down'
  // ─── Public cert verification rate limits ───────────────────────────────
  | 'cert_verify_rate_limited'
  | 'cert_verify_rate_limiter_down'
  // ─── Cert lifecycle (Wave 2C) ────────────────────────────────────────────
  | 'cert_issued' // pending insertion at exam pass
  | 'cert_activated' // pending → active via cert-fee PI
  | 'cert_expired' // active → expired via cron
  | 'cert_revoked' // * → revoked (refund/dispute_lost/admin)
  | 'cert_disputed' // active → disputed via dispute.created
  | 'cert_dispute_resolved' // disputed → active (won/warning_closed)
  | 'cert_dispute_funds_withdrawn' // log-only
  | 'cert_dispute_funds_reinstated' // log-only
  | 'cert_payment_canceled' // payment_intent.canceled
  | 'cert_payment_failed' // payment_intent.payment_failed
  | 'cert_payment_orphaned' // PI succeeded but 0 pending certs
  | 'cert_state_transition_blocked' // illegal transition rejected by helper
  | 'cert_purged' // pending TTL expiry
  | 'cert_state_reconciled' // reconciliation script transition
  // ─── Roster membership (T-46a) ──────────────────────────────────────────
  | 'staff_departed' // manager removed someone from the roster
  | 'staff_restored' // …and undid it
  // ─── Submission / restaurant / subscription ─────────────────────────────
  | 'submission_created'
  | 'submission_approved'
  | 'submission_rejected'
  | 'restaurant_listed'
  | 'restaurant_paused'
  | 'subscription_created'
  | 'subscription_expired';

// ─── Table row types ──────────────────────────────────────────────────────────

export type Restaurant = {
  id: string;
  slug: string;
  name: string;
  cuisine: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  lat: number | null;
  lng: number | null;
  phone: string | null;
  website: string | null;
  hero_photo_url: string | null;
  about: string | null;
  hours_json: Record<string, { open: string; close: string }> | null;
  allergen_specialties: string[] | null;
  status: RestaurantStatus;
  listed_at: string | null;
  listing_expires_at: string | null;
  stripe_customer_id: string | null;
  /** Added by 0020_partner_attribution.sql. */
  brand_id: string | null;
  created_at: string;
};

export type Profile = {
  id: string;
  full_name: string;
  email: string;
  role: Role;
  restaurant_id: string | null;
  job_role: string | null;
  invited_at: string | null;
  invited_by: string | null;
  accepted_at: string | null;
  /** Added by 0005_invite_tokens.sql. */
  invite_token: string | null;
  /** Added by 0020_partner_attribution.sql; set only for partner-scoped profiles. */
  partner_id: string | null;
  /**
   * Added by 0026_profiles_departed_at.sql. NULL = current staff, and that is
   * the ONLY membership predicate — restaurant_id stays populated after
   * departure. Never compare this inline; use lib/staff/membership.ts so the
   * eight call sites that count staff cannot drift apart.
   */
  departed_at: string | null;
  created_at: string;
};

export type Subscription = {
  id: string;
  restaurant_id: string;
  plan: SubscriptionPlan;
  starts_at: string;
  ends_at: string;
  amount_cents: number;
  status: SubscriptionStatus;
  stripe_subscription_id: string | null;
  stripe_invoice_id: string | null;
  auto_renew: boolean;
  created_at: string;
};

export type Module = {
  id: string;
  order_index: number;
  title: string;
  description: string | null;
  estimated_minutes: number | null;
};

export interface QuickCheckOption {
  text: string;
  correct: boolean;
}

export type Lesson = {
  id: string;
  module_id: string;
  order_index: number;
  title: string;
  body_md: string | null;
  video_mux_playback_id: string | null;
  video_duration_seconds: number | null;
  quick_check_question: string | null;
  quick_check_options: QuickCheckOption[] | null;
};

/**
 * The in-memory option shape consumed by the pure scorers
 * (`lib/learner/exam.ts:scoreExam`, `lib/learner/quiz.ts:scoreQuiz`). Built
 * server-side from `question_choices` rows; `correct` is never sent to clients.
 */
export interface ExamQuestionOption {
  id: string;
  text: string;
  correct: boolean;
}

// ─── Shared question bank (0018_shared_question_bank) ─────────────────────────
//
// One bank powers both lesson checkpoint quizzes and the final exam. Replaces
// the legacy `exam_questions` table (folded in + dropped by migration 0018).

export type Question = {
  id: string;
  prompt: string;
  /** NULL = exam-only pool (not tied to a lesson). */
  lesson_id: string | null;
  /** Kept for the exam's 5-per-module randomization. */
  module_id: string | null;
  difficulty: ExamDifficulty | null;
  /** Final exam draws only from rows where this is true. */
  is_exam_eligible: boolean;
  created_at: string;
  updated_at: string;
};

export type QuestionChoice = {
  id: string;
  question_id: string;
  text: string;
  is_correct: boolean;
  order_index: number;
  created_at: string;
};

export type QuizAttempt = {
  id: string;
  profile_id: string;
  lesson_id: string;
  started_at: string;
  submitted_at: string | null;
  score_percent: number | null;
  correct_count: number | null;
  total_count: number | null;
  updated_at: string;
};

export type QuizAttemptAnswer = {
  id: string;
  attempt_id: string;
  question_id: string;
  /** NULL = the learner left this question unanswered. */
  choice_id: string | null;
  is_correct: boolean;
  created_at: string;
};

export type LessonProgress = {
  id: string;
  profile_id: string;
  lesson_id: string;
  status: LessonStatus;
  watched_seconds: number;
  completed_at: string | null;
  started_at: string | null;
};

export type ExamAttempt = {
  id: string;
  profile_id: string;
  started_at: string;
  submitted_at: string | null;
  time_limit_seconds: number;
  score_percent: number | null;
  passed: boolean | null;
  answers: Record<string, string> | null;
  updated_at: string;
};

export type Certificate = {
  id: string;
  cert_code: string;
  profile_id: string;
  restaurant_id: string;
  exam_attempt_id: string | null;
  issued_at: string;
  expires_at: string;
  pdf_storage_path: string | null;
  /** Wave 2C: 5-state machine. Replaces legacy `revoked boolean`. */
  status: CertificateStatus;
  status_changed_at: string;
  revocation_reason: CertRevocationReason | null;
  dispute_id: string | null;
  disputed_at: string | null;
  fee_charged_cents: number | null;
  stripe_payment_intent_id: string | null;
  updated_at: string;
};

export type Submission = {
  id: string;
  restaurant_id: string;
  submitted_by: string;
  submitted_at: string;
  status: SubmissionStatus;
  reviewer_id: string | null;
  reviewer_notes: string | null;
  decided_at: string | null;
  cert_fee_total_cents: number | null;
  stripe_payment_intent_id: string | null;
  /**
   * T-41b: the Checkout Session that paid this submission's cert fees. UNIQUE
   * (migration 0024) — it is the webhook's idempotency key. NULL when no
   * Session was needed, i.e. a resubmission with zero pending certificates.
   */
  stripe_checkout_session_id: string | null;
};

export type Review = {
  id: string;
  restaurant_id: string;
  author_name: string;
  author_email: string | null;
  rating: number;
  body: string;
  allergen_context: string | null;
  status: ReviewStatus;
  created_at: string;
  updated_at: string;
};

export type ActivityEvent = {
  id: string;
  restaurant_id: string | null;
  actor_id: string | null;
  type: ActivityEventType;
  payload: Record<string, unknown> | null;
  created_at: string;
};

/**
 * Webhook delivery state (0023_webhook_retryability.sql).
 * Only 'completed' makes a redelivery a duplicate — 'pending' and 'failed' are
 * both retryable, which is what stops a transient fault dropping an event.
 */
export type StripeEventStatus = 'pending' | 'completed' | 'failed';

export type StripeEvent = {
  id: string;
  type: string;
  status: StripeEventStatus;
  /** Stamped on handler COMPLETION, never at insert. Null = not yet handled. */
  processed_at: string | null;
};

// ─── CSV upload drafts (added by 0006_csv_drafts.sql) ────────────────────────

export type CsvUploadDraft = {
  id: string;
  admin_id: string;
  restaurant_id: string;
  parsed: Array<{ email: string; fullName: string; jobRole: string }>;
  created_at: string;
  expires_at: string;
};

// ─── Review rate limits (added by 0008_review_rate_limits.sql) ───────────────

export type ReviewRateLimit = {
  ip: string;
  restaurant_id: string;
  last_at: string;
};

// ─── Account deletion tokens (added by 0016_account_deletion.sql) ────────────

export type AccountDeletionToken = {
  id: string;
  profile_id: string;
  /** sha256(token).hex — the raw token is never stored. */
  token_hash: string;
  issued_at: string;
  expires_at: string;
  used_at: string | null;
  used_reason: string | null;
  ip_hash: string | null;
};

// ─── Cert expiry warnings (added by 0010_cert_warnings.sql) ───────────────────

export type CertWarning = {
  cert_id: string;
  /** Days remaining at which the warning was sent: 30, 14, or 7. */
  threshold: number;
  sent_at: string;
};

// ─── Partner attribution (added by 0020_partner_attribution.sql) ──────────────

export type PartnerStatus = 'active' | 'inactive';

export type BrandAttributionStatus = 'active' | 'revoked';

export type Brand = {
  id: string;
  slug: string;
  name: string;
  created_at: string | null;
  updated_at: string | null;
};

export type Partner = {
  id: string;
  name: string;
  contact_email: string | null;
  default_commission_rate: number;
  status: PartnerStatus;
  created_at: string | null;
  updated_at: string | null;
};

export type BrandAttribution = {
  id: string;
  partner_id: string;
  brand_id: string;
  commission_rate: number;
  effective_date: string;
  status: BrandAttributionStatus;
  revoked_at: string | null;
  created_at: string | null;
  updated_at: string | null;
};

export type InvoicePayment = {
  id: string;
  restaurant_id: string;
  subscription_id: string | null;
  stripe_invoice_id: string;
  amount_cents: number;
  currency: string;
  commissionable: boolean;
  /** Collected timestamp — the commission gating field. */
  paid_at: string;
  created_at: string | null;
};

/** Row shape of the `commission_payouts` view (0020_partner_attribution.sql). */
export type CommissionPayout = {
  partner_id: string;
  brand_id: string;
  gross_collected_cents: number;
  rate: number;
  payout_amount_cents: number;
};

// ─── Database schema type (Supabase-style) ───────────────────────────────────
//
// Format matches what `supabase gen types` produces for @supabase/supabase-js v2.x.
//
// Required shape:
//   - __InternalSupabase: { PostgrestVersion: '12' }  — version hint for the
//     query-builder type inference in postgrest-js ≥2.x.
//   - public.Tables — each entry requires Row, Insert, Update, Relationships.
//   - public.Views — empty for MVP.
//   - public.Functions — empty for MVP.
//   - public.Enums, public.CompositeTypes — empty for MVP.
//
// The `Relationships` array on each table is empty ([]). We omit FK
// relationships for MVP; the PostgREST join-table type inference degrades
// gracefully to `unknown` when Relationships is empty.

export interface Database {
  // Internal Supabase type marker — required by @supabase/postgrest-js ≥2.x
  // for correct query-builder type inference.
  __InternalSupabase: {
    PostgrestVersion: '12';
  };
  public: {
    Tables: {
      restaurants: {
        Row: Restaurant;
        Insert: Omit<Restaurant, 'id' | 'created_at'>;
        Update: Partial<Omit<Restaurant, 'id' | 'created_at'>>;
        Relationships: [];
      };
      profiles: {
        Row: Profile;
        Insert: Omit<Profile, 'created_at'>;
        Update: Partial<Omit<Profile, 'id' | 'created_at'>>;
        Relationships: [];
      };
      subscriptions: {
        Row: Subscription;
        Insert: Omit<Subscription, 'id' | 'created_at'>;
        Update: Partial<Omit<Subscription, 'id' | 'created_at'>>;
        Relationships: [];
      };
      modules: {
        Row: Module;
        Insert: Omit<Module, 'id'>;
        Update: Partial<Omit<Module, 'id'>>;
        Relationships: [];
      };
      lessons: {
        Row: Lesson;
        Insert: Omit<Lesson, 'id'>;
        Update: Partial<Omit<Lesson, 'id'>>;
        Relationships: [];
      };
      questions: {
        Row: Question;
        Insert: Omit<Question, 'id' | 'created_at' | 'updated_at'>;
        Update: Partial<Omit<Question, 'id' | 'created_at' | 'updated_at'>>;
        Relationships: [];
      };
      question_choices: {
        Row: QuestionChoice;
        Insert: Omit<QuestionChoice, 'id' | 'created_at'>;
        Update: Partial<Omit<QuestionChoice, 'id' | 'created_at'>>;
        Relationships: [];
      };
      quiz_attempts: {
        Row: QuizAttempt;
        Insert: Omit<QuizAttempt, 'id' | 'started_at' | 'updated_at'>;
        Update: Partial<Omit<QuizAttempt, 'id' | 'started_at' | 'updated_at'>>;
        Relationships: [];
      };
      quiz_attempt_answers: {
        Row: QuizAttemptAnswer;
        Insert: Omit<QuizAttemptAnswer, 'id' | 'created_at'>;
        Update: Partial<Omit<QuizAttemptAnswer, 'id' | 'created_at'>>;
        Relationships: [];
      };
      lesson_progress: {
        Row: LessonProgress;
        Insert: Omit<LessonProgress, 'id'>;
        Update: Partial<Omit<LessonProgress, 'id'>>;
        Relationships: [];
      };
      exam_attempts: {
        Row: ExamAttempt;
        Insert: Omit<ExamAttempt, 'id' | 'started_at'>;
        Update: Partial<Omit<ExamAttempt, 'id' | 'started_at'>>;
        Relationships: [];
      };
      certificates: {
        Row: Certificate;
        Insert: Omit<Certificate, 'id' | 'issued_at'>;
        Update: Partial<Omit<Certificate, 'id' | 'issued_at'>>;
        Relationships: [];
      };
      submissions: {
        Row: Submission;
        Insert: Omit<Submission, 'id' | 'submitted_at'>;
        Update: Partial<Omit<Submission, 'id' | 'submitted_at'>>;
        Relationships: [];
      };
      reviews: {
        Row: Review;
        Insert: Omit<Review, 'id' | 'created_at' | 'updated_at'>;
        Update: Partial<Omit<Review, 'id' | 'created_at' | 'updated_at'>>;
        Relationships: [];
      };
      activity_events: {
        Row: ActivityEvent;
        // Only `type` is required; restaurant_id / actor_id / payload are
        // nullable columns and may be omitted at insert time.
        Insert: Pick<ActivityEvent, 'type'> &
          Partial<Omit<ActivityEvent, 'id' | 'created_at' | 'type'>>;
        // append-only: Update is a no-op shape required for GenericTable compat
        Update: Record<string, never>;
        Relationships: [];
      };
      stripe_events: {
        Row: StripeEvent;
        // processed_at is never supplied at insert (it marks completion) and
        // status defaults to 'pending' in the DB.
        Insert: Omit<StripeEvent, 'processed_at' | 'status'> & Partial<Pick<StripeEvent, 'status'>>;
        // No longer append-only: the webhook stamps status + processed_at when
        // the handler completes, or status='failed' when it throws.
        Update: Partial<Pick<StripeEvent, 'status' | 'processed_at'>>;
        Relationships: [];
      };
      csv_upload_drafts: {
        Row: CsvUploadDraft;
        Insert: Omit<CsvUploadDraft, 'id' | 'created_at'>;
        Update: Partial<Omit<CsvUploadDraft, 'id' | 'created_at'>>;
        Relationships: [];
      };
      review_rate_limits: {
        Row: ReviewRateLimit;
        Insert: ReviewRateLimit;
        Update: Partial<ReviewRateLimit>;
        Relationships: [];
      };
      account_deletion_tokens: {
        Row: AccountDeletionToken;
        Insert: Omit<AccountDeletionToken, 'id' | 'issued_at'> &
          Partial<Pick<AccountDeletionToken, 'issued_at'>>;
        Update: Partial<Omit<AccountDeletionToken, 'id'>>;
        Relationships: [];
      };
      cert_warnings: {
        Row: CertWarning;
        Insert: Omit<CertWarning, 'sent_at'> & Partial<Pick<CertWarning, 'sent_at'>>;
        // append-only: Update is a no-op shape required for GenericTable compat
        Update: Record<string, never>;
        Relationships: [];
      };
      brands: {
        Row: Brand;
        Insert: Omit<Brand, 'id' | 'created_at' | 'updated_at'>;
        Update: Partial<Omit<Brand, 'id' | 'created_at' | 'updated_at'>>;
        Relationships: [];
      };
      partners: {
        Row: Partner;
        Insert: Omit<Partner, 'id' | 'created_at' | 'updated_at'> &
          Partial<Pick<Partner, 'default_commission_rate' | 'status'>>;
        Update: Partial<Omit<Partner, 'id' | 'created_at' | 'updated_at'>>;
        Relationships: [];
      };
      brand_attributions: {
        Row: BrandAttribution;
        Insert: Omit<BrandAttribution, 'id' | 'created_at' | 'updated_at'> &
          Partial<Pick<BrandAttribution, 'commission_rate' | 'status'>>;
        Update: Partial<Omit<BrandAttribution, 'id' | 'created_at' | 'updated_at'>>;
        Relationships: [];
      };
      invoice_payments: {
        Row: InvoicePayment;
        Insert: Omit<InvoicePayment, 'id' | 'created_at'>;
        Update: Partial<Omit<InvoicePayment, 'id' | 'created_at'>>;
        Relationships: [];
      };
    };
    Views: {
      commission_payouts: {
        Row: CommissionPayout;
        Relationships: [];
      };
    };
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}
