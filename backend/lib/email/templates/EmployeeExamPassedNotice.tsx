/**
 * lib/email/templates/EmployeeExamPassedNotice.tsx
 *
 * React Email component — sent to the restaurant's manager/admin (not the
 * learner) when a staff member passes the certification exam.
 *
 * Subject: "Your employee passed the AllergenWise exam!"
 */

import {
  Body,
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

export interface EmployeeExamPassedNoticeProps {
  adminName: string;
  learnerName: string;
  restaurantName: string;
  scorePercent: number;
  certCode: string;
}

export const SUBJECT_EMPLOYEE_EXAM_PASSED_NOTICE = 'Your employee passed the AllergenWise exam!';

export function EmployeeExamPassedNotice({
  adminName,
  learnerName,
  restaurantName,
  scorePercent,
  certCode,
}: EmployeeExamPassedNoticeProps) {
  return (
    <Html lang="en">
      <Head />
      <Preview>
        {`${learnerName} passed the AllergenWise exam at ${restaurantName} with a score of ${scorePercent}%. Certificate issuance pending payment.`}
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

            <Heading style={h1}>Great news, {adminName}!</Heading>
            <Text style={paragraph}>
              <strong>{learnerName}</strong> passed the AllergenWise certification exam at{' '}
              <strong>{restaurantName}</strong> with a score of <strong>{scorePercent}%</strong>.
            </Text>
            <Text style={paragraph}>
              Their certificate (preview code below) will be issued when {restaurantName}&apos;s
              admin completes payment by submitting the restaurant for review.
            </Text>

            <Section style={certBox}>
              <Text style={certLabel}>Certificate Preview Code</Text>
              <Text style={certCodeText}>{certCode}</Text>
            </Section>

            <Hr style={hr} />
            <Text style={footer}>
              Submit your restaurant for review from your admin dashboard to complete certification.
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

EmployeeExamPassedNotice.PreviewProps = {
  adminName: 'Maria Lopez',
  learnerName: 'Jane Smith',
  restaurantName: 'The Green Fork',
  scorePercent: 92,
  certCode: 'AW-MQSAZ-772BH-4',
} satisfies EmployeeExamPassedNoticeProps;

export default EmployeeExamPassedNotice;

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
const certCodeText: React.CSSProperties = {
  color: '#0f766e',
  fontSize: '18px',
  fontWeight: '700',
  letterSpacing: '0.05em',
  margin: 0,
  fontFamily: 'JetBrains Mono, ui-monospace, monospace',
};
const hr: React.CSSProperties = { borderColor: '#e3e6eb', margin: '24px 0 16px' };
const footer: React.CSSProperties = {
  color: '#6b7589',
  fontSize: '12px',
  lineHeight: '1.5',
  margin: 0,
};
