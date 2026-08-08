/**
 * tests/integration/resend-send.test.ts
 *
 * Integration test for the Resend email send helper (lib/email/send.ts).
 *
 * Tests:
 * 1. Happy path: sendEmail('EmployeeInvite', ...) renders the template,
 *    calls Resend with correct from/to/subject, returns { ok: true, id }.
 * 2. Asserts rendered HTML contains recipient name + invite link.
 * 3. Error path: Resend throws → sendEmail returns { ok: false, error },
 *    no exception leaks.
 * 4. Error path: Resend returns an error object → { ok: false, error }.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mocks ────────────────────────────────────────────────────────────────────

// Mock the Resend client at the module level
vi.mock('@/lib/email/client', () => ({
  resend: {
    emails: {
      send: vi.fn(),
    },
  },
  FROM_EMAIL: 'hello@allergenwise.com',
}));

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('sendEmail — Resend integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('happy path: EmployeeInvite renders and sends correctly', async () => {
    const { resend } = await import('@/lib/email/client');
    vi.mocked(resend.emails.send).mockResolvedValue({
      data: { id: 'resend-email-id-123' },
      error: null,
    } as Awaited<ReturnType<typeof resend.emails.send>>);

    const { sendEmail } = await import('@/lib/email/send');

    const result = await sendEmail('EmployeeInvite', 'jane@bistro.com', {
      recipientName: 'Jane Smith',
      restaurantName: 'The Bistro',
      inviteLink: 'https://allergenwise.com/invite/abc123token',
    });

    expect(result.ok).toBe(true);
    expect(result.id).toBe('resend-email-id-123');

    // Verify Resend was called with correct metadata
    expect(resend.emails.send).toHaveBeenCalledOnce();
    const callArgs = vi.mocked(resend.emails.send).mock.calls[0][0];

    expect(callArgs.from).toBe('hello@allergenwise.com');
    expect(callArgs.to).toBe('jane@bistro.com');
    expect(callArgs.subject).toContain('invited to AllergenWise training');
  });

  it('rendered HTML contains recipient name and invite link', async () => {
    const { resend } = await import('@/lib/email/client');
    vi.mocked(resend.emails.send).mockResolvedValue({
      data: { id: 'resend-email-id-456' },
      error: null,
    } as Awaited<ReturnType<typeof resend.emails.send>>);

    const { sendEmail } = await import('@/lib/email/send');

    await sendEmail('EmployeeInvite', 'jane@bistro.com', {
      recipientName: 'Jane Smith',
      restaurantName: 'The Bistro',
      inviteLink: 'https://allergenwise.com/invite/UNIQUE_TOKEN_HERE',
    });

    const callArgs = vi.mocked(resend.emails.send).mock.calls[0][0];

    // HTML should contain the recipient's name
    expect(callArgs.html).toContain('Jane Smith');

    // HTML should contain the invite link
    expect(callArgs.html).toContain('UNIQUE_TOKEN_HERE');

    // HTML should contain the restaurant name
    expect(callArgs.html).toContain('The Bistro');
  });

  it('error path: Resend throws → returns { ok: false, error }, no exception leaks', async () => {
    const { resend } = await import('@/lib/email/client');
    vi.mocked(resend.emails.send).mockRejectedValue(new Error('Network timeout'));

    const { sendEmail } = await import('@/lib/email/send');

    // Must not throw — sendEmail is designed to never throw
    const result = await sendEmail('EmployeeInvite', 'jane@bistro.com', {
      recipientName: 'Jane Smith',
      restaurantName: 'The Bistro',
      inviteLink: 'https://allergenwise.com/invite/abc',
    });

    expect(result.ok).toBe(false);
    expect(result.error).toContain('Network timeout');
    expect(result.id).toBeUndefined();
  });

  it('error path: Resend returns error object → { ok: false, error }', async () => {
    const { resend } = await import('@/lib/email/client');
    vi.mocked(resend.emails.send).mockResolvedValue({
      data: null,
      error: { name: 'validation_error', message: 'Invalid recipient email' },
    } as Awaited<ReturnType<typeof resend.emails.send>>);

    const { sendEmail } = await import('@/lib/email/send');

    const result = await sendEmail('WelcomeAdmin', 'invalid', {
      adminName: 'Jane Admin',
      restaurantName: 'The Bistro',
      plan: 'quarterly',
      dashboardUrl: 'https://allergenwise.com/admin/dashboard',
    });

    expect(result.ok).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.id).toBeUndefined();
  });

  it('correct from address used for all templates', async () => {
    const { resend } = await import('@/lib/email/client');
    vi.mocked(resend.emails.send).mockResolvedValue({
      data: { id: 'resend-789' },
      error: null,
    } as Awaited<ReturnType<typeof resend.emails.send>>);

    const { sendEmail } = await import('@/lib/email/send');

    await sendEmail('ExamPassed', 'admin@bistro.com', {
      recipientName: 'Bob',
      restaurantName: 'The Bistro',
      certCode: 'AW-2026-000001',
      certUrl: 'https://allergenwise.com/learner/certificate',
    });

    const callArgs = vi.mocked(resend.emails.send).mock.calls[0][0];
    expect(callArgs.from).toBe('hello@allergenwise.com');
  });
});
