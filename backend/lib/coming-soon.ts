/**
 * lib/coming-soon.ts — the pre-launch coming-soon gate.
 *
 * Single source of truth: `COMING_SOON` (server-only env var, no
 * NEXT_PUBLIC_ prefix). Read directly by middleware and server
 * components/layouts — never inlined into a client bundle, so flipping it
 * always reflects the live server environment rather than a value frozen
 * into the build at compile time (Next.js statically replaces NEXT_PUBLIC_*
 * references at build time; a server-only var does not have that failure
 * mode). Client components that need the flag for rendering decisions
 * (Sidebar) receive it as a prop threaded down from a server component that
 * called this function.
 *
 * ── THE DEFAULT IS ON, AND THAT IS DELIBERATE ────────────────────────────
 * The test is `!== 'false'`, NOT `=== 'true'`. Every value other than the
 * exact string 'false' — unset, empty, 'FALSE', 'no', a typo, a variable
 * that never made it into the deployment — leaves the gated surfaces
 * PRIVATE.
 *
 * The two failure modes are not symmetric. Getting it wrong in the closed
 * direction shows a placeholder page to someone who should have seen the
 * directory: visible, reversible, and someone complains within the hour.
 * Getting it wrong in the open direction publishes an unfinished product to
 * the internet, silently, with nothing anywhere to alert anyone. Only an
 * operator who deliberately typed `COMING_SOON=false` gets the open door.
 *
 * Locked by tests/unit/coming-soon-flag-guard.test.ts, which reads this
 * source and fails if the comparison ever inverts.
 *
 * On Vercel, changing this var still requires a redeploy to take effect
 * (platform behavior for all env vars, not specific to this flag) — see
 * PHASE_STATUS.md.
 */
import 'server-only';

export function isComingSoonEnabled(): boolean {
  return process.env.COMING_SOON !== 'false';
}
