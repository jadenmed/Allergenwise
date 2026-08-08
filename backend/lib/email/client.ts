import { Resend } from 'resend';

if (!process.env.RESEND_API_KEY) {
  throw new Error('RESEND_API_KEY is not set');
}

export const resend = new Resend(process.env.RESEND_API_KEY);

export const FROM_EMAIL = process.env.RESEND_FROM_EMAIL ?? 'hello@allergenwise.com';

export const REVIEWER_EMAIL = process.env.REVIEWER_EMAIL ?? 'reviewers@allergenwise.com';
