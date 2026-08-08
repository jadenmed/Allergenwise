/**
 * lib/email/templates/ExamPassed.tsx
 *
 * React Email component — Exam passed (sent to learner).
 *
 * Wave 2C reword (OQ-5): the cert is NOT yet issued at exam-pass time —
 * it exists in `pending` state until the restaurant admin submits the
 * restaurant for review and the cert-fee PaymentIntent succeeds. Copy
 * must reflect that reality. The brand-new CertActivated email at the
 * pending → active transition is deferred to a P1 follow-up.
 *
 * Subject: "You passed the AllergenWise exam"
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

export interface ExamPassedProps {
  recipientName: string;
  restaurantName: string;
  certCode: string;
  certUrl: string;
}

export const SUBJECT_EXAM_PASSED = 'You passed the AllergenWise exam';

export function ExamPassed({ recipientName, restaurantName, certCode, certUrl }: ExamPassedProps) {
  return (
    <Html lang="en">
      <Head />
      <Preview>
        {recipientName} passed the AllergenWise exam at {restaurantName}. Cert preview: {certCode}.
        Issuance pending admin payment.
      </Preview>
      <Body style={body}>
        <Container style={container}>
          <Section style={header}>
            <Text style={logoText}>AllergenWise</Text>
          </Section>

          <Section style={content}>
            <Section style={badgeSection}>
              <Text style={badgeText}>EXAM PASSED</Text>
            </Section>

            <Heading style={h1}>You passed, {recipientName}!</Heading>
            <Text style={paragraph}>
              You have successfully passed the AllergenWise food-allergen safety exam at{' '}
              <strong>{restaurantName}</strong>.
            </Text>
            <Text style={paragraph}>
              Your certificate{' '}
              <strong>will be issued when your restaurant admin completes payment</strong> by
              submitting your restaurant for review. Until then, your cert is on hold under the
              preview code below.
            </Text>

            <Section style={certBox}>
              <Text style={certLabel}>Certificate Preview Code</Text>
              <Text style={certCode_}>{certCode}</Text>
            </Section>

            <Section style={ctaSection}>
              <Button style={button} href={certUrl}>
                View certificate status
              </Button>
            </Section>

            <Hr style={hr} />
            <Text style={footer}>
              We&apos;ll email you again as soon as your restaurant admin completes payment and your
              certificate is officially issued.
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

ExamPassed.PreviewProps = {
  recipientName: 'Jane Smith',
  restaurantName: 'The Green Fork',
  certCode: 'AW-MQSAZ-772BH-4',
  certUrl: 'https://allergenwise.com/learner/certificate',
} satisfies ExamPassedProps;

export default ExamPassed;

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
const badgeSection: React.CSSProperties = { textAlign: 'center', marginBottom: '16px' };
const badgeText: React.CSSProperties = {
  display: 'inline-block',
  backgroundColor: '#ccfbf1',
  color: '#0f766e',
  fontSize: '11px',
  fontWeight: '700',
  letterSpacing: '0.1em',
  padding: '4px 12px',
  borderRadius: '100px',
  border: '1px solid #5eead4',
};
const h1: React.CSSProperties = {
  color: '#1a2332',
  fontSize: '22px',
  fontWeight: '600',
  margin: '0 0 16px',
  textAlign: 'center',
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
  margin: '16px 0',
};
const certLabel: React.CSSProperties = {
  color: '#6b7589',
  fontSize: '11px',
  fontWeight: '600',
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  margin: '0 0 4px',
};
const certCode_: React.CSSProperties = {
  color: '#0f766e',
  fontSize: '18px',
  fontWeight: '700',
  letterSpacing: '0.05em',
  margin: 0,
  fontFamily: 'JetBrains Mono, ui-monospace, monospace',
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
  margin: 0,
};
