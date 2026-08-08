/**
 * lib/security/mask-pii.ts
 *
 * P1-8 — single source of truth for masking personally-identifiable
 * information (PII) before it lands in console logs, error traces, or
 * activity-event payloads.
 *
 * Rules:
 *   - Logs MAY use maskEmail() / maskName() to retain a recognizable
 *     debug shape without leaking the full value.
 *   - Activity-event payloads MUST NOT contain raw email or full_name.
 *     If a stable correlation ID is needed across events for the same
 *     subject, use emailHash() — sha256 over the lowercased address,
 *     truncated to 16 hex chars (64 bits — collision-safe for our scale).
 *
 * Mirrors the inline pattern previously used at the
 * AccountDeletionConfirm send-site:
 *     email.replace(/(.{2}).+(@.+)/, '$1***$2')
 *
 * Tested by tests/unit/mask-pii.test.ts (behavior) and
 * tests/unit/log-pii-grep.test.ts (regression — no raw-PII template
 * literals in app/ + lib/ console.* calls).
 */
import { createHash } from 'node:crypto';

/**
 * Mask an email address for safe logging.
 *
 *   alice.smith@example.com → al***@example.com
 *   ab@x.io                 → ab***@x.io
 *   a@x.io                  → ***@x.io        (too short for 2-char prefix)
 *   <no @>                  → ***
 *   null / undefined / ''   → <no-email>
 */
export function maskEmail(email: string | null | undefined): string {
  if (email === null || email === undefined || email === '') return '<no-email>';
  const at = email.indexOf('@');
  if (at < 0) return '***';
  const local = email.slice(0, at);
  const domain = email.slice(at);
  if (local.length < 3) return `***${domain}`;
  return `${local.slice(0, 2)}***${domain}`;
}

/**
 * Mask a person's name for safe logging.
 *
 *   "Jane Doe"        → "J*** D***"
 *   "Madonna"         → "M***"
 *   "A B"             → "A B"           (single-char tokens left alone)
 *   "  jane  doe  "   → "j*** d***"     (trimmed + collapsed whitespace)
 *   null / undefined  → <no-name>
 *   ''                → <no-name>
 */
export function maskName(name: string | null | undefined): string {
  if (name === null || name === undefined) return '<no-name>';
  const trimmed = name.trim();
  if (trimmed === '') return '<no-name>';
  return trimmed
    .split(/\s+/)
    .map((tok) => (tok.length <= 1 ? tok : `${tok[0]}***`))
    .join(' ');
}

/**
 * Stable correlation hash for an email — case-insensitive.
 *
 * Use in activity-event payloads when you need to correlate multiple
 * events to the same subject without storing the raw address. 64 bits
 * of hash space (16 hex chars) is more than enough for our scale and
 * matches the truncation length used elsewhere (client-ip.ts).
 *
 *   emailHash('Alice@Example.com') === emailHash('alice@example.com')
 *
 *   null / undefined / '' → ''  (caller decides whether to omit the field)
 */
export function emailHash(email: string | null | undefined): string {
  if (email === null || email === undefined || email === '') return '';
  return createHash('sha256').update(email.toLowerCase()).digest('hex').slice(0, 16);
}
