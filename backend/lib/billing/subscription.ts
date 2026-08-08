/**
 * lib/billing/subscription.ts
 * Pure helper functions for subscription state machine logic.
 * No DB calls — takes plain data, returns computed results.
 *
 * Tested by: tests/unit/subscription-state-machine.test.ts
 *
 * Subscription state machine:
 *
 *   active   → expired   (cron: expire-subscriptions when ends_at < today)
 *   active   → canceled  (admin action — not exposed in MVP UI; service-role only)
 *   expired  → active    INVALID — must purchase new subscription
 *   canceled → active    INVALID — must purchase new subscription
 *
 * Cancellation note: The MVP does not expose a cancellation UI. Cancellation is
 * performed directly via the Supabase service-role by AllergenWise staff, or via
 * the Stripe Customer Portal (auto_renew=false flow). A future endpoint
 * (POST /api/admin/billing/cancel) is documented in PRODUCTION_BUILD.md.
 * This helper guards the state transition logic regardless of trigger mechanism.
 */

import type { Subscription, SubscriptionStatus } from '@/lib/types/db';

// ─── Types ────────────────────────────────────────────────────────────────────

/** All valid subscription states */
export type SubState = SubscriptionStatus;

// ─── Pure helpers ─────────────────────────────────────────────────────────────

/**
 * Returns the effective status of a subscription given the current date.
 * This is the single source of truth for subscription status.
 *
 * @param sub     - Subscription row (or any object with status + ends_at)
 * @param nowMs   - Current time in milliseconds (injectable for testability)
 */
export function getSubscriptionStatus(
  sub: Pick<Subscription, 'status' | 'ends_at'>,
  nowMs: number = Date.now()
): SubState {
  // If already marked canceled in DB, respect that
  if (sub.status === 'canceled') return 'canceled';
  // If already marked expired in DB, or the end date has passed
  if (sub.status === 'expired') return 'expired';
  // Check if the end date has passed (cron may not have run yet)
  const endsAtMs = new Date(sub.ends_at).getTime();
  if (endsAtMs < nowMs) return 'expired';
  return 'active';
}

/**
 * Returns true if the subscription is currently active.
 */
export function isSubscriptionActive(
  sub: Pick<Subscription, 'status' | 'ends_at'>,
  nowMs: number = Date.now()
): boolean {
  return getSubscriptionStatus(sub, nowMs) === 'active';
}

/**
 * Returns true if a subscription transition from `from` → `to` is allowed.
 *
 * Valid transitions:
 *   active   → expired   (cron expire-subscriptions)
 *   active   → canceled  (admin/staff action)
 *
 * Invalid transitions:
 *   expired  → active    (cannot re-activate; must purchase new sub)
 *   canceled → active    (cannot re-activate; must purchase new sub)
 *   any      → any       (same-state transitions are idempotent no-ops)
 */
export function canTransition(from: SubState, to: SubState): boolean {
  if (from === to) return true; // idempotent no-op

  const allowed: Record<SubState, SubState[]> = {
    active: ['expired', 'canceled'],
    expired: [], // terminal — cannot transition to anything
    canceled: [], // terminal — cannot transition to anything
  };

  return allowed[from]?.includes(to) ?? false;
}

/**
 * Computes how many days remain in a subscription.
 * Returns a negative number if already expired.
 */
export function daysUntilSubscriptionEnd(
  sub: Pick<Subscription, 'ends_at'>,
  nowMs: number = Date.now()
): number {
  const endsAtMs = new Date(sub.ends_at).getTime();
  return Math.floor((endsAtMs - nowMs) / (1000 * 60 * 60 * 24));
}

/**
 * Returns true if the subscription expires within `warningDays` days.
 * Used by cron jobs to decide whether to send expiry warnings.
 */
export function isExpiringWithinDays(
  sub: Pick<Subscription, 'status' | 'ends_at'>,
  warningDays: number,
  nowMs: number = Date.now()
): boolean {
  if (!isSubscriptionActive(sub, nowMs)) return false;
  const days = daysUntilSubscriptionEnd(sub, nowMs);
  return days >= 0 && days <= warningDays;
}
