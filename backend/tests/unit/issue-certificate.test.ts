/**
 * tests/unit/issue-certificate.test.ts
 *
 * Phase 09 (B11) — issueCertificateForPassedExam() extracted out of
 * app/api/exam/submit/route.ts's POST handler into lib/learner/issue-certificate.ts.
 * This is the "testable in isolation" coverage the audit calls out: prior to
 * this extraction, the cert-code collision-retry loop was only exercisable
 * indirectly via the full route (see tests/unit/exam-submit-cert-code.test.ts).
 * These tests call the extracted function directly with a mock `db`.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CERT_CODE_REGEX } from '@/lib/learner/cert-code';
import { issueCertificateForPassedExam } from '@/lib/learner/issue-certificate';

vi.mock('server-only', () => ({}));

const { sendEmailMock } = vi.hoisted(() => ({
  sendEmailMock: vi.fn().mockResolvedValue({ ok: true, id: 'mock-email' }),
}));

vi.mock('@/lib/email/send', () => ({
  sendEmail: sendEmailMock,
}));

const RESTAURANT_ID = '22222222-2222-2222-2222-222222222222';
const ACTOR_ID = '11111111-1111-1111-1111-111111111111';
const ATTEMPT_ID = '33333333-3333-3333-3333-333333333333';
const NEW_CERT_ID = '44444444-4444-4444-4444-444444444444';
const LEARNER_NAME = 'Jane Learner';
const RESTAURANT_NAME = 'The Test Bistro';

const capturedInserts: Array<{ table: string; row: Record<string, unknown> }> = [];
const certInsertOutcomes: Array<{ data: { id: string } | null; error: { code?: string } | null }> =
  [];

/**
 * `listResult` is what awaiting the builder itself resolves to — as opposed to
 * `result`, which `.single()`/`.maybeSingle()` return. T-49 added a list read
 * (the duplicate-issuance guard: this learner's certificates in a blocking
 * status), and it must resolve to an ARRAY while the insert's `.single()` keeps
 * resolving to a row. The default `{data: []}` means "this learner holds no
 * blocking certificate", which is the precondition every test in this file
 * assumes: they are all about the FIRST certificate.
 */
function chain(table: string, result: unknown, listResult: unknown = { data: [], error: null }) {
  const c: Record<string, unknown> = {};
  const passthrough = ['select', 'eq', 'in', 'order', 'limit'];
  for (const m of passthrough) c[m] = vi.fn(() => c);
  c.then = (onF: (v: unknown) => unknown) => Promise.resolve(listResult).then(onF);
  c.insert = vi.fn((row: Record<string, unknown>) => {
    capturedInserts.push({ table, row });
    if (table === 'certificates' && certInsertOutcomes.length > 0) {
      const next = certInsertOutcomes.shift()!;
      const certChain: Record<string, unknown> = {
        select: vi.fn(() => certChain),
        single: vi.fn(async () => next),
      };
      return certChain;
    }
    return c;
  });
  c.single = vi.fn(async () => result);
  c.maybeSingle = vi.fn(async () => result);
  return c;
}

function makeMockDb() {
  return {
    from: vi.fn((table: string) => {
      if (table === 'profiles') {
        return chain('profiles', {
          data: { email: 'manager@bistro.example', full_name: 'Manager Person' },
          error: null,
        });
      }
      if (table === 'certificates') {
        return chain('certificates', { data: { id: NEW_CERT_ID }, error: null });
      }
      return chain(table, { data: null, error: null });
    }),
  } as unknown as Parameters<typeof issueCertificateForPassedExam>[0]['db'];
}

beforeEach(() => {
  vi.clearAllMocks();
  capturedInserts.length = 0;
  certInsertOutcomes.length = 0;
});

describe('issueCertificateForPassedExam', () => {
  it('first-attempt success: no collision events, cert_issued + exam_passed written, certCode returned', async () => {
    certInsertOutcomes.push({ data: { id: NEW_CERT_ID }, error: null });
    const db = makeMockDb();

    const result = await issueCertificateForPassedExam({
      db,
      restaurantId: RESTAURANT_ID,
      actorId: ACTOR_ID,
      attemptId: ATTEMPT_ID,
      scorePercent: 92,
      learnerName: LEARNER_NAME,
      restaurantName: RESTAURANT_NAME,
    });

    expect(result.certCode).toMatch(CERT_CODE_REGEX);

    const certInserts = capturedInserts.filter((c) => c.table === 'certificates');
    expect(certInserts).toHaveLength(1);

    const retryEvents = capturedInserts.filter(
      (c) => c.table === 'activity_events' && c.row.type === 'cert_code_collision_retry'
    );
    expect(retryEvents).toHaveLength(0);

    const issuedEvents = capturedInserts.filter(
      (c) => c.table === 'activity_events' && c.row.type === 'cert_issued'
    );
    expect(issuedEvents).toHaveLength(1);
    expect((issuedEvents[0].row.payload as Record<string, unknown>).certificate_id).toBe(
      NEW_CERT_ID
    );

    const passedEvents = capturedInserts.filter(
      (c) => c.table === 'activity_events' && c.row.type === 'exam_passed'
    );
    expect(passedEvents).toHaveLength(1);
    expect((passedEvents[0].row.payload as Record<string, unknown>).scorePercent).toBe(92);

    expect(sendEmailMock).toHaveBeenCalledTimes(1);
    expect(sendEmailMock).toHaveBeenCalledWith(
      'EmployeeExamPassedNotice',
      'manager@bistro.example',
      {
        adminName: 'Manager Person',
        learnerName: LEARNER_NAME,
        restaurantName: RESTAURANT_NAME,
        scorePercent: 92,
        certCode: result.certCode,
      }
    );
  });

  it('one collision then success: exactly one cert_code_collision_retry event, no exhausted event', async () => {
    certInsertOutcomes.push({ data: null, error: { code: '23505' } });
    certInsertOutcomes.push({ data: { id: NEW_CERT_ID }, error: null });
    const db = makeMockDb();

    const result = await issueCertificateForPassedExam({
      db,
      restaurantId: RESTAURANT_ID,
      actorId: ACTOR_ID,
      attemptId: ATTEMPT_ID,
      scorePercent: 88,
      learnerName: LEARNER_NAME,
      restaurantName: RESTAURANT_NAME,
    });

    expect(result.certCode).toBeDefined();
    expect(sendEmailMock).toHaveBeenCalledTimes(1);

    const certInserts = capturedInserts.filter((c) => c.table === 'certificates');
    expect(certInserts).toHaveLength(2);

    const retryEvents = capturedInserts.filter(
      (c) => c.table === 'activity_events' && c.row.type === 'cert_code_collision_retry'
    );
    expect(retryEvents).toHaveLength(1);
    expect((retryEvents[0].row.payload as Record<string, unknown>).attempt).toBe(1);

    const exhaustedEvents = capturedInserts.filter(
      (c) => c.table === 'activity_events' && c.row.type === 'cert_issuance_retry_exhausted'
    );
    expect(exhaustedEvents).toHaveLength(0);
  });

  it('three consecutive collisions: two retry events + one exhausted event, certCode undefined', async () => {
    certInsertOutcomes.push({ data: null, error: { code: '23505' } });
    certInsertOutcomes.push({ data: null, error: { code: '23505' } });
    certInsertOutcomes.push({ data: null, error: { code: '23505' } });
    const db = makeMockDb();

    const result = await issueCertificateForPassedExam({
      db,
      restaurantId: RESTAURANT_ID,
      actorId: ACTOR_ID,
      attemptId: ATTEMPT_ID,
      scorePercent: 100,
      learnerName: LEARNER_NAME,
      restaurantName: RESTAURANT_NAME,
    });

    expect(result.certCode).toBeUndefined();
    // certCode never resolved — the notice guard (adminRes.data && certCode)
    // must skip the send rather than mail a literal "undefined" cert code.
    expect(sendEmailMock).not.toHaveBeenCalled();

    const certInserts = capturedInserts.filter((c) => c.table === 'certificates');
    expect(certInserts).toHaveLength(3);

    const retryEvents = capturedInserts.filter(
      (c) => c.table === 'activity_events' && c.row.type === 'cert_code_collision_retry'
    );
    expect(retryEvents).toHaveLength(2);
    expect((retryEvents[0].row.payload as Record<string, unknown>).attempt).toBe(1);
    expect((retryEvents[1].row.payload as Record<string, unknown>).attempt).toBe(2);

    const exhaustedEvents = capturedInserts.filter(
      (c) => c.table === 'activity_events' && c.row.type === 'cert_issuance_retry_exhausted'
    );
    expect(exhaustedEvents).toHaveLength(1);
    expect((exhaustedEvents[0].row.payload as Record<string, unknown>).attempts).toBe(3);

    // No cert_issued/exam_passed events — certificateId never resolved.
    const issuedEvents = capturedInserts.filter(
      (c) => c.table === 'activity_events' && c.row.type === 'cert_issued'
    );
    expect(issuedEvents).toHaveLength(0);
  });

  it('non-23505 insert error: no retry, certCode undefined, error logged', async () => {
    certInsertOutcomes.push({ data: null, error: { code: '42501' } });
    const db = makeMockDb();
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await issueCertificateForPassedExam({
      db,
      restaurantId: RESTAURANT_ID,
      actorId: ACTOR_ID,
      attemptId: ATTEMPT_ID,
      scorePercent: 85,
      learnerName: LEARNER_NAME,
      restaurantName: RESTAURANT_NAME,
    });

    expect(result.certCode).toBeUndefined();
    expect(sendEmailMock).not.toHaveBeenCalled();

    const certInserts = capturedInserts.filter((c) => c.table === 'certificates');
    expect(certInserts).toHaveLength(1);

    const retryEvents = capturedInserts.filter(
      (c) => c.table === 'activity_events' && c.row.type === 'cert_code_collision_retry'
    );
    expect(retryEvents).toHaveLength(0);

    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '[exam/submit] cert insert error:',
      expect.objectContaining({ code: '42501' })
    );

    consoleErrorSpy.mockRestore();
  });
});
