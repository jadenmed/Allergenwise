/**
 * tests/unit/reviewer-email-cert-count.test.ts
 *
 * T-47 — the number the reviewer email reports.
 *
 * T-41b moved the RestaurantSubmitted email into finalizeSubmission and, in
 * doing so, changed what its count MEANS: it became "certificates this payment
 * just activated" instead of "certificates this restaurant holds". A reviewer
 * approving a listing reads that number as staff coverage. On a resubmission
 * where 3 of 10 staff are new it said 3; where everyone was already certified
 * it said 0.
 *
 * The fix is a live read, and these tests pin the three things that make it
 * correct:
 *
 *   1. The email reports the restaurant's total, not the delta.
 *   2. A FAILED count is `null` — never 0. That is the T-18 defect verbatim:
 *      a `?? 0` fallback shipped a green stat that told the public every
 *      restaurant was fully certified. `null` renders as "Unavailable".
 *   3. The predicate matches app/api/reviewer/queue/route.ts EXACTLY
 *      (status='active' AND expires_at > now, counting certificate ROWS). If
 *      the email and the queue disagree about the same submission, the
 *      reviewer has no way to know which one is lying.
 *
 * `activatedCount` survives alongside it in the activity_events payload — how
 * many certificates one payment bought is the money trail, and it is a
 * genuinely different number from how many the restaurant holds.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as React from 'react';
import { render } from '@react-email/components';

const mockSendEmail = vi.fn().mockResolvedValue({ ok: true });

vi.mock('@/lib/email/send', () => ({
  sendEmail: (...args: unknown[]) => mockSendEmail(...args),
}));

vi.mock('@/lib/app-url', () => ({
  resolveAppUrl: () => 'https://app.test',
}));

import { finalizeSubmission } from '@/lib/submissions/finalize';
import type { ServiceDb } from '@/lib/db/service';
import RestaurantSubmitted from '@/lib/email/templates/RestaurantSubmitted';

const REST_ID = '11111111-1111-4111-8111-111111111111';
const MANAGER_ID = '22222222-2222-4222-8222-222222222222';
const SUBMISSION_ID = '33333333-3333-4333-8333-333333333333';

// ── Fake DB ───────────────────────────────────────────────────────────────────
// PostgREST builders are thenables, so the certificates stub is one too — an
// `await` on the builder itself is exactly how the production code reads it.

interface CertQuery {
  columns: string;
  options: { count?: string; head?: boolean } | undefined;
  filters: Record<string, unknown>;
}

function makeDb(cfg: {
  /** What the certificates count query resolves to. */
  certCount?: number | null;
  certError?: { message: string } | null;
  /** Make the count query REJECT rather than resolve with an error. */
  certThrows?: boolean;
  restaurantName?: string;
}) {
  const activityInserts: Record<string, unknown>[] = [];
  const certQueries: CertQuery[] = [];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const from = (table: string): any => {
    switch (table) {
      case 'submissions':
        return {
          insert: () => ({
            select: () => ({
              single: async () => ({ data: { id: SUBMISSION_ID }, error: null }),
            }),
          }),
        };

      case 'restaurants':
        return {
          update: () => ({ eq: async () => ({ error: null }) }),
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: { name: cfg.restaurantName ?? 'The Green Fork' },
                error: null,
              }),
            }),
          }),
        };

      case 'activity_events':
        return {
          insert: async (row: Record<string, unknown>) => {
            activityInserts.push(row);
            return { error: null };
          },
        };

      case 'certificates': {
        const filters: Record<string, unknown> = {};
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const q: any = {
          select: (columns: string, options?: { count?: string; head?: boolean }) => {
            certQueries.push({ columns, options, filters });
            return q;
          },
          eq: (column: string, value: unknown) => {
            filters[column] = value;
            return q;
          },
          gt: (column: string, value: unknown) => {
            filters[`${column}>`] = value;
            return q;
          },
          then: (
            resolve: (v: { count: number | null; error: unknown }) => unknown,
            reject: (e: unknown) => unknown
          ) =>
            (cfg.certThrows
              ? Promise.reject(new Error('fetch failed'))
              : Promise.resolve({
                  count: cfg.certCount ?? null,
                  error: cfg.certError ?? null,
                })
            ).then(resolve, reject),
        };
        return q;
      }

      default:
        throw new Error(`unexpected table in finalizeSubmission: ${table}`);
    }
  };

  return {
    db: { from } as unknown as ServiceDb,
    activityInserts,
    certQueries,
  };
}

function run(db: ServiceDb, activatedCount: number, certFeeTotalCents = activatedCount * 3500) {
  return finalizeSubmission({
    db,
    restaurantId: REST_ID,
    submittedBy: MANAGER_ID,
    checkoutSessionId: activatedCount === 0 ? null : `cs_t47_${activatedCount}`,
    paymentIntentId: activatedCount === 0 ? null : `pi_t47_${activatedCount}`,
    certFeeTotalCents,
    activatedCount,
    actorId: null,
  });
}

/** The email is fired non-blocking (`void ... .catch()`), so wait for it. */
async function emailProps(): Promise<Record<string, unknown>> {
  await vi.waitFor(() => expect(mockSendEmail).toHaveBeenCalled());
  const call = mockSendEmail.mock.calls[0] as [string, string, Record<string, unknown>];
  expect(call[0], 'template name').toBe('RestaurantSubmitted');
  return call[2];
}

async function renderToText(certifiedCount: number | null): Promise<string> {
  const html = await render(
    React.createElement(RestaurantSubmitted, {
      restaurantName: 'The Green Fork',
      submissionId: 'sub_abc123',
      certifiedCount,
      reviewLink: 'https://app.test/reviewer/queue/sub_abc123',
    }),
    { pretty: false }
  );
  return String(html)
    .replace(/<[^>]*>/g, ' ')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('T-47 — the reviewer email reports total certified staff', () => {
  beforeEach(() => {
    mockSendEmail.mockClear();
  });

  it('sends the restaurant TOTAL, not the certificates this payment activated', async () => {
    // 7 already active + 3 newly activated = 10 on the restaurant.
    const { db } = makeDb({ certCount: 10 });

    const result = await run(db, 3);
    expect(result.outcome).toBe('created');

    const props = await emailProps();
    expect(props.certifiedCount, 'the reviewer sees the whole staff, not the delta').toBe(10);
    expect(props.certifiedCount).not.toBe(3);
  });

  it('reports the full staff count on the zero-pending resubmission, not 0', async () => {
    // Every learner already holds an active cert. Nothing was charged, nothing
    // was activated — and the restaurant still has 10 certified staff.
    const { db } = makeDb({ certCount: 10 });

    const result = await run(db, 0, 0);
    expect(result.outcome).toBe('created');

    const props = await emailProps();
    expect(props.certifiedCount, 'nothing activated is not nobody certified').toBe(10);
  });

  it('sends null — never 0 — when the count query fails', async () => {
    const { db } = makeDb({ certCount: null, certError: { message: 'connection reset' } });

    await run(db, 3);

    const props = await emailProps();
    expect(props.certifiedCount, 'T-18: a failed count must not render as 0').toBeNull();
  });

  it('counts with the reviewer queue predicate exactly: status=active AND expires_at > now', async () => {
    const { db, certQueries } = makeDb({ certCount: 4 });

    const before = new Date().toISOString();
    await run(db, 1);
    await emailProps();
    const after = new Date().toISOString();

    expect(certQueries, 'exactly one certificates count query').toHaveLength(1);
    const [q] = certQueries;

    // Rows, not learners — app/api/reviewer/queue/route.ts counts rows, so a
    // staff member holding two certificates counts the same on both surfaces.
    expect(q.options?.count).toBe('exact');
    expect(q.options?.head).toBe(true);

    expect(q.filters.restaurant_id).toBe(REST_ID);
    expect(q.filters.status, 'BOTH clauses — status').toBe('active');
    const expiresAfter = q.filters['expires_at>'] as string;
    expect(expiresAfter, 'BOTH clauses — expires_at > now').toBeTypeOf('string');
    expect(expiresAfter >= before && expiresAfter <= after, 'expires_at bound is "now"').toBe(true);
  });

  it('records BOTH counts in the activity_events payload, and they differ', async () => {
    const { db, activityInserts } = makeDb({ certCount: 10 });

    await run(db, 3);

    expect(activityInserts).toHaveLength(1);
    const payload = activityInserts[0].payload as Record<string, unknown>;

    // The money trail: this payment bought 3 certificates.
    expect(payload.activatedCount, 'what the payment bought').toBe(3);
    // What the restaurant holds, and what the reviewer was told.
    expect(payload.certifiedCount, 'what the restaurant holds').toBe(10);
    expect(payload.activatedCount).not.toBe(payload.certifiedCount);
  });

  it('a THROWN count still records the submission and still emails the reviewers', async () => {
    // The count is decoration on an email; the submission is the money. A
    // transport-level throw (not a returned `{error}`) must not abort
    // finalizeSubmission after the row is inserted — Stripe would redeliver,
    // hit the duplicate path, and the reviewer email would never be sent at
    // all. Degrade the number, never the submission.
    const { db, activityInserts } = makeDb({ certThrows: true });

    const result = await run(db, 3);
    expect(result.outcome, 'the submission survives a failed count').toBe('created');

    const props = await emailProps();
    expect(props.certifiedCount).toBeNull();
    expect(activityInserts[0].payload).toMatchObject({ activatedCount: 3, certifiedCount: null });
  });

  it('carries certifiedCount: null into the payload when the count fails', async () => {
    const { db, activityInserts } = makeDb({ certCount: null, certError: { message: 'boom' } });

    await run(db, 3);

    const payload = activityInserts[0].payload as Record<string, unknown>;
    expect(payload.activatedCount).toBe(3);
    expect(payload.certifiedCount).toBeNull();
  });
});

describe('T-47 — RestaurantSubmitted renders an unknown count as an absence', () => {
  it('renders "Unavailable" and no fabricated number when certifiedCount is null', async () => {
    const text = await renderToText(null);

    expect(text).toMatch(/Certified staff\s+Unavailable/);
    // No digit may stand where the count belongs...
    expect(text, 'a failed count must not render as a number').not.toMatch(/Certified staff\s+\d/);
    // ...and the preview line must drop its count clause entirely. Case
    // matters: the preview clause is lowercase "certified staff", while
    // "Certified staff" is the table LABEL — which is preceded by the
    // submission id, so a case-insensitive match here would fire on
    // "sub_abc123 Certified staff" and prove nothing.
    expect(text, 'preview must not claim a count it does not have').not.toMatch(
      /\d+\s+certified staff/
    );
  });

  it('still renders a real 0 as 0 — "none certified" is not "count unknown"', async () => {
    const text = await renderToText(0);

    expect(text).toMatch(/Certified staff\s+0/);
    expect(text).not.toContain('Unavailable');
  });

  it('renders a known count in both the table and the preview line', async () => {
    const text = await renderToText(10);

    expect(text).toMatch(/Certified staff\s+10/);
    expect(text).toMatch(/10 certified staff/);
    expect(text).not.toContain('Unavailable');
  });
});
