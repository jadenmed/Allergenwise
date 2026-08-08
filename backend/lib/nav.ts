/**
 * lib/nav.ts — Single source of truth for all navigation arrays.
 *
 * Rules:
 * - Lucide icons only, sized w-4 h-4 at render time (MASTER.md anti-pattern: no emoji)
 * - href values match the actual route group paths in app/
 * - Groups named to match role: admin / learner / reviewer / public
 */

import {
  LayoutDashboard,
  Users,
  Mail,
  CreditCard,
  ClipboardCheck,
  BookOpen,
  FileText,
  Award,
  Inbox,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  /** If true, only show this item when a condition is met (handled by consumer) */
  conditional?: boolean;
  /** If true, hidden while the coming-soon gate is on (T-03, see lib/coming-soon.ts) */
  hiddenWhenComingSoon?: boolean;
}

// ─── Admin nav ───────────────────────────────────────────────────────────────
export const adminNav: NavItem[] = [
  { label: 'Dashboard', href: '/admin/dashboard', icon: LayoutDashboard },
  { label: 'Roster', href: '/admin/roster', icon: Users },
  { label: 'Invite', href: '/admin/invite', icon: Mail },
  { label: 'Billing', href: '/admin/billing', icon: CreditCard, hiddenWhenComingSoon: true },
  { label: 'Submit for Listing', href: '/admin/submit', icon: ClipboardCheck },
];

// ─── Learner nav ─────────────────────────────────────────────────────────────
// Certificate item is conditional — rendered only when the learner has earned one.
// Consumer should filter on `conditional` or pass a `showCertificate` prop.
export const learnerNav: NavItem[] = [
  { label: 'Courses', href: '/learner/courses', icon: BookOpen },
  { label: 'Exam', href: '/learner/exam', icon: FileText },
  { label: 'Certificate', href: '/learner/certificate', icon: Award, conditional: true },
];

// ─── Reviewer nav ────────────────────────────────────────────────────────────
export const reviewerNav: NavItem[] = [{ label: 'Queue', href: '/reviewer/queue', icon: Inbox }];

// ─── Public top-bar nav ──────────────────────────────────────────────────────
// The public layout handles anon vs. signed-in distinction in the component itself.
// This array covers the static links (Home, Directory, Pricing).
export interface PublicNavItem {
  label: string;
  href: string;
  /** If true, hidden while the coming-soon gate is on (T-03, see lib/coming-soon.ts) */
  hiddenWhenComingSoon?: boolean;
}

export const publicNav: PublicNavItem[] = [
  { label: 'Home', href: '/' },
  { label: 'Directory', href: '/directory', hiddenWhenComingSoon: true },
  { label: 'Pricing', href: '/pricing', hiddenWhenComingSoon: true },
];
