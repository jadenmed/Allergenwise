/**
 * lib/email/templates/PlanExpiringSoon.tsx
 *
 * React Email component — Plan expiring soon (sent by cron).
 * Subject: "Your AllergenWise plan ends in {N} days"
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

export interface PlanExpiringSoonProps {
  adminName: string;
  restaurantName: string;
  daysRemaining: number;
  renewLink: string;
}

export function subjectPlanExpiringSoon(daysRemaining: number): string {
  return `Your AllergenWise plan ends in ${daysRemaining} day${daysRemaining === 1 ? '' : 's'}`;
}

export function PlanExpiringSoon({
  adminName,
  restaurantName,
  daysRemaining,
  renewLink,
}: PlanExpiringSoonProps) {
  const urgencyColor = daysRemaining <= 7 ? '#dc2626' : '#d97706';
  const urgencyBg = daysRemaining <= 7 ? '#fef2f2' : '#fffbeb';
  const urgencyBorder = daysRemaining <= 7 ? '#fecaca' : '#fde68a';

  return (
    <Html lang="en">
      <Head />
      <Preview>
        Your AllergenWise plan for {restaurantName} expires in{' '}
        {daysRemaining === 1 ? '1 day' : `${daysRemaining} days`}. Renew now to keep your listing
        active.
      </Preview>
      <Body style={body}>
        <Container style={container}>
          <Section style={header}>
            <Text style={logoText}>AllergenWise</Text>
          </Section>

          <Section style={content}>
            <Section
              style={{
                ...urgencyBox,
                backgroundColor: urgencyBg,
                border: `1px solid ${urgencyBorder}`,
              }}
            >
              <Text style={{ ...urgencyHeading, color: urgencyColor }}>
                {daysRemaining === 1 ? '1 day' : `${daysRemaining} days`} remaining
              </Text>
            </Section>

            <Heading style={h1}>Hi {adminName},</Heading>
            <Text style={paragraph}>
              Your AllergenWise plan for <strong>{restaurantName}</strong> expires in{' '}
              <strong>{daysRemaining === 1 ? '1 day' : `${daysRemaining} days`}</strong>. When your
              plan expires, your public directory listing will be paused and diners will no longer
              be able to find you on AllergenWise.
            </Text>
            <Text style={paragraph}>
              Renew now to keep your listing active and your staff certifications valid.
            </Text>

            <Section style={ctaSection}>
              <Button style={button} href={renewLink}>
                Renew My Plan
              </Button>
            </Section>

            <Hr style={hr} />
            <Text style={footer}>
              Manage your plan at any time from your{' '}
              <Link href={renewLink} style={linkStyle}>
                billing dashboard
              </Link>
              .
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

PlanExpiringSoon.PreviewProps = {
  adminName: 'Maria Garcia',
  restaurantName: 'The Green Fork',
  daysRemaining: 14,
  renewLink: 'https://allergenwise.com/admin/billing',
} satisfies PlanExpiringSoonProps;

export default PlanExpiringSoon;

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
const urgencyBox: React.CSSProperties = {
  borderRadius: '6px',
  padding: '12px 16px',
  marginBottom: '20px',
  textAlign: 'center',
};
const urgencyHeading: React.CSSProperties = {
  fontSize: '20px',
  fontWeight: '700',
  margin: 0,
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
const hr: React.CSSProperties = { borderColor: '#e3e6eb', margin: '0 0 16px' };
const footer: React.CSSProperties = {
  color: '#6b7589',
  fontSize: '12px',
  lineHeight: '1.5',
  margin: 0,
};
const linkStyle: React.CSSProperties = { color: '#0f766e' };
