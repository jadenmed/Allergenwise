/**
 * tests/unit/cert-state-machine.test.ts
 *
 * Wave 2C cert state machine — pure unit tests.
 *
 * Covers every transition in cert-payment-state-design.md (a):
 *   pending → active                          legal (payment_succeeded)
 *   pending → expired/revoked/disputed        illegal
 *   active  → expired                         legal (cron_expire)
 *   active  → revoked                         legal (admin_revoke or refund)
 *   active  → disputed                        legal (dispute_created)
 *   active  → pending                         illegal
 *   disputed → active                         legal (dispute_won/warning_closed)
 *   disputed → revoked                        legal (dispute_lost)
 *   expired → ANY                             illegal EXCEPT the R5/R6 carve-out
 *   revoked → ANY                             illegal (terminal)
 *
 * STATE_MACHINE_EXCEPTIONS encodes the R5/R6 carve-out as the single source
 * of truth referenced by the legality table, transitionCert(), and the
 * activity-events vocabulary.
 */

import { describe, it, expect } from 'vitest';
import {
  transitionCert,
  STATE_MACHINE_EXCEPTIONS,
  type CertStatus,
  type TransitionTrigger,
} from '@/lib/learner/cert-state';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const ALL_STATUSES: CertStatus[] = ['pending', 'active', 'expired', 'revoked', 'disputed'];

/**
 * Pick a default trigger that "should work" for a (from, to) pair, used when
 * testing legal transitions where multiple triggers fit.
 */
function defaultTrigger(from: CertStatus, to: CertStatus): TransitionTrigger {
  if (from === 'pending' && to === 'active') return 'payment_succeeded';
  if (from === 'active' && to === 'expired') return 'cron_expire';
  if (from === 'active' && to === 'revoked') return 'refund';
  if (from === 'active' && to === 'disputed') return 'dispute_created';
  if (from === 'disputed' && to === 'active') return 'dispute_won';
  if (from === 'disputed' && to === 'revoked') return 'dispute_lost';
  if (from === 'expired' && to === 'revoked') return 'refund';
  return 'payment_succeeded';
}

// ─── STATE_MACHINE_EXCEPTIONS shape invariants ───────────────────────────────

describe('STATE_MACHINE_EXCEPTIONS', () => {
  it('is non-empty (R5/R6 carve-out is encoded)', () => {
    expect(STATE_MACHINE_EXCEPTIONS.length).toBeGreaterThan(0);
  });

  it('contains the expired→revoked carve-out with refund + dispute_lost triggers', () => {
    const carveout = STATE_MACHINE_EXCEPTIONS.find(
      (e) => e.from === 'expired' && e.to === 'revoked'
    );
    expect(carveout, 'expired→revoked exception should exist').toBeDefined();
    expect(carveout!.allowedTriggers).toContain('refund');
    expect(carveout!.allowedTriggers).toContain('dispute_lost');
  });

  it('does NOT include admin_revoke or dispute_created in the expired→revoked exception', () => {
    const carveout = STATE_MACHINE_EXCEPTIONS.find(
      (e) => e.from === 'expired' && e.to === 'revoked'
    );
    expect(carveout!.allowedTriggers).not.toContain('admin_revoke');
    expect(carveout!.allowedTriggers).not.toContain('dispute_created');
  });

  it('every exception entry has a non-empty reason string', () => {
    for (const e of STATE_MACHINE_EXCEPTIONS) {
      expect(typeof e.reason).toBe('string');
      expect(e.reason.length).toBeGreaterThan(0);
    }
  });
});

// ─── Legal transitions ────────────────────────────────────────────────────────

describe('transitionCert — legal transitions', () => {
  it('pending → active via payment_succeeded', () => {
    const r = transitionCert('pending', 'active', 'payment_succeeded');
    expect(r.ok).toBe(true);
  });

  it('active → expired via cron_expire', () => {
    expect(transitionCert('active', 'expired', 'cron_expire').ok).toBe(true);
  });

  it('active → revoked via admin_revoke', () => {
    expect(transitionCert('active', 'revoked', 'admin_revoke').ok).toBe(true);
  });

  it('active → revoked via refund', () => {
    expect(transitionCert('active', 'revoked', 'refund').ok).toBe(true);
  });

  it('active → disputed via dispute_created', () => {
    expect(transitionCert('active', 'disputed', 'dispute_created').ok).toBe(true);
  });

  it('disputed → active via dispute_won', () => {
    expect(transitionCert('disputed', 'active', 'dispute_won').ok).toBe(true);
  });

  it('disputed → active via dispute_warning_closed', () => {
    expect(transitionCert('disputed', 'active', 'dispute_warning_closed').ok).toBe(true);
  });

  it('disputed → revoked via dispute_lost', () => {
    expect(transitionCert('disputed', 'revoked', 'dispute_lost').ok).toBe(true);
  });

  it('expired → revoked via refund (R5 carve-out)', () => {
    const r = transitionCert('expired', 'revoked', 'refund');
    expect(r.ok).toBe(true);
  });

  it('expired → revoked via dispute_lost (R6 carve-out)', () => {
    const r = transitionCert('expired', 'revoked', 'dispute_lost');
    expect(r.ok).toBe(true);
  });
});

// ─── Idempotent same-state transitions ───────────────────────────────────────

describe('transitionCert — idempotent (same state)', () => {
  for (const s of ALL_STATUSES) {
    it(`${s} → ${s} is a no-op (ok with same-state marker)`, () => {
      const r = transitionCert(s, s, defaultTrigger(s, s));
      expect(r.ok).toBe(true);
    });
  }
});

// ─── Illegal transitions ──────────────────────────────────────────────────────

describe('transitionCert — illegal transitions', () => {
  it('pending → expired is illegal', () => {
    const r = transitionCert('pending', 'expired', 'cron_expire');
    expect(r.ok).toBe(false);
  });

  it('pending → revoked is illegal', () => {
    expect(transitionCert('pending', 'revoked', 'admin_revoke').ok).toBe(false);
  });

  it('pending → disputed is illegal (must become active first)', () => {
    expect(transitionCert('pending', 'disputed', 'dispute_created').ok).toBe(false);
  });

  it('active → pending is illegal (once paid, never un-paid)', () => {
    expect(transitionCert('active', 'pending', 'payment_succeeded').ok).toBe(false);
  });

  it('expired → active is illegal (terminal except via R5/R6)', () => {
    expect(transitionCert('expired', 'active', 'payment_succeeded').ok).toBe(false);
  });

  it('expired → revoked via admin_revoke is illegal (NOT in carve-out)', () => {
    expect(transitionCert('expired', 'revoked', 'admin_revoke').ok).toBe(false);
  });

  it('expired → revoked via dispute_created is illegal (NOT in carve-out)', () => {
    expect(transitionCert('expired', 'revoked', 'dispute_created').ok).toBe(false);
  });

  it('expired → disputed is illegal', () => {
    expect(transitionCert('expired', 'disputed', 'dispute_created').ok).toBe(false);
  });

  it('revoked → active is illegal (terminal)', () => {
    expect(transitionCert('revoked', 'active', 'dispute_won').ok).toBe(false);
  });

  it('revoked → expired is illegal (terminal)', () => {
    expect(transitionCert('revoked', 'expired', 'cron_expire').ok).toBe(false);
  });

  it('revoked → disputed is illegal (revoked is terminal even if dispute opens later)', () => {
    expect(transitionCert('revoked', 'disputed', 'dispute_created').ok).toBe(false);
  });
});

// ─── Rejection structure ──────────────────────────────────────────────────────

describe('transitionCert — rejection structure', () => {
  it('returns { ok: false, reason: string } for illegal transitions (never throws)', () => {
    const r = transitionCert('revoked', 'active', 'dispute_won');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(typeof r.reason).toBe('string');
      expect(r.reason.length).toBeGreaterThan(0);
    }
  });
});
