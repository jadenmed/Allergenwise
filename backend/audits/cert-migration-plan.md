# Cert Migration Plan — Wave 2C

**Date:** 2026-05-10
**Companion to:** `audits/cert-payment-state-design.md`
**Mode:** plan only — SQL stub included for review. No migration runs until the design doc is approved.

---

## Migrations to land in this wave

Two forward-only schema migrations + a reconciliation script for first-launch use.

### Migration 0013 — `db/migrations/0013_cert_state.sql`

Additive schema delta on `certificates` + drop the now-redundant `revoked` column. Includes an idempotent backfill that safely runs on a fresh `pnpm db:reset`.

```sql
-- ─── Migration 0013 — Wave 2C cert state machine ───────────────────────────
--
-- Adds the canonical `status` enum-via-CHECK column to certificates so the
-- public directory + verify + learner surfaces stop drifting (F-S2/F-S3/F-S4/
-- F-S5). Drops the `revoked` boolean — its information is fully encoded by
-- `status='revoked'`, and keeping both columns is the structural source of
-- the naked `.eq('revoked', false)` anti-pattern.
--
-- Per audits/cert-payment-state-design.md, the 5 states are:
--   pending  — cert exists, no payment confirmed yet (invisible publicly)
--   active   — paid, valid, within window
--   expired  — past expires_at (cron-flipped, not in-memory-computed)
--   revoked  — manual admin OR refund OR dispute_lost
--   disputed — chargeback dispute open; publicly displayed as revoked

-- Step 1: add the status column with a temporary default so existing rows
-- get a value, then we'll backfill with the right state.
ALTER TABLE certificates
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'active', 'expired', 'revoked', 'disputed'));

ALTER TABLE certificates
  ADD COLUMN IF NOT EXISTS status_changed_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE certificates
  ADD COLUMN IF NOT EXISTS revocation_reason text
    CHECK (revocation_reason IN ('refund', 'dispute_lost', 'admin', 'expired')
           OR revocation_reason IS NULL);

ALTER TABLE certificates
  ADD COLUMN IF NOT EXISTS dispute_id text;

ALTER TABLE certificates
  ADD COLUMN IF NOT EXISTS disputed_at timestamptz;

-- Step 2: backfill from the legacy `revoked` boolean + expires_at signal.
-- Pre-launch, this is the dev-DB transition. Production launch uses the
-- reconciliation script (scripts/reconcile-cert-states.ts) which is more
-- thorough — it cross-references stripe_events for refunds/disputes.
UPDATE certificates
SET status = CASE
  WHEN revoked = true THEN 'revoked'
  WHEN expires_at < now() THEN 'expired'
  ELSE 'active'  -- pre-launch assumption: any non-revoked, non-expired cert
                 -- in the dev DB was issued under the old broken flow that
                 -- never actually charged — but for dev convenience we treat
                 -- them as paid. Production reconciliation is stricter.
END,
status_changed_at = COALESCE(updated_at, issued_at, now()),
revocation_reason = CASE
  WHEN revoked = true THEN 'admin'
  ELSE NULL
END
WHERE status = 'pending';  -- only touch newly-defaulted rows; idempotent

-- Step 3: drop the legacy `revoked` boolean.
-- Forces every naked `.eq('revoked', false)` anywhere in app code to fail
-- at TypeScript compile time, which is the structural F-S2/F-S3/F-S4/F-S5
-- closure. The migration intentionally takes a `pnpm typecheck` failure
-- in any consumer that hasn't migrated to the new helper — that's the
-- bug we want surfaced.
ALTER TABLE certificates DROP COLUMN IF EXISTS revoked;

-- Step 4: the canonical-hot-path index. Backs the
-- `countPubliclyActiveCerts(restaurantId)` helper.
CREATE INDEX IF NOT EXISTS certificates_restaurant_status_idx
  ON certificates (restaurant_id, status)
  WHERE status = 'active';

-- Step 5: secondary index for the per-learner reads (F-S4 / F-S5 helper).
CREATE INDEX IF NOT EXISTS certificates_profile_status_issued_at_idx
  ON certificates (profile_id, status, issued_at DESC);

-- Step 6: index for the TTL purge cron (purge-stale-pending-certs).
CREATE INDEX IF NOT EXISTS certificates_pending_issued_at_idx
  ON certificates (issued_at)
  WHERE status = 'pending';

-- Step 7: index for the refund/dispute reverse lookup
-- (charge.refunded → certs WHERE stripe_payment_intent_id = pi_id).
CREATE INDEX IF NOT EXISTS certificates_stripe_pi_idx
  ON certificates (stripe_payment_intent_id)
  WHERE stripe_payment_intent_id IS NOT NULL;
```

### Migration 0014 — `db/migrations/0014_activity_events_cert_index.sql`

Partial expression index for the per-cert audit-trail query:

```sql
-- ─── Migration 0014 — partial index for cert audit-trail lookups ───────────
--
-- Backs the canonical query "show me everything that happened to cert X":
--   SELECT * FROM activity_events
--   WHERE payload->>'certificate_id' = $1
--   ORDER BY created_at;
--
-- Partial index — only events that actually carry a certificate_id are
-- indexed, keeping the index small. The `payload ? 'certificate_id'`
-- predicate is the JSONB containment check.

CREATE INDEX IF NOT EXISTS activity_events_certificate_id_idx
  ON activity_events ((payload->>'certificate_id'))
  WHERE payload ? 'certificate_id';
```

### Reversibility / rollback

- **Forward-only by convention** (matches the rest of `db/migrations/`).
- **Down-migration possible** if needed: `ALTER TABLE certificates ADD COLUMN revoked boolean DEFAULT false; UPDATE ... SET revoked = (status = 'revoked'); DROP COLUMN status, ...`. Leaves the cert state collapsed back to the pre-Wave-2C model. Documented here for emergency use, not committed as a migration file (forward-only philosophy).
- **No data loss** in either direction: the backfill is computed from existing `revoked` + `expires_at` signals. Reverse re-derives `revoked` from `status`. Other added columns (`revocation_reason`, `dispute_id`, `disputed_at`) lose data on rollback but are auxiliary and only populated post-Wave-2C events.

---

## Fresh-DB seed update

`db/seed.sql` and `db/seed-curriculum.sql` need to be updated so `pnpm db:reset` produces correct state under the new schema. Diff:

- The single seeded cert in `db/seed.sql` (currently `revoked=false`) gets `status='active'` populated by the migration backfill. **No seed file change needed** — the backfill catches it. Verified by inspection of the seed file: only one INSERT into `certificates` exists, and the `revoked=false` row will be backfilled to `status='active'`.
- For coverage in dev tests, **add 4 additional seeded certs** to `db/seed.sql` after the migration lands, one per non-active state. Naming: `seed-cert-pending`, `seed-cert-expired`, `seed-cert-revoked`, `seed-cert-disputed`. Each on a distinct seeded learner profile. This gives the manual smoke tests every state to poke at.
- This seed change is part of Wave 2C implementation (not the migration plan itself), but called out here so the implementation step doesn't forget it.

---

## Reconciliation script — `scripts/reconcile-cert-states.ts`

Designed for first production launch. Pre-launch, runs against the dev DB to verify it works correctly on day one.

### Two-phase invocation

```bash
# Phase 1: dry-run (default). Writes audits/cert-migration-report.md
# enumerating every cert + the proposed transition. NO writes.
pnpm tsx scripts/reconcile-cert-states.ts

# Phase 2: apply (operator review of the report happens between phases).
pnpm tsx scripts/reconcile-cert-states.ts --apply
```

### What it does

1. Reads every cert in the DB.
2. For each cert, runs the classification logic:
   - If `stripe_payment_intent_id IS NULL AND issued_at >= now - INTERVAL '14 days'` → propose `pending`
   - If `stripe_payment_intent_id IS NULL AND issued_at < now - INTERVAL '14 days'` → propose **purge** (TTL exceeded; no payment ever confirmed)
   - If `stripe_payment_intent_id IS NOT NULL`:
     - Look up the latest `stripe_events` rows matching the PI:
       - Has any `charge.refunded` for this PI? → propose `revoked`, `revocation_reason='refund'`
       - Has any `charge.dispute.created` for this PI not yet `closed`? → propose `disputed`
       - Has any `charge.dispute.closed` with `lost` outcome? → propose `revoked`, `revocation_reason='dispute_lost'`
       - Otherwise: `expires_at < now` → propose `expired`; else → propose `active`
3. **Special-case the dev-DB pre-launch state:** for certs with `stripe_payment_intent_id IS NULL` issued by the broken old flow (which is every cert pre-Wave-2C), the reconciliation defaults to `pending` if recent OR `revoked` with `revocation_reason='admin'` and a note in `payload.notes` if older than 14 days. The 0013 backfill is more lenient (defaults to `active` for dev convenience); reconciliation is stricter for production-grade rigor.
4. Writes `audits/cert-migration-report.md` with:
   - Per-cert table: `cert_code`, current `status`, proposed `status`, proposed action, reason
   - Aggregate counts: how many certs land in each state
   - List of certs whose proposed action is `purge` (operator should review individually)
   - List of certs whose proposed `status` is `revoked` due to refund/dispute (operator should confirm Stripe state matches)
5. On `--apply`, runs the proposed transitions atomically (one transaction per cert), inserts an `activity_events` row per transition with `actor_id=NULL`, `type='cert_state_reconciled'`, `payload: { reconciliation_run_id, before_status, after_status, evidence: { stripe_event_ids: [...] } }`.

### Test plan for the script (pre-launch verification)

Add `tests/integration/reconcile-cert-states.test.ts`:
- Seed a mix of certs (pending recent, pending stale, active with PI, refunded PI, disputed PI, won-dispute PI, expired)
- Run the script in dry-run mode → assert report contents
- Run the script in apply mode → assert resulting cert states + activity_events rows
- **Golden-file dry-run:** dry-run against a known seeded DB produces a report **byte-identical** to a checked-in golden file at `tests/integration/fixtures/cert-migration-report.golden.md`. Deterministic via fixed seed + `MOCK_NOW` env. Fails on any drift.
- **Idempotent `--apply`:** running `--apply` twice in succession produces zero additional state changes on the second run (cert state diff empty, activity_events count delta is 0).
- **Fail-closed on dry-run/DB drift:** if the on-disk report does not match a freshly recomputed dry-run against the current DB state, `--apply` exits non-zero with `"reconciliation report is stale"` and performs no writes. Implementation: `--apply` re-runs the dry-run computation and diffs against the on-disk report; any mismatch aborts before the first UPDATE.

---

## Implementation sequencing (post-design-approval)

Order matters because cross-file changes ripple:

1. Land migration 0013 — fails compile of every naked `revoked` consumer. Surfaces every callsite that must be updated.
2. Add `lib/learner/cert-state.ts` (state-machine helper) and `lib/learner/cert-status.ts` (canonical reads).
3. Update `lib/billing/pricing.ts` (constant move).
4. Update `app/api/exam/submit/route.ts` to insert `status='pending'` + drop hardcoded `fee_charged_cents`.
4b. Reword the existing `ExamPassed` learner email so it no longer claims the cert is issued — new copy: "you passed — your cert will be issued when your restaurant admin completes payment." One-line template edit; new `CertActivated` email at the `pending → active` transition is deferred to a P1 follow-up in `audits/followups.md`.
5. Update `app/api/stripe/webhook/route.ts` switch with all new event handlers + replace `handleCertFeePayment` with `handleCertFeeSucceeded`.
6. Update `app/api/cron/expire-certs/route.ts` to flip status (in addition to existing email send).
7. Add `app/api/cron/purge-stale-pending-certs/route.ts` + `vercel.json` schedule + `middleware.ts:PUBLIC_PREFIXES`.
8. Update `app/api/certs/[certCode]/verify/route.ts` to read status directly.
9. Update `app/api/directory/[slug]/route.ts:160-165`, `app/api/search/route.ts:225` (and `lib/directory/search.ts:240` raw SQL), `app/api/learner/certificate/route.ts:43-51`, `app/api/learner/home-data/route.ts:139-148` to use the new helpers.
10. Update `lib/admin/eligibility.ts:60-64` and `lib/reviewer/auto-checks.ts:108-113` and `app/api/admin/roster/route.ts:178-183` and `app/api/cron/weekly-admin-digest/route.ts:99-106` and `app/api/admin/dashboard-stats/route.ts:104, 122` and `app/api/reviewer/queue/route.ts:117` to use `status='active'` instead of `revoked=false`.
11. Land migration 0014 (audit-trail index).
12. Add reconciliation script + its test.
13. Add seed updates (4 sample certs).
14. Run the full pilot loop e2e + new tests; fix any cascade.
15. Update `audits/followups.md` to mark P0 #5 / P0 #6 / A8.4 / F-S2 / F-S3 / F-S4 / F-S5 fixed with commit hashes.

---

Migration plan complete at `audits/cert-migration-plan.md`. Companion design at `audits/cert-payment-state-design.md`.
