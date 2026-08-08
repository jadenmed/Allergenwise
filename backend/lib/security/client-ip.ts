/**
 * lib/security/client-ip.ts
 *
 * Wave 4B P0 #10.b — IP hashing helper for rate-limit keys.
 *
 * The raw client IP NEVER leaves this function. The rate limiter, the
 * activity-events audit trail, and any log line that mentions a source
 * identifier all reference the truncated SHA-256 hash returned here.
 *
 * Why hash:
 *   - B11 (privacy / PII) alignment. Raw IPs are PII under GDPR.
 *   - Defense in depth against a read-only Redis disclosure: an attacker
 *     who gains read access to the rate-limit keyspace cannot reverse-map
 *     keys to source IPs without the pepper.
 *
 * Why pepper:
 *   - Forces the attacker to also exfiltrate the pepper to make any
 *     reverse lookup feasible. Rotation procedure documented in
 *     audits/cert-code-redesign-plan.md (d).
 *
 * Why truncated to 64 bits (16 hex chars):
 *   - Keeps the Redis key short.
 *   - 64 bits is still collision-safe at the scale of "all IPs that ever
 *     hit AllergenWise" — birthday probability of any two distinct IPs
 *     colliding at 2^32 distinct IPs is ~1 in 2 billion.
 *
 * Why FULL IPv6 (no /64 truncation):
 *   - See OQ-2 decision in audits/cert-code-redesign-plan.md. Household
 *     devices on the same /64 ISP prefix get independent rate-limit
 *     budgets — a 5-person family scanning QR codes at a restaurant
 *     does not collectively trip the 10/min limit.
 */

import { createHash } from 'node:crypto';
import type { NextRequest } from 'next/server';

/**
 * Extract the originating client IP from the request.
 *
 * Order of precedence:
 *   1. Left-most entry of `x-forwarded-for` (Vercel-injected).
 *   2. `request.ip` (Next.js / Vercel runtime field, populated locally).
 *   3. The literal string 'unknown'. Conservative: all anonymous-source
 *      requests share one rate-limit key, so an attacker who strips
 *      headers does not get a fresh limit per request.
 */
function extractRawIp(req: NextRequest): string {
  const xff = req.headers.get('x-forwarded-for');
  if (xff) {
    const first = xff.split(',')[0]?.trim();
    if (first && first.length > 0) return first;
  }
  // NextRequest does not always expose .ip in test environments; guard.
  const reqIp = (req as unknown as { ip?: string }).ip;
  if (reqIp && reqIp.length > 0) return reqIp;
  return 'unknown';
}

/**
 * Hash the request's source IP with a pepper.
 *
 * @returns a 16-character lowercase hex string (truncated SHA-256).
 */
export function getClientIpHash(req: NextRequest, pepper: string): string {
  const ip = extractRawIp(req);
  return createHash('sha256').update(`${ip}:${pepper}`).digest('hex').slice(0, 16);
}
