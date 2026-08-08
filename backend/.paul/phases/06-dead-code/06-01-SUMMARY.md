---
phase: 06-dead-code
plan: 01
plan_type: execute
wave: 1
type: Summary
about: allergenwise
---

# Phase 06 — Dead-code sweep (B5+B6+B7) — SUMMARY

## What changed
Zero behavior change. Every deletion gated on grep evidence of zero non-doc consumers at the branch base (`aa80033`, post-04/09 merges). Net diff: 14 insertions / 609 deletions (plus 13 deleted files).

### Files deleted (13) — B5 + B6
| File | Evidence |
|------|----------|
| `lib/search.ts` | Re-export barrel; zero imports of `@/lib/search` — all consumers import `@/lib/directory/search` directly |
| `lib/supabase/client.ts` | `createClientSupabase` 0 refs; browser-side Supabase writes retired in Wave 2A.5 — all writes flow through server routes |
| `lib/types/auth.ts` | Module path 0 imports; all 4 exports (`ProfileWithInviteToken`, `SessionUser`, `SessionResponse`, `LoginResponse`) 0 refs by name |
| `components/allergen/AllergenBadge.tsx` | Only importer was the allergen barrel (also deleted); `AllergenSeverity` 0 external refs |
| `components/allergen/index.ts`, `components/course/index.ts`, `components/shell/index.ts`, `components/directory/index.ts` | Zero barrel-style imports in any form (`@/components/X`, `…/X/index`, relative `../X`); course barrel was comment-only; all shell/directory/allergen components consumed via direct file paths (`AllergenTag`, `CertBadge` kept) |
| `components/ui/avatar.tsx`, `dropdown-menu.tsx`, `separator.tsx`, `switch.tsx`, `tooltip.tsx` | Zero imports via `@/components/ui/X` or relative `./X` anywhere, including `data-table.tsx` |

### Deps removed (8) — B6
- `@radix-ui/react-avatar`, `-dropdown-menu`, `-separator`, `-switch`, `-tooltip` — sole importers were the 5 deleted primitives.
- `mapbox-gl` + `@types/mapbox-gl` — zero source imports; Mapbox is called via plain `fetch` (`lib/directory/geocode.ts`, `app/api/search/route.ts`). The `api.mapbox.com` images.remotePattern in next.config.js is retained (REST API still in use). The no-op `webpack` block in next.config.js (mapbox-gl leftover) removed.
- `@testing-library/react` — zero refs outside package.json; tests use jsdom + plain assertions.

Lockfile shrank 514 lines.

### Dep added (1)
- `server-only@0.0.1` — audit-flagged latent bug, not dead code: 40 source files `import 'server-only'` but the package was never declared; `require.resolve('server-only')` failed (`MODULE_NOT_FOUND`) and imports only worked via Next.js's internal compiled copy (`next/dist/compiled/server-only`). Now an explicit dependency; resolves from node_modules.

### Export trims — B7
- `lib/mux.ts` — deleted legacy `signPlaybackUrl` + `getSignedPlaybackUrl` (0 consumers; 2026-05-07 security audit flagged the legacy path's wrong `sub` claim). Kept `mux` client + `signMuxPlaybackUrl` (covered by `tests/unit/mux-sign.test.ts` + `tests/integration/mux-signing.test.ts`; step-14 video wiring incoming).
- `lib/directory/geocode.ts` — `geocodeQuery` demoted export→internal; only caller is `geocodeZip` in the same file, and the integration test imports only `geocodeZip`.
- `lib/types/db.ts` — deleted 7 dead join-helper interfaces (`QuestionWithChoices`, `ProfileWithRestaurant`, `LessonWithProgress`, `ModuleWithLessons`, `CertificateWithProfile`, `SubmissionWithRestaurant`, `ReviewWithRestaurant`): each referenced only by its own definition or a dead sibling, 0 external files.

## Deliberate removals — notes for future sessions
1. **shadcn/Radix UI primitives (avatar, dropdown-menu, separator, switch, tooltip) removed as unreferenced ON PURPOSE.** The Figma hook-up sessions (PROMPT_PLAN steps 11–12) should re-add any primitive they need via `npx shadcn@latest add <component>` (which also restores the matching Radix dep) rather than treating the absence as an error or restoring the deleted files from git history.
2. **`lib/supabase/client.ts` (browser Supabase client) removed ON PURPOSE.** If step 10b (Google OAuth) needs a browser-side client for the sign-in flow, recreate it fresh against current `@supabase/ssr` patterns (`createBrowserClient`) — do not restore the deleted file from git history.

## Kept after extra scrutiny (audit UNCERTAINs + post-04/09 call-site check)
- `@mux/mux-node` / `@mux/mux-player-react` + `signMuxPlaybackUrl` — video work mid-integration (39-module Mux production, step 14).
- All `lib/curriculum.ts` type exports — they form `loadCurriculum()`'s public return-type chain; internally referenced, not dead.
- `lib/types/db.ts` enum aliases (`RestaurantStatus`, `ReviewStatus`, `CertRevocationReason`, `ExamDifficulty`, db's `QuickCheckOption`) and partner/deletion-token/cert-warning row types (`Brand`, `Partner`, `BrandAttribution`, `InvoicePayment`, `CommissionPayout`, `AccountDeletionToken`, `CertWarning`, …) — referenced internally by row types / the `Database` interface; partner types also serve the merged trackb work.
- `computeCheckChar` (B7 item) — already internal-only in `lib/learner/cert-code.ts` on the current tip; pre-satisfied by the phase-09 reshuffle. No action.
- Nothing near `lib/email/` or `lib/learner/issue-certificate.ts` (phases 04+09 new call sites) resolved as dead — no candidate touched those areas.

## Verify gate results (identical to baseline at aa80033)
- `tsc --noEmit`: 0 errors (before and after).
- `next build`: success, 49 pages (before and after). First baseline attempt failed only because the fresh worktree lacked `.env.local` (`RESEND_API_KEY is not set` at page-data collection) — copied from `aw-integration/`, not a code issue.
- `vitest run --no-file-parallelism`: **725 pass / 3 fail / 1 skip — before and after, identical failure set** (`reconcile-cert-states` ×3, real-DB tests). Note: the roadmap's expected tally was 724/4/1 including the cert-code entropy test; that test is statistical and passed in both runs on this machine. Failure set unchanged by the sweep.
- Phantom-reference sanity grep after apply: zero source references to any removed file, export, or dep.
