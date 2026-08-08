/**
 * lib/email/templates/EmployeeInvite.tsx
 *
 * React Email component — Employee invite.
 * Subject: "You're invited to AllergenWise training"
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

export interface EmployeeInviteProps {
  recipientName: string;
  restaurantName: string;
  inviteLink: string;
}

export const SUBJECT_EMPLOYEE_INVITE = "You're invited to AllergenWise training";

export function EmployeeInvite({ recipientName, restaurantName, inviteLink }: EmployeeInviteProps) {
  return (
    <Html lang="en">
      <Head />
      <Preview>
        {restaurantName} has invited you to complete AllergenWise food-allergen safety training.
        Click to get started.
      </Preview>
      <Body style={body}>
        <Container style={container}>
          {/* Header */}
          <Section style={header}>
            <Text style={logoText}>AllergenWise</Text>
          </Section>

          {/* Body */}
          <Section style={content}>
            <Heading style={h1}>Hi {recipientName},</Heading>
            <Text style={paragraph}>
              <strong>{restaurantName}</strong> has invited you to complete AllergenWise
              food-allergen safety training. Once you finish, you&apos;ll receive an AllergenWise
              certification that helps your team keep guests with food allergies safe.
            </Text>
            <Text style={paragraph}>
              This link expires in 7 days. Do not share it — it is unique to you.
            </Text>

            <Section style={ctaSection}>
              <Button style={button} href={inviteLink}>
                Accept Invitation &amp; Start Training
              </Button>
            </Section>

            <Hr style={hr} />
            <Text style={footer}>
              If the button above doesn&apos;t work, copy and paste this URL into your browser:
              <br />
              <Link href={inviteLink} style={linkStyle}>
                {inviteLink}
              </Link>
            </Text>
            <Text style={footer}>
              If you did not expect this invitation, you can safely ignore this email.
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

EmployeeInvite.PreviewProps = {
  recipientName: 'Jane Smith',
  restaurantName: 'The Green Fork',
  inviteLink: 'https://allergenwise.com/invite/abc123',
} satisfies EmployeeInviteProps;

export default EmployeeInvite;

// ── Styles ─────────────────────────────────────────────────────────────────────

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
  color: '#6b7589',
  fontSize: '12px',
  lineHeight: '1.5',
  margin: '0 0 8px',
};

const linkStyle: React.CSSProperties = {
  color: '#0f766e',
  wordBreak: 'break-all',
};
