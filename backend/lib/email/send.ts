/**
 * lib/email/send.ts
 *
 * Typed send helper for all 11 AllergenWise email templates.
 * All external email dispatch goes through this function — never call
 * `resend.emails.send` directly from route handlers or crons.
 *
 * Usage:
 *   const result = await sendEmail('EmployeeInvite', 'jane@example.com', {
 *     recipientName: 'Jane',
 *     restaurantName: 'The Green Fork',
 *     inviteLink: 'https://...',
 *   });
 *   if (!result.ok) logger.error('email failed', result.error);
 *
 * Never throws — returns { ok: false, error } on failure so callers
 * can log and continue without crashing the request/cron.
 */
import 'server-only';
import * as React from 'react';
import { render } from '@react-email/components';
import { resend, FROM_EMAIL } from '@/lib/email/client';
import { maskEmail } from '@/lib/security/mask-pii';

// ── Template imports ──────────────────────────────────────────────────────────

import {
  EmployeeInvite,
  type EmployeeInviteProps,
  SUBJECT_EMPLOYEE_INVITE,
} from '@/lib/email/templates/EmployeeInvite';

import {
  InviteReminder,
  type InviteReminderProps,
  SUBJECT_INVITE_REMINDER,
} from '@/lib/email/templates/InviteReminder';

import {
  ExamPassed,
  type ExamPassedProps,
  SUBJECT_EXAM_PASSED,
} from '@/lib/email/templates/ExamPassed';

import {
  RestaurantSubmitted,
  type RestaurantSubmittedProps,
  subjectRestaurantSubmitted,
} from '@/lib/email/templates/RestaurantSubmitted';

import {
  RestaurantApproved,
  type RestaurantApprovedProps,
  SUBJECT_RESTAURANT_APPROVED,
} from '@/lib/email/templates/RestaurantApproved';

import {
  RestaurantRejected,
  type RestaurantRejectedProps,
  SUBJECT_RESTAURANT_REJECTED,
} from '@/lib/email/templates/RestaurantRejected';

import {
  RestaurantInfoRequested,
  type RestaurantInfoRequestedProps,
  SUBJECT_RESTAURANT_INFO_REQUESTED,
} from '@/lib/email/templates/RestaurantInfoRequested';

import {
  PlanExpiringSoon,
  type PlanExpiringSoonProps,
  subjectPlanExpiringSoon,
} from '@/lib/email/templates/PlanExpiringSoon';

import {
  CertExpiringSoon,
  type CertExpiringSoonProps,
  subjectCertExpiringSoon,
} from '@/lib/email/templates/CertExpiringSoon';

import {
  ReceiptCertFee,
  type ReceiptCertFeeProps,
  SUBJECT_RECEIPT_CERT_FEE,
} from '@/lib/email/templates/ReceiptCertFee';

import {
  WelcomeAdmin,
  type WelcomeAdminProps,
  SUBJECT_WELCOME_ADMIN,
} from '@/lib/email/templates/WelcomeAdmin';

import {
  AccountDeletionConfirm,
  type AccountDeletionConfirmProps,
  SUBJECT_ACCOUNT_DELETION_CONFIRM,
} from '@/lib/email/templates/AccountDeletionConfirm';

import {
  EmployeeExamPassedNotice,
  type EmployeeExamPassedNoticeProps,
  SUBJECT_EMPLOYEE_EXAM_PASSED_NOTICE,
} from '@/lib/email/templates/EmployeeExamPassedNotice';

import {
  WeeklyAdminDigest,
  type WeeklyAdminDigestProps,
  subjectWeeklyAdminDigest,
} from '@/lib/email/templates/WeeklyAdminDigest';

import {
  ReviewerQueueDigest,
  type ReviewerQueueDigestProps,
  subjectReviewerQueueDigest,
} from '@/lib/email/templates/ReviewerQueueDigest';

// ── Template registry ─────────────────────────────────────────────────────────

/**
 * All valid template names. Add new templates here.
 */
export type TemplateName =
  | 'EmployeeInvite'
  | 'InviteReminder'
  | 'ExamPassed'
  | 'RestaurantSubmitted'
  | 'RestaurantApproved'
  | 'RestaurantRejected'
  | 'RestaurantInfoRequested'
  | 'PlanExpiringSoon'
  | 'CertExpiringSoon'
  | 'ReceiptCertFee'
  | 'WelcomeAdmin'
  | 'AccountDeletionConfirm'
  | 'EmployeeExamPassedNotice'
  | 'WeeklyAdminDigest'
  | 'ReviewerQueueDigest';

/**
 * Maps template name → its props type.
 * TypeScript uses this to infer the correct props type from the template name.
 */
export interface TemplateProps {
  EmployeeInvite: EmployeeInviteProps;
  InviteReminder: InviteReminderProps;
  ExamPassed: ExamPassedProps;
  RestaurantSubmitted: RestaurantSubmittedProps;
  RestaurantApproved: RestaurantApprovedProps;
  RestaurantRejected: RestaurantRejectedProps;
  RestaurantInfoRequested: RestaurantInfoRequestedProps;
  PlanExpiringSoon: PlanExpiringSoonProps;
  CertExpiringSoon: CertExpiringSoonProps;
  ReceiptCertFee: ReceiptCertFeeProps;
  WelcomeAdmin: WelcomeAdminProps;
  AccountDeletionConfirm: AccountDeletionConfirmProps;
  EmployeeExamPassedNotice: EmployeeExamPassedNoticeProps;
  WeeklyAdminDigest: WeeklyAdminDigestProps;
  ReviewerQueueDigest: ReviewerQueueDigestProps;
}

// ── Internal: render element + resolve subject ─────────────────────────────────

function buildEmail<T extends TemplateName>(
  template: T,
  props: TemplateProps[T]
): { element: React.ReactElement; subject: string } {
  switch (template) {
    case 'EmployeeInvite':
      return {
        element: React.createElement(EmployeeInvite, props as EmployeeInviteProps),
        subject: SUBJECT_EMPLOYEE_INVITE,
      };
    case 'InviteReminder':
      return {
        element: React.createElement(InviteReminder, props as InviteReminderProps),
        subject: SUBJECT_INVITE_REMINDER,
      };
    case 'ExamPassed':
      return {
        element: React.createElement(ExamPassed, props as ExamPassedProps),
        subject: SUBJECT_EXAM_PASSED,
      };
    case 'RestaurantSubmitted': {
      const p = props as RestaurantSubmittedProps;
      return {
        element: React.createElement(RestaurantSubmitted, p),
        subject: subjectRestaurantSubmitted(p.restaurantName),
      };
    }
    case 'RestaurantApproved':
      return {
        element: React.createElement(RestaurantApproved, props as RestaurantApprovedProps),
        subject: SUBJECT_RESTAURANT_APPROVED,
      };
    case 'RestaurantRejected':
      return {
        element: React.createElement(RestaurantRejected, props as RestaurantRejectedProps),
        subject: SUBJECT_RESTAURANT_REJECTED,
      };
    case 'RestaurantInfoRequested':
      return {
        element: React.createElement(
          RestaurantInfoRequested,
          props as RestaurantInfoRequestedProps
        ),
        subject: SUBJECT_RESTAURANT_INFO_REQUESTED,
      };
    case 'PlanExpiringSoon': {
      const p = props as PlanExpiringSoonProps;
      return {
        element: React.createElement(PlanExpiringSoon, p),
        subject: subjectPlanExpiringSoon(p.daysRemaining),
      };
    }
    case 'CertExpiringSoon': {
      const p = props as CertExpiringSoonProps;
      return {
        element: React.createElement(CertExpiringSoon, p),
        subject: subjectCertExpiringSoon(p.daysRemaining),
      };
    }
    case 'ReceiptCertFee':
      return {
        element: React.createElement(ReceiptCertFee, props as ReceiptCertFeeProps),
        subject: SUBJECT_RECEIPT_CERT_FEE,
      };
    case 'WelcomeAdmin':
      return {
        element: React.createElement(WelcomeAdmin, props as WelcomeAdminProps),
        subject: SUBJECT_WELCOME_ADMIN,
      };
    case 'AccountDeletionConfirm':
      return {
        element: React.createElement(AccountDeletionConfirm, props as AccountDeletionConfirmProps),
        subject: SUBJECT_ACCOUNT_DELETION_CONFIRM,
      };
    case 'EmployeeExamPassedNotice':
      return {
        element: React.createElement(
          EmployeeExamPassedNotice,
          props as EmployeeExamPassedNoticeProps
        ),
        subject: SUBJECT_EMPLOYEE_EXAM_PASSED_NOTICE,
      };
    case 'WeeklyAdminDigest': {
      const p = props as WeeklyAdminDigestProps;
      return {
        element: React.createElement(WeeklyAdminDigest, p),
        subject: subjectWeeklyAdminDigest(p.restaurantName),
      };
    }
    case 'ReviewerQueueDigest': {
      const p = props as ReviewerQueueDigestProps;
      return {
        element: React.createElement(ReviewerQueueDigest, p),
        subject: subjectReviewerQueueDigest(p.pendingCount),
      };
    }
    default: {
      // Exhaustive check — TypeScript will error if a template is added but not handled.
      const _exhaustive: never = template;
      throw new Error(`Unknown email template: ${_exhaustive}`);
    }
  }
}

// ── Public send function ───────────────────────────────────────────────────────

export interface SendEmailResult {
  ok: boolean;
  id?: string;
  error?: string;
}

/**
 * Render and send a typed email template via Resend.
 *
 * @param template - Template name (keyof TemplateProps)
 * @param to       - Recipient email address
 * @param props    - Template-specific props (TypeScript-inferred from `template`)
 * @param from     - Override sender (defaults to RESEND_FROM_EMAIL env var)
 *
 * Returns { ok: true, id } on success, { ok: false, error } on failure.
 * Never throws.
 */
export async function sendEmail<T extends TemplateName>(
  template: T,
  to: string,
  props: TemplateProps[T],
  from?: string
): Promise<SendEmailResult> {
  try {
    const { element, subject } = buildEmail(template, props);

    const [html, text] = await Promise.all([
      render(element, { pretty: false }),
      render(element, { plainText: true }),
    ]);

    const { data, error } = await resend.emails.send({
      from: from ?? FROM_EMAIL,
      to,
      subject,
      html,
      text,
    });

    if (error) {
      console.error(
        `[sendEmail] Resend error for template=${template} recipient=${maskEmail(to)}:`,
        error
      );
      return { ok: false, error: error.message };
    }

    return { ok: true, id: data?.id };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(
      `[sendEmail] Unexpected error for template=${template} recipient=${maskEmail(to)}:`,
      message
    );
    return { ok: false, error: message };
  }
}
