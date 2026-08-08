/**
 * lib/email/templates/InviteReminder.tsx
 *
 * React Email component — Invite reminder.
 * Subject: "Reminder: complete your AllergenWise training"
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

export interface InviteReminderProps {
  recipientName: string;
  restaurantName: string;
  inviteLink: string;
  sentDaysAgo: number;
}

export const SUBJECT_INVITE_REMINDER = 'Reminder: complete your AllergenWise training';

export function InviteReminder({
  recipientName,
  restaurantName,
  inviteLink,
  sentDaysAgo,
}: InviteReminderProps) {
  return (
    <Html lang="en">
      <Head />
      <Preview>
        Friendly reminder — your AllergenWise training invitation from {restaurantName} is still
        waiting.
      </Preview>
      <Body style={body}>
        <Container style={container}>
          <Section style={header}>
            <Text style={logoText}>AllergenWise</Text>
          </Section>

          <Section style={content}>
            <Heading style={h1}>Hi {recipientName},</Heading>
            <Text style={paragraph}>
              Just a friendly reminder that <strong>{restaurantName}</strong> invited you to
              complete AllergenWise food-allergen safety training{' '}
              {sentDaysAgo === 1 ? '1 day' : `${sentDaysAgo} days`} ago. Your invitation is still
              active — click below to get started.
            </Text>
            <Text style={paragraph}>
              The training takes about 2 hours and covers everything you need to keep guests with
              food allergies safe.
            </Text>

            <Section style={ctaSection}>
              <Button style={button} href={inviteLink}>
                Start My Training Now
              </Button>
            </Section>

            <Hr style={hr} />
            <Text style={footer}>
              If the button doesn&apos;t work, use this link:
              <br />
              <Link href={inviteLink} style={linkStyle}>
                {inviteLink}
              </Link>
            </Text>
            <Text style={footer}>
              If you have already completed your training, please ignore this reminder.
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

InviteReminder.PreviewProps = {
  recipientName: 'Jane Smith',
  restaurantName: 'The Green Fork',
  inviteLink: 'https://allergenwise.com/invite/abc123',
  sentDaysAgo: 3,
} satisfies InviteReminderProps;

export default InviteReminder;

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
const content: React.CSSProperties = { padding: '32px 24px' };
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
const ctaSection: React.CSSProperties = { textAlign: 'center', margin: '24px 0' };
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
const hr: React.CSSProperties = { borderColor: '#e3e6eb', margin: '24px 0 16px' };
const footer: React.CSSProperties = {
  color: '#6b7589',
  fontSize: '12px',
  lineHeight: '1.5',
  margin: '0 0 8px',
};
const linkStyle: React.CSSProperties = { color: '#0f766e', wordBreak: 'break-all' };
