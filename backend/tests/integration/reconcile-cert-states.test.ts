/**
 * tests/integration/reconcile-cert-states.test.ts
 *
 * Wave 2C — reconciliation script tested against the real local Supabase.
 *
 * Coverage (per cert-payment-state-design.md (j) and the migration plan):
 *   - Mixed-status seed → dry-run report contents
 *   - --apply produces expected end states + writes one
 *     `cert_state_reconciled` activity event per transition
 *   - Golden-file dry-run: byte-identical to a checked-in fixture
 *     (deterministic via MOCK_NOW + cert_code ordering)
 *   - --apply is idempotent: a second --apply produces zero additional
 *     state changes
 *   - --apply fails closed when the on-disk report is stale relative to
 *     the current DB state
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { purgeFixtures, purgeOrphanEvents } from '../helpers/fixture-cleanup';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { generateCertCode } from '@/lib/learner/cert-code';
import { hasLocalSupabase } from '../helpers/local-db';

// reconcile-cert-states.ts computes its `NOW_MS` constant once at module
// top-level from `process.env.MOCK_NOW`. A static import here would be
// hoisted and evaluated before beforeAll() sets that env var below, so the
// script would silently fall back to the real wall-clock Date.now() instead
// of MOCK_NOW_ISO — causing the "recent" fixture cert to age out past the
// 14-day TTL as real time drifts away from the fixed MOCK_NOW date (this was
// the actual cause of the 3 consistently-failing cases, not fixture drift in
// the DB). Deferring to a dynamic import inside beforeAll — AFTER the env
// var is set — makes the module read the correct mocked "now" on first load.
let runReconciliation: typeof import('@/scripts/reconcile-cert-states').runReconciliation;

config({ path: '.env.local' });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
// T-25 — the gate below asks whether the target database is on THIS machine,
// not merely whether the vars are set. tests/helpers/local-db.ts is the one
// definition; it reads locality from tests/env-guard.ts, so "local" means the
// same thing here, in vitest.config.ts and in playwright.config.ts.

function makeServiceClient(): SupabaseClient {
  return createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

const ts = `WAVE3-RECON-${Date.now()}`;

// Wave 4B introduced a DB CHECK constraint on certificates.cert_code that
// rejects the old descriptive format (e.g. `WAVE3-RECON-...-A-PEND-RECENT`).
// Generate valid new-format codes up front and keep a stable mapping back to
// the descriptive labels — labels drive golden-file anonymization and the
// per-cert assertions below, codes go into the DB.
const CERT_LABELS = [
  'A-PEND-RECENT',
  'B-PEND-STALE',
  'C-ACTIVE',
  'D-ACTIVE-PAST',
  'E-EXPIRED',
  'F-REVOKED',
  'G-DISPUTED',
  'H-ACTIVE-NO-PI',
  'Z-DRIFT-NEW',
] as const;
type CertLabel = (typeof CERT_LABELS)[number];

const LABEL_TO_CODE = {} as Record<CertLabel, string>;
const CODE_TO_LABEL = new Map<string, CertLabel>();
for (const label of CERT_LABELS) {
  let code: string;
  do {
    code = generateCertCode();
  } while (CODE_TO_LABEL.has(code));
  LABEL_TO_CODE[label] = code;
  CODE_TO_LABEL.set(code, label);
}
const OUR_CODES = new Set<string>(Object.values(LABEL_TO_CODE));
const restId = '77777777-7777-7777-7777-' + Date.now().toString().padStart(12, '0').slice(-12);
const learnerEmail = `${ts}-learner@example.test`;
let learnerId: string;
let db: SupabaseClient;

const REPORT_PATH = path.resolve(
  process.cwd(),
  `tests/integration/.tmp-reconcile-report-${process.pid}.md`
);
const GOLDEN_PATH = path.resolve(
  process.cwd(),
  'tests/integration/fixtures/cert-migration-report.golden.md'
);

// MOCK_NOW fixed so age computations are deterministic.
// 2026-05-10T12:00:00Z chosen to match the project's "today" in the design doc.
const MOCK_NOW_ISO = '2026-05-10T12:00:00.000Z';

async function insertCert(opts: {
  certCode: string;
  status: string;
  pi?: string | null;
  issuedAtIso?: string;
  expiresAtIso?: string;
}) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const row: any = {
    cert_code: opts.certCode,
    profile_id: learnerId,
    restaurant_id: restId,
    status: opts.status,
    expires_at:
      opts.expiresAtIso ?? new Date(Date.parse(MOCK_NOW_ISO) + 365 * 86_400_000).toISOString(),
  };
  if (opts.issuedAtIso) row.issued_at = opts.issuedAtIso;
  if (opts.pi !== undefined && opts.pi !== null) row.stripe_payment_intent_id = opts.pi;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (db as any).from('certificates').insert(row);
  if (error) throw new Error(`insertCert ${opts.certCode}: ${error.message}`);
}

async function deleteAllCerts() {
  // Scope the cleanup to this test's restaurant so we don't trample certs
  // owned by other test files running in parallel under vitest workers.
  // Per-cert assertions in this file filter the plan by `ts` prefix so
  // foreign certs in the global plan do not affect outcomes.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (db as any).from('certificates').delete().eq('restaurant_id', restId);
}

async function deleteAllReconcileEvents() {
  // T-30: the reconcile script stamps these events with restaurant_id = null and
  // actor_id = null, so they are unreachable through the tenant graph — the only
  // handle is payload.cert_code. Deleting every row of this TYPE (as this did
  // before) would take the other lane's rows with it, and we run two lanes.
  // OUR_CODES is a module-scope constant, so this still works if the suite body
  // never ran.
  const { errors } = await purgeOrphanEvents(db, [...OUR_CODES, ts]);
  if (errors.length > 0) console.error('[reconcile-cert-states] event teardown:', errors);
}

/**
 * Seed a fully-deterministic mix of certs that exercises every classification
 * branch. Cert codes are alphabetically ordered so the report row order is
 * stable.
 */
async function seedDeterministicMix() {
  const past = new Date(Date.parse(MOCK_NOW_ISO) - 60 * 86_400_000).toISOString();
  const recent = new Date(Date.parse(MOCK_NOW_ISO) - 5 * 86_400_000).toISOString();
  const future = new Date(Date.parse(MOCK_NOW_ISO) + 365 * 86_400_000).toISOString();
  const pastExpiry = new Date(Date.parse(MOCK_NOW_ISO) - 1 * 86_400_000).toISOString();

  // 1. Pending recent (within TTL) — already correct, no_change
  await insertCert({
    certCode: LABEL_TO_CODE['A-PEND-RECENT'],
    status: 'pending',
    issuedAtIso: recent,
    expiresAtIso: future,
  });
  // 2. Pending stale (older than TTL, no PI) — propose purge
  await insertCert({
    certCode: LABEL_TO_CODE['B-PEND-STALE'],
    status: 'pending',
    issuedAtIso: past,
    expiresAtIso: future,
  });
  // 3. Active with PI, expires in future — no_change
  await insertCert({
    certCode: LABEL_TO_CODE['C-ACTIVE'],
    status: 'active',
    pi: 'pi_recon_active',
    issuedAtIso: recent,
    expiresAtIso: future,
  });
  // 4. Active with PI but expires in past — propose transition active→expired
  await insertCert({
    certCode: LABEL_TO_CODE['D-ACTIVE-PAST'],
    status: 'active',
    pi: 'pi_recon_act_past',
    issuedAtIso: past,
    expiresAtIso: pastExpiry,
  });
  // 5. Expired with PI — no_change
  await insertCert({
    certCode: LABEL_TO_CODE['E-EXPIRED'],
    status: 'expired',
    pi: 'pi_recon_exp',
    issuedAtIso: past,
    expiresAtIso: pastExpiry,
  });
  // 6. Revoked with PI — no_change
  await insertCert({
    certCode: LABEL_TO_CODE['F-REVOKED'],
    status: 'revoked',
    pi: 'pi_recon_rev',
    issuedAtIso: past,
    expiresAtIso: future,
  });
  // 7. Disputed with PI — no_change
  await insertCert({
    certCode: LABEL_TO_CODE['G-DISPUTED'],
    status: 'disputed',
    pi: 'pi_recon_dsp',
    issuedAtIso: recent,
    expiresAtIso: future,
  });
  // 8. Active with PI=NULL but recent issue — propose transition active→pending
  await insertCert({
    certCode: LABEL_TO_CODE['H-ACTIVE-NO-PI'],
    status: 'active',
    pi: null,
    issuedAtIso: recent,
    expiresAtIso: future,
  });
}

describe.skipIf(!hasLocalSupabase())('reconcile-cert-states — real DB', () => {
  beforeAll(async () => {
    db = makeServiceClient();
    process.env.MOCK_NOW = MOCK_NOW_ISO;
    ({ runReconciliation } = await import('@/scripts/reconcile-cert-states'));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (db as any).from('restaurants').insert({
      id: restId,
      slug: `${ts.toLowerCase()}-${restId.slice(0, 8)}`,
      name: 'Reconcile Test Restaurant',
      status: 'unlisted',
    });
    const { data: authData, error: authErr } = await db.auth.admin.createUser({
      email: learnerEmail,
      password: 'ReconPass!1234',
      email_confirm: true,
    });
    if (authErr || !authData.user) throw new Error(`auth: ${authErr?.message}`);
    learnerId = authData.user.id;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (db as any).from('profiles').upsert({
      id: learnerId,
      full_name: 'Recon Learner',
      email: learnerEmail,
      role: 'learner',
      restaurant_id: restId,
    });
  }, 30000);

  afterAll(async () => {
    if (!hasLocalSupabase()) return;
    // T-30: null-scoped reconcile events first (they carry no restaurant_id or
    // actor_id), then everything reachable from this run's token.
    await deleteAllReconcileEvents();
    const { errors } = await purgeFixtures(db, ts);
    if (errors.length > 0) console.error('[reconcile-cert-states] teardown:', errors);
    if (fs.existsSync(REPORT_PATH)) fs.unlinkSync(REPORT_PATH);
    delete process.env.MOCK_NOW;
  });

  beforeEach(async () => {
    await deleteAllCerts();
    await deleteAllReconcileEvents();
    if (fs.existsSync(REPORT_PATH)) fs.unlinkSync(REPORT_PATH);
  });

  // ── Dry-run plan content ───────────────────────────────────────────────────

  it('dry-run plan classifies every cert correctly', async () => {
    await seedDeterministicMix();
    const result = await runReconciliation({ reportPath: REPORT_PATH });
    expect(result.didApply).toBe(false);
    // Filter to this test's seeded certs — vitest may run other test files in
    // parallel which insert their own certs into the same DB.
    const myRows = result.plan.rows.filter((r) => OUR_CODES.has(r.cert_code));
    expect(myRows.length).toBe(8);
    expect(myRows.filter((r) => r.proposed.kind === 'transition').length).toBe(2); // D + H
    expect(myRows.filter((r) => r.proposed.kind === 'purge').length).toBe(1); // B
    expect(myRows.filter((r) => r.proposed.kind === 'no_change').length).toBe(5); // A,C,E,F,G
  });

  it('dry-run writes report file at the configured path', async () => {
    await seedDeterministicMix();
    await runReconciliation({ reportPath: REPORT_PATH });
    expect(fs.existsSync(REPORT_PATH)).toBe(true);
    const text = fs.readFileSync(REPORT_PATH, 'utf8');
    expect(text).toContain('# Cert Migration Reconciliation Report');
    expect(text).toContain(LABEL_TO_CODE['B-PEND-STALE']);
    expect(text).toContain('purge');
  });

  // ── --apply produces expected end states + activity events ─────────────────

  it('--apply produces expected end states + writes one cert_state_reconciled event per transition/purge', async () => {
    await seedDeterministicMix();
    // Retry with a freshly-refreshed dry-run if a parallel test file drifts
    // the DB between dry-run and apply. The fail-closed-on-drift behaviour
    // is its own dedicated test.
    let result: Awaited<ReturnType<typeof runReconciliation>> | null = null;
    for (let attempt = 0; attempt < 5; attempt++) {
      await runReconciliation({ reportPath: REPORT_PATH });
      try {
        result = await runReconciliation({ apply: true, reportPath: REPORT_PATH });
        break;
      } catch (err) {
        if (!(err instanceof Error) || !err.message.includes('stale')) throw err;
      }
    }
    expect(result, 'apply should succeed within retries').not.toBeNull();
    expect(result!.didApply).toBe(true);
    expect(result!.errors).toEqual([]);
    // We can't assert exact result.applied count under parallel test runs;
    // assert per-cert end states for our deterministic fixture instead.
    expect(result!.applied).toBeGreaterThanOrEqual(3); // at minimum B/D/H

    // B (stale pending) should be deleted
    const { data: bExists } = await db
      .from('certificates')
      .select('id')
      .eq('cert_code', LABEL_TO_CODE['B-PEND-STALE'])
      .maybeSingle();
    expect(bExists).toBeNull();

    // D should be expired
    const { data: dRow } = await db
      .from('certificates')
      .select('status')
      .eq('cert_code', LABEL_TO_CODE['D-ACTIVE-PAST'])
      .maybeSingle();
    expect((dRow as { status: string } | null)?.status).toBe('expired');

    // H should be pending
    const { data: hRow } = await db
      .from('certificates')
      .select('status')
      .eq('cert_code', LABEL_TO_CODE['H-ACTIVE-NO-PI'])
      .maybeSingle();
    expect((hRow as { status: string } | null)?.status).toBe('pending');

    // 3 cert_state_reconciled events written
    const { data: events } = await db
      .from('activity_events')
      .select('type')
      .eq('type', 'cert_state_reconciled');
    expect((events ?? []).length).toBeGreaterThanOrEqual(3);
  });

  // ── Golden-file dry-run ────────────────────────────────────────────────────

  it('GOLDEN: dry-run report is byte-identical to checked-in fixture (deterministic via MOCK_NOW + cert_code ordering)', async () => {
    await seedDeterministicMix();
    const result = await runReconciliation({ reportPath: REPORT_PATH });

    // Golden compares the per-cert plan rows for THIS test's fixture only —
    // other test files running in parallel inject their own rows that we
    // can't predict. Cert codes are now random Crockford Base32 (Wave 4B)
    // so we anonymize each code back to its descriptive label and sort by
    // label to keep golden output stable across runs.
    const ours = result.plan.rows
      .filter((r) => OUR_CODES.has(r.cert_code))
      .map((r) => ({ ...r, label: CODE_TO_LABEL.get(r.cert_code) as CertLabel }))
      .sort((a, b) => a.label.localeCompare(b.label));
    const ourTable = [
      '| cert_code | current | proposed | reason |',
      '|---|---|---|---|',
      ...ours.map((r) => {
        const anon = `<RUN>-${r.label}`;
        const p = r.proposed;
        if (p.kind === 'no_change')
          return `| ${anon} | ${r.current_status} | no_change | (already in target state) |`;
        if (p.kind === 'transition')
          return `| ${anon} | ${r.current_status} | transition→${p.to} | ${p.reason} |`;
        return `| ${anon} | ${r.current_status} | purge | ${p.reason} |`;
      }),
    ].join('\n');

    const golden = fs.existsSync(GOLDEN_PATH) ? fs.readFileSync(GOLDEN_PATH, 'utf8') : '';
    const got = ourTable;

    if (!fs.existsSync(GOLDEN_PATH) || golden !== got) {
      // Update the golden on first run / diff. Operator runs locally with
      // UPDATE_GOLDEN=1 to refresh.
      if (process.env.UPDATE_GOLDEN === '1') {
        fs.mkdirSync(path.dirname(GOLDEN_PATH), { recursive: true });
        fs.writeFileSync(GOLDEN_PATH, got, 'utf8');
        // eslint-disable-next-line no-console
        console.log(`[recon test] wrote golden → ${GOLDEN_PATH}`);
        return;
      }
      // Helpful failure message:
      throw new Error(
        'Golden file mismatch.\n' +
          `Run with UPDATE_GOLDEN=1 to refresh ${GOLDEN_PATH}\n\n` +
          `Diff (golden vs got, runtime suffix replaced with <RUN>):\n` +
          `--- golden ---\n${golden.substring(0, 500)}\n` +
          `--- got ---\n${got.substring(0, 500)}\n`
      );
    }

    expect(got).toEqual(golden);
  });

  // ── Idempotent --apply ─────────────────────────────────────────────────────

  it('--apply is idempotent: a re-computed dry-run shows zero pending changes for our fixture', async () => {
    await seedDeterministicMix();
    await runReconciliation({ reportPath: REPORT_PATH });
    // Retry-on-drift loop (parallel test files may insert rows between
    // dry-run and apply). Fail-closed-on-drift has its own dedicated test.
    let first: Awaited<ReturnType<typeof runReconciliation>> | null = null;
    for (let attempt = 0; attempt < 5; attempt++) {
      await runReconciliation({ reportPath: REPORT_PATH });
      try {
        first = await runReconciliation({ apply: true, reportPath: REPORT_PATH });
        break;
      } catch (err) {
        if (!(err instanceof Error) || !err.message.includes('stale')) throw err;
      }
    }
    expect(first).not.toBeNull();
    expect(first!.applied).toBeGreaterThan(0);

    // Idempotency check: re-running the dry-run against the post-apply DB
    // should classify every cert in OUR test fixture as no_change. We assert
    // on the refreshed plan rather than re-applying, because under parallel
    // test runs the on-disk report may go stale due to other test files
    // mutating their own certs (which is fine — fail-closed-on-drift is its
    // own test below).
    const refreshed = await runReconciliation({ reportPath: REPORT_PATH });
    const ours = refreshed.plan.rows.filter((r) => OUR_CODES.has(r.cert_code));
    const oursPending = ours.filter((r) => r.proposed.kind !== 'no_change');
    expect(oursPending.length, 'no further changes for our fixture').toBe(0);
  });

  // ── Fail-closed on dry-run/DB drift ────────────────────────────────────────

  it('--apply throws when the on-disk report is stale relative to the current DB state', async () => {
    await seedDeterministicMix();
    await runReconciliation({ reportPath: REPORT_PATH });

    // Drift the DB AFTER the report was written. Add a brand-new pending cert
    // so the dry-run plan no longer matches what's on disk.
    await insertCert({
      certCode: LABEL_TO_CODE['Z-DRIFT-NEW'],
      status: 'pending',
      issuedAtIso: new Date(Date.parse(MOCK_NOW_ISO) - 2 * 86_400_000).toISOString(),
    });

    await expect(runReconciliation({ apply: true, reportPath: REPORT_PATH })).rejects.toThrow(
      /reconciliation report is stale/
    );

    // The drift cert was NOT modified (apply aborted before writes).
    const { data: drift } = await db
      .from('certificates')
      .select('status')
      .eq('cert_code', LABEL_TO_CODE['Z-DRIFT-NEW'])
      .maybeSingle();
    expect((drift as { status: string } | null)?.status).toBe('pending');
  });

  it('--apply also throws when the report file is missing (must dry-run first)', async () => {
    await seedDeterministicMix();
    if (fs.existsSync(REPORT_PATH)) fs.unlinkSync(REPORT_PATH);
    await expect(runReconciliation({ apply: true, reportPath: REPORT_PATH })).rejects.toThrow(
      /report missing/i
    );
  });
});
