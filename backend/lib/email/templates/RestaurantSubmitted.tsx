/**
 * lib/email/templates/RestaurantSubmitted.tsx
 *
 * React Email component — New restaurant submission (sent to reviewer team).
 * Subject: "New restaurant submission: {restaurantName}"
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
  Row,
  Column,
  Section,
  Text,
} from '@react-email/components';
import * as React from 'react';

export interface RestaurantSubmittedProps {
  restaurantName: string;
  submissionId: string;
  /**
   * Active certificates this restaurant holds, or `null` when the count could
   * not be read (T-47). `null` renders as "Unavailable" and drops out of the
   * preview line entirely — a reviewer must never be shown a number the
   * database did not produce, and 0 is a REAL count meaning "nobody is
   * certified", not a stand-in for "we do not know".
   */
  certifiedCount: number | null;
  reviewLink: string;
}

export function subjectRestaurantSubmitted(restaurantName: string): string {
  return `New restaurant submission: ${restaurantName}`;
}

export function RestaurantSubmitted({
  restaurantName,
  submissionId,
  certifiedCount,
  reviewLink,
}: RestaurantSubmittedProps) {
  return (
    <Html lang="en">
      <Head />
      <Preview>
        {certifiedCount === null
          ? `New submission from ${restaurantName}. Action required in the reviewer queue.`
          : `New submission from ${restaurantName} — ${certifiedCount} certified staff. Action required in the reviewer queue.`}
      </Preview>
      <Body style={body}>
        <Container style={container}>
          <Section style={header}>
            <Text style={logoText}>AllergenWise — Internal</Text>
          </Section>

          <Section style={content}>
            <Heading style={h1}>New Restaurant Submission</Heading>
            <Text style={paragraph}>
              A new submission has arrived in the reviewer queue and requires your attention.
            </Text>

            <Section style={tableSection}>
              <Row style={tableRow}>
                <Column style={tableLabel}>Restaurant</Column>
                <Column style={tableValue}>{restaurantName}</Column>
              </Row>
              <Row style={tableRow}>
                <Column style={tableLabel}>Submission ID</Column>
                <Column style={tableValue}>{submissionId}</Column>
              </Row>
              <Row style={tableRow}>
                <Column style={tableLabel}>Certified staff</Column>
                <Column style={certifiedCount === null ? tableValueUnknown : tableValue}>
                  {certifiedCount === null ? 'Unavailable' : certifiedCount}
                </Column>
              </Row>
            </Section>

            <Section style={ctaSection}>
              <Button style={button} href={reviewLink}>
                Open in Review Queue
              </Button>
            </Section>

            <Hr style={hr} />
            <Text style={footer}>
              This is an internal notification sent to the AllergenWise reviewer team. The 24-hour
              SLA timer starts now.
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

RestaurantSubmitted.PreviewProps = {
  restaurantName: 'The Green Fork',
  submissionId: 'sub_abc123',
  certifiedCount: 8,
  reviewLink: 'https://allergenwise.com/reviewer/queue/sub_abc123',
} satisfies RestaurantSubmittedProps;

export default RestaurantSubmitted;

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
  fontSize: '16px',
  fontWeight: '600',
  margin: 0,
};
const content: React.CSSProperties = { padding: '32px 24px' };
const h1: React.CSSProperties = {
  color: '#1a2332',
  fontSize: '18px',
  fontWeight: '600',
  margin: '0 0 12px',
};
const paragraph: React.CSSProperties = {
  color: '#3d4759',
  fontSize: '14px',
  lineHeight: '1.6',
  margin: '0 0 20px',
};
const tableSection: React.CSSProperties = {
  border: '1px solid #e3e6eb',
  borderRadius: '6px',
  marginBottom: '24px',
  overflow: 'hidden',
};
const tableRow: React.CSSProperties = {
  borderBottom: '1px solid #eef0f3',
};
const tableLabel: React.CSSProperties = {
  color: '#6b7589',
  fontSize: '12px',
  fontWeight: '600',
  padding: '10px 16px',
  backgroundColor: '#f1f3f6',
  width: '40%',
};
const tableValue: React.CSSProperties = {
  color: '#1a2332',
  fontSize: '13px',
  padding: '10px 16px',
};
/** "Unavailable" is an absence, not a value — muted and italic so it reads as one. */
const tableValueUnknown: React.CSSProperties = {
  ...tableValue,
  color: '#6b7589',
  fontStyle: 'italic',
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
