# Cert Payment + State Design — Wave 2C

**Date:** 2026-05-10
**Author:** design pass before implementation
**Closes:** P0 #5 (refund/dispute webhooks), P0 #6 (cert-before-payment), A8.4 (audit trail), F-S2 / F-S3 / F-S4 / F-S5 (status drift on naked `revoked=false` reads)
**Mode:** design only. No code beyond migration SQL stub. STOP after this doc + `audits/cert-migration-plan.md` land for review.

---

## Pre-flight: how cert payment actually works today

Documenting before designing because the current shape is non-obvious and shapes the design.

1. **Exam pass** (`app/api/exam/submit/route.ts:189-241`): on score ≥ 80 the route inserts a row into `certificates` with `revoked=false`, `expires_at = now + 1 year`, `fee_charged_cents = 3500` (hardcoded), `stripe_payment_intent_id = NULL`. **No payment has happened.**
2. **Restaurant submission** (`app/api/submissions/create/route.ts`): later, the admin submits the restaurant for directory listing. This route calls `POST /api/stripe/charge-cert-fees` server-to-server with `{ restaurantId, certifiedCount, submissionId }`.
3. **Charge** (`app/api/stripe/charge-cert-fees/route.ts:124-152`): builds a single Stripe `PaymentIntent` for `certifiedCount × $35`, with `metadata: { kind: 'cert_fee', restaurant_id, certified_count, fee_per_cert_cents, submission_id }`. **No `certificate_id` in metadata.** Charges off-session against the saved default payment method.
4. **Webhook** (`app/api/stripe/webhook/route.ts:handleCertFeePayment`): receives `payment_intent.succeeded` with `kind=cert_fee`, attempts `UPDATE certificates SET stripe_payment_intent_id = pi.id, fee_charged_cents = pi.amount WHERE id = pi.metadata.certificate_id`. Since `certificate_id` is never set in metadata, **this UPDATE always misses**. Cert rows remain with the hardcoded `fee_charged_cents=3500` and `stripe_payment_intent_id=NULL` forever.

**Takeaways that constrain the design:**

- The cert→payment relationship is **N:1** (many certs covered by one batch PI at submission time), not 1:1. Any "PI per cert" model is wrong.
- The reverse mapping (PI → certs) needs to be **stored on the cert row** at activation time, since the PI metadata cannot enumerate cert IDs at creation time (the cert IDs aren't known to charge-cert-fees in the current shape — and even if they were, encoding many UUIDs in metadata is fragile).
- Today, `expire-certs` cron only sends warning emails; it never persists the Expired transition. This is what F-S2/F-S3 ride on.
- Wave 2A confirmed: every cert write goes through service-role. Whatever I add, writes stay on service-role; RLS keeps blocking user-role.

---

## (a) New cert state machine

### States

| State | Meaning | Verify endpoint returns | Counts in directory? | Learner dashboard shows |
|---|---|---|---|---|
| **`pending`** | Cert exists in DB but no payment confirmed yet. Internal state — never publicly visible. | `not_found` (verify response always treats pending as if the cert does not exist) | NO | "Awaiting payment by your restaurant admin" copy + cert code preview, no PDF download |
| **`active`** | Payment confirmed, within validity window, not revoked or disputed. | `{ valid: true, status: 'active', restaurantName, issuedAt, expiresAt }` | YES | Full cert card + PDF download + verify URL |
| **`expired`** | `expires_at` has passed. Persisted by `expire-certs` cron. | `{ valid: false, status: 'expired', restaurantName, issuedAt, expiresAt }` | NO | Cert card with "Expired — retake exam to renew" |
| **`revoked`** | Manual admin revocation OR refund/chargeback-lost. | `{ valid: false, status: 'revoked', restaurantName, issuedAt, expiresAt }` | NO | Cert card with "Revoked" + reason |
| **`disputed`** | Stripe `charge.dispute.created` received. Funds on hold. **Publicly displayed as `revoked` on the verify endpoint** to protect the diner's trust signal during the dispute window. Revealed in the admin dashboard as "Disputed — under review". | `{ valid: false, status: 'revoked', restaurantName, issuedAt, expiresAt }` (intentional same-as-revoked from the diner's perspective) | NO | Admin sees "Payment disputed by cardholder — under review by Stripe" |

**Why `disputed` exists internally but maps to `revoked` publicly:** the audit and CONTEXT.md explicitly enumerate three public statuses (Active / Expired / Revoked). Adding a fourth public status leaks operational state to diners without giving them a useful signal — "disputed" is the wrong story to tell a parent at a birthday party. Internally we need the distinction so a `won` dispute can re-activate the cert without forcing re-issuance. From the diner's perspective, a disputed cert is "not currently valid," which is exactly what `revoked` already conveys.

### Legal transitions

```
                    exam_pass
                       │
                       ▼
                  ┌─────────┐
                  │ pending │
                  └────┬────┘
            payment_   │     payment_canceled / TTL
            confirmed  │  ┌──────────────────────► (cert deleted)
                       ▼  │
                  ┌─────────┐  cron: expires_at < now
                  │ active  │ ─────────────────────► expired
                  └────┬────┘
        admin_revoke   │   refund | dispute.lost
        ───────────────┴──────────────────► revoked
                       │
                       │   dispute.created
                       └────► disputed
                                 │
                                 │ dispute.won  → active
                                 │ dispute.lost → revoked
                                 │ dispute.warning_closed → active
                                 ▼
```

### Per-state legal transitions table (also encoded in the state-machine helper)

| From → To | Allowed? | Trigger | Actor recorded in `activity_events` |
|---|---|---|---|
| `pending` → `active` | YES | Stripe webhook `payment_intent.succeeded` (kind=cert_fee) | `actor_id=NULL`, payload includes `stripe_event_id` |
| `pending` → (deleted) | YES | Cron `purge-stale-pending-certs` (TTL 14d) OR `payment_intent.canceled` for the batch PI | `actor_id=NULL`, payload includes `reason: 'payment_never_confirmed' \| 'pi_canceled'` |
| `active` → `expired` | YES | Cron `expire-certs` (`expires_at < now AND status='active'`) | `actor_id=NULL`, payload includes `reason: 'scheduled_expiration'` |
| `active` → `revoked` | YES | Manual admin action via service-role tooling (no UI yet — documented in PRODUCTION_BUILD.md) OR Stripe `charge.refunded` | `actor_id=<admin profile_id>` for manual; `NULL` + `stripe_event_id` for refund |
| `active` → `disputed` | YES | Stripe `charge.dispute.created` | `actor_id=NULL`, payload includes `stripe_event_id`, `dispute_id` |
| `disputed` → `active` | YES | Stripe `charge.dispute.closed` with `status='won'` OR `status='warning_closed'` | `actor_id=NULL`, payload includes `stripe_event_id`, `dispute_outcome` |
| `disputed` → `revoked` | YES | Stripe `charge.dispute.closed` with `status='lost'` | `actor_id=NULL`, payload includes `stripe_event_id`, `dispute_outcome: 'lost'` |
| `expired` → ANY | NO* | Terminal. Re-certification requires a NEW row (new cert_code, fresh exam_attempt_id). *See `STATE_MACHINE_EXCEPTIONS` for the R5 carve-out (refund-driven `expired → revoked`). | — |
| `revoked` → ANY | NO | Terminal. Same re-certification rule. | — |
| `pending` → `expired`/`revoked`/`disputed` | NO | Pending certs that don't pay either get purged or stay pending until next batch — they never enter terminal states without first becoming active. | — |
| `active` → `pending` | NO | Once paid, never un-paid. | — |
| `revoked` → `disputed` | NO | A revoked cert's PI may still get a dispute opened, but the cert stays revoked. We log the event but do not transition. | — |

**Illegal transition handling:** the state-machine helper `lib/learner/cert-state.ts:transitionCert()` returns `{ ok: false, reason }` for any disallowed transition. The webhook handler logs the rejection as a `cert_state_transition_blocked` activity event with the attempted from/to. Never throws — Stripe must keep getting 200s on the webhook so it doesn't retry forever.

### Single source of truth for legality carve-outs — `STATE_MACHINE_EXCEPTIONS`

The R5 (refund-arrives-after-expiration) and R6 (lost-dispute-on-expired-cert) windows allow `expired → revoked` only when the trigger is a refund or a lost dispute — never a manual revoke or a fresh dispute open. Three places reference this carve-out: the legality table (above), the state-machine helper, and the activity-events vocabulary in (g). To prevent drift, the carve-out is encoded once in `lib/learner/cert-state.ts`:

```ts
// lib/learner/cert-state.ts
//
// Single source of truth for state-machine carve-outs. The legality table in
// the design doc, the transitionCert() helper, and the activity-events
// vocabulary in (g) all reference this constant — do NOT inline the same
// rules elsewhere.

export type TransitionTrigger =
  | 'exam_pass'
  | 'payment_succeeded'
  | 'payment_canceled'
  | 'payment_failed'
  | 'cron_expire'
  | 'cron_purge'
  | 'admin_revoke'
  | 'refund'
  | 'dispute_created'
  | 'dispute_won'
  | 'dispute_lost'
  | 'dispute_warning_closed';

/**
 * Carve-outs from the strict "terminal states are terminal" rule.
 * Each entry: a (from, to) transition that is normally illegal, plus the
 * exact set of triggers that DO permit it. transitionCert() consults this
 * before rejecting an apparent terminal-state violation.
 */
export const STATE_MACHINE_EXCEPTIONS: ReadonlyArray<{
  from: CertStatus;
  to: CertStatus;
  allowedTriggers: ReadonlyArray<TransitionTrigger>;
  reason: string;
}> = [
  {
    from: 'expired',
    to: 'revoked',
    allowedTriggers: ['refund', 'dispute_lost'],
    reason:
      'R5/R6: a refund or lost dispute on an already-expired cert revokes ' +
      'it post-hoc, preserving the "no funds = no cert" invariant in the ' +
      'historical record. Manual admin revoke and fresh dispute open are ' +
      'NOT in this list — once expired, those triggers are no-ops.',
  },
];
```

`transitionCert()` consults `STATE_MACHINE_EXCEPTIONS` whenever the proposed transition would otherwise be rejected as terminal. The legality table above carries the asterisk pointer, and the activity-events vocabulary in (g) references the same constant when documenting the `cert_revoked` event's `before_status='expired'` case.

---

## (b) Atomicity guarantee — Pending-on-issue chosen

**Decision: cert is created in `pending` at exam pass, transitioned to `active` by the Stripe webhook handler when the cert-fee payment confirms.**

**Rejected alternative — "cert not created until webhook fires":**
- Loses the natural exam_attempt_id link (the attempt that minted the cert).
- Forces the webhook handler to know the learner identities to issue the right number of certs — today the PI metadata only carries `restaurant_id` + `certified_count`. Mapping a count to specific learners would require querying eligible learners at webhook time and picking N of them, which is racy and brittle.
- Breaks the "passed the exam" UX — the learner has earned the credential but sees nothing in their dashboard until their admin pays.

**Chosen — pending-on-issue:**
- Cert row exists immediately at exam pass with `status='pending'`. Carries `exam_attempt_id`, `cert_code`, `expires_at` (computed from issuance time, not payment time), and **no `fee_charged_cents` or `stripe_payment_intent_id` yet**.
- Pending certs are invisible to public surfaces (verify endpoint returns `not_found`, directory count excludes them). Visible only to the learner ("Awaiting payment by your restaurant admin") and to the admin's dashboard ("N pending certs — submit your restaurant to activate").
- When `charge-cert-fees` succeeds, the webhook flips ALL pending certs for that restaurant to `active` in a single atomic `UPDATE` and stamps each with `stripe_payment_intent_id` + `fee_charged_cents = pi.amount / pending_count`.

**TTL on pending — `purge-stale-pending-certs` cron:**
- Add a new daily cron `app/api/cron/purge-stale-pending-certs/route.ts` (already implies a new entry in `vercel.json` and `middleware.ts:PUBLIC_PREFIXES` per F2's forcing function).
- Default TTL: **14 days** from `issued_at`. After 14 days without payment, the cert row is hard-deleted (cascade-deletes its `cert_warnings`).
- Justification: 14 days is long enough for an admin to attend to a passed exam (they'd typically batch a submission within a week). Shorter TTLs risk losing legitimate pending state during admin vacation; longer TTLs grow the unbounded pending pool. The number is reviewable by setting an env var override `PENDING_CERT_TTL_DAYS`.
- Also triggered eagerly by `payment_intent.canceled` for a cert-fee PI: pending certs for that restaurant are NOT auto-purged on PI cancel (the admin may retry payment). They wait for TTL.

**What a learner sees with a pending cert:** a card on `/learner/certificate` and `/learner/home-data` reading "Your certificate is awaiting payment by your restaurant admin. Cert code preview: AW-2026-000123. PDF available once activated." No QR code shown.

---

## (c) Stripe event → state transition mapping

| Stripe event | Action | Implementation |
|---|---|---|
| `payment_intent.succeeded` (kind=cert_fee) | Flip all `pending` certs for `pi.metadata.restaurant_id` to `active`, stamp `stripe_payment_intent_id=pi.id`, `fee_charged_cents = floor(pi.amount / N)` where N is the number of certs flipped. Insert one `activity_events` per cert. Also accept the case where N=0 (no pending certs found) — this happens if the same PI replays after a previous activation; idempotent no-op. | New `handleCertFeeSucceeded(db, pi)` in webhook handler. Replaces today's `handleCertFeePayment` which is broken (looks at `pi.metadata.certificate_id` that's never set). |
| `payment_intent.canceled` (kind=cert_fee) | Insert `activity_events { type: 'cert_payment_canceled', payload: { pi_id, restaurant_id } }`. **Pending certs are NOT auto-purged here** — the admin may retry. They expire via TTL cron. | New `handlePaymentIntentCanceled(db, pi)` switch arm. |
| `payment_intent.payment_failed` (kind=cert_fee) | Insert `activity_events { type: 'cert_payment_failed', payload: { pi_id, last_payment_error } }`. Same no-purge rule. The admin's submit flow already rolls back the restaurant's `pending_review` status. | Existing `handlePaymentIntentFailed` already exists; extend to log the kind. |
| `charge.refunded` | For each cert with `stripe_payment_intent_id = charge.payment_intent`, transition `active → revoked` with `revocation_reason='refund'`. Also fires for `disputed → revoked` via dispute lost path (same UPDATE WHERE clause matches). Insert one `activity_events` per cert. If `charge.amount_refunded < charge.amount` (partial refund), still revoke ALL certs paid by that PI — partial cert revocation is not modeled (would need cert-level refund metadata, which Stripe doesn't carry). | New `handleChargeRefunded(db, charge)` switch arm. |
| `charge.dispute.created` | For each cert with `stripe_payment_intent_id = dispute.payment_intent`, transition `active → disputed`. Stamp `dispute_id` and `disputed_at` on the cert. Insert one `activity_events` per cert. | New `handleDisputeCreated(db, dispute)` switch arm. |
| `charge.dispute.closed` | Look up the dispute outcome (`status` field on the dispute object). For `won` or `warning_closed` → `disputed → active`. For `lost` → `disputed → revoked` with `revocation_reason='dispute_lost'`. For any other outcome (`needs_response`, `under_review` — these shouldn't appear on `closed` but defensive) → log only, no transition. Insert one `activity_events` per cert. | New `handleDisputeClosed(db, dispute)` switch arm. |
| `charge.dispute.funds_withdrawn` | Insert `activity_events { type: 'cert_dispute_funds_withdrawn', payload: { dispute_id, amount } }`. **No state transition** — the cert is already `disputed` from `charge.dispute.created`. This event records the cash-flow side; the cert state is governed by `charge.dispute.closed`. | New `handleDisputeFundsWithdrawn(db, dispute)` switch arm — log-only. |
| `charge.dispute.funds_reinstated` | Same as above — log-only. The cert state will follow when `dispute.closed` arrives. | Log-only. |
| `customer.subscription.deleted` | **No cert revocation.** AllergenWise's subscription model today is per-quarter PaymentIntents, not Stripe Subscriptions. If a future Stripe Subscription is deleted, the certs already issued under it remain valid for their `expires_at` window — sub deletion ≠ refund. The `expire-subscriptions` cron handles the restaurant's listing eligibility separately. | Switch arm logs `subscription_deleted` activity event but does not touch `certificates`. |
| `invoice.payment_failed` | Today: not used (no Stripe Subscriptions). Reserved for future. | Default branch logs and 200s. |

**Idempotency:** every handler relies on the existing `stripe_events` dedupe table — the webhook entry-point handler inserts `event.id` BEFORE calling these handlers, so a replay short-circuits before the state machine is consulted. This was confirmed PASS in the original audit's A2; design preserves the model. **In addition**, every state transition above is itself idempotent at the row level: re-running an `active → revoked` UPDATE on an already-revoked row is a no-op (the `WHERE` clause includes `status='active'` for activate transitions and `status IN ('active','disputed')` for revocation transitions).

---

## (d) Expiration persistence — Option (1): single `status` enum column

**Decision: add `status text NOT NULL DEFAULT 'pending'` with a CHECK constraint to `certificates`. Drop the `revoked boolean` column.**

Justification matches the audit's "strongly prefer" recommendation:

- A single status enum is the cleanest model and aligns with the state-machine framing in (a).
- Indexable for the canonical "active certs for restaurant X" query that powers F-S2 / F-S3 / F-S4 / F-S5.
- One source of truth — the cron flips it, the webhook flips it, the admin tools flip it. No more "compute status in memory and hope every consumer remembers to call `getCertStatus`."
- `revoked boolean` becomes redundant once status='revoked' encodes it. Drop it in the same migration to prevent the existing-callsite pitfall of "naked `.eq('revoked', false)`" reads coming back to bite us (F-S2/F-S3/F-S4/F-S5 are all this exact pattern). Without the column, that query stops compiling — the F-S2/F-S3 fix is forced.
- A new `status_changed_at` column tracks when the most recent transition happened (useful for "show me the pending certs older than 14 days" cron query).

### Schema delta (full SQL in migration plan)

```sql
-- Add status column with all 5 values
ALTER TABLE certificates
  ADD COLUMN status text NOT NULL DEFAULT 'pending'
  CHECK (status IN ('pending', 'active', 'expired', 'revoked', 'disputed'));

-- Add timestamps for the dispute / revocation paths
ALTER TABLE certificates
  ADD COLUMN status_changed_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN revocation_reason text
    CHECK (revocation_reason IN ('refund', 'dispute_lost', 'admin', 'expired') OR revocation_reason IS NULL),
  ADD COLUMN dispute_id text,         -- Stripe dispute object id (for disputed → resolved lookup)
  ADD COLUMN disputed_at timestamptz; -- When charge.dispute.created was received

-- Index for the canonical hot path: count active certs per restaurant
CREATE INDEX certificates_restaurant_status_idx
  ON certificates (restaurant_id, status)
  WHERE status = 'active';

-- Drop the now-redundant `revoked` column. Forces every naked .eq('revoked', false)
-- read to fail at compile time, which is what we want.
ALTER TABLE certificates DROP COLUMN revoked;
```

### Canonical helper

```ts
// lib/learner/cert-status.ts
//
// Single source of truth for "is this cert currently active?" reads.
// Every consumer (verify endpoint, directory count, search count, learner
// certificate page, learner home-data) MUST go through this helper. No
// route handler does ad-hoc `.eq('status', 'active')` or in-memory status
// computation.
//
// The helper exists to make the F-S2/F-S3/F-S4/F-S5 anti-pattern
// (naked status reads + missing expiry pair) physically uncallable.

import type { ServiceDb } from '@/lib/db/service';

export type CertStatus = 'pending' | 'active' | 'expired' | 'revoked' | 'disputed';

/** All states whose certs publicly verify as active and count toward the
 * directory's "X certified staff" badge. */
export const PUBLICLY_ACTIVE_STATUSES: ReadonlyArray<CertStatus> = ['active'];

export interface ActiveCertCount {
  restaurantId: string;
  count: number;
}

/**
 * Returns the count of currently-publicly-active certs for a restaurant.
 * The single canonical query that backs the directory + search + verify
 * surfaces. Every consumer reads through this — no naked `.eq('status', ...)`
 * elsewhere in app code.
 */
export async function countPubliclyActiveCerts(
  db: ServiceDb,
  restaurantId: string,
): Promise<number>;

/**
 * Returns the latest (by issued_at desc) cert for a learner whose status is
 * in PUBLICLY_ACTIVE_STATUSES. Returns null if none.
 */
export async function getLatestActiveCertForLearner(
  db: ServiceDb,
  profileId: string,
): Promise<{ id: string; cert_code: string; issued_at: string; expires_at: string; pdf_storage_path: string | null; restaurant_id: string } | null>;

/**
 * Returns ALL certs for a learner, including pending/expired/revoked, so the
 * learner dashboard can show the full history with appropriate UI state per
 * cert. Used by /api/learner/home-data and /api/learner/certificate.
 */
export async function getAllCertsForLearner(
  db: ServiceDb,
  profileId: string,
): Promise<Array<{ id: string; cert_code: string; status: CertStatus; issued_at: string; expires_at: string; pdf_storage_path: string | null; restaurant_id: string }>>;
```

### Verify endpoint response shape

`/api/certs/[certCode]/verify` reads the cert's `status` directly. Response shape per the table in (a):

| Cert internal status | Verify response |
|---|---|
| `pending` | `{ valid: false, status: 'not_found' }` (treats pending as if cert does not exist publicly) |
| `active` | `{ valid: true, status: 'active', restaurantName, issuedAt, expiresAt }` |
| `expired` | `{ valid: false, status: 'expired', restaurantName, issuedAt, expiresAt }` |
| `revoked` | `{ valid: false, status: 'revoked', restaurantName, issuedAt, expiresAt }` |
| `disputed` | `{ valid: false, status: 'revoked', restaurantName, issuedAt, expiresAt }` (intentionally same as revoked from diner's view) |

Three publicly-visible statuses preserved. The original audit and CONTEXT.md non-negotiables are honored.

---

## (e) Race conditions

Every scenario walked through. Where a transactional guard is needed, it's spelled out.

### R1 — Exam pass, then payment confirm (the happy path)
1. `exam/submit` inserts cert row `(status='pending', exam_attempt_id, expires_at = now + 1y)` via service-role.
2. Days later, charge-cert-fees succeeds, webhook arrives.
3. `handleCertFeeSucceeded` runs `UPDATE certificates SET status='active', stripe_payment_intent_id=$1, fee_charged_cents=floor($2/N) WHERE restaurant_id=$3 AND status='pending' RETURNING id`. Returns N rows; loops to insert N `activity_events`. **Idempotent** because re-running the same UPDATE matches zero rows the second time (status is already `active`).

### R2 — Payment-confirm webhook arrives BEFORE exam-pass cert is inserted
1. Charge-cert-fees runs before any pending cert exists for the restaurant (e.g. admin clicks submit with no learners certified). The `submissions/create` route's eligibility check already prevents this (`certifiedCount=0` blocks submission), so this race is structurally impossible **today**.
2. **However:** if a learner passes exam between charge-cert-fees firing and the webhook arriving (Stripe webhook can be delayed by minutes), the new cert is `pending` AND will not be activated by the inflight webhook (the webhook only sees N pending certs at the moment it runs, and the late cert is ahead in the queue but not visible at webhook time).
3. **Resolution:** the late cert stays `pending` and is picked up by the next submission's batch. Acceptable — this is a rare edge case (admin would need to submit, then a learner passes within minutes, then the webhook arrives; far more common is the admin submits after all learners are done).
4. Document this in the helper comment so future engineers don't try to "fix" it by activating-by-restaurant-without-a-PI link.

### R3 — Refund arrives before the activation webhook completes
1. Webhook receives `payment_intent.succeeded` (kind=cert_fee) — handler starts, runs the activation UPDATE — long-running, holds Postgres row locks via `SELECT ... FOR UPDATE`.
2. Webhook receives `charge.refunded` for the same PI a few hundred ms later. Stripe's webhook delivery is concurrent across endpoints; same endpoint serializes by event but our handler is async. Possible interleave.
3. **Resolution:** the activation handler wraps its UPDATE in a transaction with `SELECT ... FOR UPDATE` on the cert rows being activated. The refund handler's revocation UPDATE waits on the same lock. Outcome: activation lands first, then revocation runs the `active → revoked` transition, ending in `revoked`. End state is correct.
4. **Alternative**: process events serially per-PI. The existing dedupe table already prevents replay; we don't need another mutex. Postgres row-locks are sufficient.

### R4 — Concurrent `charge.succeeded` replays from Stripe
1. Stripe retries are deduped by `stripe_events` table INSERT-with-conflict. The second replay short-circuits at the entry point, before the handler runs. **Already PASS per audit A2.** No change.

### R5 — Cron flips cert to `expired` the same second a refund arrives
1. Cron's UPDATE: `status='expired' WHERE status='active' AND expires_at < now`.
2. Refund's UPDATE: `status='revoked' WHERE stripe_payment_intent_id=$1 AND status IN ('active','disputed')`.
3. **Postgres serializes via row locks.** Whichever runs first wins. End state could be `expired` (if cron ran first) or `revoked` (if refund ran first). Both are terminal; subsequent runs of either are no-ops.
4. **Question of intent:** which "should" win for a cert that was both refunded AND expired in the same instant? `revoked` is the more accurate signal — the customer didn't pay for it, so it shouldn't have been valid even briefly. **Resolution:** the refund handler's WHERE clause is widened to `status IN ('active','disputed','expired')` for the cross-event window — explicitly allowing refund to revoke a freshly-expired cert. The legality table in (a) is augmented: `expired → revoked` is allowed when the trigger is a refund (not when the trigger is a manual revoke or a dispute_created, because those don't make sense post-expiry).
5. State machine helper updated accordingly. The carve-out is encoded in `STATE_MACHINE_EXCEPTIONS` (see (a)) — the single source of truth referenced by the legality table, `transitionCert()`, and the activity-events vocabulary.

### R6 — Dispute opens on a cert that's already `expired`
1. Cron expired the cert weeks ago.
2. Cardholder disputes the original charge months later.
3. Dispute handler's UPDATE: `status='disputed' WHERE stripe_payment_intent_id=$1 AND status IN ('active')` — rejects expired. Activity event still logged with `cert_state_transition_blocked`. The cert stays `expired`. The diner-facing impact is zero (cert was already invalid). The dispute funds movement still happens at the Stripe level — we just don't model it on the cert because the cert was already invalid before the dispute.
4. If `dispute.closed` later arrives with `lost`, the lost-dispute revocation is permitted under the `STATE_MACHINE_EXCEPTIONS` carve-out (see (a)). The handler's WHERE clause widens to `status IN ('active','disputed','expired')`, flipping the expired cert to `revoked` with `revocation_reason='dispute_lost'` — preserving the "no funds = no cert" invariant in the historical record.

### R7 — Two `payment_intent.succeeded` events for two different PIs targeting the same restaurant arrive simultaneously
1. Restaurant submits twice in quick succession (e.g. retry after a network blip in the admin UI). Two PIs created, both succeed. Both webhooks land at the same time.
2. Both handlers run `UPDATE ... WHERE restaurant_id=$X AND status='pending'`. Postgres row-locks serialize them.
3. First handler activates all N pending certs, stamping them with PI_A. Second handler runs the same query — finds zero pending — no-op. The second PI is for $0 worth of cert activations, which is a charge for nothing.
4. **This is the existing `submissions/create` flow's responsibility, not the cert state machine's.** The eligibility check in `submissions/create` prevents double-submission while one is `pending_review`. If the admin somehow bypasses it (shouldn't happen post-Wave-2A), we're left with an extra paid-but-no-cert PI. Stripe charges are non-reversible without a refund — surface to operator via an `activity_events { type: 'cert_payment_orphaned', ... }` if the second handler activates zero certs. The operator can then issue a refund manually.
5. Add a **defensive log + alert candidate**: if a `cert_fee` PI succeeds and the activation handler activates zero certs, that's "money received but nothing delivered" and is a signal to investigate. Log at `error` level, not `warn`, so it surfaces in monitoring.
6. **Pre-launch posture (explicit):** R7 has no automated remediation. Operator recovery is a manual Stripe-dashboard refund triggered off the `cert_payment_orphaned` activity event. If R7 fires more than once post-launch, build an admin refund tool that consumes orphaned-payment events and issues the refund via the Stripe API. Documented here so future-you doesn't have to rediscover it.

---

## (f) Pricing source of truth

**Decision: keep the constant in `lib/billing/pricing.ts`. Lock in `fee_charged_cents` per cert at activation time (when the webhook fires), not at exam-pass time. Stripe price-object lookup adds a network round-trip on the issuance hot path for marginal benefit; the constant is fine for the MVP.**

```ts
// lib/billing/pricing.ts
export const CERT_FEE_CENTS = 3500; // $35.00 per certified employee
// Future: read from a Stripe price object indexed by env. Track price changes
// via cert_fee_total_cents on the submissions table (already exists) — that
// row records what was charged at submission time, even if the constant
// later changes.
```

- Move the constant from `app/api/stripe/charge-cert-fees/route.ts:28` to `lib/billing/pricing.ts` so the new exam/submit and webhook handler can both import it without duplicating.
- Cert is created with `fee_charged_cents = NULL` at exam-pass time (since no charge has happened).
- Webhook activation handler stamps `fee_charged_cents = floor(pi.amount / N)` at activation time, where N = number of certs being activated. This is the actual amount Stripe charged divided across the certs in the batch, not the constant — handles the case where pricing changes between issuance and activation.
- If pricing later moves to a Stripe price object, the change is local to `lib/billing/pricing.ts` (look up via Stripe API + cache for 5 min) and the import site doesn't change. Existing certs lock in their issued price via `fee_charged_cents`.

---

## (g) Audit trail (A8.4)

### Existing `activity_events` schema (no changes needed)

`activity_events (id uuid pk, restaurant_id uuid fk, actor_id uuid fk null, type text, payload jsonb, created_at timestamptz)`. Schema already supports rich metadata via `payload jsonb`. No migration needed for the audit trail itself.

### Cert event vocabulary (additions)

| `type` | When | Required `payload` fields |
|---|---|---|
| `cert_issued` (existing — repurposed) | Cert row inserted by exam/submit | `{ certificate_id, cert_code, exam_attempt_id, status: 'pending' }` |
| `cert_activated` (new) | Status `pending → active` via cert-fee PI | `{ certificate_id, cert_code, stripe_event_id, stripe_payment_intent_id, fee_charged_cents, before_status: 'pending', after_status: 'active' }` |
| `cert_expired` (new) | Status `active → expired` via cron | `{ certificate_id, cert_code, expires_at, before_status: 'active', after_status: 'expired', reason: 'scheduled_expiration' }` |
| `cert_revoked` (new) | Status `* → revoked` (any source). When `before_status='expired'`, the trigger MUST be one of `STATE_MACHINE_EXCEPTIONS[expired→revoked].allowedTriggers` (i.e. `refund` or `dispute_lost`); see `lib/learner/cert-state.ts`. | `{ certificate_id, cert_code, before_status, after_status: 'revoked', reason: 'refund' \| 'dispute_lost' \| 'admin', stripe_event_id?, dispute_id? }` |
| `cert_disputed` (new) | Status `active → disputed` | `{ certificate_id, cert_code, stripe_event_id, dispute_id, dispute_amount, before_status: 'active', after_status: 'disputed' }` |
| `cert_dispute_resolved` (new) | Status `disputed → active` (won/warning_closed) | `{ certificate_id, cert_code, stripe_event_id, dispute_id, dispute_outcome: 'won' \| 'warning_closed', before_status: 'disputed', after_status: 'active' }` |
| `cert_dispute_funds_withdrawn` (new) | Stripe `dispute.funds_withdrawn` (log-only) | `{ stripe_event_id, dispute_id, amount }` (no certificate_id — log-only) |
| `cert_dispute_funds_reinstated` (new) | Stripe `dispute.funds_reinstated` (log-only) | `{ stripe_event_id, dispute_id, amount }` |
| `cert_payment_canceled` (new) | Stripe `payment_intent.canceled` (kind=cert_fee) | `{ stripe_event_id, stripe_payment_intent_id, restaurant_id }` |
| `cert_payment_failed` (new) | Stripe `payment_intent.payment_failed` (kind=cert_fee) | `{ stripe_event_id, stripe_payment_intent_id, last_payment_error }` |
| `cert_payment_orphaned` (new — operator alert candidate) | Cert-fee PI succeeded but activation found zero pending certs | `{ stripe_event_id, stripe_payment_intent_id, restaurant_id, amount_cents }` |
| `cert_state_transition_blocked` (new) | State-machine helper rejected an attempted transition | `{ certificate_id, attempted_from, attempted_to, source: 'webhook' \| 'cron' \| 'manual' }` |
| `cert_purged` (new) | Pending cert hard-deleted by TTL cron | `{ certificate_id, cert_code, profile_id, restaurant_id, exam_attempt_id, age_days }` |

**Querying the audit trail for a cert's history:** `SELECT * FROM activity_events WHERE payload->>'certificate_id' = $1 ORDER BY created_at`. Add an expression index to keep this query fast at scale:

```sql
CREATE INDEX activity_events_certificate_id_idx
  ON activity_events ((payload->>'certificate_id'))
  WHERE payload ? 'certificate_id';
```

(Partial expression index — only events that mention a cert get indexed.)

---

## (h) Migration plan reference

Full migration SQL + reconciliation script outlined in `audits/cert-migration-plan.md`. Summary:

1. **0013_cert_state.sql** — additive schema delta (add `status`, `status_changed_at`, `revocation_reason`, `dispute_id`, `disputed_at`; drop `revoked`; new index).
2. **0014_activity_events_cert_index.sql** — partial expression index on `payload->>'certificate_id'`.
3. **Backfill query** in 0013 that maps existing rows to the new states:
   - `revoked = true` → `status='revoked'`, `revocation_reason='admin'`
   - `revoked = false AND expires_at < now` → `status='expired'`
   - `revoked = false AND expires_at >= now` → `status='active'` (assumes paid; pre-launch this is OK; the reconciliation script in the migration plan re-evaluates for production launch by checking `stripe_payment_intent_id IS NOT NULL`)
   - **Pre-launch:** there is no production data. Backfill is for dev DBs only. The reconciliation script exists for first-launch use.
4. **Reconciliation script** `scripts/reconcile-cert-states.ts` — produces `audits/cert-migration-report.md` for human review BEFORE running mutations, then on second invocation with `--apply` flag actually flips states. Reads every cert + cross-references `stripe_events` for refunds/disputes that arrived during the gap.
5. **Fresh-DB seed update** — `db/seed.sql` updates so `pnpm db:reset` produces certs with `status='active'` for happy-path test data + a sprinkling of `pending`/`expired`/`revoked`/`disputed` for surface coverage.

---

## (i) Acceptance criteria — finding-by-finding

| Finding | Resolution under this design |
|---|---|
| **P0 #5** (no refund/chargeback handler) | New webhook handlers for `charge.refunded`, `charge.dispute.created`, `charge.dispute.closed`, `charge.dispute.funds_withdrawn`, `charge.dispute.funds_reinstated`, `payment_intent.canceled`. Each maps to a documented state transition in (c). Refund/lost-dispute → `revoked`. Won-dispute → `active`. Activity events written for every transition. |
| **P0 #6** (cert created before payment) | Cert created in `status='pending'` at exam pass with `fee_charged_cents=NULL` and `stripe_payment_intent_id=NULL`. Verify endpoint treats pending as `not_found`. Directory count excludes pending. Cert is invisible publicly until the cert-fee PI succeeds and the webhook flips status to `active`. The hardcoded $35 at exam-pass time is removed. |
| **A8.4** (no cert state-transition audit trail) | Every state transition writes an `activity_events` row with `before_status`, `after_status`, `reason`, `stripe_event_id` (when applicable). Vocabulary documented in (g). Partial expression index makes per-cert history queryable. |
| **F-S2** (directory count includes expired certs) | `app/api/directory/[slug]/route.ts:160-165` rewritten to call `countPubliclyActiveCerts(db, restaurantId)` from `lib/learner/cert-status.ts`. Helper queries `WHERE status='active'` (the only publicly-active status). Cron `expire-certs` is extended to actually flip status to `expired`. F-S2 closed structurally. |
| **F-S3** (search count includes expired certs) | `lib/directory/search.ts:240` raw SQL changes from `FILTER (WHERE c.revoked = false)` to `FILTER (WHERE c.status = 'active')`. Same canonical truth. (Cannot use the helper from raw SQL, but the WHERE predicate is the same canonical predicate the helper uses.) |
| **F-S4** (learner certificate route returns expired) | `app/api/learner/certificate/route.ts:43-51` rewritten to call `getLatestActiveCertForLearner(db, profileId)`. Returns null if no active cert; client renders the appropriate "no active cert / pending / expired" UI based on the broader `getAllCertsForLearner` call. |
| **F-S5** (learner home-data returns expired) | Same pattern as F-S4 — `app/api/learner/home-data/route.ts:139-148` calls the helper. |

The naked-`.eq('revoked', false)` anti-pattern that produced F-S2/F-S3/F-S4/F-S5 is also structurally killed by **dropping the `revoked` column**. Any old call site referencing `revoked` fails at compile time.

---

## (j) Test plan

### Unit tests — `tests/unit/cert-state-machine.test.ts` (replace the existing file's behavior)

For each transition in (a)'s legality table, one test pair: "transitionCert returns ok for legal transitions" (parametrized over every legal pair) and "transitionCert returns rejection for illegal transitions" (parametrized over every illegal pair). Specific cases to cover:
- `pending → active` legal
- `pending → expired/revoked/disputed` illegal (must go through `active`)
- `active → expired` legal
- `active → revoked` legal
- `active → disputed` legal
- `disputed → active` legal (won)
- `disputed → revoked` legal (lost)
- `expired → revoked` legal **only** when triggered by refund (R5 exception)
- `expired → revoked` illegal when triggered by manual or dispute
- `revoked → ANY` illegal (terminal)
- `expired → ANY` illegal except the R5 exception above
- `same → same` no-op (idempotent)

### Unit tests — `tests/unit/cert-status-helper.test.ts`

- `countPubliclyActiveCerts` returns 0 for restaurant with only pending/expired/revoked/disputed certs
- `countPubliclyActiveCerts` returns N for N active certs
- `countPubliclyActiveCerts` correctly excludes certs from other restaurants
- `getLatestActiveCertForLearner` returns null when learner has only pending
- `getLatestActiveCertForLearner` returns the most recent active cert (sorted by issued_at desc)
- `getAllCertsForLearner` returns the full history with statuses

### Integration tests — `tests/integration/stripe-cert-events.test.ts` (Vitest)

For each Stripe event type in (c), one test that signs a Stripe-verified payload and asserts the resulting cert state + activity_events row. Use `Stripe.webhooks.generateTestHeaderString` (existing pattern from full-pilot-loop spec).

- `payment_intent.succeeded` (kind=cert_fee) with N pending certs → all N flipped to active, N activity_events written
- `payment_intent.succeeded` (kind=cert_fee) with 0 pending certs → orphaned-payment activity event written, no cert touched
- `payment_intent.succeeded` (kind=cert_fee) replay → idempotent no-op (dedupe table catches it)
- `charge.refunded` for a PI with 3 active certs → all 3 to revoked with reason='refund'
- `charge.refunded` for an already-revoked PI's certs → idempotent no-op
- `charge.dispute.created` → certs to disputed, dispute_id stamped
- `charge.dispute.closed` (won) → certs back to active
- `charge.dispute.closed` (lost) → certs to revoked with reason='dispute_lost'
- `charge.dispute.closed` (warning_closed) → certs back to active
- `payment_intent.canceled` (kind=cert_fee) → activity event only, no cert touched
- `customer.subscription.deleted` → log-only, no cert touched

### Integration tests — `tests/integration/cert-status-helper-real-db.test.ts`

Exercises `countPubliclyActiveCerts` etc. against the real local Supabase (not mocks), seeding mixed-status certs and asserting query correctness.

### Integration tests — `tests/integration/expire-certs-cron.test.ts`

- `expire-certs` cron flips `active → expired` for certs whose `expires_at < now`. Activity event written. Idempotent on rerun.
- `expire-certs` cron does NOT touch pending/revoked/disputed certs (only active).

### Integration tests — `tests/integration/purge-stale-pending-certs-cron.test.ts`

- New cron `purge-stale-pending-certs` deletes certs `status='pending' AND issued_at < now - INTERVAL '14 days'`. Cascade-deletes cert_warnings. Activity event written.
- Does NOT delete pending certs younger than 14 days.

### Integration tests — race-condition coverage

- `tests/integration/cert-race-conditions.test.ts`:
  - R1: simulate exam-pass + later activation in sequence; assert end state
  - R3: simulate activation + refund interleaving via promises; assert end state revoked
  - R5: simulate cron expire + refund interleaving; assert end state revoked
  - R6: dispute on already-expired cert; assert no transition + activity event
  - R7: two cert-fee PIs for same restaurant, second activates zero certs; assert orphaned-payment event

### Integration tests — verify endpoint shapes per state

- `tests/integration/verify-endpoint-states.test.ts`:
  - pending cert → `not_found`
  - active cert → 4-field active response
  - expired cert → 4-field expired response
  - revoked cert → 4-field revoked response
  - disputed cert → 4-field response with `status='revoked'` (intentional public masking)

### Integration tests — reconciliation script — `tests/integration/reconcile-cert-states.test.ts`

(Companion to the migration-plan reconciliation script. Listed here so the design doc's test plan is complete.)

- Seed a mix of certs (pending recent, pending stale, active with PI, refunded PI, disputed PI, won-dispute PI, expired) and assert dry-run report contents.
- `--apply` produces the expected end states + writes one `cert_state_reconciled` activity event per transition.
- **Golden-file dry-run:** running the dry-run against a known seeded DB produces a report that is **byte-identical** to a checked-in golden file at `tests/integration/fixtures/cert-migration-report.golden.md`. Fails if the report drifts (deterministic ordering, deterministic timestamps via `MOCK_NOW` env).
- **Idempotent `--apply`:** running `--apply` twice in succession against the same DB produces zero additional state changes on the second run (assertions: cert state diff is empty, activity_events count delta is 0).
- **Fail-closed on dry-run drift:** if the on-disk report is older than the current DB state (i.e. the DB changed since the dry-run was generated), `--apply` exits non-zero with `"reconciliation report is stale"` and writes nothing. Implementation: `--apply` re-runs the dry-run computation and compares against the on-disk report; mismatch aborts.

### End-to-end happy path

- `tests/e2e/cert-payment-happy-path.spec.ts`:
  - Seed: restaurant + admin + learner with completed lessons + active subscription
  - Learner submits exam → cert created in `pending` status
  - Verify endpoint for cert_code → `not_found`
  - Directory count for restaurant → 0 active certs
  - Admin submits restaurant via `/api/submissions/create` → charge-cert-fees fires → webhook activates pending cert
  - Verify endpoint for same cert_code → `active` with 4 fields
  - Directory count for restaurant → 1 active cert
  - Learner home-data → cert visible as active with PDF link

### End-to-end refund path

- `tests/e2e/cert-refund-path.spec.ts`:
  - Pre: a happy-path cert is `active`
  - Simulate Stripe-signed `charge.refunded` webhook for that cert's PI
  - Verify endpoint → `revoked`
  - Directory count → 0 active certs
  - Learner home-data → cert visible as revoked with reason

### End-to-end dispute path

- `tests/e2e/cert-dispute-path.spec.ts`:
  - Pre: a happy-path cert is `active`
  - Simulate Stripe-signed `charge.dispute.created` → cert goes to `disputed`
  - Verify endpoint shows `revoked` (public masking)
  - Directory count → 0 active certs
  - Simulate `charge.dispute.closed` (won) → cert back to `active`
  - Verify endpoint → `active` again
  - Simulate `charge.dispute.closed` (lost) on a re-disputed cert → cert to `revoked` with reason='dispute_lost'

---

## OPEN QUESTIONS — surfaced for review

These are ambiguities discovered during the design pass. Each needs a decision before implementation.

### OQ-1 — Pending cert PDF generation
Today `exam/submit` fires-and-forgets to `/api/certs/generate` immediately. With pending state, do we generate the PDF at exam-pass time (so it's ready when status flips to active) or at activation time (so we don't waste storage on certs that may never activate)?

**Recommendation:** generate at activation time. Saves storage + Mux/font costs on certs that get TTL-purged. The activation handler triggers the existing fire-and-forget call. Trade-off: a small delay (~1-2 sec) between activation and PDF availability — the learner page can poll if `pdf_storage_path IS NULL`.

### OQ-2 — Existing seeded test data
`db/seed.sql` (full seed, not curriculum-only) includes 1 cert for the demo bistro learner. Backfill needs to map this to the new schema. Default: assume seeded certs go to `status='active'` (consistent with their non-revoked + non-expired state). Confirm this matches intent.

**Recommendation:** yes, default to `active` for the seed cert.

### OQ-3 — Activity event vocabulary collision
`cert_issued` already exists in code (used by current `handleCertFeePayment`). Repurposing it to mean "cert row inserted in pending state" changes its semantics. Two options:
- (a) Repurpose: `cert_issued` = pending insertion; `cert_activated` = pending → active flip.
- (b) Preserve: keep `cert_issued` for the active flip (matches today's meaning); use a new `cert_pending` for the pending insertion.

**Recommendation:** (a) — semantic alignment with the state machine. Existing dev-DB activity_events rows are throwaway; pre-launch we have no production audit trail to disrupt.

### OQ-4 — Disputed cert PDF link
A cert in `disputed` state shows publicly as `revoked`. Should the learner's PDF download link still work? The PDF is already in Storage. Three options:
- (a) Disable PDF download client-side based on status.
- (b) Continue to allow download — the PDF itself isn't authoritative; the verify URL on it points to the verify endpoint which shows `revoked`.
- (c) Stamp a "DISPUTED" watermark via a regenerated PDF.

**Recommendation:** (b). The verify URL is the source of truth, not the PDF. Watermarking adds complexity for marginal benefit. Disabled download could surprise the learner during a temporary dispute that resolves in their favor.

**Decision: (b) approved.** Explicit consequence to record: the verify URL embedded in the PDF will read `revoked` for any diner who scans the QR while the cert is in the `disputed` state. This is the correct UX — the diner sees the same "not currently valid" signal a refund would produce, the trust badge degrades safely, and if the dispute resolves `won`/`warning_closed` the same QR snaps back to `active` with no PDF re-issuance. This is precisely why option (b) is the right answer over (a) (disabled download) and (c) (regenerated watermarked PDF): the PDF is a static artifact, the verify endpoint is dynamic, and the public-masking decision in (a) already maps `disputed → revoked` for diner-facing surfaces.

### OQ-5 — When to send the WelcomeAdmin / cert-issued email?
Currently `handleCertFeePayment` doesn't send a learner-facing email at the activation moment (only admin emails happen earlier). With the new state machine, do we send the learner an "Your certificate is now active!" email at activation? CONTEXT.md doesn't specify.

**Recommendation:** yes — at the `pending → active` transition, send a `CertActivated` email to the learner. The current flow only sends `ExamPassed` at exam-pass time, which is now misleading because the learner's cert isn't actually issued yet.

**Decision (split):**
- **In scope this wave:** reword the existing `ExamPassed` email so it does not lie about the cert being issued. New copy: "you passed — your cert will be issued when your restaurant admin completes payment." This is a one-line template change; the email already exists. Reworded ExamPassed lands as a step between (4) and (5) of the implementation sequencing in `cert-migration-plan.md`.
- **Deferred to P1 follow-up:** the brand-new `CertActivated` email at the `pending → active` transition. That one is net-new template work (subject, body, branding pass) and is filed in `audits/followups.md` as a P1. The activation handler will write the activity event for the transition either way; the email send wires up later.

---

Design complete at `audits/cert-payment-state-design.md`. Migration plan at `audits/cert-migration-plan.md`. Awaiting review before implementation.

---

## Revision log — 2026-05-10 (post-review modifications)

Approved-with-mods round. Changes applied in place:

- **OQ-4 PDF link:** explicit consequence recorded — embedded verify URL reads `revoked` during a dispute window, which is the correct UX and the reason option (b) is right (not (a) or (c)).
- **OQ-5 ExamPassed email:** reword in this wave (added as step 4b in the migration-plan sequencing). New `CertActivated` email at activation deferred to a P1 in `audits/followups.md`.
- **Concern 1 — STATE_MACHINE_EXCEPTIONS:** new constant in `lib/learner/cert-state.ts` is the single source of truth for the R5/R6 `expired → revoked` carve-out. Legality table, `transitionCert()`, and the `cert_revoked` activity-events row all reference it.
- **Concern 2 — R7 remediation:** explicit pre-launch posture recorded in section (e) R7 — manual Stripe-dashboard refund off `cert_payment_orphaned`; build an admin refund tool only if R7 fires more than once post-launch.
- **Concern 3 — reconciliation script tests:** three new tests added to test plan section (j) and to `cert-migration-plan.md`'s test plan: golden-file dry-run (byte-identical), idempotent `--apply`, fail-closed on dry-run/DB drift.

Awaiting review.
