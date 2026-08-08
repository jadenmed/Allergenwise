/**
 * tests/unit/invite-accept-coming-soon-unaffected.test.ts
 *
 * The invite-accept path (an invited learner setting their password) must be
 * completely unaffected by the coming-soon gate: invited learners join an
 * existing restaurant and never see a plan/payment step, unlike the
 * top-level restaurant signup form. This is a structural regression guard
 * (modeled on tests/unit/log-pii-grep.test.ts's grep-based approach) proving
 * no coupling to the gate was introduced, rather than asserting today's
 * behavior happens to be unaffected.
 *
 * T-03 retargeted the pattern. It used to grep for `mvp-mode|MVP_FREE_MODE|
 * isFreeModeEnabled` — names that no longer exist anywhere in the repo, so
 * the assertion would have passed for free and could never have failed
 * again. A guard that cannot fail is decoration. It now names the module and
 * function that actually exist, which is what a future edit would reach for.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const repoRoot = resolve(__dirname, '..', '..');

const INVITE_ACCEPT_FILES = [
  'app/api/auth/invite/accept/route.ts',
  'app/(auth)/invite/[token]/InviteAcceptForm.tsx',
  'app/(auth)/invite/[token]/InviteErrorView.tsx',
  'app/(auth)/invite/[token]/page.tsx',
];

const COMING_SOON_REFERENCE_RE = /lib\/coming-soon|isComingSoonEnabled|COMING_SOON/;

describe('regression: invite-accept path has zero coupling to the coming-soon gate', () => {
  it.each(INVITE_ACCEPT_FILES)('%s does not reference the coming-soon flag', (relPath) => {
    const text = readFileSync(resolve(repoRoot, relPath), 'utf8');
    expect(COMING_SOON_REFERENCE_RE.test(text)).toBe(false);
  });

  it('the pattern it greps for is one that actually exists in the repo', () => {
    // The failure mode this file just walked out of: grepping for a name
    // nothing uses any more, so the guard passes unconditionally. Anchor it
    // to the live module — if lib/coming-soon.ts is renamed again, this
    // fails and forces the pattern above to be retargeted with it.
    const flagModule = readFileSync(resolve(repoRoot, 'lib/coming-soon.ts'), 'utf8');
    expect(COMING_SOON_REFERENCE_RE.test(flagModule)).toBe(true);
  });
});
