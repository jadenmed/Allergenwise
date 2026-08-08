/**
 * tests/unit/decide.test.ts
 *
 * Tests for lib/reviewer/decide.ts — approve/reject/request_info flows.
 * All dependencies are mocked; no real DB or Resend calls.
 *
 * Coverage:
 *   - approve: RPC called with correct args, email sent, emailQueued=true.
 *   - reject:  RPC called with notes, email sent, emailQueued=true.
 *   - request_info: RPC called, email sent, emailQueued=true.
 *   - RPC error propagates as thrown Error.
 *   - Email failure is non-fatal; emailQueued=false, no rethrow.
 *   - Missing admin contact: email skipped, emailQueued=false.
 *
 * Vitest hoisting note:
 *   vi.mock() factories are hoisted to the top of the file and run before variable
 *   declarations. All spies referenced inside factories must be defined inline
 *   (using vi.fn()) to avoid "Cannot access before initialization" errors.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Hoist spies so they are available in vi.mock factories ───────────────────
// vi.mock() factories are hoisted above all code including const declarations.
// vi.hoisted() is the correct way to define spies used inside factories.

const { rpcSpy, fromSpy, emailSendSpy } = vi.hoisted(() => ({
  rpcSpy: vi.fn(),
  fromSpy: vi.fn(),
  // emailSendSpy mocks lib/email/send.ts sendEmail (the centralized email dispatcher)
  emailSendSpy: vi.fn().mockResolvedValue({ ok: true, id: 'mock-email-id' }),
}));

// ─── Mock supabase/server ──────────────────────────────────────────────────────

vi.mock('@/lib/supabase/server', () => ({
  createServiceSupabase: () => ({
    rpc: rpcSpy,
    from: fromSpy,
  }),
}));

// ─── Mock lib/email/send (centralized email dispatcher used by decide.ts) ────

vi.mock('@/lib/email/send', () => ({
  sendEmail: emailSendSpy,
}));

// ─── Mock lib/email/client (still needed by other transitive imports) ─────────

vi.mock('@/lib/email/client', () => ({
  resend: { emails: { send: vi.fn().mockResolvedValue({ id: 'mock-email' }) } },
  FROM_EMAIL: 'hello@allergenwise.com',
  REVIEWER_EMAIL: 'reviewers@allergenwise.com',
}));

// ─── Mock email templates (needed by send.ts which imports them) ────────────

vi.mock('@/lib/email/templates/RestaurantApproved', () => ({
  RestaurantApproved: () => null,
  SUBJECT_RESTAURANT_APPROVED: 'Restaurant approved',
}));
vi.mock('@/lib/email/templates/RestaurantRejected', () => ({
  RestaurantRejected: () => null,
  SUBJECT_RESTAURANT_REJECTED: 'Restaurant rejected',
}));
vi.mock('@/lib/email/templates/RestaurantInfoRequested', () => ({
  RestaurantInfoRequested: () => null,
  SUBJECT_RESTAURANT_INFO_REQUESTED: 'Info requested',
}));

// ─── Mock server-only (Next.js guard, not applicable in Vitest) ───────────────

vi.mock('server-only', () => ({}));

// ─── Import AFTER mocks ───────────────────────────────────────────────────────

import { decideSubmission } from '@/lib/reviewer/decide';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const SUBMISSION_ID = '00000000-0000-0000-0000-000000000001';
const REVIEWER_ID = '00000000-0000-0000-0000-000000000002';
const RESTAURANT_ID = '00000000-0000-0000-0000-000000000003';
const ADMIN_ID = '00000000-0000-0000-0000-000000000004';

// ─── Mock chain builder ───────────────────────────────────────────────────────

/**
 * Creates a thenable chain for a supabase .from() call.
 * The chain supports .select, .eq filter methods (returning this) and .single terminator.
 */
function makeFromChain(data: unknown, error: unknown = null) {
  const chain: Record<string, unknown> = {};
  chain['select'] = vi.fn().mockReturnValue(chain);
  chain['eq'] = vi.fn().mockReturnValue(chain);
  chain['neq'] = vi.fn().mockReturnValue(chain);
  chain['in'] = vi.fn().mockReturnValue(chain);
  chain['gt'] = vi.fn().mockReturnValue(chain);
  chain['single'] = vi.fn().mockResolvedValue({ data, error });
  chain['maybeSingle'] = vi.fn().mockResolvedValue({ data, error });
  chain['then'] = (onfulfilled: (v: unknown) => unknown, onrejected?: (e: unknown) => unknown) =>
    Promise.resolve({ data, error }).then(onfulfilled, onrejected);
  return chain;
}

/**
 * Sets up fromSpy to serve sequential from() calls:
 *   loadAdminContact makes 3 from() calls:
 *     1. submissions → { restaurant_id, submitted_by }
 *     2. restaurants → { name }
 *     3. profiles    → { email, full_name }
 */
function setupAdminContactMocks() {
  let callIndex = 0;
  const responses = [
    { restaurant_id: RESTAURANT_ID, submitted_by: ADMIN_ID },
    { name: 'The Green Fork' },
    { email: 'admin@restaurant.com', full_name: 'Maria Garcia' },
  ];
  fromSpy.mockImplementation(() => {
    const data = responses[callIndex] ?? null;
    callIndex++;
    return makeFromChain(data);
  });
}

/**
 * Sets up fromSpy to return error on the first call (simulates contact load failure).
 */
function setupContactLoadFailure() {
  fromSpy.mockReturnValue(makeFromChain(null, { message: 'not found' }));
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('decideSubmission — approve', () => {
  beforeEach(() => vi.clearAllMocks());

  it('calls RPC with correct args and returns ok=true with slug + expiry', async () => {
    rpcSpy.mockResolvedValueOnce({
      data: {
        ok: true,
        restaurantSlug: 'the-green-fork-san-diego',
        listingExpiresAt: '2027-04-30T00:00:00Z',
      },
      error: null,
    });
    setupAdminContactMocks();
    emailSendSpy.mockResolvedValueOnce({ ok: true, id: 'email-1' });

    const result = await decideSubmission({
      submissionId: SUBMISSION_ID,
      reviewerId: REVIEWER_ID,
      action: 'approve',
    });

    expect(rpcSpy).toHaveBeenCalledWith('decide_submission', {
      p_submission_id: SUBMISSION_ID,
      p_reviewer_id: REVIEWER_ID,
      p_action: 'approve',
      p_notes: null,
    });
    expect(result.ok).toBe(true);
    expect(result.restaurantSlug).toBe('the-green-fork-san-diego');
    expect(result.listingExpiresAt).toBe('2027-04-30T00:00:00Z');
    expect(result.emailQueued).toBe(true);
  });

  it('sets emailQueued=false when email send throws (non-fatal)', async () => {
    rpcSpy.mockResolvedValueOnce({
      data: { ok: true, restaurantSlug: 'foo-bar', listingExpiresAt: '2027-01-01T00:00:00Z' },
      error: null,
    });
    setupAdminContactMocks();
    // sendEmail never throws — it returns { ok: false, error } on failure
    emailSendSpy.mockRejectedValueOnce(new Error('Unexpected error in sendEmail wrapper'));

    const result = await decideSubmission({
      submissionId: SUBMISSION_ID,
      reviewerId: REVIEWER_ID,
      action: 'approve',
    });

    expect(result.ok).toBe(true);
    expect(result.emailQueued).toBe(false);
  });

  it('sets emailQueued=false when admin contact cannot be loaded', async () => {
    rpcSpy.mockResolvedValueOnce({
      data: { ok: true, restaurantSlug: 'foo-bar', listingExpiresAt: '2027-01-01T00:00:00Z' },
      error: null,
    });
    setupContactLoadFailure();

    const result = await decideSubmission({
      submissionId: SUBMISSION_ID,
      reviewerId: REVIEWER_ID,
      action: 'approve',
    });

    expect(result.ok).toBe(true);
    expect(result.emailQueued).toBe(false);
    expect(emailSendSpy).not.toHaveBeenCalled();
  });
});

describe('decideSubmission — reject', () => {
  beforeEach(() => vi.clearAllMocks());

  it('calls RPC with action=reject and notes, sends email', async () => {
    rpcSpy.mockResolvedValueOnce({ data: { ok: true }, error: null });
    setupAdminContactMocks();
    emailSendSpy.mockResolvedValueOnce({ ok: true, id: 'email-2' });

    const result = await decideSubmission({
      submissionId: SUBMISSION_ID,
      reviewerId: REVIEWER_ID,
      action: 'reject',
      notes: 'Staff certs expired.',
    });

    expect(rpcSpy).toHaveBeenCalledWith('decide_submission', {
      p_submission_id: SUBMISSION_ID,
      p_reviewer_id: REVIEWER_ID,
      p_action: 'reject',
      p_notes: 'Staff certs expired.',
    });
    expect(result.ok).toBe(true);
    expect(result.emailQueued).toBe(true);
    expect(result.restaurantSlug).toBeUndefined();
    expect(result.listingExpiresAt).toBeUndefined();
  });

  it('sends email with fallback text when notes is undefined', async () => {
    rpcSpy.mockResolvedValueOnce({ data: { ok: true }, error: null });
    setupAdminContactMocks();
    emailSendSpy.mockResolvedValueOnce({ ok: true, id: 'email-3' });

    const result = await decideSubmission({
      submissionId: SUBMISSION_ID,
      reviewerId: REVIEWER_ID,
      action: 'reject',
    });

    expect(result.emailQueued).toBe(true);
    expect(emailSendSpy).toHaveBeenCalledTimes(1);
  });
});

describe('decideSubmission — request_info', () => {
  beforeEach(() => vi.clearAllMocks());

  it('calls RPC with action=request_info and sends email with notes', async () => {
    rpcSpy.mockResolvedValueOnce({ data: { ok: true }, error: null });
    setupAdminContactMocks();
    emailSendSpy.mockResolvedValueOnce({ ok: true, id: 'email-4' });

    const result = await decideSubmission({
      submissionId: SUBMISSION_ID,
      reviewerId: REVIEWER_ID,
      action: 'request_info',
      notes: 'Please provide updated documentation.',
    });

    expect(rpcSpy).toHaveBeenCalledWith('decide_submission', {
      p_submission_id: SUBMISSION_ID,
      p_reviewer_id: REVIEWER_ID,
      p_action: 'request_info',
      p_notes: 'Please provide updated documentation.',
    });
    expect(result.ok).toBe(true);
    expect(result.emailQueued).toBe(true);
  });

  it('sends email with fallback text when notes is undefined', async () => {
    rpcSpy.mockResolvedValueOnce({ data: { ok: true }, error: null });
    setupAdminContactMocks();
    emailSendSpy.mockResolvedValueOnce({ ok: true, id: 'email-5' });

    const result = await decideSubmission({
      submissionId: SUBMISSION_ID,
      reviewerId: REVIEWER_ID,
      action: 'request_info',
    });

    expect(result.emailQueued).toBe(true);
  });
});

describe('decideSubmission — RPC error cases', () => {
  beforeEach(() => vi.clearAllMocks());

  it('throws when RPC returns an error object', async () => {
    rpcSpy.mockResolvedValueOnce({
      data: null,
      error: { message: 'submission 123 not found' },
    });

    await expect(
      decideSubmission({
        submissionId: SUBMISSION_ID,
        reviewerId: REVIEWER_ID,
        action: 'approve',
      })
    ).rejects.toThrow('decide_submission RPC failed: submission 123 not found');
  });

  it('throws when RPC returns ok=false', async () => {
    rpcSpy.mockResolvedValueOnce({ data: { ok: false }, error: null });

    await expect(
      decideSubmission({
        submissionId: SUBMISSION_ID,
        reviewerId: REVIEWER_ID,
        action: 'reject',
      })
    ).rejects.toThrow('decide_submission returned ok=false');
  });

  it('does not call email when RPC fails', async () => {
    rpcSpy.mockResolvedValueOnce({
      data: null,
      error: { message: 'already in terminal state: approved' },
    });

    await expect(
      decideSubmission({
        submissionId: SUBMISSION_ID,
        reviewerId: REVIEWER_ID,
        action: 'approve',
      })
    ).rejects.toThrow();

    expect(emailSendSpy).not.toHaveBeenCalled();
  });
});
