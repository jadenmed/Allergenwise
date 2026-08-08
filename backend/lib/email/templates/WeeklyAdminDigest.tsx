/**
 * lib/email/templates/WeeklyAdminDigest.tsx
 *
 * React Email component — weekly cert-readiness digest sent to each
 * restaurant admin (sent by cron/weekly-admin-digest, Mondays 08:00 UTC).
 *
 * Subject: "AllergenWise weekly digest — {restaurantName}"
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

export interface WeeklyAdminDigestProps {
  adminName: string;
  restaurantName: string;
  certReadinessPct: number;
  certifiedCount: number;
  totalLearners: number;
  expiringCerts: number;
  pendingInvites: number;
  dashboardUrl: string;
}

export function subjectWeeklyAdminDigest(restaurantName: string): string {
  return `AllergenWise weekly digest — ${restaurantName}`;
}

export function WeeklyAdminDigest({
  adminName,
  restaurantName,
  certReadinessPct,
  certifiedCount,
  totalLearners,
  expiringCerts,
  pendingInvites,
  dashboardUrl,
}: WeeklyAdminDigestProps) {
  return (
    <Html lang="en">
      <Head />
      <Preview>
        {`Your weekly AllergenWise summary for ${restaurantName}: ${certReadinessPct}% certified, ${expiringCerts} expiring soon, ${pendingInvites} pending invites.`}
      </Preview>
      <Body style={body}>
        <Container style={container}>
          <Section style={header}>
            <Text style={logoText}>AllergenWise</Text>
          </Section>

          <Section style={content}>
            <Heading style={h1}>Hi {adminName},</Heading>
            <Text style={paragraph}>
              Here&apos;s your weekly AllergenWise summary for <strong>{restaurantName}</strong>:
            </Text>

            <Section style={statsBox}>
              <Text style={statItem}>
                <strong>Certification readiness:</strong> {certReadinessPct}% ({certifiedCount}/
                {totalLearners} staff certified)
              </Text>
              <Text style={statItem}>
                <strong>Certificates expiring in 30 days:</strong> {expiringCerts}
              </Text>
              <Text style={statItem}>
                <strong>Pending invites (not yet accepted):</strong> {pendingInvites}
              </Text>
            </Section>

            <Section style={ctaSection}>
              <Button style={button} href={dashboardUrl}>
                View your dashboard
              </Button>
            </Section>

            <Hr style={hr} />
            <Text style={footer}>— The AllergenWise team</Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

WeeklyAdminDigest.PreviewProps = {
  adminName: 'Maria Lopez',
  restaurantName: 'The Green Fork',
  certReadinessPct: 80,
  certifiedCount: 8,
  totalLearners: 10,
  expiringCerts: 2,
  pendingInvites: 1,
  dashboardUrl: 'https://allergenwise.com/admin/dashboard',
} satisfies WeeklyAdminDigestProps;

export default WeeklyAdminDigest;

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
const statsBox: React.CSSProperties = {
  backgroundColor: '#f0fdfa',
  border: '1px solid #99f6e4',
  borderRadius: '6px',
  padding: '20px',
  margin: '0 0 24px',
};
const statItem: React.CSSProperties = {
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
