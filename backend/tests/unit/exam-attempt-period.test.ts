/**
 * tests/unit/exam-attempt-period.test.ts
 *
 * T-52 — MAX_ATTEMPTS counts attempts in the CURRENT certification period, not
 * over a learner's lifetime.
 *
 * THE BUG
 * ───────
 * `checkCooldown` counted every submitted attempt a learner had ever made and
 * refused a fourth. Someone who failed twice and passed on the third try has
 * three submitted attempts FOREVER. When their certificate expires two years
 * later they go to renew and are told "Maximum attempts reached. Please contact
 * your administrator." — with no in-product way for anyone to clear it. Their
 * restaurant then fails checkEligibility condition 2 permanently, which is the
 * T-46 deadlock again: one employee who cannot renew blocks the whole listing.
 *
 * THE BOUNDARY IS AN ATTEMPT, NOT A CERTIFICATE
 * ─────────────────────────────────────────────
 * The period begins at the learner's most recent attempt with `passed === true`.
 *
 * It is deliberately NOT keyed on the certificate. app/api/cron/purge-stale-
 * pending-certs/route.ts HARD-DELETES pending certificates — a real
 * `.delete()`, not a status flip. A learner who passes at a restaurant that
 * never pays the fee loses the certificate row entirely, so a certificate-keyed
 * boundary would leave exactly those learners locked out forever. That is the
 * most common real instance of this bug, not an edge case. `exam_attempts` is
 * never purged, so the pass itself is the durable record.
 *
 * That is also why `checkCooldown` needs no new argument: `passed` is already
 * in the data it receives. The boundary is computed from what it already has.
 *
 * WHAT IS UNCHANGED
 * ─────────────────
 * The 24-hour post-failure cooldown, its duration, MAX_ATTEMPTS itself, and the
 * user-facing copy. A learner who genuinely exhausts three attempts INSIDE one
 * period is still refused, and still told to contact their administrator —
 * which is now true rather than permanent.
 */

import { describe, it, expect } from 'vitest';
import { checkCooldown, COOLDOWN_HOURS, MAX_ATTEMPTS } from '@/lib/learner/exam';

const NOW_MS = new Date('2026-08-05T12:00:00.000Z').getTime();
const HOUR_MS = 60 * 60 * 1000;

/** An attempt submitted `h` hours before NOW_MS. */
function attempt(h: number, passed: boolean | null) {
  return {
    started_at: new Date(NOW_MS - h * HOUR_MS - 30 * 60 * 1000).toISOString(),
    submitted_at: new Date(NOW_MS - h * HOUR_MS).toISOString(),
    passed,
  };
}

/** Oldest-first, the order a human would write a history in. */
const chronological = <T>(...rows: T[]) => rows;

// ─── The headline ─────────────────────────────────────────────────────────────

describe('a learner who failed twice before passing can renew', () => {
  it('THE HEADLINE: 2 fails + 1 pass, certificate expired → can start a new exam', () => {
    // The exact history that locked people out. Two years ago: fail, fail, pass.
    // Their certificate has since expired, so T-49's duplicate guard lets them
    // through — and then this refused them.
    const history = chronological(
      attempt(2 * 365 * 24 + 48, false),
      attempt(2 * 365 * 24 + 24, false),
      attempt(2 * 365 * 24, true)
    );

    const result = checkCooldown(history, NOW_MS);

    expect(result.canAttempt, 'renewal must not be refused').toBe(true);
    expect(result.reason).toBeUndefined();
    // The pass closed the period, so this is attempt 1 of the NEW period.
    expect(result.attemptNumber).toBe(1);
  });

  it('THE PURGE CASE: the pending certificate was hard-deleted and renewal still works', () => {
    // app/api/cron/purge-stale-pending-certs deletes the certificate ROW when a
    // restaurant never pays. This learner passed, the fee was never paid, the
    // cron purged the cert, and no certificate record of them exists anywhere.
    //
    // A certificate-keyed period boundary would find nothing, fall back to
    // "lifetime", count 3 and refuse — permanently, for the most common real
    // instance of this bug. The boundary is the PASS, which is never purged, so
    // this function never needed the certificate in the first place.
    const history = chronological(
      attempt(90 * 24, false),
      attempt(89 * 24, false),
      attempt(88 * 24, true) // passed; cert issued, then purged unpaid
    );

    const result = checkCooldown(history, NOW_MS);

    expect(result.canAttempt, 'no certificate row exists, and none is needed').toBe(true);
    expect(result.attemptNumber).toBe(1);
  });

  it('a revoked-certificate holder with 3 lifetime attempts can retake', () => {
    // The near-term path, not the two-year one. T-49 deliberately allows a
    // learner whose certificate was revoked or disputed to sit the exam again;
    // lifetime counting silently cancelled that permission.
    const history = chronological(
      attempt(200 * 24, false),
      attempt(199 * 24, false),
      attempt(198 * 24, true) // cert issued, later revoked
    );

    expect(checkCooldown(history, NOW_MS).canAttempt).toBe(true);
  });
});

// ─── First-time certification is untouched ────────────────────────────────────

describe('a learner who has never passed is unchanged', () => {
  it(`${MAX_ATTEMPTS} failures and no pass is still blocked`, () => {
    const history = chronological(
      attempt(72, false),
      attempt(48, false),
      attempt(25, false) // cooldown elapsed, so this is the max-attempts refusal
    );

    const result = checkCooldown(history, NOW_MS);

    expect(result.canAttempt).toBe(false);
    expect(result.reason).toContain('Maximum attempts reached');
    // The copy is deliberately unchanged — an administrator genuinely is the
    // escape hatch for someone out of attempts inside a live period.
    expect(result.reason).toMatch(/contact your administrator/i);
  });

  it('no attempts at all: first attempt is allowed, numbered 1', () => {
    const result = checkCooldown([], NOW_MS);
    expect(result.canAttempt).toBe(true);
    expect(result.attemptNumber).toBe(1);
  });

  it('two failures and no pass still allows a third', () => {
    const result = checkCooldown(chronological(attempt(72, false), attempt(48, false)), NOW_MS);
    expect(result.canAttempt).toBe(true);
    expect(result.attemptNumber).toBe(3);
  });
});

// ─── Exhausting a period still blocks ─────────────────────────────────────────

describe('three attempts INSIDE the current period is still a refusal', () => {
  it('blocks even though an older passed attempt exists', () => {
    // Passed two years ago, certificate expired, then failed three times trying
    // to renew. That learner IS out of attempts — for this period — and the
    // administrator message is now accurate rather than permanent.
    const history = chronological(
      attempt(2 * 365 * 24, true), // period boundary
      attempt(72, false),
      attempt(48, false),
      attempt(25, false)
    );

    const result = checkCooldown(history, NOW_MS);

    expect(result.canAttempt).toBe(false);
    expect(result.reason).toContain('Maximum attempts reached');
  });

  it('counts only the failures after the most recent pass, not before it', () => {
    // Six submitted attempts in total; only two are in the current period.
    const history = chronological(
      attempt(500 * 24, false),
      attempt(499 * 24, false),
      attempt(498 * 24, false),
      attempt(497 * 24, true), // boundary
      attempt(72, false),
      attempt(48, false)
    );

    const result = checkCooldown(history, NOW_MS);

    expect(result.canAttempt, 'two in-period failures leaves one attempt').toBe(true);
    expect(result.attemptNumber).toBe(3);
  });

  it('the most RECENT pass is the boundary when there are several', () => {
    const history = chronological(
      attempt(900 * 24, true), // an older period
      attempt(800 * 24, false),
      attempt(700 * 24, true), // the boundary that counts
      attempt(72, false)
    );

    const result = checkCooldown(history, NOW_MS);

    expect(result.canAttempt).toBe(true);
    expect(result.attemptNumber, 'one failure since the most recent pass').toBe(2);
  });
});

// ─── attemptNumber is period-scoped (T-52 point 6) ────────────────────────────

describe('attemptNumber counts within the period', () => {
  it('resets to 1 immediately after a pass', () => {
    const result = checkCooldown(chronological(attempt(48, true)), NOW_MS);

    expect(result.canAttempt).toBe(true);
    // Was 2 under lifetime counting. A pass closes the period, so the next
    // attempt is the first of a new one.
    expect(result.attemptNumber).toBe(1);
  });

  it('climbs 1 → 2 → 3 within one period regardless of prior history', () => {
    const priorCycle = chronological(
      attempt(1000 * 24, false),
      attempt(999 * 24, false),
      attempt(998 * 24, true)
    );

    expect(checkCooldown(priorCycle, NOW_MS).attemptNumber).toBe(1);
    expect(checkCooldown([...priorCycle, attempt(72, false)], NOW_MS).attemptNumber).toBe(2);
    expect(
      checkCooldown([...priorCycle, attempt(72, false), attempt(48, false)], NOW_MS).attemptNumber
    ).toBe(3);
  });
});

// ─── The 24-hour cooldown is unchanged ────────────────────────────────────────

describe('the 24-hour post-failure cooldown still applies', () => {
  it('blocks a retry one hour after an in-period failure', () => {
    const history = chronological(attempt(2 * 365 * 24, true), attempt(1, false));

    const result = checkCooldown(history, NOW_MS);

    expect(result.canAttempt).toBe(false);
    expect(result.reason).toContain(`${COOLDOWN_HOURS} hours`);
    expect(result.retryAvailableAt).toBeDefined();
  });

  it('allows the retry once 24 hours have elapsed', () => {
    const history = chronological(attempt(2 * 365 * 24, true), attempt(25, false));

    expect(checkCooldown(history, NOW_MS).canAttempt).toBe(true);
  });

  it('measures the wait from the failure, not from the period boundary', () => {
    const failedAtMs = NOW_MS - 1 * HOUR_MS;
    const history = chronological(attempt(2 * 365 * 24, true), attempt(1, false));

    const result = checkCooldown(history, NOW_MS);

    const retryMs = new Date(result.retryAvailableAt!).getTime();
    expect(retryMs).toBe(failedAtMs + COOLDOWN_HOURS * HOUR_MS);
  });

  it('a pass after a failure clears the cooldown — the period moved on', () => {
    const history = chronological(attempt(2, false), attempt(1, true));

    const result = checkCooldown(history, NOW_MS);

    expect(result.canAttempt).toBe(true);
    expect(result.retryAvailableAt).toBeUndefined();
  });
});

// ─── Order independence ───────────────────────────────────────────────────────

describe('the answer does not depend on the order rows arrive in', () => {
  it('enforces the cooldown on newest-first input, as /api/exam/start supplies', () => {
    // app/api/exam/start/route.ts orders `.order('started_at', {ascending:false})`
    // — NEWEST FIRST. Reading "the last submitted attempt" positionally therefore
    // picked the OLDEST row, computed the cooldown from a failure 48 hours back,
    // and let the learner retry one hour after failing. Deciding the period
    // boundary positionally would have inherited exactly the same defect, so the
    // attempts are ordered by submitted_at inside the function.
    const newestFirst = [attempt(1, false), attempt(48, false)];

    const result = checkCooldown(newestFirst, NOW_MS);

    expect(result.canAttempt, 'the one-hour-old failure governs').toBe(false);
    expect(result.reason).toContain(`${COOLDOWN_HOURS} hours`);
  });

  it('finds the period boundary on newest-first input', () => {
    const newestFirst = [attempt(48, false), attempt(2 * 365 * 24, true)];

    const result = checkCooldown(newestFirst, NOW_MS);

    expect(result.canAttempt).toBe(true);
    expect(result.attemptNumber, 'one failure since the pass').toBe(2);
  });

  it('agrees with itself on shuffled input', () => {
    const rows = [
      attempt(500 * 24, false),
      attempt(499 * 24, true),
      attempt(72, false),
      attempt(48, false),
    ];

    const forwards = checkCooldown(rows, NOW_MS);
    const backwards = checkCooldown([...rows].reverse(), NOW_MS);

    expect(backwards).toEqual(forwards);
    expect(forwards.attemptNumber).toBe(3);
  });
});

// ─── Unsubmitted rows ─────────────────────────────────────────────────────────

describe('attempts that were never submitted are ignored', () => {
  it('an in-flight attempt does not consume a period slot', () => {
    const history = [
      attempt(2 * 365 * 24, true),
      attempt(72, false),
      {
        started_at: new Date(NOW_MS - 10 * 60 * 1000).toISOString(),
        submitted_at: null,
        passed: null,
      },
    ];

    const result = checkCooldown(history, NOW_MS);

    expect(result.attemptNumber).toBe(2);
  });

  it('a null `passed` on a submitted row is not treated as a pass', () => {
    // Only `passed === true` closes a period. Anything else is not a pass, and
    // reading it as one would hand out an unearned fresh set of attempts.
    const history = chronological(attempt(72, null), attempt(48, null), attempt(25, null));

    const result = checkCooldown(history, NOW_MS);

    expect(result.canAttempt).toBe(false);
    expect(result.reason).toContain('Maximum attempts reached');
  });
});

// ─── Per-learner, never per-restaurant ────────────────────────────────────────

describe('the period is per-learner', () => {
  it('two colleagues with different histories get different answers', () => {
    // The function only ever sees one learner's rows — the routes scope the
    // query with .eq('profile_id', user.id). This pins that a shared boundary
    // cannot leak between two people at the same restaurant: the same call,
    // given different histories, must disagree.
    const alice = chronological(attempt(500 * 24, false), attempt(499 * 24, true));
    const bob = chronological(attempt(72, false), attempt(48, false), attempt(25, false));

    expect(checkCooldown(alice, NOW_MS).canAttempt, "alice's pass closed her period").toBe(true);
    expect(checkCooldown(bob, NOW_MS).canAttempt, 'bob has never passed').toBe(false);
  });

  it("one colleague's pass does not open attempts for another", () => {
    const bobAlone = chronological(attempt(72, false), attempt(48, false), attempt(25, false));
    const bobWithAlicesPassMixedIn = [...bobAlone, attempt(499 * 24, true)];

    // Alice's pass is OLDER than Bob's failures, so even if the two histories
    // were ever mixed the boundary would sit before Bob's three failures and he
    // would stay blocked. Counting is time-ordered, not positional.
    expect(checkCooldown(bobWithAlicesPassMixedIn, NOW_MS).canAttempt).toBe(false);
  });
});

// ─── Constants are untouched ──────────────────────────────────────────────────

describe('T-52 changes which attempts are counted, nothing else', () => {
  it('MAX_ATTEMPTS is still 3 and COOLDOWN_HOURS is still 24', () => {
    expect(MAX_ATTEMPTS).toBe(3);
    expect(COOLDOWN_HOURS).toBe(24);
  });
});
