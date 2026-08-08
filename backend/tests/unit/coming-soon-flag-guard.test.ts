/**
 * tests/unit/coming-soon-flag-guard.test.ts
 *
 * T-03 acceptance lock, in the manner of tests/unit/seed-db-guard.test.ts.
 *
 * Two things are being held shut here, and they fail in opposite directions.
 *
 *   1. THE OLD FLAG IS GONE. `MVP_FREE_MODE` was one variable doing five
 *      unrelated jobs: gating the public site, hiding nav, skipping Stripe,
 *      skipping certificate issuance, and hiding billing. The last three were
 *      deleted outright — since T-41a a comped restaurant goes through the
 *      real Checkout and reaches $0 with a promotion code, so a payment
 *      bypass has nothing left to do. Any reappearance of those names is a
 *      re-merge of concerns that took a whole task to separate.
 *
 *   2. THE NEW FLAG DEFAULTS TO ON. `COMING_SOON !== 'false'`. Written the
 *      other way round — `=== 'true'` — a variable that is missing,
 *      misspelled, or simply never added to a deployment publishes an
 *      unfinished product to the internet. Silently. With nothing anywhere
 *      to alert anyone. This is the one place in this codebase where the
 *      safe default is "on", so it is asserted three ways: structurally
 *      against the source text, behaviourally against the real function, and
 *      by proving no NEXT_PUBLIC_ variant exists to be baked into a client
 *      bundle at build time and go stale.
 *
 * A behavioural test alone would not catch a second, subtly-different copy
 * of the predicate appearing elsewhere; a structural test alone would not
 * catch the predicate being correct but unreachable. Hence both.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { resolve, join, relative } from 'node:path';

vi.mock('server-only', () => ({}));

const repoRoot = resolve(__dirname, '..', '..');
const FLAG_MODULE = resolve(repoRoot, 'lib/coming-soon.ts');

/** Directories the acceptance grep covers, plus components/ (Sidebar lives there). */
const SCANNED_DIRS = ['app', 'lib', 'components'];
const SCANNED_FILES = ['middleware.ts'];

const SOURCE_EXTENSIONS = ['.ts', '.tsx'];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === 'node_modules' || entry === '.next') continue;
      walk(full, out);
    } else if (SOURCE_EXTENSIONS.some((ext) => entry.endsWith(ext))) {
      out.push(full);
    }
  }
  return out;
}

function scannedSourceFiles(): string[] {
  const files = SCANNED_DIRS.flatMap((d) => walk(resolve(repoRoot, d)));
  return [...files, ...SCANNED_FILES.map((f) => resolve(repoRoot, f))];
}

describe('T-03: the old free-mode flag is gone from the shipped surface', () => {
  const files = scannedSourceFiles();

  it('scans a non-trivial number of files (the walker itself is not broken)', () => {
    // Without this, a bug in walk() that returned [] would make every
    // assertion below pass over nothing at all.
    expect(files.length).toBeGreaterThan(100);
    expect(files).toContain(resolve(repoRoot, 'middleware.ts'));
    expect(files).toContain(FLAG_MODULE);
  });

  const bannedNames = [
    'MVP_FREE_MODE',
    'isFreeModeEnabled',
    'lib/mvp-mode',
    'hiddenInFreeMode',
    'FreeSignupForm',
  ];

  it.each(bannedNames)(
    'no file under app/, lib/, components/ or middleware.ts mentions %s',
    (name) => {
      const offenders = files
        .filter((f) => readFileSync(f, 'utf8').includes(name))
        .map((f) => relative(repoRoot, f));

      expect(offenders, `${name} is still referenced`).toEqual([]);
    }
  );

  it('lib/mvp-mode.ts no longer exists', () => {
    expect(existsSync(resolve(repoRoot, 'lib/mvp-mode.ts'))).toBe(false);
  });

  it('the free-mode signup form no longer exists', () => {
    expect(existsSync(resolve(repoRoot, 'app/(auth)/signup/FreeSignupForm.tsx'))).toBe(false);
  });

  it('exactly one module owns the flag', () => {
    // A second definition of "is the site private" is how the five-jobs-one-
    // flag problem comes back.
    const definers = files
      .filter((f) => /process\.env\.COMING_SOON/.test(readFileSync(f, 'utf8')))
      .map((f) => relative(repoRoot, f));

    expect(definers).toEqual(['lib/coming-soon.ts']);
  });
});

describe('T-03: the coming-soon gate defaults to ON (structural)', () => {
  const src = readFileSync(FLAG_MODULE, 'utf8');

  it("tests for !== 'false', which is what makes the default private", () => {
    expect(src).toMatch(/process\.env\.COMING_SOON\s*!==\s*'false'/);
  });

  it("never tests for === 'true', which would make the default public", () => {
    // The whole task in one assertion. `=== 'true'` inverts the failure mode
    // from "a page someone expected is hidden" to "the unfinished product is
    // live", and nothing else in the system would notice.
    expect(src).not.toMatch(/COMING_SOON\s*===\s*'true'/);
    expect(src).not.toMatch(/COMING_SOON\s*===\s*'1'/);
  });

  it('reads process.env at call time rather than caching at module load', () => {
    // A module-level `const ENABLED = …` would freeze the value at import,
    // which breaks per-request evaluation in middleware and makes every test
    // in this repo that sets the var lie.
    expect(src).not.toMatch(/^const\s+\w+\s*=\s*process\.env\.COMING_SOON/m);
    expect(src).toMatch(/return\s+process\.env\.COMING_SOON/);
  });

  it('is server-only and has no NEXT_PUBLIC_ twin', () => {
    expect(src).toMatch(/import\s+'server-only'/);

    const publicVariant = scannedSourceFiles()
      .filter((f) => readFileSync(f, 'utf8').includes('NEXT_PUBLIC_COMING_SOON'))
      .map((f) => relative(repoRoot, f));

    // NEXT_PUBLIC_* is statically substituted at build time, so a public
    // twin would freeze the gate into the bundle and stop tracking the live
    // server environment.
    expect(publicVariant).toEqual([]);
  });
});

describe('T-03: the coming-soon gate defaults to ON (behavioural)', () => {
  const originalComingSoon = process.env.COMING_SOON;

  beforeEach(() => {
    vi.resetModules();
    delete process.env.COMING_SOON;
  });

  afterEach(() => {
    if (originalComingSoon === undefined) delete process.env.COMING_SOON;
    else process.env.COMING_SOON = originalComingSoon;
  });

  async function isEnabled(): Promise<boolean> {
    const { isComingSoonEnabled } = await import('@/lib/coming-soon');
    return isComingSoonEnabled();
  }

  it('unset → enabled (private)', async () => {
    await expect(isEnabled()).resolves.toBe(true);
  });

  const staysPrivate = [
    '',
    'true',
    'TRUE',
    'False',
    'FALSE',
    'no',
    '0',
    '1',
    'flase',
    ' false',
    'false ',
  ];

  it.each(staysPrivate)('COMING_SOON=%j → still enabled (private)', async (value) => {
    process.env.COMING_SOON = value;
    await expect(isEnabled()).resolves.toBe(true);
  });

  it("COMING_SOON='false' → disabled (public). Exactly one value opens the door.", async () => {
    process.env.COMING_SOON = 'false';
    await expect(isEnabled()).resolves.toBe(false);
  });
});
