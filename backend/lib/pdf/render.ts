/**
 * lib/pdf/render.ts
 * Server-side PDF rendering wrapper.
 * Generates QR code, renders certificate component via @react-pdf/renderer, returns Buffer.
 *
 * Usage:
 *   const pdfBytes = await renderCertificatePdf({ certCode, recipientName, ... });
 *   // pdfBytes starts with %PDF — valid PDF document
 *
 * Note: QR code generation is async and must complete before the React component
 * tree is rendered. We await it here and pass the data URL as a prop.
 */

import React from 'react';
import { renderToBuffer, type DocumentProps } from '@react-pdf/renderer';
import QRCode from 'qrcode';
import { CertificateDocument } from './certificate';
import type { CertificateDocumentProps } from './certificate';

// Props that callers provide — qrDataUrl is generated internally here
export type CertificateProps = Omit<CertificateDocumentProps, 'qrDataUrl'>;

/**
 * Renders the AllergenWise certificate as a PDF Buffer.
 *
 * @param props - Certificate data. qrDataUrl is generated from props.verifyUrl.
 * @returns     - PDF bytes as a Node.js Buffer. First 4 bytes are `%PDF`.
 * @throws      - If QR code generation or PDF rendering fails.
 */
export async function renderCertPdf(props: CertificateProps): Promise<Buffer> {
  const { verifyUrl } = props;

  // 1. Generate QR code as PNG data URL — MUST await before rendering
  //    Error correction level H (30%) for scan reliability on printed certs.
  const qrDataUrl = await QRCode.toDataURL(verifyUrl, {
    errorCorrectionLevel: 'H',
    type: 'image/png',
    width: 144, // 2× for print quality (displayed at 60×60pt on cert)
    margin: 1,
    color: {
      dark: '#0f766e', // Teal-700 QR modules
      light: '#ffffff',
    },
  });

  // 2. Build complete props for the document component
  const documentProps: CertificateDocumentProps = { ...props, qrDataUrl };

  // 3. Create React element.
  //    CertificateDocument renders a <Document> from @react-pdf/renderer.
  //    renderToBuffer expects ReactElement<DocumentProps>. The cast is safe because
  //    CertificateDocument wraps a <Document> which satisfies DocumentProps at runtime.
  const element = React.createElement(
    CertificateDocument,
    documentProps
  ) as React.ReactElement<DocumentProps>;

  // 4. Render to Buffer — Node.js runtime only (not edge-compatible)
  const buffer = await renderToBuffer(element);

  // 5. Validate — guard against silent render failures
  if (!buffer || buffer.length < 5) {
    throw new Error('PDF render produced an empty buffer');
  }

  const magic = buffer.slice(0, 4).toString('ascii');
  if (magic !== '%PDF') {
    throw new Error(`PDF render produced invalid output (magic bytes: ${JSON.stringify(magic)})`);
  }

  return buffer;
}

/**
 * Alias — Agent C's /api/exam/submit calls renderCertificatePdf.
 */
export const renderCertificatePdf = renderCertPdf;
