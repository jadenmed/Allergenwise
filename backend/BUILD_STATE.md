# AllergenWise MVP Build — Resume State

**Last update:** 2026-05-07 — Phase 4 backend lock done. typecheck 0 / lint 0 / build 0 / unit+integration 404/404 / e2e 50/50/0/0 (curriculum-only seed against local Supabase).

**Status:** Phases 0 + 1 + 2 + 3 + 4 DONE. Backend frozen for UI-designer handoff (deadline 2026-05-09/10).

**Plan source-of-truth:** `/Users/guillermoamador/.claude/plans/tender-leaping-lamport.md` (v2).

## Phase progress

- **Phase 0 — Reduced foundation** — DONE. DB migrations 0001-0010, seed, READMEs, api 501 stubs, route-group layout shells. Vanilla `components/shell/*` deleted.
- **Phase 1 — Backend domain build** — DONE. 8 sub-agents shipped (A auth, B admin, C learner, D directory, E reviewer, F1 stripe+cert, F2 cron+email+mux, 1b curriculum). All API routes implemented, all backend libs typed, RLS audit PASS, verify endpoint leak-free, state-machine transition tests, integration tests for Stripe/Mux/Resend/PDF/Mapbox. **388/388 unit + integration tests pass. typecheck 0. lint 0. build 0.** Curriculum: 30 lessons + 60 exam questions split across 5 module files in `content/curriculum/` (loader at `lib/curriculum.ts`).
- **Phase 2 — Backend integration test (Playwright API-only full pilot loop)** — DONE. `tests/e2e/full-pilot-loop.spec.ts` written + passing (50 tests: 24 pass without Supabase, 26 skip pending real local Supabase + sk_test_* Stripe key). typecheck 0, lint 0, test:e2e exit 0. `middleware.ts` updated: API routes return 401 JSON (not redirect) when unauthenticated; public API prefixes expanded.
  - **Post-fix 2026-05-02 — backend wiring landed:** `supabase/migrations` symlinked to `db/migrations`; `pnpm db:reset` applies all 10 migrations cleanly against local Supabase. Curriculum data loaded via new `db/seed-curriculum.sql` (modules + lessons + exam_questions, no auth FKs). Full e2e suite now **50 passed / 0 skipped / 0 failed** in 14s on local Supabase. `package.json` script renamed `db:migrate` → `db:reset` (+ added `db:push` for cloud). Fixes shipped during this pass: (1) `lib/auth/invite.ts acceptInvite` now sets `email_confirm: true` so invited learners can log in (was silently leaving `email_confirmed_at = NULL` → 401 on `signInWithPassword`); (2) `db/seed.sql` exam_question UUIDs had invalid hex prefix `q1000000-` → replaced with `e1000000-` (mirrored in spec constants); (3) pilot-loop describe converted to `mode: 'serial'` with shared `APIRequestContext` (`pilotApi`) so session cookies persist across the 13 sequential steps — without this, every step that depended on a prior login returned 401.
- **HARD GATE — UI Pro Max skill installed by Guillermo before Phase 3.** Verified 2026-05-03 — skill present at `.claude/skills/ui-ux-pro-max/`, MASTER.md locked, never `--design-system --persist`'d.
- **Phase 3 — UI build (3a foundation, 3b 5 parallel surfaces, 3c judge)** — DONE 2026-05-03.
  - **3a (Sonnet):** UI foundation. `lib/nav.ts` (single source of truth for role nav arrays), `lib/page-meta.ts` (per-route title/description, clinical voice), 6 shell components (`Sidebar`, `AppTopBar`, `PublicTopBar`, `PageHeader`, `RoleGate`, `StatCard`, `EmptyState`), 4 role-group layout rewrites (`(public|admin|learner|reviewer|auth)/layout.tsx`), 6 role-scoped loading + error pages, global `loading.tsx` / `error.tsx` / `not-found.tsx`. Allergen primitives upgraded: `CertBadge` now takes `status: valid|expired|revoked` (3 distinct visual treatments), `AllergenBadge` takes `severity: contains|may-contain|free-from` (icon + text, never color-only). Tailwind extended with `minHeight` tokens (`topbar`, `pageheader`, `button-lg`). Bonus fix: `tsconfig.json` excludes `scripts/` so `tsc --noEmit` passes despite dotenv import in `scripts/seed-auth-users.ts`.
  - **3b (5 Sonnet agents in parallel):** all 5 role surfaces built from 8-line stubs. Public: landing (full trust artifacts per MASTER.md), pricing (matches DB `SubscriptionPlan` type — quarterly/semi-annual + free trial + enterprise), directory list (server fetch + client filter island), directory detail (CertBadge + reviews + ReviewForm), `verify/[certId]` brand moment (full-bleed colored hero per status, first-class disclaimer). Admin: dashboard with StatCards + activity feed, roster with DataTable + filter tabs + inline resend, invite (RHF+Zod form + recently sent), billing (subscription summary + cancel Dialog routes to Stripe Customer Portal or support fallback), submit-listing (eligibility gate + allergen chips + photo upload + first-class disclaimer). Learner: courses with module locks + progress bars, lesson player (Mux placeholder fallback when `MUX_TOKEN_ID` is stub — neutral card + manual mark-complete), exam with wall-clock timer derived from server `startedAt` (no setInterval drift), complete (quiet credentialed dignity, no confetti), certificate viewer with copy verify URL. Reviewer: queue with FIFO sort + status tabs, submission detail with approve/reject/request-info Dialogs (reject reason required). Auth-polish: login (generic 401 messaging, role-based redirect), signup with **Stripe Elements demo-mode** (renders `<PaymentElement />` for visual fidelity but disables submit + shows warning Alert when key is placeholder; full real-mode flow when `pk_test_*` present), invite-accept with server-side token validation (zero-flicker error states for not_found/expired/already_accepted).
  - **3c (Opus judge):** Audit pass. Flagged + fixed 14 token violations: 1 raw glyph `✕` → Lucide `X` icon (admin/submit), 13 `text-ink-400` content uses → `text-ink-500` across public surfaces (anti-pattern: ink-400 is placeholder-only per MASTER.md). Verified all Phase 1 non-negotiables intact (RLS on every tenant table, Stripe webhook signature+dedupe, verify endpoint leak-free, exam route strips `correct` field). Final state: typecheck 0, lint 0 errors, build 0, **e2e 50/50/0/0** (no skips, no failures) against local Supabase + curriculum-only seed.
  - **Bonus fixes shipped during 3b (root-cause fixes, not workarounds):** `app/api/lesson/[lessonId]/route.ts` implicit-any errors fixed via proper typing from `lib/learner/progress.ts`. `next.config.js` — `serverExternalPackages` (Next 15 key) → `experimental.serverComponentsExternalPackages` (Next 14 correct); added `outputFileTracing: false` to fix App-Router-only `.next/export/500.html` rename build error. Lesson player MuxPlayer ref typing (`MuxPlayerElement` cast). Exam page unused import removed. Billing client unescaped apostrophe.
- **Phase 4 — Final integration + verification** — DONE 2026-05-07. Three Sonnet sub-agents shipped in parallel + Opus verification pass: (1) sign-out wiring (`POST /api/auth/logout` + `AuthedTopBar` server-component wrapper + `AuthedTopBarClient` island, threaded uniformly into all 3 role layouts; per-page `<AppTopBar>` stubs removed from admin pages; 4 new unit tests for logout route — happy / no-session / signOut throws / supabase throws); (2) PDF cert local font embed (Crimson Text Regular/SemiBold/Italic TTFs committed under `lib/pdf/fonts/` + OFL LICENSE.txt + README; `Font.register` switched from broken remote woff2 URLs to `path.join(process.cwd(), 'lib/pdf/fonts', ...)`; integration test expanded 4 → 16 tests asserting font embedding + no-gstatic-fetch); (3) `pageMeta.learner` dead-code cleanup (Option B — deleted; learner routes are auth-gated client components, zero SEO benefit). Final state: typecheck 0, lint 0 errors, build 0, **unit+integration 404/404**, **e2e 50/50/0/0** in ~42s on local Supabase + curriculum-only seed.

  - **Phase 4 follow-ups still open (config-only, not code blockers — UI designer can proceed):**
    - Real `RESEND_API_KEY` for production. Test runs use placeholder; sends fail silently (fire-and-forget).
    - Real Mapbox token for geocode in `app/api/search/route.ts` (TODO in code).
    - Real Mux asset IDs in `app/(learner)/learner/courses/[moduleId]/[lessonId]/page.tsx` once video content recorded; placeholder fallback rendered today.
    - Real Stripe `pk_test_*` / `sk_test_*` for full signup→Stripe→webhook in dev. Demo-mode UI rendered today.

## Phase 1 deliverables on disk
- `app/api/{auth,admin,invites,submissions,lesson,exam,learner,directory,reviewer,reviews,search,certs,stripe,cron}/**` — 35 route files.
- `lib/{auth,admin,learner,directory,reviewer,billing,email,pdf,curriculum}/*` — domain modules.
- `lib/email/templates/*.tsx` — 11 React Email templates + previews.
- `db/migrations/0005_invite_tokens.sql` through `0010_cert_warnings.sql`.
- `content/curriculum/{manifest,module-1..5}.json`.
- `tests/unit/*.test.ts` (state machines, scoring, RLS, slug, csv, leak, etc.) + `tests/integration/*.test.ts` (Stripe webhook signed roundtrip, Mux JWT, Resend mock, PDF render, Mapbox geocode).
- `docs/api-contracts/{A,B,C,D,E,F1,F2}-*.md` — 7 contract docs.
- `docs/RLS_AUDIT.md` — PASS.
- `vercel.json` — 6 cron schedules.

## Phase 2 deliverables on disk
- `tests/e2e/full-pilot-loop.spec.ts` — 50-test Playwright API-only spec covering the full pilot loop: signup → Stripe webhook → invite → accept → all-lessons complete → exam start → exam submit (pass) → cert generate → submission create → reviewer approve → directory GET → search → review submit. Plus 12 standalone security/contract invariant tests.
- `middleware.ts` — updated: API routes without a valid session return 401 JSON (not 307 redirect to login); public API prefixes expanded to include `/api/auth/`, `/api/directory/`, `/api/certs/`.

## Resume Phase 3
**HARD GATE:** Guillermo must confirm the `ui-ux-pro-max` skill is installed and staged at `.claude/skills/ui-ux-pro-max/` before dispatching Phase 3. Per CONTEXT.md the skill is pre-staged — verify it is present before proceeding.

Phase 3 dispatch: open Claude Code and say "resume Phase 3 allergenwise build" OR dispatch 3 parallel sub-agents:
- **Agent 3a — UI Foundation:** Design system wiring, shadcn primitives, shared layout components
- **Agent 3b — 5 Parallel Surfaces:** (public/marketing, admin, learner, reviewer, directory) — one sub-agent per surface
- **Agent 3c — Judge:** UI audit + integration verification pass

Each agent MUST:
1. Read `CONTEXT.md` + `design-system/allergenwise/MASTER.md` first
2. Use the ui-ux-pro-max skill in reference mode only (never `--design-system --persist`)
3. Run builder → devil's-advocate → advocate three-pass protocol
4. Return typecheck 0, lint 0, build 0

## What's already on disk (do NOT redo)

- Project root files: `package.json`, `tsconfig.json`, `next.config.js`, `.eslintrc.json`, `.prettierrc`, `.gitignore`, `.editorconfig`, `.env.example`, `postcss.config.js`, `vitest.config.ts`, `playwright.config.ts`.
- `tailwind.config.ts` + `app/globals.css` — full teal palette, surface/ink tokens, soft shadows, focus ring, fonts.
- `app/layout.tsx` — root layout with Inter font.
- `middleware.ts` — auth + role redirects, public-route allowlist.
- `lib/supabase/{server,client,middleware}.ts`, `lib/stripe.ts`, `lib/mux.ts`, `lib/email/client.ts`, `lib/utils.ts`, `lib/types/db.ts`.
- `components/shell/{Sidebar,TopBar,PageHeader,RoleGate,StatCard,EmptyState}.tsx` — full shell built.
- Empty stub directories under `components/{ui,allergen,course,directory}/` and the full `app/(public|admin|learner|reviewer|auth)/...` route tree (page.tsx files mostly missing).

## What's still missing (the Phase 0 finisher's job)

Phase 0 finisher checklist resolved 2026-05-02; all items shipped during Phase 0/1.

## After Phase 0 completes

Dispatch in parallel (single message, multiple Agent calls, all `model: "sonnet"`):

- Agent A — Public/Marketing (landing, pricing, signup w/ Stripe Elements, login, invite-accept, verify)
- Agent B — Admin (dashboard, roster, invite, billing, submit + admin API routes)
- Agent C — Learner (courses, player w/ Mux, exam, complete, certificate + learner API routes)
- Agent D — Directory (list+map, detail, reviews, search/review submit routes)
- Agent E — Reviewer (queue, detail, decide route)
- Agent F — Backend services (Stripe webhooks, PaymentIntent, cert PDF gen, cron jobs, Resend templates, search SQL)
- Agent 1b — Curriculum seed (`content/curriculum.json` — 5 modules × 6 lessons + 50–75 exam Qs)

Each MUST run the builder → devil's-advocate → advocate three-pass protocol and return a debate log.

## Deviations from plan

1. **Spec path:** BUILD_STATE.md said `tests/api/full-pilot-loop.spec.ts` but playwright.config.ts sets `testDir: ./tests/e2e`. Spec was placed at `tests/e2e/full-pilot-loop.spec.ts` (correct per actual config).

2. **`/api/certs/generate` body shape:** API contract (F1) says `{ "certCode": "AW-..." }` but the implemented route (Phase 1) accepts `{ "certificateId": "uuid" }`. The spec uses `certificateId` (matches actual implementation). Phase 3 or post-MVP: reconcile contract doc with implementation.

3. **Middleware API-route behavior:** Middleware was silently redirecting unauthenticated API requests to `/login` (307) instead of returning 401. Fixed in Phase 2: API routes without session now return `{ error: "Unauthorized" }` 401 JSON. This is the correct behavior per API contract; the redirect was a Phase 0/1 oversight.

4. **26 pilot loop steps skip without local Supabase + real Stripe test key:** The spec gracefully skips steps 1–13 of the pilot loop when `NEXT_PUBLIC_SUPABASE_URL` is the placeholder stub. The 24 invariant tests (security + contract checks) pass without Supabase. Full green run requires: `supabase start` (local Supabase) + real `STRIPE_SECRET_KEY=sk_test_*` in `.env.local`.

5. **Stripe webhook "tampered payload" invariant:** When `STRIPE_WEBHOOK_SECRET=whsec_placeholder_build_only`, the Stripe library still validates the signature format but generates a "No signatures found" error (not a crash). The tampered-payload test correctly exercises 400 status in both placeholder and real-key modes.

6. **Curriculum seed split out (2026-05-02):** `db/seed.sql` mixes restaurant + profiles (FK to `auth.users`) with curriculum (no FKs). The auth FK makes the full seed unsafe to run without first creating matching auth users. Curriculum-only inserts extracted into `db/seed-curriculum.sql` so e2e (which needs lessons/modules/exam_questions) can run cleanly. Full `db/seed.sql` still requires the pre-seed script — see Follow-ups.

## Follow-ups

- **Seed pre-script for `db/seed.sql`** — DONE 2026-05-02 (out-of-band). User added `scripts/seed-auth-users.ts` + `db:seed-auth` + `db:seed-with-auth` package scripts. Verify wired correctly during Phase 4 smoke.

### Phase 3 follow-ups (Phase 4 candidates — non-blocking)

- **Sign-out + account UI not wired in any role surface.** DONE 2026-05-07. `POST /api/auth/logout` route added (calls `supabase.auth.signOut()` server-side, clears cookies). `components/shell/AuthedTopBar.tsx` (Server Component) fetches profile + renders `AuthedTopBarClient.tsx` (Client Component) with real userName/userEmail/roleLabel + wired `onSignOut` handler (`fetch /api/auth/logout` → `router.push('/')` + `router.refresh()`). All three role layouts now render `<AuthedTopBar />` at the layout level. Per-page `<AppTopBar roleLabel="Admin" />` stubs removed from all 5 admin pages. Pre-existing unused `path` import in `lib/pdf/certificate.tsx` restored (import was removed accidentally; file uses `path.join` for font registration). typecheck 0, lint 0 errors, build 0. 4 new unit tests in `tests/unit/logout.test.ts` — all pass. Total unit tests: 370/370.
- **PDF cert generation fetches Crimson Text font from `fonts.gstatic.com` at render time.** DONE 2026-05-07. Crimson Text Regular/SemiBold/Italic TTF files committed under `lib/pdf/fonts/` (Google Fonts v19, ~300KB total) + OFL LICENSE.txt + README. `Font.register` now uses `path.join(process.cwd(), 'lib/pdf/fonts', '<file>.ttf')`. Integration test expanded 4 → 16 tests covering font file presence, no-gstatic source check, font subset embedding (~17KB cert PDF, smaller than woff2 fetch path would have been), no-network fetch spy. Original woff2 URLs were not just remote — they 404'd. typecheck 0 / lint 0 / integration 34/34.
- **Resend API key invalid in test runs.** Email sends in `reviewer/decide` and `invites/send` fail with `'API key is invalid'`. All sends are fire-and-forget (decision/invite still recorded). Production deploy needs a real `RESEND_API_KEY`; document in env.example.
- **Two TODOs left in code.** `app/(learner)/learner/courses/[moduleId]/[lessonId]/page.tsx` (Mux assets when video content recorded; react-markdown for lesson body rendering — currently `<pre>`). `app/api/search/route.ts` (Mapbox geocode integration when token provided). All pilot-acceptable; convert to GitHub issues when repo goes public.
- **`pageMeta.learner.*` defined but unused** — DONE 2026-05-07. Chose Option B (delete). All five learner pages are `'use client'`; `/learner/**` is fully auth-gated (middleware redirects unauthenticated requests to `/login`) so there is zero SEO benefit. Removed the `learner` key from `pageMeta` in `lib/page-meta.ts` and replaced it with a comment explaining the deliberate absence and the conditions under which server-wrapper conversion would be warranted. Zero references to `pageMeta.learner` existed anywhere in the codebase. typecheck 0, lint 0 errors, build 0.
