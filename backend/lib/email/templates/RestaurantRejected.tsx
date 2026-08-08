/**
 * lib/email/templates/RestaurantRejected.tsx
 *
 * React Email component — Restaurant submission rejected.
 * Subject: "Update on your AllergenWise submission"
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

export interface RestaurantRejectedProps {
  adminName: string;
  restaurantName: string;
  reviewerNotes: string;
}

export const SUBJECT_RESTAURANT_REJECTED = 'Update on your AllergenWise submission';

export function RestaurantRejected({
  adminName,
  restaurantName,
  reviewerNotes,
}: RestaurantRejectedProps) {
  return (
    <Html lang="en">
      <Head />
      <Preview>
        We&apos;ve reviewed the submission for {restaurantName}. Please see the notes from our
        review team inside.
      </Preview>
      <Body style={body}>
        <Container style={container}>
          <Section style={header}>
            <Text style={logoText}>AllergenWise</Text>
          </Section>

          <Section style={content}>
            <Heading style={h1}>Hi {adminName},</Heading>
            <Text style={paragraph}>
              Thank you for submitting <strong>{restaurantName}</strong> for AllergenWise
              certification. After a thorough review, our team was unable to approve this submission
              at this time.
            </Text>

            <Section style={notesBox}>
              <Text style={notesLabel}>Reviewer notes</Text>
              <Text style={notesBody}>{reviewerNotes}</Text>
            </Section>

            <Text style={paragraph}>
              Once you have addressed the items above, you are welcome to resubmit through your
              dashboard. If you have questions, reply to this email.
            </Text>

            <Section style={ctaSection}>
              <Button style={button} href="https://allergenwise.com/admin/dashboard">
                Go to Dashboard
              </Button>
            </Section>

            <Hr style={hr} />
            <Text style={footer}>
              AllergenWise &middot;{' '}
              <Link href="https://allergenwise.com" style={linkStyle}>
                allergenwise.com
              </Link>
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

RestaurantRejected.PreviewProps = {
  adminName: 'Maria Garcia',
  restaurantName: 'The Green Fork',
  reviewerNotes:
    'We found that 2 of the listed certifications have expired. Please ensure all staff hold active, non-expired AllergenWise certificates before resubmitting.',
} satisfies RestaurantRejectedProps;

export default RestaurantRejected;

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
const notesBox: React.CSSProperties = {
  backgroundColor: '#fef2f2',
  border: '1px solid #fecaca',
  borderRadius: '6px',
  padding: '16px',
  marginBottom: '20px',
};
const notesLabel: React.CSSProperties = {
  color: '#b91c1c',
  fontSize: '11px',
  fontWeight: '600',
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  margin: '0 0 8px',
};
const notesBody: React.CSSProperties = {
  color: '#1a2332',
  fontSize: '13px',
  lineHeight: '1.6',
  margin: 0,
  whiteSpace: 'pre-wrap',
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
