/**
 * lib/email/templates/RestaurantApproved.tsx
 *
 * React Email component — Restaurant approved and listed.
 * Subject: "Your restaurant is now listed on AllergenWise"
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

export interface RestaurantApprovedProps {
  adminName: string;
  restaurantName: string;
  listingUrl: string;
  listingExpiresAt: string;
}

export const SUBJECT_RESTAURANT_APPROVED = 'Your restaurant is now listed on AllergenWise';

export function RestaurantApproved({
  adminName,
  restaurantName,
  listingUrl,
  listingExpiresAt,
}: RestaurantApprovedProps) {
  return (
    <Html lang="en">
      <Head />
      <Preview>
        Great news — {restaurantName} is now listed on the AllergenWise public directory. Parents
        and diners can find you today.
      </Preview>
      <Body style={body}>
        <Container style={container}>
          <Section style={header}>
            <Text style={logoText}>AllergenWise</Text>
          </Section>

          <Section style={content}>
            <Section style={approvedBadge}>
              <Text style={approvedText}>APPROVED &amp; LISTED</Text>
            </Section>

            <Heading style={h1}>Congratulations, {adminName}!</Heading>
            <Text style={paragraph}>
              We&apos;re pleased to confirm that <strong>{restaurantName}</strong> has been reviewed
              and approved. Your restaurant is now live on the AllergenWise public directory, where
              families with food allergies can find and trust you.
            </Text>

            <Section style={infoBox}>
              <Text style={infoLabel}>Listing expires</Text>
              <Text style={infoValue}>{listingExpiresAt}</Text>
              <Text style={infoNote}>
                Renew your plan to keep your listing active after this date.
              </Text>
            </Section>

            <Section style={ctaSection}>
              <Button style={button} href={listingUrl}>
                View Your Public Listing
              </Button>
            </Section>

            <Hr style={hr} />
            <Text style={footer}>
              Share your listing link with guests:{' '}
              <Link href={listingUrl} style={linkStyle}>
                {listingUrl}
              </Link>
            </Text>
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

RestaurantApproved.PreviewProps = {
  adminName: 'Maria Garcia',
  restaurantName: 'The Green Fork',
  listingUrl: 'https://allergenwise.com/directory/the-green-fork-san-diego',
  listingExpiresAt: 'April 30, 2027',
} satisfies RestaurantApprovedProps;

export default RestaurantApproved;

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
const approvedBadge: React.CSSProperties = { textAlign: 'center', marginBottom: '16px' };
const approvedText: React.CSSProperties = {
  display: 'inline-block',
  backgroundColor: '#ecfdf5',
  color: '#047857',
  fontSize: '11px',
  fontWeight: '700',
  letterSpacing: '0.1em',
  padding: '4px 12px',
  borderRadius: '100px',
  border: '1px solid #6ee7b7',
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
  margin: '0 0 20px',
};
const infoBox: React.CSSProperties = {
  backgroundColor: '#f0fdfa',
  border: '1px solid #99f6e4',
  borderRadius: '6px',
  padding: '16px',
  marginBottom: '24px',
};
const infoLabel: React.CSSProperties = {
  color: '#6b7589',
  fontSize: '11px',
  fontWeight: '600',
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  margin: '0 0 4px',
};
const infoValue: React.CSSProperties = {
  color: '#0f766e',
  fontSize: '16px',
  fontWeight: '600',
  margin: '0 0 4px',
};
const infoNote: React.CSSProperties = {
  color: '#6b7589',
  fontSize: '12px',
  margin: 0,
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
  margin: '0 0 8px',
};
const linkStyle: React.CSSProperties = { color: '#0f766e' };
