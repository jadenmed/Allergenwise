/**
 * POST /api/admin/csv-upload
 * Bulk employee invite via CSV upload.
 *
 * Query params:
 *   ?dryRun=true  (default) — parse + validate + dedupe, return preview
 *   ?commit=true&uploadId=<uuid> — commit previously validated rows
 *
 * Body: multipart/form-data with `file` field (CSV)
 *       OR application/json with { uploadId } for commit mode
 *
 * CSV columns: email, fullName (or full_name / full name), jobRole (or job_role / job role)
 * Limits: ≤200 rows
 *
 * Returns (dry run):  { uploadId, validRows: [{email,fullName,jobRole}], errors, duplicatesSkipped, totalParsed }
 * Returns (commit):   { committed: number, failed: [], uploadId }
 *
 * Chunked email sends: 50 emails/sec to stay under Resend rate limit.
 *
 * DEPENDENCY: db/migrations/0006_csv_drafts.sql (csv_upload_drafts table).
 * DEPENDENCY: Agent A's 0005_invite_tokens.sql (profiles.invite_token column).
 */
import 'server-only';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createServiceDb } from '@/lib/db/service';
import { requireRole } from '@/lib/auth/require-role';
import { parseCsv, MAX_CSV_BYTES } from '@/lib/admin/csv';
import { generateInviteToken } from '@/lib/auth/invite';
import { sendEmail } from '@/lib/email/send';
import type { CsvRow } from '@/lib/admin/csv';

// ─── Commit query schema ──────────────────────────────────────────────────────

const CommitQuerySchema = z.object({
  uploadId: z.string().uuid('uploadId must be a valid UUID'),
});

// ─── Rate-limited email sender (50/sec) ──────────────────────────────────────

const CHUNK_SIZE = 50;
const CHUNK_DELAY_MS = 1000; // 1 second between chunks → 50/sec

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface SendResult {
  email: string;
  ok: boolean;
  error?: string;
}

async function sendInviteEmailsChunked(
  rows: Array<{ email: string; fullName: string; inviteToken: string }>,
  restaurantName: string,
  adminName: string,
  appUrl: string
): Promise<SendResult[]> {
  const results: SendResult[] = [];

  for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
    const chunk = rows.slice(i, i + CHUNK_SIZE);

    await Promise.all(
      chunk.map(async ({ email, fullName, inviteToken }) => {
        const inviteUrl = `${appUrl}/invite/${inviteToken}`;

        const result = await sendEmail('EmployeeInvite', email, {
          recipientName: fullName,
          restaurantName,
          inviteLink: inviteUrl,
        });

        if (!result.ok) {
          results.push({ email, ok: false, error: result.error ?? 'Send failed' });
        } else {
          results.push({ email, ok: true });
        }
      })
    );

    // Throttle between chunks (not needed after last chunk)
    if (i + CHUNK_SIZE < rows.length) {
      await sleep(CHUNK_DELAY_MS);
    }
  }

  return results;
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function POST(request: Request) {
  const url = new URL(request.url);
  const isCommit = url.searchParams.get('commit') === 'true';
  const isDryRun = !isCommit;

  // ── Auth ──────────────────────────────────────────────────────────────────
  const auth = await requireRole({
    roles: ['manager'],
    profileClient: 'service',
    columns: 'id, role, restaurant_id, full_name',
    unauthorizedMessage: 'Unauthorized.',
    forbiddenMessage: 'Forbidden. Admin role required.',
    onMissingProfile: 'forbidden',
    requireRestaurant: { status: 403, message: 'Forbidden. Admin role required.' },
  });
  if (auth instanceof NextResponse) return auth;
  const { profile: adminProfile } = auth;

  const serviceClient = createServiceDb();

  const restaurantId = adminProfile.restaurant_id!;

  // ─────────────────────────────────────────────────────────────────────────
  // COMMIT MODE
  // ─────────────────────────────────────────────────────────────────────────
  if (isCommit) {
    const uploadIdParam = url.searchParams.get('uploadId');
    const commitParsed = CommitQuerySchema.safeParse({ uploadId: uploadIdParam });

    if (!commitParsed.success) {
      return NextResponse.json(
        { error: 'Invalid uploadId.', details: commitParsed.error.flatten().fieldErrors },
        { status: 400 }
      );
    }

    const { uploadId } = commitParsed.data;

    // Fetch draft from csv_upload_drafts
    type DraftRow = {
      id: string;
      admin_id: string;
      restaurant_id: string;
      parsed: CsvRow[];
      expires_at: string;
    };

    const { data: draft, error: draftError } = await (serviceClient
      .from('csv_upload_drafts')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .select('*' as any)
      .eq('id', uploadId)
      .eq('admin_id', adminProfile.id)
      .eq('restaurant_id', restaurantId)
      .single() as unknown as Promise<{
      data: DraftRow | null;
      error: { message: string } | null;
    }>);

    if (draftError || !draft) {
      return NextResponse.json(
        { error: 'Draft not found or expired. Please re-upload the CSV.' },
        { status: 404 }
      );
    }

    // Check expiry
    if (new Date(draft.expires_at) < new Date()) {
      return NextResponse.json(
        { error: 'Draft expired (1 hour). Please re-upload the CSV.' },
        { status: 410 }
      );
    }

    const rows: CsvRow[] = draft.parsed;

    // Fetch restaurant name
    const { data: restaurant } = await serviceClient
      .from('restaurants')
      .select('name')
      .eq('id', restaurantId)
      .single();
    const restaurantName = restaurant?.name ?? 'your restaurant';
    const appUrl = process.env.APP_URL ?? 'http://localhost:3000';

    // Create auth users + profiles + collect email rows
    const emailPayload: Array<{ email: string; fullName: string; inviteToken: string }> = [];
    const failed: Array<{ email: string; error: string }> = [];

    for (const row of rows) {
      const inviteToken = generateInviteToken();
      const now = new Date().toISOString();

      // Create auth user
      const { data: authData, error: authError } = await serviceClient.auth.admin.createUser({
        email: row.email,
        email_confirm: false,
        user_metadata: { full_name: row.fullName },
      });

      if (authError || !authData.user) {
        failed.push({
          email: row.email,
          error: authError?.message ?? 'Failed to create auth user',
        });
        continue;
      }

      // Insert profile
      const { error: profileError } = await serviceClient
        .from('profiles')
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .insert({
          id: authData.user.id,
          full_name: row.fullName,
          email: row.email,
          role: 'learner',
          restaurant_id: restaurantId,
          job_role: row.jobRole,
          invited_at: now,
          invited_by: adminProfile.id,
          invite_token: inviteToken,
        } as unknown as Parameters<ReturnType<typeof serviceClient.from>['insert']>[0]);

      if (profileError) {
        // Rollback auth user
        await serviceClient.auth.admin.deleteUser(authData.user.id).catch(() => {});
        failed.push({
          email: row.email,
          error: profileError.message ?? 'Failed to create profile',
        });
        continue;
      }

      emailPayload.push({ email: row.email, fullName: row.fullName, inviteToken });
    }

    // Send emails in chunks of 50/sec
    const emailResults = await sendInviteEmailsChunked(
      emailPayload,
      restaurantName,
      adminProfile.full_name,
      appUrl
    );

    const emailFailed = emailResults.filter((r) => !r.ok);

    // Log activity event for bulk invite
    if (emailPayload.length > 0) {
      await serviceClient
        .from('activity_events')
        .insert({
          restaurant_id: restaurantId,
          actor_id: adminProfile.id,
          type: 'invite_sent',
          payload: {
            action: 'csv_bulk_invite',
            count: emailPayload.length,
            uploadId,
          },
        })
        .then(() => {})
        .catch((err: unknown) => console.error('[csv-upload/commit] activity_event failed:', err));
    }

    // Delete draft after commit
    await (
      serviceClient
        .from('csv_upload_drafts')
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .delete()
        .eq('id', uploadId) as unknown as Promise<unknown>
    ).catch(() => {});

    return NextResponse.json({
      committed: emailPayload.length,
      failed: [
        ...failed,
        ...emailFailed.map((r) => ({ email: r.email, error: r.error ?? 'Email failed' })),
      ],
      uploadId,
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // DRY-RUN MODE (default)
  // ─────────────────────────────────────────────────────────────────────────

  // P1-10: cheap pre-buffer guard from Content-Length. 64 KB slack covers
  // multipart envelope overhead. Rejects oversize bodies before formData()
  // reads them into memory.
  const contentLength = Number(request.headers.get('content-length') ?? 0);
  if (contentLength > MAX_CSV_BYTES + 64 * 1024) {
    return NextResponse.json(
      { error: 'Payload too large', maxBytes: MAX_CSV_BYTES },
      { status: 413 }
    );
  }

  // Parse multipart form
  let csvText: string;
  try {
    const formData = await request.formData();
    const file = formData.get('file');
    if (!file || typeof file === 'string') {
      return NextResponse.json(
        { error: 'Missing file field. Send multipart/form-data with a `file` field.' },
        { status: 400 }
      );
    }
    // P1-10: enforce byte cap on the File entry — covers a missing or lying
    // Content-Length header.
    if ((file as File).size > MAX_CSV_BYTES) {
      return NextResponse.json(
        { error: 'Payload too large', maxBytes: MAX_CSV_BYTES },
        { status: 413 }
      );
    }
    csvText = await (file as File).text();
    // P1-10: final defense — UTF-8 byte length after decoding.
    if (Buffer.byteLength(csvText, 'utf8') > MAX_CSV_BYTES) {
      return NextResponse.json(
        { error: 'Payload too large', maxBytes: MAX_CSV_BYTES },
        { status: 413 }
      );
    }
  } catch {
    return NextResponse.json({ error: 'Failed to parse multipart form data.' }, { status: 400 });
  }

  if (!csvText.trim()) {
    return NextResponse.json({ error: 'CSV file is empty.' }, { status: 400 });
  }

  // Fetch existing emails for this restaurant (for deduplication)
  const { data: existingProfiles } = await serviceClient
    .from('profiles')
    .select('email')
    .eq('restaurant_id', restaurantId);

  const existingEmails = new Set<string>(
    (existingProfiles ?? []).map((p: { email: string }) => p.email.toLowerCase())
  );

  // Parse + validate
  const { validRows, errors, totalParsed, duplicatesSkipped } = parseCsv(csvText, existingEmails);

  // If there are structural errors, return immediately
  if (isDryRun && errors.length > 0 && validRows.length === 0) {
    return NextResponse.json(
      { uploadId: null, validRows: [], errors, totalParsed, duplicatesSkipped },
      { status: 422 }
    );
  }

  // Store draft in csv_upload_drafts for 1 hour
  let uploadId: string | null = null;
  if (validRows.length > 0) {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 60 * 60 * 1000).toISOString();

    const { data: draft, error: draftInsertError } = await (serviceClient
      .from('csv_upload_drafts')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .insert({
        admin_id: adminProfile.id,
        restaurant_id: restaurantId,
        parsed: validRows,
        created_at: now.toISOString(),
        expires_at: expiresAt,
      } as unknown as Parameters<ReturnType<typeof serviceClient.from>['insert']>[0])
      .select('id')
      .single() as unknown as Promise<{
      data: { id: string } | null;
      error: { message: string } | null;
    }>);

    if (!draftInsertError && draft) {
      uploadId = draft.id;
    }
  }

  return NextResponse.json(
    {
      uploadId,
      validRows,
      errors,
      duplicatesSkipped,
      totalParsed,
    },
    { status: errors.length > 0 && validRows.length === 0 ? 422 : 200 }
  );
}
