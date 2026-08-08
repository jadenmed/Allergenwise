/**
 * lib/email/templates/AccountDeletionConfirm.tsx
 *
 * P1-16 — sent on POST /api/account/me/request-deletion. Carries the
 * one-time confirmation link the user clicks to finalize deletion.
 */

import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Link,
  Preview,
  Section,
  Text,
} from '@react-email/components';
import * as React from 'react';

export interface AccountDeletionConfirmProps {
  recipientName: string;
  confirmLink: string;
  expiresAt: string;
  warnings: string[];
}

export const SUBJECT_ACCOUNT_DELETION_CONFIRM = 'Confirm your AllergenWise account deletion';

export function AccountDeletionConfirm({
  recipientName,
  confirmLink,
  expiresAt,
  warnings,
}: AccountDeletionConfirmProps) {
  return (
    <Html lang="en">
      <Head />
      <Preview>
        Confirm deletion of your AllergenWise account. This link expires in 24 hours.
      </Preview>
      <Body style={body}>
        <Container style={container}>
          <Section style={header}>
            <Text style={logoText}>AllergenWise</Text>
          </Section>

          <Section style={content}>
            <Heading style={h1}>Hi {recipientName},</Heading>
            <Text style={paragraph}>
              We received a request to permanently delete your AllergenWise account. To confirm,
              click the button below.
            </Text>
            <Text style={paragraph}>
              <strong>This link is valid until {expiresAt}.</strong> If you did not request this,
              ignore this email and your account will remain active.
            </Text>

            {warnings.length > 0 ? (
              <Section style={warningBox}>
                <Text style={warningHeading}>Please review before confirming:</Text>
                {warnings.map((w, i) => (
                  <Text key={i} style={warningItem}>
                    • {w}
                  </Text>
                ))}
              </Section>
            ) : null}

            <Section style={ctaSection}>
              <Button style={button} href={confirmLink}>
                Confirm Account Deletion
              </Button>
            </Section>

            <Text style={paragraph}>
              Once confirmed, the following data will be permanently erased: your profile name and
              login email, certificates, exam attempts, lesson progress, and personal activity
              history. Records that belong to your restaurant (roster CSVs, restaurant listing,
              business records) are governed by your restaurant&apos;s retention policy and remain
              stored.
            </Text>

            <Hr style={hr} />
            <Text style={footer}>
              If the button above doesn&apos;t work, copy and paste this URL into your browser:
              <br />
              <Link href={confirmLink} style={linkStyle}>
                {confirmLink}
              </Link>
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

AccountDeletionConfirm.PreviewProps = {
  recipientName: 'Jane Smith',
  confirmLink: 'https://allergenwise.com/account/delete/confirm?token=abc',
  expiresAt: '2026-05-12 18:42 UTC',
  warnings: [],
} satisfies AccountDeletionConfirmProps;

export default AccountDeletionConfirm;

// ── Styles ─────────────────────────────────────────────────────────────────

const body: React.CSSProperties = {
  backgroundColor: '#f6f7f9',
  fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif',
  margin: 0,
  padding: '24px 0',
};

const container: React.CSSProperties = {
  maxWidth: '600px',
  margin: '0 auto',
  backgroundColor: '#ffffff',
  border: '1px solid #e3e6eb',
  borderRadius: '8px',
  overflow: 'hidden',
};

const header: React.CSSProperties = {
  backgroundColor: '#0f766e',
  padding: '24px',
  textAlign: 'center',
};

const logoText: React.CSSProperties = {
  color: '#ffffff',
  fontSize: '20px',
  fontWeight: '600',
  letterSpacing: '-0.02em',
  margin: 0,
};

const content: React.CSSProperties = {
  padding: '32px 24px',
};

const h1: React.CSSProperties = {
  color: '#1a2332',
  fontSize: '18px',
  fontWeight: '600',
  margin: '0 0 16px',
};

const paragraph: React.CSSProperties = {
  color: '#3d4759',
  fontSize: '14px',
  lineHeight: '1.6',
  margin: '0 0 16px',
};

const warningBox: React.CSSProperties = {
  backgroundColor: '#fef3c7',
  border: '1px solid #f59e0b',
  borderRadius: '6px',
  padding: '12px 16px',
  margin: '16px 0',
};

const warningHeading: React.CSSProperties = {
  color: '#92400e',
  fontSize: '13px',
  fontWeight: '600',
  margin: '0 0 8px',
};

const warningItem: React.CSSProperties = {
  color: '#78350f',
  fontSize: '13px',
  lineHeight: '1.5',
  margin: '0 0 4px',
};

const ctaSection: React.CSSProperties = {
  textAlign: 'center',
  margin: '24px 0',
};

const button: React.CSSProperties = {
  backgroundColor: '#0d9488',
  color: '#ffffff',
  borderRadius: '6px',
  fontSize: '14px',
  fontWeight: '500',
  padding: '12px 24px',
  textDecoration: 'none',
  display: 'inline-block',
};

const hr: React.CSSProperties = {
  borderColor: '#e3e6eb',
  margin: '24px 0 16px',
};

const footer: React.CSSProperties = {
  color: '#6b7280',
  fontSize: '12px',
  lineHeight: '1.5',
  margin: '0 0 8px',
};

const linkStyle: React.CSSProperties = {
  color: '#0d9488',
  wordBreak: 'break-all',
};
