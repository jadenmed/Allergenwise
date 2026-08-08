---
type: Roadmap
about: allergenwise
---

# ROADMAP — v0.1 Perf-Hardening + Simplification

Milestone status: **All 9 phases merged** (2026-07-20 — formal milestone close-out pending)
Source audit: `~/Documents/Claude/Projects/OS BUILD/allergenwise-audit.md`

Phases below mirror the audit's file-disjoint PAUL sequencing. Each phase = one approved audit item = one plan→apply→unify loop. Phases activate ONLY when the user explicitly picks the next one. Do not auto-chain.

| Phase | Audit ref | Scope (files) | Status |
|-------|-----------|---------------|--------|
| **01 — Stripe timeout** | Part A #3a | `lib/stripe.ts` ONLY | **✅ Complete** |
| 02 — DB waterfall parallelization | B2 | eligibility, roster, dashboard-stats, auto-checks, directory/[slug], reviewer/queue | **✅ Complete** |
| 03 — Auth guard extraction + error helper | B1+B8 | new `lib/auth/require-*.ts` + 21 routes | **✅ Complete** |
| 04 — Email consolidation + fire-and-forget | B3+B4, #3b | sendEmail routing + drop awaits | **✅ Complete** |
| 05 — Audit-event batching | Part A #2 | cert-event-handlers + cron routes | **✅ Complete** |
| 06 — Dead-code sweep | B5+B6+B7 | file deletes + dep removal | **✅ Complete** |
| 07 — Optimistic lesson-complete | Part A #4 | courses/[moduleId]/[lessonId]/page.tsx | **✅ Complete** |
| 08 — directory/[slug] static params | Part A #5 | directory/[slug]/page.tsx | **✅ Complete** |
| 09 — Oversized splits | B9–B11 | reviewer detail, signup, exam/submit | **✅ Complete** |

Statuses reconciled 2026-07-17 against `PHASE_STATUS.md`'s branch table (source of truth for what's merged into `integration/v0.1-hardening`): phases 05/07/08 landed via `perf/05-audit-batching`, `perf/07-optimistic-lesson`, `perf/08-directory-static` outside this PAUL loop's own tracking, so this file understated them as not started.

**Collision rule:** Phase 03 (auth guards) and Phase 04 (email) both edit invite/exam/submissions routes → never run concurrently.

## Phase 01 — Stripe timeout (active)
Goal: cap Stripe SDK network timeout 80s→10s and add `maxNetworkRetries:2` in `lib/stripe.ts`. Behavior-preserving: callers unchanged, only network timeout/retry config changes. Pause at human-verify before finalize.
