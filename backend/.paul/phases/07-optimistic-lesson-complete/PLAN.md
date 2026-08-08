---
description: "Phase 07 — optimistic lesson-complete UI"
type: Plan
about: "aw-phase07"
---

# Plan: Optimistic lesson-complete

## Goal
"Mark lesson complete" updates UI immediately, reconciles with server response, rolls back on failure. Behavior-preserving on server; no API contract change.

## Scope lock
Touch ONLY:
- `app/(learner)/learner/courses/[moduleId]/[lessonId]/page.tsx`

No separate client child owns mark-complete — button + handler both live in this file. No additional files needed.

## Boundaries
- `app/api/lesson/[lessonId]/complete/route.ts` — READ ONLY (confirmed response shape: `{ ok, status, justCompleted }`). Not touched.
- No change to fetch URL, method, headers, or request body.
- No change to `handleMarkComplete`'s call sites (`onClick`, `onEnded`).

## Change
`handleMarkComplete()` in page.tsx:
1. Snapshot `previousComplete = isComplete` before mutating.
2. Set `isComplete = true` optimistically, before the network call.
3. On success: reconcile `isComplete` from the server's `status` field (parse response body once, reuse for both the `!res.ok` error path and the success path).
4. On failure (non-ok response or thrown error): roll back `isComplete` to `previousComplete`, set `completeError`.
5. `completing` flag unchanged in purpose (still disables double-submit / shows "Saving…"); button visibility still gated on `!isComplete`, so optimistic set hides the button immediately — this IS the desired optimistic behavior.

## Definition of done
- `npx tsc --noEmit` → 0 errors
- lint → 0 errors
- `npm run build` → 0 errors
- learner e2e (lesson complete flow) → green

## Verify gate
Fresh review subagent audits diff for:
1. Any edit outside scope-locked file
2. Any server-side/API-contract change
3. Any rollback path leaving UI inconsistent with server state on failure
