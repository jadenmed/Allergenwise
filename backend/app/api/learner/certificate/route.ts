/**
 * GET /api/learner/certificate
 *
 * Wave 2C — returns the authenticated learner's latest publicly-active
 * certificate (status='active' only) with a fresh signed URL for the PDF
 * (1-hour expiry). 404 when no active cert exists; the client distinguishes
 * "no cert / pending / expired / revoked" via the home-data full-history
 * response.
 *
 * The 404 body also includes `hasPassedExam`. A learner who passes gets a
 * certificates row immediately, but it lands as `pending` and only becomes
 * `active` once the cert fee is charged (T-41b) — and this route returns
 * active certs only. So a learner who passed can legitimately 404 here for
 * a while. /learner/certificate uses this flag to say "your certificate is
 * being finalized" instead of "go take the exam" to someone who already has.
 *
 * Response shape:
 *   { certCode, issuedAt, expiresAt, pdfUrl, profileName, restaurantName }
 *   404: { error, hasPassedExam }
 */
import 'server-only';
import { NextRequest, NextResponse } from 'next/server';
import { createServiceDb } from '@/lib/db/service';
import { requireRole } from '@/lib/auth/require-role';

export async function GET(_req: NextRequest) {
  // ── Auth ──────────────────────────────────────────────────────────────────
  const auth = await requireRole({
    roles: ['learner'],
    profileClient: 'session',
    columns: 'id, role, full_name',
    forbiddenMessage: 'Forbidden: learner role required',
    onMissingProfile: 'forbidden',
    // T-46a — a departed learner keeps their certificate. They sat the exam,
    // the restaurant paid for it, and it names the restaurant and the date:
    // still true after they leave. Every read below is keyed on their own
    // profile_id, so nothing here is restaurant-scoped data they have lost the
    // right to see.
    allowDeparted: true,
  });
  if (auth instanceof NextResponse) return auth;
  const { user, profile } = auth;

  const db = createServiceDb();

  // ── Fetch latest publicly-active certificate ──────────────────────────────
  const { data: cert, error: certError } = await db
    .from('certificates')
    .select('cert_code, issued_at, expires_at, pdf_storage_path, restaurant_id')
    .eq('profile_id', user.id)
    .eq('status', 'active')
    .order('issued_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (certError) {
    return NextResponse.json({ error: 'Failed to fetch certificate' }, { status: 500 });
  }

  if (!cert) {
    const { data: passedAttempt } = await db
      .from('exam_attempts')
      .select('id')
      .eq('profile_id', user.id)
      .eq('passed', true)
      .limit(1)
      .maybeSingle();

    return NextResponse.json(
      { error: 'No certificate found', hasPassedExam: !!passedAttempt },
      { status: 404 }
    );
  }

  // ── Fetch restaurant name ─────────────────────────────────────────────────
  const { data: restaurant } = await db
    .from('restaurants')
    .select('name')
    .eq('id', cert.restaurant_id)
    .single();

  // ── Generate fresh signed URL (1-hour expiry) ─────────────────────────────
  let pdfUrl: string | null = null;
  if (cert.pdf_storage_path) {
    const { data: signedData } = await db.storage
      .from('certificates')
      .createSignedUrl(cert.pdf_storage_path, 3600);
    pdfUrl = signedData?.signedUrl ?? null;
  }

  return NextResponse.json({
    certCode: cert.cert_code,
    issuedAt: cert.issued_at,
    expiresAt: cert.expires_at,
    pdfUrl,
    profileName: profile.full_name,
    restaurantName: restaurant?.name ?? '',
  });
}
