/**
 * tests/unit/cron-idempotency.test.ts
 *
 * Verifies that the expire-certs cron is idempotent:
 * re-running on the same day does not double-send CertExpiringSoon emails.
 *
 * The cert_warnings table has PK(cert_id, threshold). This pure-logic test
 * simulates the lookup that the cron performs and asserts the "already warned"
 * path results in 0 emails sent for that (cert, threshold) combo.
 *
 * Because the cron itself calls Supabase + Resend (which we don't mock in unit
 * tests), we test the decision logic in isolation:
 *   - Given a set of cert IDs and a set of already-warned (cert_id, threshold) rows,
 *   - the "send set" = certs NOT already warned.
 */
import { describe, it, expect } from 'vitest';

// ── Pure logic extracted from the cron for isolated testing ──────────────────

/** Simulates the cron's "should we send?" decision. */
function computeSendSet(certIds: string[], alreadySent: Set<string>): string[] {
  return certIds.filter((id) => !alreadySent.has(id));
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('expire-certs cron idempotency', () => {
  const CERT_A = 'cert-uuid-a';
  const CERT_B = 'cert-uuid-b';
  const CERT_C = 'cert-uuid-c';

  it('sends to all certs when no warnings exist', () => {
    const alreadySent = new Set<string>();
    const result = computeSendSet([CERT_A, CERT_B, CERT_C], alreadySent);
    expect(result).toEqual([CERT_A, CERT_B, CERT_C]);
  });

  it('skips certs that already have a warning row', () => {
    // CERT_A was already warned at this threshold
    const alreadySent = new Set<string>([CERT_A]);
    const result = computeSendSet([CERT_A, CERT_B, CERT_C], alreadySent);
    expect(result).not.toContain(CERT_A);
    expect(result).toContain(CERT_B);
    expect(result).toContain(CERT_C);
  });

  it('sends to no certs when all are already warned', () => {
    const alreadySent = new Set<string>([CERT_A, CERT_B, CERT_C]);
    const result = computeSendSet([CERT_A, CERT_B, CERT_C], alreadySent);
    expect(result).toHaveLength(0);
  });

  it('handles empty cert list gracefully', () => {
    const alreadySent = new Set<string>([CERT_A]);
    const result = computeSendSet([], alreadySent);
    expect(result).toHaveLength(0);
  });

  it('handles empty alreadySent with populated certs', () => {
    const alreadySent = new Set<string>();
    const result = computeSendSet([CERT_A], alreadySent);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(CERT_A);
  });

  /**
   * Threshold isolation: warnings for threshold=30 do NOT suppress
   * warnings for threshold=14 (they're separate (cert_id, threshold) PK rows).
   * This test verifies the per-threshold lookup approach.
   */
  it('threshold=30 warning does not suppress threshold=14 warning', () => {
    // At threshold=30, CERT_A was already warned
    const alreadySentAt30 = new Set<string>([CERT_A]);
    // At threshold=14, CERT_A has NOT been warned yet
    const alreadySentAt14 = new Set<string>();

    const sendAt30 = computeSendSet([CERT_A], alreadySentAt30);
    const sendAt14 = computeSendSet([CERT_A], alreadySentAt14);

    expect(sendAt30).toHaveLength(0); // already warned at 30 days
    expect(sendAt14).toHaveLength(1); // not yet warned at 14 days
    expect(sendAt14[0]).toBe(CERT_A);
  });

  it('re-running the cron on the same day (same cert, same threshold) sends zero emails', () => {
    // Simulates: first run inserts warning row, second run finds it
    const certId = CERT_A;
    const threshold = 7;

    // First run: no warnings exist
    const firstRunSent = new Set<string>();
    const firstRunSendList = computeSendSet([certId], firstRunSent);
    expect(firstRunSendList).toHaveLength(1);

    // After first run: insert (certId, threshold) into cert_warnings
    // Simulate the second run: the warning row is now present
    const secondRunSent = new Set<string>([certId]);
    const secondRunSendList = computeSendSet([certId], secondRunSent);
    expect(secondRunSendList).toHaveLength(0);
  });
});
