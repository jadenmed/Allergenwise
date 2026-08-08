-- AllergenWise — One learner, one current certificate (T-49)
-- Migration: 0027_duplicate_cert_preflight.sql
-- Idempotent: reads only. Creates nothing, changes nothing, deletes nothing.
--             Re-running against a clean database is a no-op.
--
-- WHAT WAS BROKEN
-- ───────────────
-- `checkCooldown` (lib/learner/exam.ts) gated on three submitted attempts and a
-- 24h wait after a FAILURE. Its cooldown branch is `if (!lastPassed)`, so a
-- learner who PASSED fell straight through to `canAttempt: true`, and
-- /api/exam/submit issued a certificate on every pass. Pass twice, hold two
-- certificates.
--
-- That over-bills. The Checkout Session in /api/submissions/create is priced
-- CERT_FEE_CENTS × pendingCertCount, and pendingCertCount counts certificate
-- ROWS (lib/admin/eligibility.ts) — correctly, because rows are exactly what
-- the cert-fee webhook's activation UPDATE touches. Two pending rows for one
-- person is $70 to certify one person.
--
-- WHY THIS MIGRATION ADDS NO UNIQUE INDEX
-- ───────────────────────────────────────
-- The obvious fix — a partial unique index on (profile_id) — was considered and
-- rejected. It does not work here, for two independently fatal reasons:
--
--   1. `unique (profile_id) where status='active'` BREAKS ACTIVATION FOR
--      EVERYONE. The cert-fee webhook activates a restaurant's pending
--      certificates in ONE statement (`UPDATE … WHERE status='pending'`), and
--      that single-statement shape is exactly what makes Stripe redelivery
--      idempotent (T-41b, T-48). A 23505 raised anywhere in it aborts the WHOLE
--      statement — so at a restaurant that has already paid, NOBODY gets
--      activated, and Stripe retries into the same wall until it gives up.
--
--   2. Including `pending` MISREPORTS ITSELF. The insert lives inside a
--      collision-retry loop (lib/learner/issue-certificate.ts) that reads every
--      23505 as a cert-code collision. A duplicate-holder violation would burn
--      the retry budget and then write `cert_issuance_retry_exhausted` — an ops
--      signal whose documented meaning is "the entropy source is broken",
--      pointing at a bug that is nothing of the kind.
--
-- The guard therefore lives upstream, in application code, at three layers:
-- /api/exam/start (refuses entry), /api/exam/submit (refuses submission), and
-- issueCertificateForPassedExam (refuses issuance — the layer a future caller
-- cannot skip, because it sits inside the only code that inserts the row).
--
-- What remains for the database to do is REPORT. Same posture as 0023 and 0024:
-- fail early and NAME the rows rather than leave a silent inconsistency for
-- someone to trip over later.
--
-- WHY IT REPORTS AND DOES NOT REPAIR
-- ──────────────────────────────────
-- Every row named below is a billing record for money a restaurant has already
-- been charged, or is about to be. Deciding which of two certificates survives —
-- and whether the surplus fee is refunded, credited, or was never captured — is
-- a human call with an invoice attached. A schema migration does not get to make
-- it, and must not paper over it by deleting the evidence.

-- ─── Pre-flight: one current certificate per learner ─────────────────────────
-- "Current" is the same predicate lib/admin/eligibility.ts uses for "this
-- learner has passed the exam", and the same one lib/learner/cert-state.ts
-- applies in `blocksNewCertIssuance`: status IN ('pending','active') AND
-- expires_at > now().
--
-- The three excluded states are excluded on purpose, not by oversight:
--   - `expired`  → retaking the exam IS the renewal flow; a learner may hold
--                  any number of lapsed certificates from prior years.
--   - `revoked`  → does not count toward eligibility, so the learner must be
--                  able to earn a fresh one.
--   - `disputed` → same.
-- A learner with one active certificate and four expired ones is correct data
-- and must not be reported.
--
-- errcode is `data_exception`, deliberately NOT `unique_violation`: there is no
-- unique index here and there must not appear to be one. Anyone grepping for
-- what raised this should land on this file, not go hunting for a constraint
-- that does not exist.

do $$
declare
  dup_groups int;
  dup_rows   int;
  dup_list   text;
begin
  select
      count(*),
      coalesce(sum(c), 0),
      coalesce(string_agg(profile_id::text || ' (x' || c::text || ': ' || codes || ')', ', '
               order by profile_id::text), '')
    into dup_groups, dup_rows, dup_list
    from (
      select
          profile_id,
          count(*)                                                       as c,
          string_agg(cert_code || '/' || status, ', ' order by issued_at) as codes
        from certificates
       where status in ('pending', 'active')
         and expires_at > now()
       group by profile_id
      having count(*) > 1
    ) d;

  if dup_groups > 0 then
    raise exception
      'migration 0027: % learner(s) hold more than one current certificate (% rows total): %',
      dup_groups, dup_rows, dup_list
      using
        errcode = 'data_exception',
        hint    = 'Resolve by hand before re-running. For each learner keep the EARLIEST issued_at certificate and revoke the surplus, then refund or credit the extra cert fee — /api/submissions/create charged CERT_FEE_CENTS per pending row. Do NOT delete certificate rows: they are billing records. Nothing else in this migration depends on the result, so a failure here blocks no schema change.';
  end if;
end $$;
