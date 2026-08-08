/**
 * tests/unit/subscription-state-machine.test.ts
 *
 * Covers every subscription state transition (valid + invalid).
 * Tests are pure — no DB, no network, only lib/billing/subscription.ts helpers.
 *
 * Subscription state machine:
 *   active   → expired   (cron: expire-subscriptions when ends_at < today)  ✓ valid
 *   active   → canceled  (admin/staff action — no MVP UI)                   ✓ valid
 *   expired  → active    (cannot re-activate; must buy new sub)             ✗ invalid
 *   canceled → active    (cannot re-activate; must buy new sub)             ✗ invalid
 *
 * Cancellation note: The MVP does not expose a cancellation endpoint. Cancellation
 * is performed directly via service-role or Stripe portal (auto_renew=false flow).
 * A future endpoint (POST /api/admin/billing/cancel) is documented in
 * PRODUCTION_BUILD.md §billing-management.
 */

import { describe, it, expect } from 'vitest';
import {
  getSubscriptionStatus,
  isSubscriptionActive,
  canTransition,
  daysUntilSubscriptionEnd,
  isExpiringWithinDays,
} from '@/lib/billing/subscription';
import type { SubState } from '@/lib/billing/subscription';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const NOW_MS = new Date('2026-04-30T12:00:00Z').getTime();
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/** An active subscription ending in 30 days */
const activeSub = {
  status: 'active' as const,
  ends_at: new Date(NOW_MS + 30 * ONE_DAY_MS).toISOString().split('T')[0], // date string
};

/** An active subscription that has already passed its end date (cron may not have run) */
const activeButTimedOutSub = {
  status: 'active' as const,
  ends_at: new Date(NOW_MS - 1 * ONE_DAY_MS).toISOString().split('T')[0],
};

/** A subscription already marked expired in the DB */
const expiredSub = {
  status: 'expired' as const,
  ends_at: new Date(NOW_MS - 5 * ONE_DAY_MS).toISOString().split('T')[0],
};

/** A subscription explicitly canceled */
const canceledSub = {
  status: 'canceled' as const,
  ends_at: new Date(NOW_MS + 60 * ONE_DAY_MS).toISOString().split('T')[0],
};

// ─── getSubscriptionStatus ────────────────────────────────────────────────────

describe('getSubscriptionStatus', () => {
  it('returns "active" for an active sub with future ends_at', () => {
    expect(getSubscriptionStatus(activeSub, NOW_MS)).toBe('active');
  });

  it('returns "expired" for an active-status sub whose ends_at has passed (pre-cron run)', () => {
    // Real status is expired even if DB still says 'active' — cron may not have run yet
    expect(getSubscriptionStatus(activeButTimedOutSub, NOW_MS)).toBe('expired');
  });

  it('returns "expired" for a DB-expired sub', () => {
    expect(getSubscriptionStatus(expiredSub, NOW_MS)).toBe('expired');
  });

  it('returns "canceled" for a canceled sub regardless of ends_at', () => {
    expect(getSubscriptionStatus(canceledSub, NOW_MS)).toBe('canceled');
  });
});

// ─── isSubscriptionActive ─────────────────────────────────────────────────────

describe('isSubscriptionActive', () => {
  it('returns true for a genuinely active sub', () => {
    expect(isSubscriptionActive(activeSub, NOW_MS)).toBe(true);
  });

  it('returns false for an expired sub (DB-marked)', () => {
    expect(isSubscriptionActive(expiredSub, NOW_MS)).toBe(false);
  });

  it('returns false for an active-status sub that has timed out', () => {
    expect(isSubscriptionActive(activeButTimedOutSub, NOW_MS)).toBe(false);
  });

  it('returns false for a canceled sub', () => {
    expect(isSubscriptionActive(canceledSub, NOW_MS)).toBe(false);
  });
});

// ─── canTransition (VALID transitions) ───────────────────────────────────────

describe('canTransition — VALID transitions', () => {
  it('active → expired (cron expire-subscriptions): allowed', () => {
    expect(canTransition('active', 'expired')).toBe(true);
  });

  it('active → canceled (admin/staff action): allowed', () => {
    expect(canTransition('active', 'canceled')).toBe(true);
  });

  it('same-state transitions are idempotent no-ops: allowed', () => {
    const states: SubState[] = ['active', 'expired', 'canceled'];
    for (const state of states) {
      expect(canTransition(state, state)).toBe(true);
    }
  });
});

// ─── canTransition (INVALID transitions) ─────────────────────────────────────

describe('canTransition — INVALID transitions', () => {
  it('expired → active: MUST fail (must purchase new subscription)', () => {
    expect(canTransition('expired', 'active')).toBe(false);
  });

  it('canceled → active: MUST fail (must purchase new subscription)', () => {
    expect(canTransition('canceled', 'active')).toBe(false);
  });

  it('expired → canceled: MUST fail (expired is terminal)', () => {
    expect(canTransition('expired', 'canceled')).toBe(false);
  });

  it('canceled → expired: MUST fail (canceled is terminal)', () => {
    expect(canTransition('canceled', 'expired')).toBe(false);
  });
});

// ─── daysUntilSubscriptionEnd ─────────────────────────────────────────────────

describe('daysUntilSubscriptionEnd', () => {
  it('returns positive number for a future end date', () => {
    // ends_at is a date string (date-only); parsed as UTC midnight.
    // NOW_MS is 2026-04-30T12:00:00Z (UTC noon). Adding 14 days = 2026-05-14T12:00:00Z.
    // The date string is "2026-05-14" = midnight UTC. Distance from noon = ~13.5 days → floor = 13.
    // To get exactly 14, we compute from actual midnight reference.
    const endsAtMs = NOW_MS + 14 * ONE_DAY_MS;
    const endsAtDate = new Date(endsAtMs).toISOString().split('T')[0];
    const sub = { ends_at: endsAtDate };
    const result = daysUntilSubscriptionEnd(sub, NOW_MS);
    // The result should be within ±1 of 14 depending on whether ends_at date parses
    // to midnight UTC which may be slightly less than 14 full days from NOW_MS noon.
    expect(result).toBeGreaterThanOrEqual(13);
    expect(result).toBeLessThanOrEqual(14);
  });

  it('returns negative number for an already-ended subscription', () => {
    const endsAtMs = NOW_MS - 3 * ONE_DAY_MS;
    const endsAtDate = new Date(endsAtMs).toISOString().split('T')[0];
    const sub = { ends_at: endsAtDate };
    const result = daysUntilSubscriptionEnd(sub, NOW_MS);
    // Should be around -3 (may be -3 or -4 depending on time-of-day boundary)
    expect(result).toBeGreaterThanOrEqual(-4);
    expect(result).toBeLessThanOrEqual(-2);
  });
});

// ─── isExpiringWithinDays ─────────────────────────────────────────────────────

describe('isExpiringWithinDays', () => {
  it('returns true when sub expires within warning window', () => {
    const sub14Days = {
      status: 'active' as const,
      ends_at: new Date(NOW_MS + 14 * ONE_DAY_MS).toISOString().split('T')[0],
    };
    expect(isExpiringWithinDays(sub14Days, 14, NOW_MS)).toBe(true);
    expect(isExpiringWithinDays(sub14Days, 30, NOW_MS)).toBe(true);
  });

  it('returns false when sub expires after warning window', () => {
    const sub60Days = {
      status: 'active' as const,
      ends_at: new Date(NOW_MS + 60 * ONE_DAY_MS).toISOString().split('T')[0],
    };
    expect(isExpiringWithinDays(sub60Days, 14, NOW_MS)).toBe(false);
  });

  it('returns false for already-expired subscriptions', () => {
    expect(isExpiringWithinDays(expiredSub, 14, NOW_MS)).toBe(false);
  });

  it('returns false for canceled subscriptions', () => {
    expect(isExpiringWithinDays(canceledSub, 14, NOW_MS)).toBe(false);
  });
});

// ─── Cron: expire-subscriptions simulation ───────────────────────────────────

describe('expire-subscriptions cron simulation', () => {
  it('cron correctly identifies subscriptions that should be expired', () => {
    // Cron transitions active → expired for subs where ends_at < today
    const aboutToExpire = {
      status: 'active' as const,
      ends_at: new Date(NOW_MS - 1).toISOString().split('T')[0],
    };
    expect(getSubscriptionStatus(aboutToExpire, NOW_MS)).toBe('expired');
  });

  it('cron does not expire subscriptions ending in the future', () => {
    const future = {
      status: 'active' as const,
      ends_at: new Date(NOW_MS + ONE_DAY_MS).toISOString().split('T')[0],
    };
    expect(getSubscriptionStatus(future, NOW_MS)).toBe('active');
  });

  it('cron transition active → expired is valid per canTransition', () => {
    expect(canTransition('active', 'expired')).toBe(true);
  });
});

// ─── Admin cancellation simulation ───────────────────────────────────────────

describe('admin cancellation (DB-level service-role transition)', () => {
  it('setting status=canceled on an active sub transitions it to "canceled"', () => {
    const before = { status: 'active' as const, ends_at: activeSub.ends_at };
    const after = { status: 'canceled' as const, ends_at: activeSub.ends_at };

    expect(getSubscriptionStatus(before, NOW_MS)).toBe('active');
    expect(getSubscriptionStatus(after, NOW_MS)).toBe('canceled');
    expect(canTransition('active', 'canceled')).toBe(true);
  });

  it('cancellation is idempotent (canceling an already-canceled sub stays canceled)', () => {
    expect(getSubscriptionStatus(canceledSub, NOW_MS)).toBe('canceled');
    expect(canTransition('canceled', 'canceled')).toBe(true);
  });
});
