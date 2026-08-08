/**
 * tests/unit/cert-code-fixture-grep.test.ts
 *
 * Regression guard for the Wave 4B cert-code fixture sweep.
 *
 * Migration 0015 added `certificates_cert_code_format_chk` enforcing the
 * Crockford Base32 + ISO 7064 Mod 37,36 format. Any test that inserts a
 * literal old-format cert code (`AW-YYYY-NNNNNN`) into the certificates
 * table fails the CHECK constraint.
 *
 * This guard scans tests/ for any occurrence of the old format
 * (`AW-\d{4}-\d{6}`) and fails if a match appears outside the allowlist.
 *
 * Allowlist entries are files that legitimately reference the old format
 * as a NEGATIVE-PATH input — proving the validator / verify endpoint /
 * route rejects it. Those references are intentional and must not be
 * regenerated.
 *
 * Same shape as the Math.random guard in `secure-random.test.ts:110`.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';

const OLD_FORMAT_REGEX = /AW-\d{4}-\d{6}/;

// Files that intentionally reference the old format as negative-path input.
// Paths are repo-relative (POSIX separators).
const ALLOWLIST = new Set<string>([
  // validator unit test: asserts old format → invalid_format
  'tests/unit/cert-code.test.ts',
  // verify endpoint negative tests: assert old format → not_found
  'tests/unit/verify-leak.test.ts',
  'tests/integration/verify-cert-code-format.test.ts',
  // rate-limit test uses old format as nonexistent cert input
  'tests/integration/verify-rate-limit.test.ts',
  // p10 spec uses old format as a malformed input to verify endpoint
  'tests/e2e/p10-verify-rate-limit.spec.ts',
  // resend email template fixture — pure render input, not a DB insert
  'tests/integration/resend-send.test.ts',
  // this guard file itself contains the regex literal
  'tests/unit/cert-code-fixture-grep.test.ts',
]);

describe('cert-code fixture grep guard', () => {
  it('finds zero old-format cert codes in tests/ outside the allowlist', () => {
    const repoRoot = resolve(__dirname, '..', '..');
    const testsDir = join(repoRoot, 'tests');
    const offenders: string[] = [];

    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const p = join(dir, entry);
        const s = statSync(p);
        if (s.isDirectory()) {
          walk(p);
          continue;
        }
        if (!/\.(ts|tsx|js|jsx|mjs)$/.test(entry)) continue;
        const rel = relative(repoRoot, p).split('\\').join('/');
        if (ALLOWLIST.has(rel)) continue;
        const text = readFileSync(p, 'utf8');
        if (OLD_FORMAT_REGEX.test(text)) offenders.push(rel);
      }
    };

    walk(testsDir);
    expect(offenders).toEqual([]);
  });
});
