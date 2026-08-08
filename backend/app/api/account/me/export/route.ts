/**
 * GET /api/account/me/export
 *
 * P1-16 — GDPR Art. 15 + 20 data portability.
 *
 * Authenticated user downloads a JSON blob of every PII surface
 * AllergenWise stores about them. Snapshot at request time. Heavy
 * query, so rate-limited per-account (1/hr) + per-IP (5/hr).
 */
import 'server-only';
import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase, createServiceSupabase } from '@/lib/supabase/server';
import { getClientIpHash } from '@/lib/security/client-ip';
import { getAccountExportIpLimiter, getAccountExportAcctLimiter } from '@/lib/security/rate-limit';
import {
  runRateLimit,
  rateLimitedResponse,
  rateLimitUnavailableResponse,
} from '@/lib/security/rate-limit-guard';
import { buildAccountExport } from '@/lib/account/export';

export async function GET(req: NextRequest) {
  // Auth.
  const sessionClient = await createServerSupabase();
  const {
    data: { user },
    error: authError,
  } = await sessionClient.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  }

  // Rate limit (per-IP first; per-account second). Per-account is the
  // tighter knob (1/hr) — heavy query.
  const pepper = process.env.RATELIMIT_IP_PEPPER ?? '';
  const ipHash = getClientIpHash(req, pepper);
  const db = createServiceSupabase();

  const guard = await runRateLimit([
    { kind: 'per_ip', limiter: getAccountExportIpLimiter, key: ipHash },
    { kind: 'per_account', limiter: getAccountExportAcctLimiter, key: user.id },
  ]);

  if (guard.outcome !== 'ok') {
    if (guard.outcome === 'rate_limited') {
      try {
        await db.from('activity_events').insert({
          type: 'account_export_rate_limited',
          payload: { kind: guard.kind, ip_hash: ipHash, profile_id: user.id },
          actor_id: null,
        });
      } catch (err) {
        console.error('[account/export] activity_events insert failed:', err);
      }
      return rateLimitedResponse();
    }
    try {
      await db.from('activity_events').insert({
        type: 'account_export_rate_limiter_down',
        payload: { error: guard.error },
        actor_id: null,
      });
    } catch (err) {
      console.error('[account/export] activity_events insert failed:', err);
    }
    return rateLimitUnavailableResponse();
  }

  // Assemble the export.
  const payload = await buildAccountExport(db, user.id);

  // Audit event.
  try {
    await db.from('activity_events').insert({
      type: 'account_export_requested',
      actor_id: user.id,
      payload: {
        profile_id: user.id,
        ip_hash: ipHash,
        cert_count: payload.certificates.length,
        exam_attempt_count: payload.examAttempts.length,
      },
    });
  } catch (err) {
    console.error('[account/export] activity_events insert failed:', err);
  }

  // Render JSON with attachment headers. Pretty-print so a human
  // recipient can scan the file without piping through `jq`.
  const body = JSON.stringify(payload, null, 2);
  const date = new Date().toISOString().slice(0, 10);
  return new NextResponse(body, {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="allergenwise-data-export-${date}.json"`,
      'Cache-Control': 'no-store',
    },
  });
}
