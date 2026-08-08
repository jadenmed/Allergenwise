/**
 * tests/unit/exam-passed-email-reword.test.ts
 *
 * Wave 2C OQ-5 — the ExamPassed email no longer claims the cert is issued.
 * Copy must reflect the new reality: cert exists in `pending` state and
 * activation depends on the admin completing payment via the cert-fee PI.
 *
 * The new CertActivated email at the pending → active transition is
 * deferred to a P1 follow-up (audits/followups.md).
 */

import { describe, it, expect } from 'vitest';
import * as React from 'react';
import { render } from '@react-email/components';
import ExamPassed, { SUBJECT_EXAM_PASSED } from '@/lib/email/templates/ExamPassed';

describe('ExamPassed email — Wave 2C reword', () => {
  it('does NOT claim the certificate is ready to download', async () => {
    const html = await render(React.createElement(ExamPassed, ExamPassed.PreviewProps));
    // Old copy: "Your certificate is ready to view, download, and print"
    expect(html.toLowerCase()).not.toContain('ready to view');
    expect(html.toLowerCase()).not.toContain('ready to download');
    expect(html.toLowerCase()).not.toContain('valid for 12 months');
  });

  it('explicitly mentions admin payment as the gating step', async () => {
    const html = await render(React.createElement(ExamPassed, ExamPassed.PreviewProps));
    const lower = html.toLowerCase();
    expect(lower, 'must reference admin payment or restaurant submission').toMatch(
      /admin completes payment|restaurant admin|admin submits|submit your restaurant/
    );
  });

  it('subject line no longer asserts the cert is issued', () => {
    // Old subject: "Congratulations — you're AllergenWise Certified" (lies in pending state)
    expect(SUBJECT_EXAM_PASSED.toLowerCase()).not.toContain('certified');
  });
});
