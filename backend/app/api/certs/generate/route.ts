/**
 * app/api/certs/generate/route.ts
 * Server-to-server endpoint — generate cert PDF + upload to Supabase Storage.
 * Called by Agent C's /api/exam/submit after exam pass.
 *
 * POST /api/certs/generate
 * Auth: x-internal-secret header (CRON_SECRET)
 * Body: { certificateId: string }
 *
 * Idempotent: if cert.pdf_storage_path already set → returns existing signed URL.
 * Race condition note: two concurrent calls on the same cert — second finds
 * pdf_storage_path set and returns existing URL. Acceptable for MVP.
 *
 * Returns: { pdfStoragePath, signedUrl, cached }
 *
 * Type note: Supabase join queries and update() return never when Database type
 * lacks __InternalSupabase. We use (db as any) casts at mutation sites.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createServiceSupabase } from '@/lib/supabase/server';
import { renderCertificatePdf } from '@/lib/pdf/render';

export const runtime = 'nodejs';

// ─── Zod schema ───────────────────────────────────────────────────────────────

const GenerateCertSchema = z.object({
  certificateId: z.string().uuid('certificateId must be a UUID'),
});

// ─── Row shape returned by the joined select query ────────────────────────────

interface CertRow {
  id: string;
  cert_code: string;
  profile_id: string;
  restaurant_id: string;
  issued_at: string;
  expires_at: string;
  status: string;
  pdf_storage_path: string | null;
  profiles: { full_name: string; email: string } | { full_name: string; email: string }[] | null;
  restaurants:
    | { name: string; city: string | null; state: string | null }
    | { name: string; city: string | null; state: string | null }[]
    | null;
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest): Promise<NextResponse> {
  // 1. Internal secret guard
  const callerSecret = req.headers.get('x-internal-secret');
  const expectedSecret = process.env.CRON_SECRET;

  if (!expectedSecret || callerSecret !== expectedSecret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // 2. Parse + validate body
  let body: z.infer<typeof GenerateCertSchema>;
  try {
    const raw = await req.json();
    body = GenerateCertSchema.parse(raw);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid request', issues: err.issues }, { status: 400 });
    }
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { certificateId } = body;
  const db = createServiceSupabase();

  // 3. Fetch certificate with joined profile + restaurant
  const { data: certData, error: certErr } = await db
    .from('certificates')
    .select(
      `
      id,
      cert_code,
      profile_id,
      restaurant_id,
      issued_at,
      expires_at,
      status,
      pdf_storage_path,
      profiles:profile_id (
        full_name,
        email
      ),
      restaurants:restaurant_id (
        name,
        city,
        state
      )
    `
    )
    .eq('id', certificateId)
    .single();

  if (certErr || !certData) {
    console.error('[certs/generate] Certificate not found:', certificateId, certErr);
    return NextResponse.json({ error: 'Certificate not found' }, { status: 404 });
  }

  // Cast join result to known shape
  const cert = certData as unknown as CertRow;

  // 4. Idempotency — return existing PDF if already generated
  if (cert.pdf_storage_path) {
    const { data: urlData, error: urlErr } = await db.storage
      .from('certificates')
      .createSignedUrl(cert.pdf_storage_path, 60 * 60 * 24 * 365); // 1-year

    if (!urlErr && urlData) {
      console.log('[certs/generate] Returning existing PDF:', cert.cert_code);
      return NextResponse.json({
        pdfStoragePath: cert.pdf_storage_path,
        signedUrl: urlData.signedUrl,
        cached: true,
      });
    }
    console.warn('[certs/generate] Signed URL for existing cert failed; regenerating:', urlErr);
  }

  // 5. Extract joined data
  const profile = Array.isArray(cert.profiles) ? cert.profiles[0] : cert.profiles;

  const restaurant = Array.isArray(cert.restaurants) ? cert.restaurants[0] : cert.restaurants;

  if (!profile || !restaurant) {
    return NextResponse.json(
      { error: 'Profile or restaurant data missing from certificate' },
      { status: 500 }
    );
  }

  // 6. Generate QR code + PDF bytes
  const appUrl = process.env.APP_URL ?? 'https://allergenwise.com';

  let pdfBytes: Buffer;
  try {
    pdfBytes = await renderCertificatePdf({
      certCode: cert.cert_code,
      recipientName: profile.full_name,
      restaurantName: restaurant.name,
      issuedAt: cert.issued_at,
      expiresAt: cert.expires_at,
      verifyUrl: `${appUrl}/verify/${cert.cert_code}`,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[certs/generate] PDF render failed:', message);
    return NextResponse.json({ error: 'PDF generation failed', detail: message }, { status: 500 });
  }

  // 7. Upload to Supabase Storage: certificates/{certCode}.pdf
  const storagePath = `${cert.cert_code}.pdf`;

  const { error: uploadErr } = await db.storage.from('certificates').upload(storagePath, pdfBytes, {
    contentType: 'application/pdf',
    upsert: true, // Overwrite on retry
  });

  if (uploadErr) {
    console.error('[certs/generate] Upload failed:', uploadErr);
    return NextResponse.json(
      { error: 'Storage upload failed', detail: uploadErr.message },
      { status: 500 }
    );
  }

  // 8. Update certificate row with storage path
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: updateErr } = await (db as any)
    .from('certificates')
    .update({ pdf_storage_path: storagePath })
    .eq('id', certificateId);

  if (updateErr) {
    // Non-fatal — PDF is uploaded; next call regenerates without cached path
    console.error('[certs/generate] Failed to update pdf_storage_path:', updateErr);
  }

  // 9. Create 1-year signed URL
  const { data: urlData, error: urlErr } = await db.storage
    .from('certificates')
    .createSignedUrl(storagePath, 60 * 60 * 24 * 365);

  if (urlErr || !urlData) {
    console.error('[certs/generate] Signed URL failed (non-fatal):', urlErr);
    return NextResponse.json({
      pdfStoragePath: storagePath,
      signedUrl: null,
      cached: false,
      warning: 'PDF uploaded but signed URL generation failed',
    });
  }

  console.log('[certs/generate] Generated and uploaded:', cert.cert_code);

  return NextResponse.json({
    pdfStoragePath: storagePath,
    signedUrl: urlData.signedUrl,
    cached: false,
  });
}
