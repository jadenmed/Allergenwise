/**
 * tests/unit/email-templates.test.ts
 *
 * Verifies all 11 React Email templates render without throwing.
 * Uses @react-email/components render() in a jsdom environment.
 *
 * Each test:
 *   1. Creates the element using PreviewProps.
 *   2. Renders it to HTML via render().
 *   3. Asserts the output is a non-empty string containing DOCTYPE.
 *   4. Asserts no uncaught errors.
 */
import { describe, it, expect } from 'vitest';
import * as React from 'react';
import { render } from '@react-email/components';

// ── Template imports ──────────────────────────────────────────────────────────

import EmployeeInvite from '@/lib/email/templates/EmployeeInvite';
import InviteReminder from '@/lib/email/templates/InviteReminder';
import ExamPassed from '@/lib/email/templates/ExamPassed';
import RestaurantSubmitted from '@/lib/email/templates/RestaurantSubmitted';
import RestaurantApproved from '@/lib/email/templates/RestaurantApproved';
import RestaurantRejected from '@/lib/email/templates/RestaurantRejected';
import RestaurantInfoRequested from '@/lib/email/templates/RestaurantInfoRequested';
import PlanExpiringSoon from '@/lib/email/templates/PlanExpiringSoon';
import CertExpiringSoon from '@/lib/email/templates/CertExpiringSoon';
import ReceiptCertFee from '@/lib/email/templates/ReceiptCertFee';
import WelcomeAdmin from '@/lib/email/templates/WelcomeAdmin';

// ── Helper ────────────────────────────────────────────────────────────────────

async function renderTemplate(element: React.ReactElement): Promise<string> {
  return render(element, { pretty: false });
}

function assertValidHtml(html: string, templateName: string): void {
  expect(html, `${templateName}: html should be a string`).toBeTypeOf('string');
  expect(html.length, `${templateName}: html should be non-empty`).toBeGreaterThan(100);
  // React Email renders an XHTML transitional DOCTYPE (email client compatibility)
  expect(html, `${templateName}: should start with DOCTYPE`).toMatch(/<!DOCTYPE html/i);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('email templates render without throwing', () => {
  it('EmployeeInvite', async () => {
    const html = await renderTemplate(
      React.createElement(EmployeeInvite, EmployeeInvite.PreviewProps)
    );
    assertValidHtml(html, 'EmployeeInvite');
    expect(html).toContain('AllergenWise');
    expect(html).toContain(EmployeeInvite.PreviewProps.restaurantName);
  });

  it('InviteReminder', async () => {
    const html = await renderTemplate(
      React.createElement(InviteReminder, InviteReminder.PreviewProps)
    );
    assertValidHtml(html, 'InviteReminder');
    expect(html).toContain('AllergenWise');
  });

  it('ExamPassed', async () => {
    const html = await renderTemplate(React.createElement(ExamPassed, ExamPassed.PreviewProps));
    assertValidHtml(html, 'ExamPassed');
    expect(html).toContain(ExamPassed.PreviewProps.certCode);
  });

  it('RestaurantSubmitted', async () => {
    const html = await renderTemplate(
      React.createElement(RestaurantSubmitted, RestaurantSubmitted.PreviewProps)
    );
    assertValidHtml(html, 'RestaurantSubmitted');
    expect(html).toContain(RestaurantSubmitted.PreviewProps.restaurantName);
  });

  it('RestaurantApproved', async () => {
    const html = await renderTemplate(
      React.createElement(RestaurantApproved, RestaurantApproved.PreviewProps)
    );
    assertValidHtml(html, 'RestaurantApproved');
    expect(html).toContain('AllergenWise');
  });

  it('RestaurantRejected', async () => {
    const html = await renderTemplate(
      React.createElement(RestaurantRejected, RestaurantRejected.PreviewProps)
    );
    assertValidHtml(html, 'RestaurantRejected');
    expect(html).toContain(RestaurantRejected.PreviewProps.restaurantName);
  });

  it('RestaurantInfoRequested', async () => {
    const html = await renderTemplate(
      React.createElement(RestaurantInfoRequested, RestaurantInfoRequested.PreviewProps)
    );
    assertValidHtml(html, 'RestaurantInfoRequested');
    expect(html).toContain('AllergenWise');
  });

  it('PlanExpiringSoon', async () => {
    const html = await renderTemplate(
      React.createElement(PlanExpiringSoon, PlanExpiringSoon.PreviewProps)
    );
    assertValidHtml(html, 'PlanExpiringSoon');
    expect(html).toContain('14'); // daysRemaining from PreviewProps
  });

  it('CertExpiringSoon', async () => {
    const html = await renderTemplate(
      React.createElement(CertExpiringSoon, CertExpiringSoon.PreviewProps)
    );
    assertValidHtml(html, 'CertExpiringSoon');
    expect(html).toContain(CertExpiringSoon.PreviewProps.certCode);
  });

  it('ReceiptCertFee', async () => {
    const html = await renderTemplate(
      React.createElement(ReceiptCertFee, ReceiptCertFee.PreviewProps)
    );
    assertValidHtml(html, 'ReceiptCertFee');
    expect(html).toContain('AllergenWise');
  });

  it('WelcomeAdmin', async () => {
    const html = await renderTemplate(React.createElement(WelcomeAdmin, WelcomeAdmin.PreviewProps));
    assertValidHtml(html, 'WelcomeAdmin');
    expect(html).toContain(WelcomeAdmin.PreviewProps.adminName);
  });

  it('all templates have explicit background-color on container (dark-mode safety)', async () => {
    // Spot-check: the container must have a white backgroundColor so it
    // doesn't inherit the system dark-mode background in email clients.
    const htmls = await Promise.all([
      renderTemplate(React.createElement(EmployeeInvite, EmployeeInvite.PreviewProps)),
      renderTemplate(React.createElement(WelcomeAdmin, WelcomeAdmin.PreviewProps)),
      renderTemplate(React.createElement(ExamPassed, ExamPassed.PreviewProps)),
    ]);

    for (const html of htmls) {
      // All templates use backgroundColor: '#ffffff' on the container inline style.
      // React Email renders inline styles without spaces, e.g. background-color:#fff
      expect(html).toMatch(/background-color:#fff(fff)?/i);
    }
  });
});
