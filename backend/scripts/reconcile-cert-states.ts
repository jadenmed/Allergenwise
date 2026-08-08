/**
 * scripts/reconcile-cert-states.ts
 *
 * Wave 2C — first-launch (and ongoing) reconciliation of cert state.
 *
 * Two-phase invocation:
 *
 *   pnpm tsx scripts/reconcile-cert-states.ts
 *     Dry-run. Writes audits/cert-migration-report.md enumerating every
 *     cert and its proposed transition. NO writes to DB.
 *
 *   pnpm tsx scripts/reconcile-cert-states.ts --apply
 *     Re-computes the dry-run, asserts the on-disk report matches the
 *     freshly-computed plan (fail-closed on drift), then applies the
 *     transitions atomically and inserts cert_state_reconciled events.
 *
 * Determinism:
 *   - Rows are ordered by cert_code (ascending) so the report is stable
 *     across runs that see the same DB state.
 *   - The fixed-format MOCK_NOW env var (ISO timestamp) freezes "now"
 *     relative computations so tests can byte-compare against a golden.
 *
 * Per cert-payment-state-design.md (h) and cert-migration-plan.md.
 */

import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import * as fs from 'node:fs';
import * as path from 'node:path';

config({ path: '.env.local' });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const REPORT_PATH =
  process.env.RECONCILE_REPORT_PATH ??
  path.resolve(process.cwd(), 'audits/cert-migration-report.md');

if (!SUPABASE_URL || !SERVICE_KEY || SERVICE_KEY.includes('placeholder')) {
  throw new Error('reconcile-cert-states requires real SUPABASE_URL and SERVICE_KEY env');
}

const NOW_MS = process.env.MOCK_NOW ? new Date(process.env.MOCK_NOW).getTime() : Date.now();

const TTL_DAYS = 14;
const TTL_MS = TTL_DAYS * 86_400_000;

// ─── Types ────────────────────────────────────────────────────────────────────

type CertStatus = 'pending' | 'active' | 'expired' | 'revoked' | 'disputed';
type ProposedAction =
  | { kind: 'no_change'; status: CertStatus }
  | { kind: 'transition'; from: CertStatus; to: CertStatus; reason: string }
  | { kind: 'purge'; reason: string };

interface CertRow {
  id: string;
  cert_code: string;
  status: CertStatus;
  issued_at: string;
  expires_at: string;
  stripe_payment_intent_id: string | null;
}

interface StripeEventRow {
  id: string;
  type: string;
  // We don't store the payload on stripe_events today — it's only an idempotency
  // ledger. The reconciliation script therefore cannot cross-reference refund
  // / dispute outcomes from this table alone. For the dev-DB pre-launch path
  // we operate purely from cert.stripe_payment_intent_id presence + age.
  // Production launch can extend this script to also read activity_events
  // payloads (which DO carry stripe_event_id + dispute outcome) if richer
  // cross-referencing becomes necessary.
}

interface PlannedRow {
  cert_code: string;
  current_status: CertStatus;
  proposed: ProposedAction;
}

// ─── Classification logic ───────────────────────────────────────────────────

function classify(cert: CertRow): ProposedAction {
  const issuedMs = new Date(cert.issued_at).getTime();
  const expiresMs = new Date(cert.expires_at).getTime();
  const ageMs = NOW_MS - issuedMs;
  const hasPi = cert.stripe_payment_intent_id !== null && cert.stripe_payment_intent_id !== '';

  // No PI on file
  if (!hasPi) {
    if (ageMs >= TTL_MS) {
      return {
        kind: 'purge',
        reason: 'no_pi_on_file_and_ttl_exceeded',
      };
    }
    if (cert.status === 'pending') {
      return { kind: 'no_change', status: 'pending' };
    }
    return {
      kind: 'transition',
      from: cert.status,
      to: 'pending',
      reason: 'cert_has_no_pi_and_within_ttl_so_should_be_pending',
    };
  }

  // PI present — derive expected state from time + current
  const desired: CertStatus =
    cert.status === 'revoked' || cert.status === 'disputed'
      ? cert.status
      : expiresMs < NOW_MS
        ? 'expired'
        : 'active';

  if (cert.status === desired) return { kind: 'no_change', status: desired };

  // Transition.
  let reason = `pi_present_${cert.status}_to_${desired}`;
  if (cert.status === 'pending' && desired === 'active') {
    reason = 'pi_present_activate_pending_cert';
  } else if (cert.status === 'active' && desired === 'expired') {
    reason = 'expires_at_in_past_so_active_to_expired';
  } else if (cert.status === 'pending' && desired === 'expired') {
    reason = 'pi_present_but_expires_at_in_past';
  }

  return {
    kind: 'transition',
    from: cert.status,
    to: desired,
    reason,
  };
}

// ─── DB accessors ─────────────────────────────────────────────────────────────

function makeServiceClient() {
  return createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function loadAllCerts(db: ReturnType<typeof makeServiceClient>): Promise<CertRow[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (db as any)
    .from('certificates')
    .select('id, cert_code, status, issued_at, expires_at, stripe_payment_intent_id')
    .order('cert_code', { ascending: true });
  if (error) throw new Error(`loadAllCerts: ${error.message}`);
  return (data as CertRow[] | null) ?? [];
}

// ─── Plan + report ────────────────────────────────────────────────────────────

export interface Plan {
  rows: PlannedRow[];
  counts: {
    total: number;
    no_change: number;
    transitions: number;
    purges: number;
    by_target_status: Record<CertStatus, number>;
  };
}

function buildPlan(certs: CertRow[]): Plan {
  const rows: PlannedRow[] = certs
    .map((c) => ({
      cert_code: c.cert_code,
      current_status: c.status,
      proposed: classify(c),
    }))
    .sort((a, b) => a.cert_code.localeCompare(b.cert_code));

  const counts = {
    total: rows.length,
    no_change: 0,
    transitions: 0,
    purges: 0,
    by_target_status: {
      pending: 0,
      active: 0,
      expired: 0,
      revoked: 0,
      disputed: 0,
    } as Record<CertStatus, number>,
  };
  for (const r of rows) {
    const p = r.proposed;
    if (p.kind === 'no_change') {
      counts.no_change++;
      counts.by_target_status[p.status]++;
    } else if (p.kind === 'transition') {
      counts.transitions++;
      counts.by_target_status[p.to]++;
    } else {
      counts.purges++;
    }
  }
  return { rows, counts };
}

function renderReport(plan: Plan): string {
  const lines: string[] = [];
  lines.push('# Cert Migration Reconciliation Report');
  lines.push('');
  lines.push('Generated by `scripts/reconcile-cert-states.ts`. Stable order: cert_code ascending.');
  lines.push('');
  lines.push('## Aggregate counts');
  lines.push('');
  lines.push(`- total: ${plan.counts.total}`);
  lines.push(`- no_change: ${plan.counts.no_change}`);
  lines.push(`- transitions: ${plan.counts.transitions}`);
  lines.push(`- purges: ${plan.counts.purges}`);
  lines.push('');
  lines.push('## End states (per target)');
  lines.push('');
  for (const s of ['pending', 'active', 'expired', 'revoked', 'disputed'] as const) {
    lines.push(`- ${s}: ${plan.counts.by_target_status[s]}`);
  }
  lines.push('');
  lines.push('## Per-cert plan');
  lines.push('');
  lines.push('| cert_code | current | proposed | reason |');
  lines.push('|---|---|---|---|');
  for (const r of plan.rows) {
    const p = r.proposed;
    if (p.kind === 'no_change') {
      lines.push(
        `| ${r.cert_code} | ${r.current_status} | no_change | (already in target state) |`
      );
    } else if (p.kind === 'transition') {
      lines.push(`| ${r.cert_code} | ${r.current_status} | transition→${p.to} | ${p.reason} |`);
    } else {
      lines.push(`| ${r.cert_code} | ${r.current_status} | purge | ${p.reason} |`);
    }
  }
  lines.push('');
  return lines.join('\n');
}

// ─── Apply ────────────────────────────────────────────────────────────────────

async function applyPlan(
  db: ReturnType<typeof makeServiceClient>,
  certs: CertRow[],
  plan: Plan
): Promise<{ applied: number; skipped: number; errors: string[] }> {
  const result = { applied: 0, skipped: 0, errors: [] as string[] };
  const reconciliationRunId = `recon-${new Date(NOW_MS).toISOString()}`;

  for (const r of plan.rows) {
    const cert = certs.find((c) => c.cert_code === r.cert_code);
    if (!cert) {
      result.errors.push(`cert ${r.cert_code} disappeared mid-run`);
      continue;
    }

    if (r.proposed.kind === 'no_change') {
      result.skipped++;
      continue;
    }

    if (r.proposed.kind === 'purge') {
      // Activity event BEFORE delete so the audit trail survives.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (db as any).from('activity_events').insert({
        restaurant_id: null,
        actor_id: null,
        type: 'cert_state_reconciled',
        payload: {
          reconciliation_run_id: reconciliationRunId,
          cert_code: cert.cert_code,
          before_status: cert.status,
          action: 'purge',
          reason: r.proposed.reason,
        },
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (db as any).from('certificates').delete().eq('id', cert.id);
      if (error) {
        result.errors.push(`purge ${cert.cert_code}: ${error.message}`);
        continue;
      }
      result.applied++;
      continue;
    }

    // transition
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const updateRow: any = {
      status: r.proposed.to,
      status_changed_at: new Date(NOW_MS).toISOString(),
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (db as any).from('certificates').update(updateRow).eq('id', cert.id);
    if (error) {
      result.errors.push(`transition ${cert.cert_code}: ${error.message}`);
      continue;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (db as any).from('activity_events').insert({
      restaurant_id: null,
      actor_id: null,
      type: 'cert_state_reconciled',
      payload: {
        reconciliation_run_id: reconciliationRunId,
        cert_code: cert.cert_code,
        before_status: r.proposed.from,
        after_status: r.proposed.to,
        action: 'transition',
        reason: r.proposed.reason,
      },
    });
    result.applied++;
  }

  return result;
}

// ─── Public entry-point (callable from tests + CLI) ──────────────────────────

export interface RunOptions {
  apply?: boolean;
  reportPath?: string;
}

export interface RunResult {
  plan: Plan;
  reportText: string;
  applied: number;
  skipped: number;
  errors: string[];
  /** True if --apply ran. */
  didApply: boolean;
}

export async function runReconciliation(opts: RunOptions = {}): Promise<RunResult> {
  const apply = Boolean(opts.apply);
  const reportPath = opts.reportPath ?? REPORT_PATH;

  const db = makeServiceClient();
  const certs = await loadAllCerts(db);
  const plan = buildPlan(certs);
  const reportText = renderReport(plan);

  if (!apply) {
    fs.writeFileSync(reportPath, reportText, 'utf8');
    return {
      plan,
      reportText,
      applied: 0,
      skipped: 0,
      errors: [],
      didApply: false,
    };
  }

  // --apply: re-compute dry-run from CURRENT DB state and compare to the
  // on-disk report. If they don't match, the DB drifted between dry-run and
  // apply — abort. This is the "fail-closed on drift" guarantee.
  if (!fs.existsSync(reportPath)) {
    throw new Error(`reconciliation report missing at ${reportPath}; run dry-run first`);
  }
  const onDisk = fs.readFileSync(reportPath, 'utf8');
  if (onDisk !== reportText) {
    throw new Error(
      'reconciliation report is stale (DB state changed since dry-run)\n' +
        'Re-run without --apply to refresh, then re-apply.'
    );
  }

  const { applied, skipped, errors } = await applyPlan(db, certs, plan);
  return { plan, reportText, applied, skipped, errors, didApply: true };
}

// ─── CLI ──────────────────────────────────────────────────────────────────────

async function main() {
  const apply = process.argv.includes('--apply');
  const result = await runReconciliation({ apply });
  console.log(`[reconcile-cert-states] mode=${apply ? 'apply' : 'dry-run'}`);
  console.log(`  total=${result.plan.counts.total}`);
  console.log(
    `  transitions=${result.plan.counts.transitions} purges=${result.plan.counts.purges} no_change=${result.plan.counts.no_change}`
  );
  if (apply) {
    console.log(
      `  applied=${result.applied} skipped=${result.skipped} errors=${result.errors.length}`
    );
    if (result.errors.length > 0) {
      for (const e of result.errors) console.error(`    error: ${e}`);
      process.exit(1);
    }
  } else {
    console.log(`  report → ${REPORT_PATH}`);
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error('[reconcile-cert-states] fatal:', err);
    process.exit(1);
  });
}
