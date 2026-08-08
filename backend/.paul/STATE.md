---
type: State
about: allergenwise
---

# STATE

## Current Position

Milestone: v0.1 Perf-Hardening + Simplification
Phase: **9 of 9 complete** — all phases (01–09) merged into `integration/v0.1-hardening`. Milestone work done; formal close-out (`/paul:complete-milestone`) pending user.
Plan: Phase 06 (06-01) applied + human-verify approved on `perf/06-dead-code` (worktree `aw-phase06/`, cut from aa80033), merged into `integration/v0.1-hardening` at `a71b46a`.
Status: Phase 06 (B5+B6+B7 dead-code sweep) — 13 dead files deleted (lib/search.ts, lib/supabase/client.ts, lib/types/auth.ts, AllergenBadge + 4 component barrels, 5 unused shadcn primitives), 8 deps removed (5 Radix, mapbox-gl, @types/mapbox-gl, @testing-library/react), dead exports trimmed (lib/mux.ts legacy signing pair, geocodeQuery demoted, 7 dead join-helper interfaces in lib/types/db.ts), no-op mapbox webpack block dropped, and `server-only@0.0.1` ADDED (latent bug: 40 importers, resolved only via Next's compiled copy). Every deletion evidence-gated; full details in `.paul/phases/06-dead-code/06-01-SUMMARY.md`.
Last activity: 2026-07-20 — phase 06 merged; verify identical to baseline (tsc 0, build 49 pages, vitest serial 725/3/1, same reconcile-cert-states real-DB failures).

Progress:
- Milestone: [██████████] 100% (9 of 9 phases merged)

## Loop Position

```
PLAN ──▶ APPLY ──▶ UNIFY
  ✓        ✓        ✓     [Phase 06 merged — milestone phase work complete]
```

Phase 01 (Stripe): 7e2858a. Phase 02 (DB waterfalls): scoped 6 files. Phase 03 (auth guards): 474809a. Phase 04 (email): merged @ aa80033 (conflict reconciled per Decision #4). Phase 05 (audit batching): perf/05-audit-batching. Phase 07 (optimistic lesson): perf/07-optimistic-lesson. Phase 08 (directory static): perf/08-directory-static. Phase 09 (splits): merged @ 0b30e77. Phase 06 (dead-code): `5ede957` on perf/06-dead-code, merged @ `a71b46a`.

lib/auth/require-auth.ts requireAuth() still staged for the 6 auth-only routes if a later phase wants them.

## Decisions

| # | Decision | Rationale |
|---|----------|-----------|
| 1 | One audit item per loop; no auto-chaining | User directive; file-disjoint sequencing prevents collisions |
| 2 | Phase 01 scope = lib/stripe.ts ONLY | User explicit scope lock |
| 3 | Phase 09 split into 3 vertical-slice plans (09-01/02/03) | B9/B10/B11 are 3 distinct subsystems |
| 4 | Phase 09-03 / Phase 04 exam-submit collision — RESOLVED 2026-07-20 | `issueCertificateForPassedExam()` in lib/learner/issue-certificate.ts owns the exam-pass email send |
| 5 | 2026-07-18: invites/remind + invites/[id]/resend fire-and-forget | User selected; matches B4 reference pattern |
| 6 | 2026-07-20 (phase 06): 5 shadcn/Radix primitives (avatar, dropdown-menu, separator, switch, tooltip) DELIBERATELY removed as unreferenced | Figma hook-up sessions (PROMPT_PLAN steps 11–12) must re-add any they need via `npx shadcn@latest add <component>` — absence is NOT an error, do not restore from git history |
| 7 | 2026-07-20 (phase 06): lib/supabase/client.ts (browser Supabase client) DELIBERATELY removed | If step 10b (Google OAuth) needs a browser client for sign-in, recreate fresh against current @supabase/ssr `createBrowserClient` patterns — do not restore the deleted file |
| 8 | 2026-07-20 (phase 06): `server-only` added as explicit dep; @mux deps + signMuxPlaybackUrl + curriculum.ts type exports + db.ts enum/row types kept | Latent-bug fix per audit; keeps flagged UNCERTAINs that serve step-14 video work, loadCurriculum's public API, and the Database interface |

## Session Continuity

Last session: 2026-07-20 — phase 06 full loop in fresh worktree `aw-phase06/` (branch perf/06-dead-code from aa80033). Evidence sweep → apply → verify (identical to baseline) → human-verify approved → merged `a71b46a`. Main fast-forwarded. PHASE_STATUS.md + ROADMAP.md updated; VAULT decision note logged.
Stopped at: Milestone phase work 100% complete.
Next action: Formal milestone close-out (`/paul:complete-milestone`) when user chooses, then PROMPT_PLAN step 10 (coming-soon gate / free mode, Sonnet 5).
Resume file: .paul/ROADMAP.md
