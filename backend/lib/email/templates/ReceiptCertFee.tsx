/**
 * lib/email/templates/ReceiptCertFee.tsx
 * React Email — Payment receipt for cert fees or plan payment.
 * Trigger: payment_intent.succeeded (kind=cert_fee or kind=plan)
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

export interface ReceiptCertFeeProps {
  adminName: string;
  restaurantName: string;
  amountCents: number;
  receiptType: 'plan' | 'cert_fee' | 'submission';
  paymentIntentId: string;
  plan?: 'quarterly' | 'semiannual';
  certifiedCount?: number;
}

export const SUBJECT_RECEIPT_CERT_FEE = 'Payment receipt — AllergenWise';

export function ReceiptCertFee({
  adminName,
  restaurantName,
  amountCents,
  receiptType,
  paymentIntentId,
  plan,
  certifiedCount,
}: ReceiptCertFeeProps) {
  const amountDollars = (amountCents / 100).toFixed(2);

  let description = 'Payment';
  if (receiptType === 'plan' && plan) {
    description = plan === 'quarterly' ? 'Quarterly Plan ($90)' : 'Semi-Annual Plan ($120)';
  } else if (receiptType === 'cert_fee' && certifiedCount) {
    description = `Certification fees — ${certifiedCount} employee${certifiedCount !== 1 ? 's' : ''} × $35`;
  } else if (receiptType === 'submission' && certifiedCount) {
    description = `Submission certification fees — ${certifiedCount} employee${certifiedCount !== 1 ? 's' : ''} × $35`;
  }

  const _subject = `Receipt: $${amountDollars} — ${restaurantName}`;
  void _subject; // subject computed but not rendered — exported via SUBJECT_RECEIPT_CERT_FEE constant

  return (
    <Html lang="en">
      <Head />
      <Preview>
        Payment receipt for {restaurantName}: ${amountDollars} charged. Reference: {paymentIntentId}
        .
      </Preview>
      <Body style={body}>
        <Container style={container}>
          <Section style={header}>
            <Text style={logoText}>AllergenWise</Text>
          </Section>

          <Section style={content}>
            <Heading style={h1}>Payment Receipt</Heading>
            <Text style={paragraph}>Hi {adminName}, thank you for your payment.</Text>

            <Section style={receiptBox}>
              <Section style={receiptRow}>
                <Text style={receiptLabel}>Restaurant</Text>
                <Text style={receiptValue}>{restaurantName}</Text>
              </Section>
              <Section style={receiptRow}>
                <Text style={receiptLabel}>Description</Text>
                <Text style={receiptValue}>{description}</Text>
              </Section>
              <Section style={receiptRow}>
                <Text style={receiptLabel}>Amount charged</Text>
                <Text style={receiptValueAmount}>${amountDollars}</Text>
              </Section>
              <Hr style={receiptHr} />
              <Section style={receiptRow}>
                <Text style={receiptLabel}>Reference</Text>
                <Text style={receiptValueMono}>{paymentIntentId}</Text>
              </Section>
            </Section>

            <Hr style={hr} />
            <Text style={footer}>
              This is an automated receipt. For questions about billing, contact
              support@allergenwise.com or log in to your billing dashboard.
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

ReceiptCertFee.PreviewProps = {
  adminName: 'Maria Lopez',
  restaurantName: 'Casa Verde',
  amountCents: 10500,
  receiptType: 'cert_fee',
  paymentIntentId: 'pi_3EXAMPLE',
  certifiedCount: 3,
} satisfies ReceiptCertFeeProps;

export default ReceiptCertFee;

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
const receiptBox: React.CSSProperties = {
  backgroundColor: '#f6f7f9',
  border: '1px solid #e3e6eb',
  borderRadius: '6px',
  padding: '20px',
  margin: '0 0 24px',
};
const receiptRow: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'row' as const,
  justifyContent: 'space-between',
  marginBottom: '8px',
};
const receiptLabel: React.CSSProperties = {
  color: '#6b7589',
  fontSize: '12px',
  fontWeight: '600',
  letterSpacing: '0.05em',
  textTransform: 'uppercase' as const,
  margin: 0,
};
const receiptValue: React.CSSProperties = {
  color: '#1a2332',
  fontSize: '13px',
  margin: 0,
  textAlign: 'right' as const,
};
const receiptValueAmount: React.CSSProperties = {
  color: '#0f766e',
  fontSize: '16px',
  fontWeight: '700',
  margin: 0,
  textAlign: 'right' as const,
};
const receiptValueMono: React.CSSProperties = {
  color: '#6b7589',
  fontSize: '11px',
  fontFamily: 'monospace',
  margin: 0,
  textAlign: 'right' as const,
};
const receiptHr: React.CSSProperties = { borderColor: '#e3e6eb', margin: '12px 0' };
const hr: React.CSSProperties = { borderColor: '#e3e6eb', margin: '24px 0 16px' };
const footer: React.CSSProperties = {
  color: '#6b7589',
  fontSize: '12px',
  lineHeight: '1.5',
  margin: 0,
};

export { subject };
function subject(props: ReceiptCertFeeProps) {
  return `Receipt: $${(props.amountCents / 100).toFixed(2)} — ${props.restaurantName}`;
}
