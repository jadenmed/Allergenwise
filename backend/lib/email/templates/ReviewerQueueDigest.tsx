/**
 * lib/email/templates/ReviewerQueueDigest.tsx
 *
 * React Email component — operational digest sent to REVIEWER_EMAIL when
 * submissions have been pending/in_review for more than 24 hours.
 * Sent by cron/digest-reviewer-queue, daily 09:00 UTC.
 *
 * Subject: "AllergenWise reviewer digest — {pendingCount} submission(s) awaiting review"
 */

import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Html,
  Preview,
  Section,
  Text,
} from '@react-email/components';
import * as React from 'react';

export interface ReviewerQueueDigestProps {
  pendingCount: number;
  reviewQueueUrl: string;
}

export function subjectReviewerQueueDigest(pendingCount: number): string {
  return `AllergenWise reviewer digest — ${pendingCount} submission${pendingCount === 1 ? '' : 's'} awaiting review`;
}

export function ReviewerQueueDigest({ pendingCount, reviewQueueUrl }: ReviewerQueueDigestProps) {
  const submissionWord = pendingCount === 1 ? 'submission' : 'submissions';

  return (
    <Html lang="en">
      <Head />
      <Preview>
        {`${pendingCount} ${submissionWord} in pending or in_review status submitted more than 24 hours ago.`}
      </Preview>
      <Body style={body}>
        <Container style={container}>
          <Section style={header}>
            <Text style={logoText}>AllergenWise</Text>
          </Section>

          <Section style={content}>
            <Heading style={h1}>Reviewer Queue Digest</Heading>
            <Text style={paragraph}>
              <strong>
                {pendingCount} {submissionWord}
              </strong>{' '}
              in pending or in_review status submitted more than 24 hours ago.
            </Text>

            <Section style={ctaSection}>
              <Button style={button} href={reviewQueueUrl}>
                Open the reviewer queue
              </Button>
            </Section>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

ReviewerQueueDigest.PreviewProps = {
  pendingCount: 3,
  reviewQueueUrl: 'https://allergenwise.com/reviewer/queue',
} satisfies ReviewerQueueDigestProps;

export default ReviewerQueueDigest;

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
  margin: '0 0 24px',
};
const ctaSection: React.CSSProperties = { textAlign: 'center', margin: '8px 0' };
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
