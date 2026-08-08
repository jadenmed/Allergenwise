# Cron State Recovery — F2 Production Impact

**Date:** 2026-05-09 (filed under 2026-05-07 per audit naming convention)
**Author:** F2 fix wave
**Scope:** What state is currently wrong because the 6 cron routes have been silently 401'd by middleware since they were deployed, and how to recover.

---

## Methodology

I do not have direct access to the production Supabase database or to Vercel Cron logs from this session. Findings below are based on:

1. **Local dev DB inventory** (curriculum-only seed + pilot-loop test artifacts), checked via service-role queries against `127.0.0.1:54322`.
2. **Schema + handler inspection** to derive the state-drift signature each cron is responsible for catching.
3. **Inference from the bug timeline.** F2 was introduced at the same moment middleware acquired its API-prefix branch (commit unknown without `git blame`, but no later than Phase 1 / `8462be1`). Therefore every Vercel Cron invocation since first deploy returned 401 silently. Vercel reports the run as "completed" with whatever HTTP status the route returned — a 401 doesn't necessarily surface as a runbook alert.

Numbers below from the local dev DB are illustrative of *how to count* the affected production set. Production must be re-run by someone with prod DB access; the queries are reproducible.

---

## 1. `expire-certs` (daily 03:15 UTC) — sends warning emails at 30 / 14 / 7 days, optionally upserts `cert_warnings` rows

**What it does:**
- Iterates non-revoked certs whose `expires_at` is within 30 days of now.
- For each cert, looks up the most recent `cert_warnings` row keyed by `(cert_id, window)` and sends a warning email if the corresponding window (`30d` / `14d` / `7d`) has not yet been emailed.
- Inserts a `cert_warnings` row on each successful send.

**What's NOT in this cron:** the actual transition `valid` → `expired`. Cert state is computed in-memory by `getCertStatus()` from `certificates.expires_at`. **This means a cert past its expiry already shows `status: 'expired'` to the verify endpoint without any cron — no data was ever in the wrong bucket from a verifier's perspective.** The cron only governs the *warning email* side-effect.

**Local dev inventory (post-F2-fix, pre-recovery-run):**
```
certs past expires_at, revoked=false:        0
certs in 30-day window:                      0   (warning emails skipped)
certs in 14-day window:                      0
certs in 7-day window:                       0
cert_warnings rows ever inserted:            0   ← confirms cron has never run
```

**Production-equivalent queries (run with service role on prod):**
```sql
-- Certs that should have received warning emails since first deploy:
SELECT count(*) FROM certificates
WHERE revoked = false
  AND expires_at < now() + interval '30 days'
  AND issued_at < now() - interval '30 days';   -- existed long enough to warrant a warning

-- Confirm cron has never run successfully:
SELECT count(*) FROM cert_warnings;
```

**Recovery plan:**
1. After F2 fix lands and Vercel deploys, the next 03:15 UTC run will catch up: it sends one email per (cert_id, window) tuple that's still unsent. **Risk: a backlog of warning emails fires the morning after deploy.** A learner whose cert expires in 6 days, with no prior warning, will get all three windows' worth of emails in rapid succession because the absence of prior `cert_warnings` rows means each window is "owed."
2. Mitigation if backlog is large: pre-populate `cert_warnings` for every non-revoked cert with `(cert_id, '30d', NOW())`, `(cert_id, '14d', NOW())`, `(cert_id, '7d', NOW())` for any cert whose window is already past — i.e., back-date the suppression so users only get warnings for windows still ahead. Not destructive (idempotent), and skips redundant emails.

**Downstream incident risk:** **Low.** The verify endpoint computes `expired` from `expires_at` directly. No diner ever saw an expired cert as `active` because of this bug. The customer-facing cost is "users got fewer renewal-reminder emails than promised" — a soft service degradation, not a safety event.

---

## 2. `expire-subscriptions` (daily 03:30 UTC) — flips `active` → `expired` on ends_at lapse, also pauses restaurant

**What it does:** `UPDATE subscriptions SET status='expired'` for rows with `status='active' AND ends_at < now()`. Also flips the linked restaurant's status to `paused`.

**What's NOT in the cron:** the application-side eligibility checks (`lib/admin/eligibility.ts:88` checks for an active subscription) read the subscription row's `status` AND `ends_at`. So a row stuck at `status='active'` with `ends_at < now()` would still fail eligibility correctly because the `>= today` guard on `ends_at` lives in app code as well. Verify by inspection of `lib/billing/subscription.ts`.

**Wait** — look closer:

```sql
SELECT * FROM subscriptions
WHERE status = 'active' AND ends_at < now();
```

If any such row exists, the restaurant **is technically still active** in the `subscriptions.status` column, even though they shouldn't be. Whether this is exploitable depends on whether any production read path checks only `status` without also checking `ends_at`. A grep is needed:

```
grep -rn "status.*active" app/ lib/ | grep -i subscription
```

If any read path does `.eq('status','active')` without also `.gte('ends_at', now())`, that's an exploitable bypass: a customer past their billing period continues to receive service until the cron runs.

**Local dev inventory:**
```
active subs past ends_at: 0
```

**Production query:**
```sql
SELECT id, restaurant_id, ends_at, status
FROM subscriptions
WHERE status = 'active' AND ends_at < now()
ORDER BY ends_at ASC;
```

**Recovery plan:**
1. After F2 fix deploys, the next 03:30 UTC run catches up — flips status, pauses restaurants. Idempotent.
2. **Manual immediate run worth considering:** if customers have been past their billing period with `status='active'` for a meaningful interval, the operator should `curl -H "Authorization: Bearer $CRON_SECRET" https://allergenwise.com/api/cron/expire-subscriptions` immediately after deploy to bring state current rather than waiting up to 24h.
3. **Refunds/credits owed?** If any restaurant kept using the platform past their billing period, that's revenue leakage in the customer's favor. Decide policy: charge them for the gap, or absorb. Out of scope for this doc; surface to product/finance.

**Downstream incident risk:** **Medium-High** if any active read path treats `status='active'` as ground truth without checking `ends_at`. Needs a code grep before declaring this safe.

---

## 3. `exam-timeout-sweep` (every minute) — auto-submits abandoned exam_attempts as failed

**What it does:** finds `exam_attempts` rows with `submitted_at IS NULL AND started_at + (time_limit_seconds + grace) < now()` and writes `submitted_at, score_percent=0, passed=false`. Also writes activity events.

**Practical effect of the bug:** abandoned exam attempts sit forever in the "open" state. A learner who started an exam, closed the tab, and never returned would have an open attempt indefinitely. This blocks the cooldown / max-attempts logic — `lib/learner/exam.ts:checkActiveAttempt()` rejects new exam starts when an active attempt exists.

**Local dev inventory:**
```
abandoned attempts (started > 60min ago, submitted_at IS NULL): 0
```

**Production query:**
```sql
SELECT count(*) AS abandoned_count, min(started_at) AS oldest, max(started_at) AS newest
FROM exam_attempts
WHERE submitted_at IS NULL
  AND started_at < now() - interval '60 minutes';
```

If `oldest` is meaningfully old (days/weeks), some learners have been blocked from starting a new exam by their own abandoned one this whole time.

**Recovery plan:**
1. After F2 fix deploys, the next minute's run sweeps the whole backlog. Idempotent.
2. **Customer-facing impact:** any learner who tried to start a fresh exam and was rejected with "active attempt exists" since first deploy. To find them: query above + cross-reference with any "tried to start exam" attempts in app logs. If those logs aren't structured, no way to enumerate — but after the cron catches up, those learners can simply retry.
3. Surface to support so they can proactively reach out to any learner who reported being stuck.

**Downstream incident risk:** **Medium.** No data corruption, no security exposure — just learner-facing UX brokenness. Recovers fully once cron runs.

---

## 4. `expire-listings` (daily 03:00 UTC) — flips `listed` → `paused` on listing_expires_at lapse

**What it does:** `UPDATE restaurants SET status='paused' WHERE status='listed' AND listing_expires_at < now()`.

**Same risk profile as `expire-subscriptions`:** if any read path treats `status='listed'` as authoritative without also gating on `listing_expires_at >= now()`, expired listings stay public on the directory.

**Local dev inventory:** `0`.

**Production query:**
```sql
SELECT id, slug, name, listing_expires_at
FROM restaurants
WHERE status = 'listed'
  AND listing_expires_at IS NOT NULL
  AND listing_expires_at < now();
```

**Downstream incident risk:** **Low-Medium.** A restaurant whose listing window expired remains visible in the public directory until the cron runs. Customer trust depends on listing currency, but no safety claim is being made by mere visibility — the cert badge has its own freshness signal that *is* correctly enforced via `getCertStatus`.

---

## 5. `digest-reviewer-queue` (daily 09:00 UTC) — emails reviewer team about stale submissions

**Effect of bug:** reviewer team has not received daily queue digests. Submissions languish without operational visibility. Reviewers may discover queue items only via the admin UI when they happen to log in.

**Production query:**
```sql
SELECT count(*) FROM submissions
WHERE status IN ('pending','in_review','info_requested')
  AND created_at < now() - interval '7 days';
```

**Downstream incident risk:** **Low.** Operational delay only.

---

## 6. `weekly-admin-digest` (Mon 08:00 UTC) — emails per-restaurant admin a weekly summary

**Effect of bug:** admins have not received weekly summary emails. Soft service degradation.

**Production query:** N/A — this digest doesn't write state, only sends email.

**Downstream incident risk:** **Low.**

---

## Summary table — production-impact verdict

| Cron | Data drift today | Customer-facing impact | Recovery |
|---|---|---|---|
| expire-certs | None (state computed live) | Missing renewal-reminder emails | Auto-recovers with optional back-fill of cert_warnings to suppress backlog |
| expire-subscriptions | **POTENTIAL** active-past-ends_at rows | Possibly customers past billing still receiving service | Auto-recovers; **grep app for naked `status='active'` reads to confirm** |
| exam-timeout-sweep | Abandoned attempts blocking learners' new tries | Learners stuck on "active attempt exists" rejection | Auto-recovers next minute after deploy |
| expire-listings | Possibly stale `listed` rows past expiry window | Public directory shows expired listings | Auto-recovers; minor only |
| digest-reviewer-queue | None — email-only | Reviewers operating without daily queue digest | Auto-recovers next 09:00 UTC |
| weekly-admin-digest | None — email-only | Admins without weekly summary | Auto-recovers next Mon |

---

## Recommended sequence after F2 deploy

1. Deploy F2 fix (commit `a4edb07`) to production.
2. Run the **production-equivalent queries above** against the prod DB and capture row counts BEFORE the next scheduled cron runs. This is the definitive evidence of pre-fix drift.
3. **Audit code for `status='active'` and `status='listed'` naked reads** that don't also gate on `ends_at` / `listing_expires_at`. If any exist, that's a separate billing-correctness bug to triage.
4. For `expire-certs`, decide: let the morning's run fire the full warning-email backlog, or pre-populate `cert_warnings` to suppress. Recommendation: pre-populate, because three near-simultaneous "your cert expires in N days" emails to the same learner is bad UX.
5. Manually trigger `expire-subscriptions` and `exam-timeout-sweep` immediately after deploy to bring state current rather than waiting up to 24h / 1m. Both are idempotent.
6. Surface to support: any learner who reported "can't start exam" issues can now retry. Email them proactively if support has the list.
7. Surface to product/finance: any customer with active-past-ends_at subscription needs a billing decision (charge for gap or absorb).

---

## Outstanding question — when did F2 first appear?

`git log --oneline middleware.ts` would establish the first commit that introduced the API-prefix 401 branch. If middleware predates `vercel.json` cron config, F2 has been live since cron schedules went online. If `vercel.json` predates the middleware change, there's a window when crons did run before the regression. Without that timeline, the "how long has this been broken" question is open. Worth answering before assigning incident severity.
