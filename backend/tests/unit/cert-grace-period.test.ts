/**
 * tests/unit/cert-grace-period.test.ts
 *
 * T-45a — the grace period is ONE constant, in one place, and it governs
 * consequences only.
 *
 * THE DECISION THIS PINS
 * ──────────────────────
 * A grace period applies to: when the top-up fee is charged, blocking new
 * submissions, pulling or flagging the listing.
 *
 * It does NOT apply to: the displayed certified count, the displayed staff
 * total, or whether a new hire enters the denominator.
 *
 * The displayed numbers are read from the database on every read. Freezing them
 * for thirty days would be the T-18 defect again — a public page asserting a
 * fully-certified roster while three untrained people work the floor, read by a
 * diner with a life-threatening allergy who may be served by one of them.
 *
 * So the load-bearing assertion in this file is a NEGATIVE one: no counting code
 * imports this module. It exists so T-45b's dunning lifecycle has one definition
 * to read rather than inventing its own, and for nothing else yet.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  CERT_TOP_UP_GRACE_PERIOD_DAYS,
  graceDeadlineFrom,
  isGracePeriodElapsed,
} from '@/lib/billing/grace-period';

const DAY_MS = 24 * 60 * 60 * 1000;

function source(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), relativePath), 'utf8');
}

describe('the grace period is one named constant', () => {
  it('is 30 days', () => {
    expect(CERT_TOP_UP_GRACE_PERIOD_DAYS).toBe(30);
  });

  it('is defined exactly once — no second copy in the modules that would want one', () => {
    // The point of the constant. A dunning job that inlines `30` is a second
    // definition, and a second definition is what drifts.
    const FILES = [
      'lib/billing/grace-period.ts',
      'lib/billing/cert-balance.ts',
      'lib/billing/cert-checkout.ts',
      'app/api/admin/top-up/route.ts',
      'lib/staff/membership.ts',
    ];

    const definers = FILES.filter((f) => source(f).includes('CERT_TOP_UP_GRACE_PERIOD_DAYS ='));
    expect(definers).toEqual(['lib/billing/grace-period.ts']);
  });
});

describe('the deadline runs from when the debt started', () => {
  it('is owedSince + 30 days', () => {
    const owedSince = '2026-06-01T00:00:00.000Z';
    const deadline = graceDeadlineFrom(owedSince);

    expect(deadline).not.toBeNull();
    expect(new Date(deadline!).getTime() - new Date(owedSince).getTime()).toBe(30 * DAY_MS);
  });

  it('no debt means no deadline', () => {
    // Not "the deadline is now" and not "the deadline has passed". A restaurant
    // that owes nothing is not inside a grace period at all.
    expect(graceDeadlineFrom(null)).toBeNull();
    expect(isGracePeriodElapsed(null)).toBe(false);
  });

  it('an unparseable timestamp is treated as no deadline, not an expired one', () => {
    // Fail-closed toward LENIENCE. The consequences this gates are punitive, and
    // applying one to a restaurant that may owe nothing is the worse error.
    expect(graceDeadlineFrom('not-a-date')).toBeNull();
    expect(isGracePeriodElapsed('not-a-date')).toBe(false);
  });

  it('has not elapsed on day 29, and has on day 31', () => {
    const owedSince = new Date('2026-06-01T00:00:00.000Z');
    const at = (days: number) => owedSince.getTime() + days * DAY_MS;

    expect(isGracePeriodElapsed(owedSince.toISOString(), at(29))).toBe(false);
    expect(isGracePeriodElapsed(owedSince.toISOString(), at(30))).toBe(true);
    expect(isGracePeriodElapsed(owedSince.toISOString(), at(31))).toBe(true);
  });
});

describe('the grace period never touches a displayed number', () => {
  it('nothing that counts staff imports it', () => {
    // THE assertion in this file. If a future edit makes a counting module read
    // the grace period, the displayed figure becomes a function of whether
    // somebody has paid — which is exactly the dishonesty this product exists
    // not to ship.
    const COUNTING_MODULES = [
      'lib/staff/membership.ts',
      'lib/billing/cert-balance.ts',
      'lib/directory/cert-stat.ts',
      'app/api/directory/[slug]/route.ts',
      'app/api/search/route.ts',
      'app/api/admin/dashboard-stats/route.ts',
      'lib/admin/eligibility.ts',
    ];

    for (const file of COUNTING_MODULES) {
      expect(source(file), `${file} must not read the grace period`).not.toContain(
        "from '@/lib/billing/grace-period'"
      );
    }
  });

  it('is not consumed by anything in T-45a yet — it is for T-45b', () => {
    // Stated as a fact rather than left implicit, so the first consumer is a
    // deliberate act rather than an accident.
    const T45A_FILES = [
      'lib/billing/cert-balance.ts',
      'lib/billing/cert-checkout.ts',
      'app/api/admin/top-up/route.ts',
    ];

    for (const file of T45A_FILES) {
      expect(source(file)).not.toContain("from '@/lib/billing/grace-period'");
    }
  });
});
