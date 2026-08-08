/**
 * lib/security/rate-limit.ts
 *
 * Wave 4B P0 #10.b — verify endpoint rate limiter.
 *
 * Two independent sliding-window limiters wrap the same route handler.
 * Both must pass for the request to reach the DB:
 *
 *   - per-IP limiter: key shaped `rl:verify:ip:<hash>`, 10 / 60s.
 *     Defends against single-IP enumeration.
 *
 *   - per-code limiter: key shaped `rl:verify:code:<normalized>`,
 *     5 / 60s. Defends against pinning one valid cert and hammering it
 *     to test backend freshness vs the limiter state.
 *
 * Both limits are configurable via env vars (see .env.example), with
 * the documented defaults baked in.
 *
 * Fail-closed posture: if Redis is unreachable, `.limit()` throws and
 * the verify route returns 503 (NOT a free pass). See route handler.
 * See audits/cert-code-redesign-plan.md (d) for the full rationale.
 *
 * Integration tests mock @upstash/ratelimit directly per OQ-5. The
 * env-gated `verify-rate-limit-live-smoke` spec is the one place that
 * touches real Upstash, and only when UPSTASH_LIVE_TEST=1.
 */

import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

// ─── Defaults (documented in .env.example) ───────────────────────────────────

const DEFAULT_IP_PER_MIN = 10;
const DEFAULT_CODE_PER_MIN = 5;
// P1-14 — signup / invite-accept / invites-send defaults.
const DEFAULT_SIGNUP_IP_PER_MIN = 10;
const DEFAULT_SIGNUP_EMAIL_PER_MIN = 5;
const DEFAULT_INVITE_ACCEPT_IP_PER_MIN = 10;
const DEFAULT_INVITE_ACCEPT_TOKEN_PER_MIN = 5;
const DEFAULT_INVITE_SEND_IP_PER_MIN = 10;
const DEFAULT_INVITE_SEND_RESTAURANT_PER_MIN = 20;
// P1-16 — account-deletion + export defaults (per-hour, not per-minute).
const DEFAULT_ACCOUNT_DELETE_REQUEST_IP_PER_HOUR = 5;
const DEFAULT_ACCOUNT_DELETE_REQUEST_ACCT_PER_HOUR = 5;
const DEFAULT_ACCOUNT_DELETE_CONFIRM_IP_PER_HOUR = 10;
const DEFAULT_ACCOUNT_EXPORT_IP_PER_HOUR = 5;
const DEFAULT_ACCOUNT_EXPORT_ACCT_PER_HOUR = 1;
const WINDOW = '60 s' as const;
const WINDOW_HOUR = '3600 s' as const;

// ─── Shared Redis client (lazily constructed) ────────────────────────────────

let _redis: Redis | null = null;

function getRedis(): Redis {
  if (_redis) return _redis;
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) {
    throw new Error(
      '[rate-limit] KV_REST_API_URL or KV_REST_API_TOKEN missing. ' +
        'Provision an Upstash Redis instance via the Vercel Marketplace, or ' +
        'set both vars locally. See .env.example.'
    );
  }
  _redis = new Redis({ url, token });
  return _redis;
}

// ─── Limiter factories ───────────────────────────────────────────────────────

let _ipLimiter: Ratelimit | null = null;
let _codeLimiter: Ratelimit | null = null;

/**
 * Build (or return cached) the per-IP rate limiter.
 *
 * 10 requests per 60-second sliding window by default. Override via
 * `RATELIMIT_VERIFY_IP_PER_MIN`.
 */
export function getVerifyIpLimiter(): Ratelimit {
  if (_ipLimiter) return _ipLimiter;
  const limit = Number(process.env.RATELIMIT_VERIFY_IP_PER_MIN) || DEFAULT_IP_PER_MIN;
  _ipLimiter = new Ratelimit({
    redis: getRedis(),
    limiter: Ratelimit.slidingWindow(limit, WINDOW),
    analytics: false,
    prefix: 'rl:verify:ip',
  });
  return _ipLimiter;
}

/**
 * Build (or return cached) the per-cert-code rate limiter.
 *
 * 5 requests per 60-second sliding window by default. Override via
 * `RATELIMIT_VERIFY_CODE_PER_MIN`.
 */
export function getVerifyCodeLimiter(): Ratelimit {
  if (_codeLimiter) return _codeLimiter;
  const limit = Number(process.env.RATELIMIT_VERIFY_CODE_PER_MIN) || DEFAULT_CODE_PER_MIN;
  _codeLimiter = new Ratelimit({
    redis: getRedis(),
    limiter: Ratelimit.slidingWindow(limit, WINDOW),
    analytics: false,
    prefix: 'rl:verify:code',
  });
  return _codeLimiter;
}

// ─── P1-14 limiter factories (signup / invite-accept / invites-send) ──────────
//
// Same shape as the verify limiters. Two limiters per endpoint:
//   - per-IP guard (defends against scanners hammering one source).
//   - per-identifier guard (per-email for signup, per-token-hash for
//     invite-accept, per-restaurant for invites-send).
//
// Both must pass for the request to proceed to its DB phase. Either
// rejection → byte-identical 429. Redis throw → 503. Same fail-closed
// posture as Wave 4B.

let _signupIpLimiter: Ratelimit | null = null;
let _signupEmailLimiter: Ratelimit | null = null;
let _inviteAcceptIpLimiter: Ratelimit | null = null;
let _inviteAcceptTokenLimiter: Ratelimit | null = null;
let _inviteSendIpLimiter: Ratelimit | null = null;
let _inviteSendRestaurantLimiter: Ratelimit | null = null;

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Per-IP signup limiter (default 10/60s). Override: RATELIMIT_SIGNUP_IP_PER_MIN. */
export function getSignupIpLimiter(): Ratelimit {
  if (_signupIpLimiter) return _signupIpLimiter;
  const limit = envInt('RATELIMIT_SIGNUP_IP_PER_MIN', DEFAULT_SIGNUP_IP_PER_MIN);
  _signupIpLimiter = new Ratelimit({
    redis: getRedis(),
    limiter: Ratelimit.slidingWindow(limit, WINDOW),
    analytics: false,
    prefix: 'rl:signup:ip',
  });
  return _signupIpLimiter;
}

/** Per-email signup limiter (default 5/60s). Override: RATELIMIT_SIGNUP_EMAIL_PER_MIN. */
export function getSignupEmailLimiter(): Ratelimit {
  if (_signupEmailLimiter) return _signupEmailLimiter;
  const limit = envInt('RATELIMIT_SIGNUP_EMAIL_PER_MIN', DEFAULT_SIGNUP_EMAIL_PER_MIN);
  _signupEmailLimiter = new Ratelimit({
    redis: getRedis(),
    limiter: Ratelimit.slidingWindow(limit, WINDOW),
    analytics: false,
    prefix: 'rl:signup:email',
  });
  return _signupEmailLimiter;
}

/** Per-IP invite-accept limiter (default 10/60s). Override: RATELIMIT_INVITE_ACCEPT_IP_PER_MIN. */
export function getInviteAcceptIpLimiter(): Ratelimit {
  if (_inviteAcceptIpLimiter) return _inviteAcceptIpLimiter;
  const limit = envInt('RATELIMIT_INVITE_ACCEPT_IP_PER_MIN', DEFAULT_INVITE_ACCEPT_IP_PER_MIN);
  _inviteAcceptIpLimiter = new Ratelimit({
    redis: getRedis(),
    limiter: Ratelimit.slidingWindow(limit, WINDOW),
    analytics: false,
    prefix: 'rl:invite-accept:ip',
  });
  return _inviteAcceptIpLimiter;
}

/** Per-token-hash invite-accept limiter (default 5/60s). Override: RATELIMIT_INVITE_ACCEPT_TOKEN_PER_MIN. */
export function getInviteAcceptTokenLimiter(): Ratelimit {
  if (_inviteAcceptTokenLimiter) return _inviteAcceptTokenLimiter;
  const limit = envInt(
    'RATELIMIT_INVITE_ACCEPT_TOKEN_PER_MIN',
    DEFAULT_INVITE_ACCEPT_TOKEN_PER_MIN
  );
  _inviteAcceptTokenLimiter = new Ratelimit({
    redis: getRedis(),
    limiter: Ratelimit.slidingWindow(limit, WINDOW),
    analytics: false,
    prefix: 'rl:invite-accept:token',
  });
  return _inviteAcceptTokenLimiter;
}

/** Per-IP invites-send limiter (default 10/60s). Override: RATELIMIT_INVITE_SEND_IP_PER_MIN. */
export function getInviteSendIpLimiter(): Ratelimit {
  if (_inviteSendIpLimiter) return _inviteSendIpLimiter;
  const limit = envInt('RATELIMIT_INVITE_SEND_IP_PER_MIN', DEFAULT_INVITE_SEND_IP_PER_MIN);
  _inviteSendIpLimiter = new Ratelimit({
    redis: getRedis(),
    limiter: Ratelimit.slidingWindow(limit, WINDOW),
    analytics: false,
    prefix: 'rl:invite-send:ip',
  });
  return _inviteSendIpLimiter;
}

/** Per-restaurant invites-send limiter (default 20/60s — admins legitimately send in bulk). */
export function getInviteSendRestaurantLimiter(): Ratelimit {
  if (_inviteSendRestaurantLimiter) return _inviteSendRestaurantLimiter;
  const limit = envInt(
    'RATELIMIT_INVITE_SEND_RESTAURANT_PER_MIN',
    DEFAULT_INVITE_SEND_RESTAURANT_PER_MIN
  );
  _inviteSendRestaurantLimiter = new Ratelimit({
    redis: getRedis(),
    limiter: Ratelimit.slidingWindow(limit, WINDOW),
    analytics: false,
    prefix: 'rl:invite-send:restaurant',
  });
  return _inviteSendRestaurantLimiter;
}

// ─── P1-16 limiter factories (account deletion + export) ──────────────────────
//
// Windows are hourly (vs the 60s used elsewhere). Defaults:
//   request-deletion: 5/hr per-IP, 5/hr per-account
//   confirm-deletion: 10/hr per-IP (token brute-force defense)
//   export:           5/hr per-IP, 1/hr per-account (heavy query)

let _acctDelReqIp: Ratelimit | null = null;
let _acctDelReqAcct: Ratelimit | null = null;
let _acctDelConfirmIp: Ratelimit | null = null;
let _acctExportIp: Ratelimit | null = null;
let _acctExportAcct: Ratelimit | null = null;

export function getAccountDeleteRequestIpLimiter(): Ratelimit {
  if (_acctDelReqIp) return _acctDelReqIp;
  const limit = envInt(
    'RATELIMIT_ACCOUNT_DELETE_REQUEST_IP_PER_HOUR',
    DEFAULT_ACCOUNT_DELETE_REQUEST_IP_PER_HOUR
  );
  _acctDelReqIp = new Ratelimit({
    redis: getRedis(),
    limiter: Ratelimit.slidingWindow(limit, WINDOW_HOUR),
    analytics: false,
    prefix: 'rl:acct:del-req:ip',
  });
  return _acctDelReqIp;
}

export function getAccountDeleteRequestAcctLimiter(): Ratelimit {
  if (_acctDelReqAcct) return _acctDelReqAcct;
  const limit = envInt(
    'RATELIMIT_ACCOUNT_DELETE_REQUEST_ACCT_PER_HOUR',
    DEFAULT_ACCOUNT_DELETE_REQUEST_ACCT_PER_HOUR
  );
  _acctDelReqAcct = new Ratelimit({
    redis: getRedis(),
    limiter: Ratelimit.slidingWindow(limit, WINDOW_HOUR),
    analytics: false,
    prefix: 'rl:acct:del-req:acct',
  });
  return _acctDelReqAcct;
}

export function getAccountDeleteConfirmIpLimiter(): Ratelimit {
  if (_acctDelConfirmIp) return _acctDelConfirmIp;
  const limit = envInt(
    'RATELIMIT_ACCOUNT_DELETE_CONFIRM_IP_PER_HOUR',
    DEFAULT_ACCOUNT_DELETE_CONFIRM_IP_PER_HOUR
  );
  _acctDelConfirmIp = new Ratelimit({
    redis: getRedis(),
    limiter: Ratelimit.slidingWindow(limit, WINDOW_HOUR),
    analytics: false,
    prefix: 'rl:acct:del-confirm:ip',
  });
  return _acctDelConfirmIp;
}

export function getAccountExportIpLimiter(): Ratelimit {
  if (_acctExportIp) return _acctExportIp;
  const limit = envInt('RATELIMIT_ACCOUNT_EXPORT_IP_PER_HOUR', DEFAULT_ACCOUNT_EXPORT_IP_PER_HOUR);
  _acctExportIp = new Ratelimit({
    redis: getRedis(),
    limiter: Ratelimit.slidingWindow(limit, WINDOW_HOUR),
    analytics: false,
    prefix: 'rl:acct:exp:ip',
  });
  return _acctExportIp;
}

export function getAccountExportAcctLimiter(): Ratelimit {
  if (_acctExportAcct) return _acctExportAcct;
  const limit = envInt(
    'RATELIMIT_ACCOUNT_EXPORT_ACCT_PER_HOUR',
    DEFAULT_ACCOUNT_EXPORT_ACCT_PER_HOUR
  );
  _acctExportAcct = new Ratelimit({
    redis: getRedis(),
    limiter: Ratelimit.slidingWindow(limit, WINDOW_HOUR),
    analytics: false,
    prefix: 'rl:acct:exp:acct',
  });
  return _acctExportAcct;
}

/**
 * Test-only: reset the cached singletons. Called from test setup so each
 * test starts with fresh env-var reads.
 *
 * Not exported in production usage but harmless to leave compiled.
 */
export function _resetForTests(): void {
  _redis = null;
  _ipLimiter = null;
  _codeLimiter = null;
  _signupIpLimiter = null;
  _signupEmailLimiter = null;
  _inviteAcceptIpLimiter = null;
  _inviteAcceptTokenLimiter = null;
  _inviteSendIpLimiter = null;
  _inviteSendRestaurantLimiter = null;
  _acctDelReqIp = null;
  _acctDelReqAcct = null;
  _acctDelConfirmIp = null;
  _acctExportIp = null;
  _acctExportAcct = null;
}
