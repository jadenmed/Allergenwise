/**
 * lib/page-meta.ts — Consistent <title> and <meta description> helpers.
 *
 * Voice: Clinical, credentialed, authoritative (per MASTER.md product frame).
 * No marketing superlatives. Short, purposeful descriptions.
 *
 * Usage (in a Next.js page):
 *   import { pageMeta } from '@/lib/page-meta';
 *   export const metadata = pageMeta.admin.dashboard;
 */

import type { Metadata } from 'next';

function meta(title: string, description: string): Metadata {
  return { title, description };
}

export const pageMeta = {
  // ─── Public ────────────────────────────────────────────────────────────────
  public: {
    home: meta(
      'AllergenWise — Allergen Safety Certification for Restaurants',
      'Certify your restaurant staff in food-allergen safety. Structured training, verified credentials, and a public directory diners trust.'
    ),
    directory: meta(
      'Certified Restaurants Directory',
      'Find allergen-certified restaurants near you. Every listing is backed by verified staff training and a current certification on file.'
    ),
    pricing: meta(
      'Pricing',
      'Transparent subscription pricing for restaurant allergen-safety certification. Quarterly and semi-annual plans with no hidden fees.'
    ),
    verify: meta(
      'Certificate Verification',
      'Verify the authenticity and current status of an AllergenWise certification for a restaurant or staff member.'
    ),
  },

  // ─── Auth ──────────────────────────────────────────────────────────────────
  auth: {
    login: meta(
      'Sign In',
      'Sign in to your AllergenWise account to manage training, certification, and restaurant compliance.'
    ),
    signup: meta(
      'Create Account',
      'Start your allergen-safety certification journey. Create an AllergenWise account for your restaurant.'
    ),
    invite: meta(
      'Accept Invitation',
      'Accept your invitation to join an AllergenWise-certified restaurant team and begin your allergen safety training.'
    ),
  },

  // ─── Admin ─────────────────────────────────────────────────────────────────
  admin: {
    dashboard: meta(
      'Dashboard',
      "Overview of your restaurant's certification progress, active staff, and training metrics."
    ),
    roster: meta(
      'Staff Roster',
      'Manage your restaurant staff, view training progress, and track certification status for each team member.'
    ),
    invite: meta(
      'Invite Staff',
      'Send allergen safety training invitations to your restaurant staff members.'
    ),
    billing: meta(
      'Billing',
      'Manage your AllergenWise subscription, view payment history, and update billing information.'
    ),
    submit: meta(
      'Submit for Directory Listing',
      "Submit your restaurant's certification documentation for review and directory listing approval."
    ),
  },

  // ─── Learner ───────────────────────────────────────────────────────────────
  // NOTE: No learner metadata defined here.
  // All learner pages (`/learner/**`) are 'use client' components — Next.js
  // requires `export const metadata` to live in a Server Component. Because
  // learner routes are fully gated behind auth (middleware redirects
  // unauthenticated requests to /login), there is zero SEO benefit to indexing
  // them. No server-wrapper conversion is warranted. If learner routes ever
  // become publicly crawlable, add per-route server-component wrappers that
  // export metadata and render the existing client components.

  // ─── Reviewer ──────────────────────────────────────────────────────────────
  reviewer: {
    queue: meta(
      'Review Queue',
      'Pending restaurant certification submissions awaiting review and approval decision.'
    ),
    queueDetail: meta(
      'Submission Detail',
      'Review restaurant certification submission documents and make an approval decision.'
    ),
  },
} as const;
