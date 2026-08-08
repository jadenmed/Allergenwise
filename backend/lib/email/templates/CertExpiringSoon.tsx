/**
 * lib/email/templates/CertExpiringSoon.tsx
 *
 * React Email component — Certificate expiring soon (sent by cron at 30/14/7 days).
 * Subject: "Your AllergenWise certificate expires in {N} days"
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

export interface CertExpiringSoonProps {
  recipientName: string;
  restaurantName: string;
  daysRemaining: number;
  certCode: string;
}

export function subjectCertExpiringSoon(daysRemaining: number): string {
  return `Your AllergenWise certificate expires in ${daysRemaining} day${daysRemaining === 1 ? '' : 's'}`;
}

export function CertExpiringSoon({
  recipientName,
  restaurantName,
  daysRemaining,
  certCode,
}: CertExpiringSoonProps) {
  const appUrl = process.env.APP_URL ?? 'https://allergenwise.com';
  const retakeLink = `${appUrl}/learner/courses`;

  return (
    <Html lang="en">
      <Head />
      <Preview>
        Your AllergenWise certificate ({certCode}) expires in{' '}
        {daysRemaining === 1 ? '1 day' : `${daysRemaining} days`}. Retake the training to renew it.
      </Preview>
      <Body style={body}>
        <Container style={container}>
          <Section style={header}>
            <Text style={logoText}>AllergenWise</Text>
          </Section>

          <Section style={content}>
            <Heading style={h1}>Hi {recipientName},</Heading>
            <Text style={paragraph}>
              Your AllergenWise food-allergen safety certificate at{' '}
              <strong>{restaurantName}</strong> is expiring in{' '}
              <strong>{daysRemaining === 1 ? '1 day' : `${daysRemaining} days`}</strong>.
            </Text>
            <Text style={paragraph}>
              To keep your certification current and remain on the AllergenWise registry, complete
              the refresher training and retake the exam before your certificate expires.
            </Text>

            <Section style={certBox}>
              <Text style={certLabel}>Current Certificate ID</Text>
              <Text style={certCodeStyle}>{certCode}</Text>
            </Section>

            <Section style={ctaSection}>
              <Button style={button} href={retakeLink}>
                Start Refresher Training
              </Button>
            </Section>

            <Hr style={hr} />
            <Text style={footer}>
              If you have already retaken the exam, your new certificate will replace this one
              automatically. Verify your current status at{' '}
              <Link href={`${appUrl}/verify/${certCode}`} style={linkStyle}>
                allergenwise.com/verify/{certCode}
              </Link>
              .
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

CertExpiringSoon.PreviewProps = {
  recipientName: 'Jane Smith',
  restaurantName: 'The Green Fork',
  daysRemaining: 30,
  certCode: 'AW-MQSAZ-772BH-4',
} satisfies CertExpiringSoonProps;

export default CertExpiringSoon;

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
const certBox: React.CSSProperties = {
  backgroundColor: '#f0fdfa',
  border: '1px solid #99f6e4',
  borderRadius: '6px',
  padding: '16px',
  textAlign: 'center',
  marginBottom: '24px',
};
const certLabel: React.CSSProperties = {
  color: '#6b7589',
  fontSize: '11px',
  fontWeight: '600',
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  margin: '0 0 4px',
};
const certCodeStyle: React.CSSProperties = {
  color: '#0f766e',
  fontSize: '18px',
  fontWeight: '700',
  letterSpacing: '0.05em',
  margin: 0,
  fontFamily: 'JetBrains Mono, ui-monospace, monospace',
};
const ctaSection: React.CSSProperties = { textAlign: 'center', margin: '0 0 24px' };
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
