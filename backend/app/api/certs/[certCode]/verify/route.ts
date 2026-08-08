/**
 * app/api/certs/[certCode]/verify/route.ts
 * Public anonymous endpoint — verify a certificate by cert code.
 * Used by the QR code on printed certs and the public /verify page.
 *
 * GET /api/certs/{certCode}/verify
 * No auth required — fully public route.
 *
 * Wave 4B (P0 #10) — order of operations is load-bearing:
 *
 *   1. Format-validate via validateCertCode (cheap, no I/O).
 *      Invalid format → return not_found shape, indistinguishable from
 *      an unknown-but-valid-format code. Malformed traffic NEVER reaches
 *      step 2 — so a victim's per-IP rate-limit window cannot be drained
 *      by spoofed gibberish traffic.
 *
 *   2. Per-IP rate-limit guard (10 / 60s sliding window).
 *      Per-code rate-limit guard (5 / 60s sliding window).
 *      Either rejection → 429 with Retry-After: 60, identical body for
 *      existing vs non-existing codes.
 *      Redis throw → 503 with Retry-After: 60, identical body across
 *      all callers.
 *
 *   3. Service-role DB read of the cert row. Maps internal status to
 *      the 4 publicly visible verify statuses:
 *
 *        pending  → not_found  (treated as if cert does not exist)
 *        active   → active
 *        expired  → expired
 *        revoked  → revoked
 *        disputed → revoked    (intentional public masking per
 *                              cert-payment-state-design.md (a))
 *
 *   4. Always emit a `cert_verify_latency` structured log line.
 *      OQ-1 reopen-trigger thresholds documented in followups.md.
 *
 * Non-negotiable leak-prevention (CLAUDE.md):
 *   The response MUST ONLY include:
 *     valid, status, restaurantName, issuedAt, expiresAt.
 *   The response MUST NOT include profile name, address, lat/lng, phone,
 *   internal UUIDs, exam scores, dispute_id, or revocation_reason.
 *
 * Wave 4B note on caching: `revalidate = 60` was removed because it
 * cached the response BEFORE the handler ran, bypassing the rate
 * limiter on cache hits. The route is now `force-dynamic` so the
 * limiter has authority on every external request. The cache-cost
 * trade-off is documented in OQ-1.
 */

import { NextRequest, NextResponse } from 'next/server';
import type { ActivityEventType } from '@/lib/types/db';
import { createServiceSupabase } from '@/lib/supabase/server';
import type { CertStatus } from '@/lib/learner/cert-state';
import { validateCertCode } from '@/lib/learner/cert-code';
import { getClientIpHash } from '@/lib/security/client-ip';
import { getVerifyIpLimiter, getVerifyCodeLimiter } from '@/lib/security/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// ─── Allowed response shape (exhaustive — nothing else is permitted) ──────────

export type VerifyStatus = 'active' | 'expired' | 'revoked' | 'not_found' | 'rate_limited';

export interface VerifyResponse {
  valid: boolean;
  status: VerifyStatus;
  restaurantName?: string;
  issuedAt?: string;
  expiresAt?: string;
}

// ─── Joined row shape (minimal — only what we need to build VerifyResponse) ───

interface CertVerifyRow {
  issued_at: string;
  expires_at: string;
  status: CertStatus;
  restaurants: { name: string } | { name: string }[] | null;
}

// ─── Constant response bodies (avoid any per-call string interpolation) ──────

const NOT_FOUND_RESPONSE: VerifyResponse = { valid: false, status: 'not_found' };
const RATE_LIMITED_RESPONSE: VerifyResponse = { valid: false, status: 'rate_limited' };

function notFoundResponse(): NextResponse {
  return NextResponse.json(NOT_FOUND_RESPONSE);
}

function rateLimitedResponse(): NextResponse {
  return NextResponse.json(RATE_LIMITED_RESPONSE, {
    status: 429,
    headers: {
      'Retry-After': '60',
      'Cache-Control': 'no-store',
    },
  });
}

function serviceUnavailableResponse(): NextResponse {
  // Same indistinguishability rule as 429 — every 503 looks the same.
  return NextResponse.json(
    { valid: false, status: 'unavailable' },
    {
      status: 503,
      headers: {
        'Retry-After': '60',
        'Cache-Control': 'no-store',
      },
    }
  );
}

/** Map internal 5-state to the 4 publicly visible verify statuses. */
function publicStatus(internal: CertStatus): VerifyStatus {
  switch (internal) {
    case 'active':
      return 'active';
    case 'expired':
      return 'expired';
    case 'revoked':
      return 'revoked';
    case 'disputed':
      return 'revoked'; // intentional masking
    case 'pending':
    default:
      return 'not_found';
  }
}

// ─── Telemetry helpers ───────────────────────────────────────────────────────

interface LatencyContext {
  start: number;
  rateLimitMs: number;
  dbQueryMs: number;
}

function nowMs(): number {
  // Use Date.now rather than performance.now so test fakes work uniformly.
  return Date.now();
}

async function logActivity(
  db: ReturnType<typeof createServiceSupabase>,
  type: ActivityEventType,
  payload: Record<string, unknown>
): Promise<void> {
  try {
    await db.from('activity_events').insert({ type, payload, actor_id: null });
  } catch (err) {
    // Audit-trail failures must NEVER affect the response. Log to console
    // and move on; ops can correlate via the Sentry breadcrumb separately.
    console.error('[verify route] activity_events insert failed:', err);
  }
}

function emitLatencyLog(ctx: LatencyContext, outcome: VerifyStatus | 'unavailable'): void {
  const duration_ms = nowMs() - ctx.start;
  // Structured log — Sentry / log-drain consumers parse this. p50/p95/p99
  // alerts documented in audits/followups.md.
  console.log(
    JSON.stringify({
      type: 'cert_verify_latency',
      duration_ms,
      db_query_ms: ctx.dbQueryMs,
      rate_limit_ms: ctx.rateLimitMs,
      outcome,
    })
  );
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export async function GET(
  req: Request | NextRequest,
  { params }: { params: { certCode: string } }
): Promise<NextResponse> {
  const ctx: LatencyContext = { start: nowMs(), rateLimitMs: 0, dbQueryMs: 0 };
  const { certCode: rawCode } = params;

  // ── Step 1: cheap format validation (no I/O) ────────────────────────────
  const validation = rawCode
    ? validateCertCode(rawCode)
    : { ok: false as const, reason: 'invalid_format' as const };
  if (!validation.ok) {
    emitLatencyLog(ctx, 'not_found');
    return notFoundResponse();
  }
  const canonicalCode = validation.canonical;

  // ── Step 2: rate-limit guard (per-IP, then per-code) ────────────────────
  const pepper = process.env.RATELIMIT_IP_PEPPER || '';
  // NextRequest exposes headers and a synthesized .ip; cast Request for tests.
  const ipHash = getClientIpHash(req as NextRequest, pepper);
  const db = createServiceSupabase();

  const rlStart = nowMs();
  try {
    const ipLimiter = getVerifyIpLimiter();
    const ipResult = await ipLimiter.limit(ipHash);
    if (!ipResult.success) {
      ctx.rateLimitMs = nowMs() - rlStart;
      await logActivity(db, 'cert_verify_rate_limited', {
        kind: 'per_ip',
        ip_hash: ipHash,
        cert_code: canonicalCode,
      });
      emitLatencyLog(ctx, 'rate_limited');
      return rateLimitedResponse();
    }

    const codeLimiter = getVerifyCodeLimiter();
    const codeResult = await codeLimiter.limit(canonicalCode);
    if (!codeResult.success) {
      ctx.rateLimitMs = nowMs() - rlStart;
      await logActivity(db, 'cert_verify_rate_limited', {
        kind: 'per_code',
        ip_hash: ipHash,
        cert_code: canonicalCode,
      });
      emitLatencyLog(ctx, 'rate_limited');
      return rateLimitedResponse();
    }
    ctx.rateLimitMs = nowMs() - rlStart;
  } catch (err) {
    ctx.rateLimitMs = nowMs() - rlStart;
    // Fail-closed: Redis unreachable → 503. See OQ-1 / (d) for rationale.
    await logActivity(db, 'cert_verify_rate_limiter_down', {
      error: err instanceof Error ? err.message : String(err),
    });
    emitLatencyLog(ctx, 'unavailable');
    return serviceUnavailableResponse();
  }

  // ── Step 3: DB read (service-role) ──────────────────────────────────────
  const dbStart = nowMs();
  const { data: certData, error } = await db
    .from('certificates')
    .select(
      `
      issued_at,
      expires_at,
      status,
      restaurants:restaurant_id (
        name
      )
    `
    )
    .eq('cert_code', canonicalCode)
    .single();
  ctx.dbQueryMs = nowMs() - dbStart;

  if (error || !certData) {
    emitLatencyLog(ctx, 'not_found');
    return notFoundResponse();
  }

  const cert = certData as unknown as CertVerifyRow;
  const visible = publicStatus(cert.status);

  // Pending masks to not_found — do NOT return restaurant name etc.
  if (visible === 'not_found') {
    emitLatencyLog(ctx, 'not_found');
    return notFoundResponse();
  }

  const restaurant = Array.isArray(cert.restaurants) ? cert.restaurants[0] : cert.restaurants;
  const restaurantName = restaurant?.name ?? 'Unknown Restaurant';

  emitLatencyLog(ctx, visible);

  return NextResponse.json({
    valid: visible === 'active',
    status: visible,
    restaurantName,
    issuedAt: cert.issued_at,
    expiresAt: cert.expires_at,
  } satisfies VerifyResponse);
}
