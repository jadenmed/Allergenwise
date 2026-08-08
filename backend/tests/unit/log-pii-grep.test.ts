/**
 * tests/unit/log-pii-grep.test.ts
 *
 * P1-8 regression guard — walks app/ + lib/ and fails when a
 * `console.<method>(...)` call contains a template-literal expression
 * that references a raw email or full-name identifier, unless that
 * expression is wrapped in maskEmail() / maskName() / emailHash() from
 * lib/security/mask-pii.
 *
 * Modeled on tests/unit/secure-random.test.ts.
 *
 * What it catches:
 *   console.error(`... ${user.email} ...`);          // bare email
 *   console.log(`... ${admin.full_name} ...`);       // bare full_name
 *   console.warn(`... to=${to} ...`);                // bare `to` recipient
 *
 * What it allows:
 *   console.error(`... ${maskEmail(user.email)} ...`);
 *   console.log(`... ${emailHash(admin.email)} ...`);
 *   console.warn(`... template=${templateName} ...`); // not a PII token
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';

const repoRoot = resolve(__dirname, '..', '..');

// Identifier-name fragments that, when they appear inside a `${...}`
// expression in a console.* call, indicate raw PII unless the expression
// is wrapped in an approved masking helper.
const PII_TOKEN_RE = /(email|Email|full_name|fullName|recipientName|adminName|learnerName)/;

// Approved wrappers — if the entire expression's outermost call is one
// of these, the expression is considered safely masked.
const APPROVED_WRAP_RE = /^\s*(?:maskEmail|maskName|emailHash)\s*\(/;

const SKIP_DIRS = new Set([
  'node_modules',
  '.next',
  '.git',
  'dist',
  'build',
  'coverage',
  '.turbo',
  '.vercel',
]);

// Files to skip — the helper definition + this test + the behavior test +
// the email-template *.tsx files, which legitimately render raw names /
// emails into the HTML body (those are not console.* logs).
const SKIP_FILE_BASENAMES = new Set(['mask-pii.ts', 'mask-pii.test.ts', 'log-pii-grep.test.ts']);

function walk(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const p = join(dir, entry);
    const s = statSync(p);
    if (s.isDirectory()) {
      walk(p, out);
      continue;
    }
    if (!/\.(ts|tsx)$/.test(entry)) continue;
    if (SKIP_FILE_BASENAMES.has(entry)) continue;
    out.push(p);
  }
}

/**
 * Best-effort scanner: find every `console.<method>(... );` call (across
 * lines), then enumerate `${...}` expressions inside the args. Returns
 * one offender string per unmasked PII expression.
 *
 * The console-call matcher uses `[\s\S]*?` and looks for `);` — adequate
 * for the well-formatted source in this repo. Refactor if a future
 * pattern breaks it (e.g. a `);` inside a string literal mid-call).
 */
function scanFile(path: string): string[] {
  const text = readFileSync(path, 'utf8');
  const offenders: string[] = [];

  const callRe = /console\.(?:log|info|warn|error|debug|trace)\(([\s\S]*?)\);/g;
  let cm: RegExpExecArray | null;
  while ((cm = callRe.exec(text)) !== null) {
    const callArgs = cm[1];

    // Pull each `${...}` expression. Inner `}` characters in expressions
    // are rare in this repo's logs; flag those if seen for follow-up.
    const exprRe = /\$\{([^}]+)\}/g;
    let em: RegExpExecArray | null;
    while ((em = exprRe.exec(callArgs)) !== null) {
      const rawExpr = em[1];
      const expr = rawExpr.trim();

      // (a) approved wrapper — call starts with maskEmail/maskName/emailHash
      if (APPROVED_WRAP_RE.test(expr)) continue;

      // (b) bare `to` identifier (the email-recipient parameter name used
      // in lib/email/send.ts and elsewhere)
      if (expr === 'to') {
        offenders.push(`${path}: console.* contains unmasked recipient \${${expr}}`);
        continue;
      }

      // (c) any expression referencing a PII identifier token
      if (PII_TOKEN_RE.test(expr)) {
        offenders.push(`${path}: console.* contains unmasked PII expression \${${expr}}`);
        continue;
      }
    }

    // Also flag positional `console.log('...', admin.email)` style calls
    // where a raw `<obj>.email` / `<obj>.full_name` is passed as a
    // standalone argument (not inside a template literal).
    //
    // Strategy: tokenize the call args at the top-level commas and check
    // each arg for `\.(email|full_name|fullName)` not wrapped in a mask
    // helper.
    for (const arg of splitTopLevelArgs(callArgs)) {
      const a = arg.trim();
      if (a.length === 0) continue;
      // Skip string literals entirely.
      if (a.startsWith("'") || a.startsWith('"') || a.startsWith('`')) continue;
      // Skip args that are themselves wrapped in an approved helper at top level.
      if (APPROVED_WRAP_RE.test(a)) continue;
      if (/\.(email|full_name|fullName)\b/.test(a)) {
        offenders.push(`${path}: console.* contains unmasked positional PII arg ${a}`);
      }
    }
  }

  return offenders;
}

/**
 * Split a string at top-level commas (depth-0 with respect to parens,
 * brackets, braces, and string literals). Used to scan positional args
 * of a console.* call without misreading commas inside nested calls.
 */
function splitTopLevelArgs(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let i = 0;
  let start = 0;
  let inStr: string | null = null;
  while (i < s.length) {
    const ch = s[i];
    if (inStr) {
      if (ch === '\\') {
        i += 2;
        continue;
      }
      if (ch === inStr) inStr = null;
      i++;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      inStr = ch;
      i++;
      continue;
    }
    if (ch === '(' || ch === '[' || ch === '{') depth++;
    else if (ch === ')' || ch === ']' || ch === '}') depth--;
    else if (ch === ',' && depth === 0) {
      out.push(s.slice(start, i));
      start = i + 1;
    }
    i++;
  }
  out.push(s.slice(start));
  return out;
}

describe('regression: no raw PII (emails / full names) in console.* calls', () => {
  it('no offenders under app/', () => {
    const files: string[] = [];
    walk(join(repoRoot, 'app'), files);
    const offenders = files.flatMap(scanFile);
    expect(offenders).toEqual([]);
  });

  it('no offenders under lib/', () => {
    const files: string[] = [];
    walk(join(repoRoot, 'lib'), files);
    const offenders = files.flatMap(scanFile);
    expect(offenders).toEqual([]);
  });
});
