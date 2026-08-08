/**
 * lib/billing/grace-period.ts
 *
 * T-45a — the one definition of the top-up grace period.
 *
 * WHAT A GRACE PERIOD GOVERNS, AND WHAT IT NEVER GOVERNS
 * ─────────────────────────────────────────────────────
 * This constant governs CONSEQUENCES:
 *   - when the top-up fee is charged
 *   - whether new submissions are blocked
 *   - whether the listing is pulled or flagged
 *
 * It does NOT govern, and must never be allowed to govern:
 *   - the displayed certified count
 *   - the displayed staff total
 *   - whether a new hire enters the denominator
 *
 * The counts are read from the database on every read, always — see
 * lib/billing/cert-balance.ts. A restaurant that hired someone yesterday reads
 * "10 of 13 staff certified · 3 new team members in training" from the moment
 * the thirteenth person is added, whether or not anyone has paid, and whether or
 * not the grace period has elapsed.
 *
 * Freezing the number during a grace window would be the T-18 defect again: a
 * public page asserting a fully-certified roster while three untrained people
 * work the floor, read by a diner with a life-threatening allergy who may be
 * served by one of them. Honesty is not the punishment here — "in training" is
 * what makes it generous, because a restaurant that just hired reads as one
 * doing the right thing.
 *
 * NOTHING IN T-45a CONSUMES THIS
 * ──────────────────────────────
 * Deliberately. T-45b builds the dunning lifecycle — reminders, warnings,
 * escalation, deactivation — and it needs ONE definition to read rather than
 * inventing its own. This file is that definition, sitting here ahead of its
 * first consumer so the lifecycle cannot ship with a second copy of the number.
 *
 * Tested by: tests/unit/cert-grace-period.test.ts
 */

/**
 * How long a restaurant has to settle the fee for staff certified after its
 * listing was paid for, before any consequence attaches.
 *
 * Change it HERE. There is no second copy, and no caller may inline `30`.
 */
export const CERT_TOP_UP_GRACE_PERIOD_DAYS = 30;

/** Milliseconds in a day. Named so the arithmetic below reads as intent. */
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * The instant a balance stops being inside its grace period.
 *
 * @param owedSince ISO timestamp of the OLDEST unpaid pending certificate —
 *   `CertBalance.owedSince`. The clock starts when the debt starts, not when
 *   anybody looked at it.
 * @returns The deadline as an ISO string, or `null` when nothing is owed
 *   (`owedSince` is null) — no debt, no deadline.
 */
export function graceDeadlineFrom(owedSince: string | null): string | null {
  if (owedSince === null) return null;

  const startMs = new Date(owedSince).getTime();
  if (Number.isNaN(startMs)) return null;

  return new Date(startMs + CERT_TOP_UP_GRACE_PERIOD_DAYS * MS_PER_DAY).toISOString();
}

/**
 * Has the grace period elapsed for a balance that started at `owedSince`?
 *
 * Fail-closed toward LENIENCE: an absent or unparseable `owedSince` returns
 * false. The consequences this gates are punitive — blocking a submission,
 * flagging a listing — and the cost of applying one a day late is trivially
 * smaller than the cost of applying one to a restaurant that owes nothing.
 *
 * Not consumed by T-45a. See the file header.
 */
export function isGracePeriodElapsed(
  owedSince: string | null,
  nowMs: number = Date.now()
): boolean {
  const deadline = graceDeadlineFrom(owedSince);
  if (deadline === null) return false;
  return new Date(deadline).getTime() <= nowMs;
}
