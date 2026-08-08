/**
 * lib/email/templates/RestaurantInfoRequested.tsx
 *
 * React Email component — Reviewer requests more info.
 * Subject: "Action needed: AllergenWise submission"
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

export interface RestaurantInfoRequestedProps {
  adminName: string;
  restaurantName: string;
  reviewerNotes: string;
  resubmitLink: string;
}

export const SUBJECT_RESTAURANT_INFO_REQUESTED = 'Action needed: AllergenWise submission';

export function RestaurantInfoRequested({
  adminName,
  restaurantName,
  reviewerNotes,
  resubmitLink,
}: RestaurantInfoRequestedProps) {
  return (
    <Html lang="en">
      <Head />
      <Preview>
        Our review team has a question about the {restaurantName} submission. Your response is
        needed to continue.
      </Preview>
      <Body style={body}>
        <Container style={container}>
          <Section style={header}>
            <Text style={logoText}>AllergenWise</Text>
          </Section>

          <Section style={content}>
            <Section style={actionBadge}>
              <Text style={actionText}>ACTION REQUIRED</Text>
            </Section>

            <Heading style={h1}>Hi {adminName},</Heading>
            <Text style={paragraph}>
              We&apos;ve reviewed the submission for <strong>{restaurantName}</strong> and need a
              bit more information before we can make a final decision. Please review the notes
              below and update your submission.
            </Text>

            <Section style={notesBox}>
              <Text style={notesLabel}>Reviewer notes</Text>
              <Text style={notesBody}>{reviewerNotes}</Text>
            </Section>

            <Text style={paragraph}>
              Once you&apos;ve addressed the items above, click the button below to update your
              submission. Our team will continue the review promptly.
            </Text>

            <Section style={ctaSection}>
              <Button style={button} href={resubmitLink}>
                Update Submission
              </Button>
            </Section>

            <Hr style={hr} />
            <Text style={footer}>
              Questions? Reply to this email or visit{' '}
              <Link href="https://allergenwise.com" style={linkStyle}>
                allergenwise.com
              </Link>
              .
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

RestaurantInfoRequested.PreviewProps = {
  adminName: 'Maria Garcia',
  restaurantName: 'The Green Fork',
  reviewerNotes:
    'Please provide the most recent food-handler permit number for your location. The one on file appears to have expired in March 2026.',
  resubmitLink: 'https://allergenwise.com/admin/submit',
} satisfies RestaurantInfoRequestedProps;

export default RestaurantInfoRequested;

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
const actionBadge: React.CSSProperties = { textAlign: 'center', marginBottom: '16px' };
const actionText: React.CSSProperties = {
  display: 'inline-block',
  backgroundColor: '#fffbeb',
  color: '#b45309',
  fontSize: '11px',
  fontWeight: '700',
  letterSpacing: '0.1em',
  padding: '4px 12px',
  borderRadius: '100px',
  border: '1px solid #fcd34d',
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
const notesBox: React.CSSProperties = {
  backgroundColor: '#fffbeb',
  border: '1px solid #fde68a',
  borderRadius: '6px',
  padding: '16px',
  marginBottom: '20px',
};
const notesLabel: React.CSSProperties = {
  color: '#b45309',
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
