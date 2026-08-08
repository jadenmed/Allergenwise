/**
 * lib/email/templates/WelcomeAdmin.tsx
 * React Email — Welcome email sent to admin after successful plan payment.
 * Trigger: payment_intent.succeeded with kind=plan
 */

import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Preview,
  Section,
  Text,
} from '@react-email/components';
import * as React from 'react';

export interface WelcomeAdminProps {
  adminName: string;
  restaurantName: string;
  plan: 'quarterly' | 'semiannual';
  dashboardUrl: string;
}

export const SUBJECT_WELCOME_ADMIN = 'Welcome to AllergenWise — your account is ready';

export function WelcomeAdmin({ adminName, restaurantName, plan, dashboardUrl }: WelcomeAdminProps) {
  const planLabel = plan === 'quarterly' ? 'Quarterly' : 'Semi-Annual';

  return (
    <Html lang="en">
      <Head />
      <Preview>
        Welcome, {adminName}! Your AllergenWise account for {restaurantName} is ready. Start
        inviting your team today.
      </Preview>
      <Body style={body}>
        <Container style={container}>
          <Section style={header}>
            <Text style={logoText}>AllergenWise</Text>
          </Section>

          <Section style={content}>
            <Heading style={h1}>Welcome to AllergenWise, {adminName}!</Heading>
            <Text style={paragraph}>
              Your <strong>{planLabel}</strong> plan for <strong>{restaurantName}</strong> is now
              active. Here is how to get started:
            </Text>

            <Section style={stepsBox}>
              <Text style={stepItem}>
                <strong>1. Invite your team</strong> — Go to Roster → Invite Employee. You can add
                staff one-by-one or upload a CSV.
              </Text>
              <Text style={stepItem}>
                <strong>2. Staff complete training</strong> — Each employee gets a magic-link email.
                Training takes about 2–3 hours at their own pace.
              </Text>
              <Text style={stepItem}>
                <strong>3. Submit for certification</strong> — Once 100% of your staff is certified,
                submit your restaurant for the AllergenWise directory listing.
              </Text>
            </Section>

            <Section style={ctaSection}>
              <Button style={button} href={dashboardUrl}>
                Go to Dashboard
              </Button>
            </Section>

            <Hr style={hr} />
            <Text style={footer}>
              Questions? Reply to this email or visit allergenwise.com/help.
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

WelcomeAdmin.PreviewProps = {
  adminName: 'Maria Lopez',
  restaurantName: 'Casa Verde',
  plan: 'quarterly',
  dashboardUrl: 'https://allergenwise.com/admin/dashboard',
} satisfies WelcomeAdminProps;

export default WelcomeAdmin;

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
  fontSize: '22px',
  fontWeight: '600',
  margin: '0 0 16px',
};
const paragraph: React.CSSProperties = {
  color: '#3d4759',
  fontSize: '14px',
  lineHeight: '1.6',
  margin: '0 0 20px',
};
const stepsBox: React.CSSProperties = {
  backgroundColor: '#f0fdfa',
  border: '1px solid #99f6e4',
  borderRadius: '6px',
  padding: '20px',
  margin: '0 0 24px',
};
const stepItem: React.CSSProperties = {
  color: '#3d4759',
  fontSize: '13px',
  lineHeight: '1.6',
  margin: '0 0 12px',
};
const ctaSection: React.CSSProperties = { textAlign: 'center', margin: '8px 0 24px' };
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
  margin: 0,
};
