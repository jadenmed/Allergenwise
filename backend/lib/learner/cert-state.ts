/**
 * lib/learner/cert-state.ts
 *
 * Wave 2C cert state machine.
 *
 * Pure transition logic — no DB calls. Consumers (webhook handlers, crons,
 * admin tooling) call `transitionCert(from, to, trigger)` to validate a
 * proposed change before issuing the UPDATE.
 *
 * STATE_MACHINE_EXCEPTIONS is the single source of truth for the R5/R6
 * carve-out (refund/dispute_lost may revoke an already-expired cert),
 * referenced by the legality table in the design doc, this helper, and the
 * activity-events vocabulary in cert-payment-state-design.md (g). Do NOT
 * inline the same rules elsewhere.
 *
 * Tested by: tests/unit/cert-state-machine.test.ts
 */

import type { CertificateStatus } from '@/lib/types/db';

// ─── Types ────────────────────────────────────────────────────────────────────

export type CertStatus = CertificateStatus;

/** Every action that can drive a cert state transition. */
export type TransitionTrigger =
  | 'exam_pass'
  | 'payment_succeeded'
  | 'payment_canceled'
  | 'payment_failed'
  | 'cron_expire'
  | 'cron_purge'
  | 'admin_revoke'
  | 'refund'
  | 'dispute_created'
  | 'dispute_won'
  | 'dispute_lost'
  | 'dispute_warning_closed';

export type TransitionResult = { ok: true } | { ok: false; reason: string };

// ─── Publicly-active set ──────────────────────────────────────────────────────

/**
 * All states whose certs publicly verify as active and count toward the
 * directory's "N of M staff certified" figure. Currently `['active']` only —
 * `disputed` is tracked internally but masked to `revoked` publicly.
 *
 * WHY IT LIVES HERE AND NOT IN cert-status.ts (T-23)
 * ──────────────────────────────────────────────────
 * It was declared in lib/learner/cert-status.ts, which is `server-only`. That
 * put the canonical constant out of reach of every shared module — and so four
 * separate call sites hand-wrote `status === 'active'` / `c.status = 'active'`
 * instead of importing it, which is how four counts drift apart. This module is
 * pure vocabulary with no DB access and no `server-only` marker, so the constant
 * is importable from anywhere. cert-status.ts re-exports it, so its documented
 * home still hands it out.
 */
export const PUBLICLY_ACTIVE_STATUSES: ReadonlyArray<CertStatus> = ['active'];

/**
 * The one predicate for "this certificate counts publicly". Never compare a
 * status against the string 'active' inline; call this.
 *
 * Takes a plain `string` because the rows this judges arrive from PostgREST
 * selects typed as `any`. An unrecognised or absent status is NOT publicly
 * active — the same fail-closed polarity as `isCurrentStaff`.
 */
export function isPubliclyActiveCert(status: string | null | undefined): boolean {
  return status != null && (PUBLICLY_ACTIVE_STATUSES as ReadonlyArray<string>).includes(status);
}

// ─── Issuance-blocking set (T-49) ─────────────────────────────────────────────

/**
 * The states in which a learner's EXISTING certificate forbids issuing them
 * another one — and therefore forbids them starting or submitting another exam.
 *
 * This is deliberately the same predicate `lib/admin/eligibility.ts` uses for
 * "this learner has passed the exam": `status IN ('pending','active')` paired
 * with `expires_at > now`. That symmetry is the whole point. A new exam is
 * refused in exactly the cases where eligibility already counts that learner as
 * certified, so the two can never disagree about who still needs certifying —
 * and never disagree about who is billable.
 *
 * WHY NOT SIMPLY "HOLDS A CERTIFICATE" (T-49)
 * ───────────────────────────────────────────
 * Because retaking the exam IS the renewal flow. There is no reissue endpoint:
 * an expired certificate is renewed by sitting the exam again, and the product
 * says so in four places — the learner certificate page ("Retake the exam to
 * renew"), the pricing FAQ, the public verify page, and the CertExpiringSoon
 * email. A guard keyed on "has any certificate row" would silently kill that
 * flow two years after launch.
 *
 * So the three non-blocking states each have a reason:
 *   - `expired`  → the renewal flow itself.
 *   - `revoked`  → excluded from eligibility's certified set, so the learner
 *                  MUST be able to retake or their restaurant can never list.
 *   - `disputed` → same; and "no funds = no cert" means earning a new one
 *                  legitimately costs a new fee.
 */
export const ISSUANCE_BLOCKING_STATUSES: ReadonlyArray<CertStatus> = ['pending', 'active'];

/** The minimum shape `blocksNewCertIssuance` needs off a certificate row. */
export interface IssuanceBlockingCandidate {
  status: string | null | undefined;
  expires_at: string | null | undefined;
}

/**
 * True when this certificate forbids issuing its holder another one.
 *
 * The `expires_at > now` pair matters for the same reason it does in
 * eligibility: `cron_expire` is what moves `active → expired`, and it runs on a
 * schedule. Between a certificate lapsing and the cron noticing, the row still
 * reads `active`. Treating that window as blocking would refuse a renewal for
 * up to a day for no reason, so a lapsed-but-not-yet-swept certificate does NOT
 * block. The renewal it permits mints one new `pending` row and bills one fee,
 * which is the correct price of a renewal — the old row is already paid for.
 *
 * Fail-closed on a missing/unparseable `expires_at`: BLOCK. The column is NOT
 * NULL (0001_init), so this branch is unreachable in practice; if it is ever
 * reached the row is far more likely to be a freshly-inserted pending
 * certificate than a lapsed one, and refusing an exam is recoverable where
 * double-charging a restaurant is not.
 */
export function blocksNewCertIssuance(
  cert: IssuanceBlockingCandidate,
  nowMs: number = Date.now()
): boolean {
  if (cert.status == null) return false;
  if (!(ISSUANCE_BLOCKING_STATUSES as ReadonlyArray<string>).includes(cert.status)) return false;

  if (cert.expires_at == null) return true; // fail-closed — see above
  const expiresMs = new Date(cert.expires_at).getTime();
  if (Number.isNaN(expiresMs)) return true; // fail-closed — see above

  return expiresMs > nowMs;
}

/**
 * Returns the first certificate in the list that blocks a new issuance, or null
 * when the learner is free to sit the exam. Pure — the caller does the read.
 */
export function findIssuanceBlockingCert<T extends IssuanceBlockingCandidate>(
  certs: ReadonlyArray<T>,
  nowMs: number = Date.now()
): T | null {
  return certs.find((c) => blocksNewCertIssuance(c, nowMs)) ?? null;
}

interface ExceptionEntry {
  from: CertStatus;
  to: CertStatus;
  allowedTriggers: ReadonlyArray<TransitionTrigger>;
  reason: string;
}

// ─── Carve-outs ──────────────────────────────────────────────────────────────

/**
 * Single source of truth for state-machine carve-outs. Each entry: a
 * (from, to) transition that is normally illegal, plus the exact set of
 * triggers that DO permit it.
 *
 * Referenced by the legality table in the design doc, transitionCert()
 * below, and the cert_revoked activity-events row in
 * cert-payment-state-design.md (g).
 */
export const STATE_MACHINE_EXCEPTIONS: ReadonlyArray<ExceptionEntry> = [
  {
    from: 'expired',
    to: 'revoked',
    allowedTriggers: ['refund', 'dispute_lost'],
    reason:
      'R5/R6: a refund or lost dispute on an already-expired cert revokes ' +
      'it post-hoc, preserving the "no funds = no cert" invariant in the ' +
      'historical record. Manual admin revoke and fresh dispute open are ' +
      'NOT in this list — once expired, those triggers are no-ops.',
  },
];

// ─── Base legality table ──────────────────────────────────────────────────────

const ALLOWED_TRANSITIONS: Record<
  CertStatus,
  ReadonlyArray<{
    to: CertStatus;
    triggers: ReadonlyArray<TransitionTrigger>;
  }>
> = {
  pending: [{ to: 'active', triggers: ['payment_succeeded'] }],
  active: [
    { to: 'expired', triggers: ['cron_expire'] },
    { to: 'revoked', triggers: ['admin_revoke', 'refund'] },
    { to: 'disputed', triggers: ['dispute_created'] },
  ],
  disputed: [
    { to: 'active', triggers: ['dispute_won', 'dispute_warning_closed'] },
    { to: 'revoked', triggers: ['dispute_lost'] },
  ],
  expired: [],
  revoked: [],
};

// ─── transitionCert ───────────────────────────────────────────────────────────

/**
 * Validates whether a cert may transition `from → to` under the given trigger.
 *
 * Returns `{ ok: true }` for legal transitions (including same-state no-ops).
 * Returns `{ ok: false, reason }` for illegal transitions — NEVER throws.
 * The webhook handler logs rejections as a `cert_state_transition_blocked`
 * activity event (Stripe must keep getting 200s).
 *
 * Ordering: same-state idempotency is checked first. Then the base legality
 * table. Then the STATE_MACHINE_EXCEPTIONS carve-outs (which can permit
 * an otherwise-illegal terminal-state escape).
 */
export function transitionCert(
  from: CertStatus,
  to: CertStatus,
  trigger: TransitionTrigger
): TransitionResult {
  // 1. Same-state — idempotent no-op.
  if (from === to) return { ok: true };

  // 2. Base legality table.
  const allowed = ALLOWED_TRANSITIONS[from] ?? [];
  const match = allowed.find((entry) => entry.to === to);
  if (match && match.triggers.includes(trigger)) {
    return { ok: true };
  }

  // 3. Carve-out exceptions (terminal-state escapes).
  const exception = STATE_MACHINE_EXCEPTIONS.find((e) => e.from === from && e.to === to);
  if (exception && exception.allowedTriggers.includes(trigger)) {
    return { ok: true };
  }

  // 4. Reject with a useful reason.
  if (match && !match.triggers.includes(trigger)) {
    return {
      ok: false,
      reason: `transition ${from}→${to} is legal but not under trigger '${trigger}' (allowed: ${match.triggers.join(', ')})`,
    };
  }
  return {
    ok: false,
    reason: `transition ${from}→${to} is not allowed (terminal or illegal)`,
  };
}
