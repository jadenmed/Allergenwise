/**
 * POST /api/admin/upload-photo
 *
 * Server-side photo upload for admin restaurant submissions. Replaces the
 * direct browser-side Supabase Storage upload that broke under Wave 2A's
 * httpOnly cookie hardening (F-S6 in audits/followups.md).
 *
 * Contract:
 *   - Auth: admin session (createServerSupabase().auth.getUser() + DB role
 *           re-check)
 *   - Body: multipart/form-data with one `photo` file field
 *   - Size cap: 5 MB enforced server-side BEFORE buffering the whole file
 *               (Content-Length check first, then byte-count check after
 *               formData() reads the part — both required).
 *   - MIME validation: by actual file bytes via `sharp().metadata()`,
 *               not the client-supplied Content-Type. Accepts jpeg, png, webp.
 *   - EXIF: stripped via `sharp(buffer).rotate().toFormat(<orig>).toBuffer()`.
 *           Output keeps the original format (jpeg→jpeg, png→png, webp→webp).
 *   - Storage upload: via createServiceSupabase() (service-role, bypasses
 *               storage RLS). Path: `<restaurant_id>/hero-<timestamp>-<rand>.<ext>`
 *
 * Response shapes:
 *   200 { storagePath, contentType, bytes }
 *   401 { error: 'Unauthorized' }
 *   403 { error: 'Forbidden: admin role required' }
 *   413 { error: 'Payload too large', maxBytes }
 *   415 { error: 'Unsupported media type' }
 *   422 { error: 'Invalid image' }
 *   500 { error: 'Upload failed', detail? }
 */

import 'server-only';
import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'node:crypto';
import sharp from 'sharp';
import { createServiceSupabase } from '@/lib/supabase/server';
import { requireRole } from '@/lib/auth/require-role';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_BYTES = 5 * 1024 * 1024; // 5 MB
const STORAGE_BUCKET = 'restaurant-photos';

// Map sharp's reported `format` to a Storage-friendly content-type and file
// extension. Anything not in this set is rejected.
const FORMAT_MAP: Record<string, { contentType: string; ext: string }> = {
  jpeg: { contentType: 'image/jpeg', ext: 'jpg' },
  jpg: { contentType: 'image/jpeg', ext: 'jpg' },
  png: { contentType: 'image/png', ext: 'png' },
  webp: { contentType: 'image/webp', ext: 'webp' },
};

export async function POST(req: NextRequest): Promise<NextResponse> {
  // ── 1+2. Auth: session + admin role with a restaurant ──────────────────────
  let restaurantId: string;
  try {
    const auth = await requireRole({
      roles: ['manager'],
      profileClient: 'service',
      columns: 'id, role, restaurant_id, full_name',
      unauthorizedMessage: 'Unauthorized',
      forbiddenMessage: 'Forbidden: admin role required',
      onMissingProfile: 'forbidden',
      requireRestaurant: { status: 403, message: 'Forbidden: admin role required' },
    });
    if (auth instanceof NextResponse) return auth;
    restaurantId = auth.profile.restaurant_id as string;
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // ── 3. Cheap pre-buffer size guard from Content-Length ─────────────────────
  const contentLength = Number(req.headers.get('content-length') ?? 0);
  if (contentLength > MAX_BYTES + 1024 * 64 /* small slack for multipart envelope */) {
    return NextResponse.json({ error: 'Payload too large', maxBytes: MAX_BYTES }, { status: 413 });
  }

  // ── 4. Parse multipart, pull the `photo` field ─────────────────────────────
  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: 'Invalid multipart body' }, { status: 400 });
  }

  const photoEntry = formData.get('photo');
  if (!photoEntry || typeof photoEntry === 'string') {
    return NextResponse.json({ error: 'Missing photo field' }, { status: 400 });
  }
  const photo = photoEntry as File;

  // ── 5. Enforce byte-count cap after parse (covers content-length lying) ────
  if (photo.size > MAX_BYTES) {
    return NextResponse.json({ error: 'Payload too large', maxBytes: MAX_BYTES }, { status: 413 });
  }

  const inputBuffer = Buffer.from(await photo.arrayBuffer());
  if (inputBuffer.length > MAX_BYTES) {
    return NextResponse.json({ error: 'Payload too large', maxBytes: MAX_BYTES }, { status: 413 });
  }

  // ── 6. Validate the actual image bytes + decode metadata via sharp ─────────
  let format: string | undefined;
  try {
    const meta = await sharp(inputBuffer).metadata();
    format = meta.format;
  } catch {
    return NextResponse.json({ error: 'Invalid image' }, { status: 422 });
  }

  if (!format || !FORMAT_MAP[format]) {
    return NextResponse.json({ error: 'Unsupported media type' }, { status: 415 });
  }

  // ── 7. Re-encode without metadata (strips EXIF) — preserves format ─────────
  let cleanedBuffer: Buffer;
  try {
    const pipeline = sharp(inputBuffer).rotate(); // .rotate() applies EXIF orientation, then strips
    if (format === 'jpeg' || format === 'jpg') {
      cleanedBuffer = await pipeline.jpeg().toBuffer();
    } else if (format === 'png') {
      cleanedBuffer = await pipeline.png().toBuffer();
    } else if (format === 'webp') {
      cleanedBuffer = await pipeline.webp().toBuffer();
    } else {
      return NextResponse.json({ error: 'Unsupported media type' }, { status: 415 });
    }
  } catch (err) {
    const detail = err instanceof Error ? err.message : 'unknown';
    return NextResponse.json({ error: 'Invalid image', detail }, { status: 422 });
  }

  // ── 8. Build storage path: <restaurant_id>/hero-<ts>-<rand>.<ext> ──────────
  const { contentType, ext } = FORMAT_MAP[format]!;
  const rand = randomBytes(6).toString('hex');
  const storagePath = `${restaurantId}/hero-${Date.now()}-${rand}.${ext}`;

  // ── 9. Upload via service-role (bypasses Storage RLS by design) ────────────
  const storage = createServiceSupabase();
  const { error: uploadError } = await storage.storage
    .from(STORAGE_BUCKET)
    .upload(storagePath, cleanedBuffer, {
      contentType,
      upsert: false,
      cacheControl: '3600',
    });

  if (uploadError) {
    console.error('[upload-photo] storage upload error:', uploadError);
    return NextResponse.json(
      { error: 'Upload failed', detail: uploadError.message },
      { status: 500 }
    );
  }

  return NextResponse.json({
    storagePath,
    contentType,
    bytes: cleanedBuffer.length,
  });
}
