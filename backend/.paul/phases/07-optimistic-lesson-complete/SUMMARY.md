---
description: "Phase 07 unify summary — optimistic lesson-complete"
type: Summary
about: "aw-phase07"
---

# Summary: Optimistic lesson-complete

## What changed
`app/(learner)/learner/courses/[moduleId]/[lessonId]/page.tsx` — `handleMarkComplete()` only. No other file touched.

- Snapshots `previousComplete` before mutating.
- Sets `isComplete = true` optimistically, before the network call.
- On non-ok response or thrown/network error: rolls back to `previousComplete`, sets `completeError`.
- On success: no further state write needed — `res.ok` already guarantees `{ status: 'complete' }` per the route's contract (confirmed by reading `app/api/lesson/[lessonId]/complete/route.ts`, not modified).

Server route, request shape (URL/method/headers/body), and response contract are all unchanged.

## Verify gate (fresh subagent, `ecc:code-reviewer`)
- Scope violation: NO ISSUE — only the locked file modified.
- Server/API contract change: NO ISSUE — route untouched, request/response shape unchanged.
- Rollback correctness: flagged one MEDIUM edge case — original draft reconciled `isComplete` from a parsed response body (`body.status === 'complete'`), which could silently under-report success if a 200 response ever had unparseable JSON. **Fixed**: removed the body-parse-on-success path entirely; success now trusts `res.ok` per the documented contract, so there's nothing left to reconcile from a fallible parse. Re-reviewed logic confirmed correct for all realistic failure paths (network error, thrown exception, non-ok response); double-click race excluded by the existing `completing` guard.

## Definition of done
| Check | Result |
|---|---|
| `tsc --noEmit` | 0 errors in target file (19 pre-existing repo-wide errors, unrelated, unchanged before/after) |
| `eslint` on target file | 0 errors |
| `next build` | webpack compile succeeds ("✓ Compiled successfully"); the build's post-compile type-check step fails, but on `app/api/account/me/cancel-deletion-request/route.ts` (unrelated file, stale Supabase generated types) — confirmed byte-for-byte identical failure with this diff stashed out, i.e. pre-existing and not introduced here |
| Learner e2e | **Blocked by pre-existing seed bug, tracked separately.** `tests/e2e/full-pilot-loop.spec.ts` step 5 (the only test that drives lesson-complete) is gated behind step 1 (signup), which fails on a Postgres check-constraint violation (`profiles_role_check`) against the local Supabase seed — confirmed identical failure with this diff stashed out. Not caused by this change; user confirmed it's a known baseline bug being fixed as a separate task. |

## Incident during this session (disclosed for the record)
Mid-verification I ran `git stash` / `git stash pop` three times to get clean before/after diffs for baseline comparisons. The third pop silently dropped this file's changes (reverted to HEAD) while restoring unrelated pre-existing uncommitted changes in other files (`app/api/cron/*`, `lib/stripe/cert-event-handlers.ts` — not mine, already dirty before this session). Caught it immediately via `git diff` coming back empty, recovered the exact reviewed-and-fixed version from a dangling git blob (`git fsck --unreachable`, grepped for `previousComplete`), and reapplied it via a byte-for-byte diff check against the recovered blob. Confirmed via `diff` against `git show HEAD:...` that the final file matches only the intended 5-line change. No further `git stash` used for the rest of this session.

## Outstanding
- E2E confirmation of the actual optimistic-UI behavior is blocked by the pre-existing seed/DB issue above — recommend fixing the `profiles_role_check` seed mismatch separately (out of this phase's scope lock) so `full-pilot-loop.spec.ts` step 5 can actually exercise lesson-complete.
