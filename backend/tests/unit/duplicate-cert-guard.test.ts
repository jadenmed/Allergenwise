/**
 * tests/unit/duplicate-cert-guard.test.ts
 *
 * T-49 — one learner, one current certificate.
 *
 * THE BUG
 * ───────
 * `checkCooldown` (lib/learner/exam.ts) gates on three submitted attempts and a
 * 24h wait after a FAILURE. Its cooldown branch is `if (!lastPassed)`, so a
 * learner who PASSED fell straight through to `canAttempt: true`, and
 * /api/exam/submit issued a certificate on every pass. Pass twice, hold two
 * certificates — and be billed twice, because /api/submissions/create prices
 * the Checkout Session at CERT_FEE_CENTS × pendingCertCount and
 * `pendingCertCount` counts certificate ROWS.
 *
 * This file covers the two lowest layers of the fix:
 *   1. The pure predicate (lib/learner/cert-state.ts) — which certificates
 *      block a new issuance, and, just as load-bearing, which do NOT.
 *   2. The structural backstop inside `issueCertificateForPassedExam`, the
 *      layer a future caller cannot skip because it lives inside the only code
 *      that inserts a `certificates` row.
 *
 * Route-level coverage is in exam-start-duplicate-cert-guard.test.ts and
 * exam-submit-duplicate-cert-guard.test.ts. The billing consequence is in
 * billing-one-cert-per-learner.test.ts.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  ISSUANCE_BLOCKING_STATUSES,
  blocksNewCertIssuance,
  findIssuanceBlockingCert,
} from '@/lib/learner/cert-state';
import { issueCertificateForPassedExam } from '@/lib/learner/issue-certificate';

vi.mock('server-only', () => ({}));

const { sendEmailMock } = vi.hoisted(() => ({
  sendEmailMock: vi.fn().mockResolvedValue({ ok: true, id: 'mock-email' }),
}));

vi.mock('@/lib/email/send', () => ({ sendEmail: sendEmailMock }));

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const NOW = Date.parse('2026-08-05T12:00:00.000Z');
const FUTURE = '2028-08-05T12:00:00.000Z';
const PAST = '2025-08-05T12:00:00.000Z';

const RESTAURANT_ID = '22222222-2222-2222-2222-222222222222';
const ACTOR_ID = '11111111-1111-1111-1111-111111111111';
const ATTEMPT_ID = '33333333-3333-3333-3333-333333333333';
const NEW_CERT_ID = '44444444-4444-4444-4444-444444444444';
const HELD_CERT_ID = '55555555-5555-5555-5555-555555555555';
const HELD_CERT_CODE = 'AW-T49AA-BBBB1-2';

// ─── 1. The pure predicate ────────────────────────────────────────────────────

describe('blocksNewCertIssuance — which certificates forbid a second one', () => {
  it('a PENDING certificate blocks: this is the double-billing case', () => {
    // Two pending rows for one person is what /api/submissions/create prices at
    // $70 to certify one employee.
    expect(blocksNewCertIssuance({ status: 'pending', expires_at: FUTURE }, NOW)).toBe(true);
  });

  it('an unexpired ACTIVE certificate blocks', () => {
    expect(blocksNewCertIssuance({ status: 'active', expires_at: FUTURE }, NOW)).toBe(true);
  });

  it('an EXPIRED certificate does NOT block — retaking the exam is the renewal flow', () => {
    // Not an edge case. There is no reissue endpoint: the product tells learners
    // to retake the exam to renew, in the learner certificate page, the pricing
    // FAQ, the public verify page and the CertExpiringSoon email. A guard keyed
    // on "holds a certificate" would have killed that flow.
    expect(blocksNewCertIssuance({ status: 'expired', expires_at: PAST }, NOW)).toBe(false);
  });

  it('a REVOKED certificate does NOT block — it does not count toward eligibility', () => {
    // checkEligibility counts only pending|active, so a learner whose
    // certificate was revoked must be able to earn a new one or their
    // restaurant can never list again.
    expect(blocksNewCertIssuance({ status: 'revoked', expires_at: FUTURE }, NOW)).toBe(false);
  });

  it('a DISPUTED certificate does NOT block — same reason, and no funds means no cert', () => {
    expect(blocksNewCertIssuance({ status: 'disputed', expires_at: FUTURE }, NOW)).toBe(false);
  });

  it('an ACTIVE certificate whose expiry has passed does NOT block (expire-certs cron lag)', () => {
    // active → expired is driven by a scheduled cron. Between a certificate
    // lapsing and the cron noticing, the row still reads `active`. Treating
    // that window as blocking would refuse a legitimate renewal for up to a day.
    expect(blocksNewCertIssuance({ status: 'active', expires_at: PAST }, NOW)).toBe(false);
  });

  it('fails CLOSED on a missing or unparseable expires_at', () => {
    // Unreachable in practice — the column is NOT NULL since 0001_init. If it
    // is ever reached, refusing an exam is recoverable; double-charging a
    // restaurant is not.
    expect(blocksNewCertIssuance({ status: 'pending', expires_at: null }, NOW)).toBe(true);
    expect(blocksNewCertIssuance({ status: 'active', expires_at: 'not-a-date' }, NOW)).toBe(true);
  });

  it('an absent status does not block', () => {
    expect(blocksNewCertIssuance({ status: null, expires_at: FUTURE }, NOW)).toBe(false);
    expect(blocksNewCertIssuance({ status: undefined, expires_at: FUTURE }, NOW)).toBe(false);
  });
});

describe('findIssuanceBlockingCert', () => {
  it('returns null when the learner holds only expired, revoked and disputed certificates', () => {
    const certs = [
      { id: 'a', status: 'expired', expires_at: PAST },
      { id: 'b', status: 'revoked', expires_at: FUTURE },
      { id: 'c', status: 'disputed', expires_at: FUTURE },
    ];
    expect(findIssuanceBlockingCert(certs, NOW)).toBeNull();
  });

  it('finds the one blocking certificate in a mixed history', () => {
    const certs = [
      { id: 'old', status: 'expired', expires_at: PAST },
      { id: 'current', status: 'active', expires_at: FUTURE },
      { id: 'older', status: 'expired', expires_at: PAST },
    ];
    expect(findIssuanceBlockingCert(certs, NOW)?.id).toBe('current');
  });

  it('returns null for an empty history — a first-time learner is never blocked', () => {
    expect(findIssuanceBlockingCert([], NOW)).toBeNull();
  });
});

// ─── 2. The symmetry with eligibility ─────────────────────────────────────────

describe('the blocking set matches what checkEligibility counts as certified', () => {
  it('ISSUANCE_BLOCKING_STATUSES is exactly [pending, active]', () => {
    expect([...ISSUANCE_BLOCKING_STATUSES]).toEqual(['pending', 'active']);
  });

  it('lib/admin/eligibility.ts still queries those same two statuses', () => {
    // The structural half. The guard is only correct because it refuses a new
    // exam in exactly the cases where eligibility already counts that learner
    // as certified. If someone narrows eligibility's filter — back to
    // .eq('status','active'), say — the two halves disagree about who still
    // needs certifying, and this fails rather than letting them drift apart.
    const src = readFileSync(resolve(__dirname, '..', '..', 'lib/admin/eligibility.ts'), 'utf8');
    expect(src).toMatch(/\.in\('status',\s*\['pending',\s*'active'\]\)/);
    expect(src).toMatch(/\.gt\('expires_at',\s*now\)/);
  });
});

// ─── 3. The structural backstop inside the issuer ─────────────────────────────

const capturedInserts: Array<{ table: string; row: Record<string, unknown> }> = [];

/**
 * `heldCerts` is what the T-49 guard read returns — this learner's certificates
 * in a blocking status, straight from PostgREST, before the expiry half of the
 * predicate is applied in TypeScript.
 */
function makeMockDb(heldCerts: Array<Record<string, unknown>>) {
  const chain = (table: string, result: unknown, listResult: unknown) => {
    const c: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'in', 'order', 'limit']) c[m] = vi.fn(() => c);
    c.insert = vi.fn((row: Record<string, unknown>) => {
      capturedInserts.push({ table, row });
      return c;
    });
    c.single = vi.fn(async () => result);
    c.maybeSingle = vi.fn(async () => result);
    c.then = (onF: (v: unknown) => unknown) => Promise.resolve(listResult).then(onF);
    return c;
  };

  return {
    from: vi.fn((table: string) => {
      if (table === 'certificates') {
        return chain(
          'certificates',
          { data: { id: NEW_CERT_ID }, error: null },
          { data: heldCerts, error: null }
        );
      }
      if (table === 'profiles') {
        return chain(
          'profiles',
          { data: { email: 'manager@bistro.example', full_name: 'Manager Person' }, error: null },
          { data: [], error: null }
        );
      }
      return chain(table, { data: null, error: null }, { data: [], error: null });
    }),
  } as unknown as Parameters<typeof issueCertificateForPassedExam>[0]['db'];
}

const issueParams = (db: Parameters<typeof issueCertificateForPassedExam>[0]['db']) => ({
  db,
  restaurantId: RESTAURANT_ID,
  actorId: ACTOR_ID,
  attemptId: ATTEMPT_ID,
  scorePercent: 92,
  learnerName: 'Jane Learner',
  restaurantName: 'The Test Bistro',
});

beforeEach(() => {
  vi.clearAllMocks();
  capturedInserts.length = 0;
});

describe('issueCertificateForPassedExam — the guard a future caller cannot skip', () => {
  it('refuses to insert a SECOND certificate when the learner holds a pending one', async () => {
    const db = makeMockDb([
      { id: HELD_CERT_ID, cert_code: HELD_CERT_CODE, status: 'pending', expires_at: FUTURE },
    ]);

    const result = await issueCertificateForPassedExam(issueParams(db));

    expect(result.blocked, 'the refusal must be distinguishable from a failure').toBe(true);
    expect(result.certCode).toBeUndefined();

    // The headline assertion: no second row.
    expect(capturedInserts.filter((c) => c.table === 'certificates')).toHaveLength(0);
  });

  it('refuses when the learner holds an unexpired active certificate', async () => {
    const db = makeMockDb([
      { id: HELD_CERT_ID, cert_code: HELD_CERT_CODE, status: 'active', expires_at: FUTURE },
    ]);

    const result = await issueCertificateForPassedExam(issueParams(db));

    expect(result.blocked).toBe(true);
    expect(capturedInserts.filter((c) => c.table === 'certificates')).toHaveLength(0);
  });

  it('logs cert_issuance_blocked_duplicate naming the certificate that blocked it', async () => {
    // A block reaching this layer means a route guard was bypassed — a new
    // caller, or the surplus half of a race. Silence would make that invisible.
    const db = makeMockDb([
      { id: HELD_CERT_ID, cert_code: HELD_CERT_CODE, status: 'active', expires_at: FUTURE },
    ]);

    await issueCertificateForPassedExam(issueParams(db));

    const blocked = capturedInserts.filter(
      (c) => c.table === 'activity_events' && c.row.type === 'cert_issuance_blocked_duplicate'
    );
    expect(blocked).toHaveLength(1);

    const payload = blocked[0].row.payload as Record<string, unknown>;
    expect(payload.blocking_certificate_id).toBe(HELD_CERT_ID);
    expect(payload.blocking_cert_code).toBe(HELD_CERT_CODE);
    expect(payload.blocking_status).toBe('active');
    expect(payload.exam_attempt_id).toBe(ATTEMPT_ID);
  });

  it('writes no cert_issued or exam_passed event and sends no email when blocked', async () => {
    // The manager was already told when the first certificate was issued.
    const db = makeMockDb([
      { id: HELD_CERT_ID, cert_code: HELD_CERT_CODE, status: 'pending', expires_at: FUTURE },
    ]);

    await issueCertificateForPassedExam(issueParams(db));

    const issued = capturedInserts.filter(
      (c) => c.table === 'activity_events' && c.row.type === 'cert_issued'
    );
    const passed = capturedInserts.filter(
      (c) => c.table === 'activity_events' && c.row.type === 'exam_passed'
    );
    expect(issued).toHaveLength(0);
    expect(passed).toHaveLength(0);
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it('ISSUES normally when the learner holds no blocking certificate (renewal after expiry)', async () => {
    // The control. Without it, a guard that blocked everything would pass every
    // other case in this describe block. Expired certificates never reach the
    // predicate — the SQL status filter excludes them.
    const db = makeMockDb([]);

    const result = await issueCertificateForPassedExam(issueParams(db));

    expect(result.blocked).toBeUndefined();
    expect(result.certCode).toBeDefined();
    expect(capturedInserts.filter((c) => c.table === 'certificates')).toHaveLength(1);
    expect(sendEmailMock).toHaveBeenCalledTimes(1);
  });

  it('ISSUES normally when a returned row is active but already past its expiry', async () => {
    // The status filter runs in SQL, so a lapsed-but-not-yet-swept certificate
    // still comes back from the query. The expiry half of the predicate is what
    // must let it through — proving the decision is made in TypeScript rather
    // than by the WHERE clause.
    const db = makeMockDb([
      { id: HELD_CERT_ID, cert_code: HELD_CERT_CODE, status: 'active', expires_at: PAST },
    ]);

    const result = await issueCertificateForPassedExam(issueParams(db));

    expect(result.blocked).toBeUndefined();
    expect(capturedInserts.filter((c) => c.table === 'certificates')).toHaveLength(1);
  });
});
