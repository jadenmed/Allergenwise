# Manager Course — Architecture Plan

> **Status:** Draft v1. Architecture only — no code, no content, no Mux uploads.
> **Author:** Planning session 2026-05-29.
> **Transcription note:** Saved from the planning-session output; obvious streaming
> typos were repaired but no technical decision was altered. The canonical numbering
> in §9/Appendix A assumed the rename migration would be `0018`; in the actual repo
> `0018_shared_question_bank.sql` already exists, so PR 1's rename migration is
> **`0019_rename_admin_to_manager.sql`** and PR 2's courses migration shifts to `0020`.
> **Decisions locked in this session:**
> 1. The `admin` role is renamed to `manager`. No new role added.
> 2. Manager course is a **gate**: roster view, invite/assign learners, and reminder nudges only unlock after the manager passes the course.
> 3. No manager certificate. A `manager_qualified_at` timestamp on the profile is the gate token.
> 4. Course content lives in a new `courses` table with FK from `modules` and `exam_questions`.
> 5. Multiple managers per restaurant, shared roster. Each manager passes the course individually.
> 6. Billing: included in existing quarterly/semiannual subscription. No new Stripe SKU.

---

## 1. The shape of the change in one paragraph

Today AllergenWise has one course (worker training), one role hierarchy (`admin` / `learner` / `reviewer`), and one certificate type. The client wants a second course (manager training) that gates the existing admin-tier features. The cleanest way to land that is: (a) rename `admin` → `manager` everywhere, (b) introduce a real `courses` concept so the existing course becomes "Worker Course" and the new one becomes "Manager Course", (c) make `lesson_progress` and `exam_attempts` course-aware, (d) add a `manager_qualified_at` timestamp on the profile that's set when a manager passes the manager exam and is the source-of-truth check for every gated feature, and (e) extend the existing invite/reminder infrastructure to support the manager-→-employee reminder direction. No new role, no new certificate, no new Stripe product.

---

## 2. Schema changes

### 2.1 New table: `courses`

```sql
create table courses (
  id              uuid primary key default gen_random_uuid(),
  slug            text unique not null,            -- 'worker' | 'manager' | future
  title           text not null,
  description     text,
  audience        text not null check (audience in ('worker','manager')),
  pass_threshold  int not null default 80,         -- exam pass %
  exam_questions_drawn int not null default 25,    -- # questions per attempt
  exam_time_limit_seconds int not null default 1800,
  is_active       boolean not null default true,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);
```

Seed two rows: `worker` (existing) and `manager` (new).

**Why a table not an enum:** the moment you have two courses you'll eventually have three (refresher, language variants, franchise-specific). A table lets you add one with a seed insert; an enum requires a migration every time. Per-course exam config (threshold, question count, time limit) was hardcoded in the codebase; this table is where it should have lived from day one.

### 2.2 `modules.course_id` and `exam_questions.course_id`

```sql
alter table modules
  add column course_id uuid references courses(id);
alter table exam_questions
  add column course_id uuid references courses(id);
```

Backfill: every existing row gets the `worker` course id. Then `set not null` + index.

`(course_id, order_index)` becomes the new uniqueness constraint on modules (the existing `order_index unique` constraint must be dropped — both courses need their own module 1).

### 2.3 `lesson_progress` and `exam_attempts` become course-aware

`lesson_progress` already keys by `(profile_id, lesson_id)` and lessons belong to modules which now belong to courses — so it's transitively course-aware with no schema change.

`exam_attempts` needs an explicit `course_id` column. Today a profile has one exam history; tomorrow a manager has two (worker + manager). Add:

```sql
alter table exam_attempts
  add column course_id uuid references courses(id);
```

Backfill existing rows to the `worker` course id, then `set not null`. The unique-active-attempt logic (only one in-flight attempt per learner per course) gets a partial unique index keyed on `(profile_id, course_id)` where `submitted_at is null`.

### 2.4 The role rename

```sql
-- profiles.role check constraint
alter table profiles drop constraint profiles_role_check;
alter table profiles add constraint profiles_role_check
  check (role in ('manager','learner','reviewer'));

-- data migration
update profiles set role = 'manager' where role = 'admin';
```

The `Role` TS union becomes `'manager' | 'learner' | 'reviewer'`. Reviewer stays as-is — it's flagged provisional in `CONTEXT.md` and is not in scope here.

### 2.5 The gate token

```sql
alter table profiles
  add column manager_qualified_at timestamptz;
alter table profiles
  add column manager_course_attempt_id uuid references exam_attempts(id);
```

`manager_qualified_at` is the **single check** for every gated feature. It's set by the exam-submit handler when a manager passes the manager course exam. It's cleared (set to `null`) if the qualifying attempt is invalidated for any reason (admin override, fraud finding). The `manager_course_attempt_id` lets the audit trail point to which specific attempt qualified them.

**Open decision:** does `manager_qualified_at` expire? Worker certificates expire on a 2-year cycle. The manager qualification probably should too — see §10 open questions.

### 2.6 Activity event types

```ts
| 'manager_course_started'
| 'manager_course_passed'
| 'manager_course_failed'
| 'manager_qualified'                  // when manager_qualified_at is set
| 'manager_qualification_revoked'      // when set back to null
| 'manager_reminder_sent'              // manager → learner reminder
```

The `manager_qualified` event is the audit hook that compliance / disputes will care about later.

---

## 3. The gate — one helper, used everywhere

Every gated feature checks `manager_qualified_at is not null` on the calling user's profile. The check lives in **one** server-side helper:

```ts
// lib/manager/gate.ts
export async function requireManagerQualified(supabase, userId): Promise<Profile> {
  const profile = await fetchProfile(supabase, userId);
  if (profile.role !== 'manager') throw new ForbiddenError('not_manager');
  if (!profile.manager_qualified_at) throw new ForbiddenError('manager_course_required');
  return profile;
}
```

This is called by:

- The `(manager)` route layout (replaces `(admin)/layout.tsx`)
- Every `/api/manager/*` route handler (replaces `/api/admin/*`)
- Middleware fast-path that 302s an unqualified manager to `/manager/course` instead of letting them hit a 403

**Important:** there are two distinct unauthorized states the gate handles separately. (a) "You're not a manager at all" → 403. (b) "You're a manager but you haven't passed the course yet" → 302 to the manager course. Confusing these is a UX failure — a new manager landing on a 403 page would think they were locked out of the product. The helper returns a discriminated error and the route shell branches on it.

### 3.1 RLS does NOT enforce the gate

The gate is enforced at the application layer, not in RLS policies. Rationale:

- RLS in this codebase scopes by `role` + `restaurant_id`, not by qualification state.
- The qualifying flow itself needs the user to *be* a manager (to take the manager course), so an RLS check on `manager_qualified_at` for manager-tier reads would create a chicken-and-egg.
- Defense in depth still holds: an unqualified manager can read curriculum (correct — they need to take the course), but cannot write invites, view team progress, or send reminders, because every write/read of those tables goes through a `/api/manager/*` handler that calls `requireManagerQualified`.

The RLS policies that today read `auth_role() = 'admin'` are renamed verbatim to `auth_role() = 'manager'`. No new policies, no new helper functions. The `auth_role()` security-definer function stays; it now returns `'manager'` instead of `'admin'` for the same users.

---

## 4. Course modeling at the content layer

### 4.1 Modules and lessons

A module belongs to exactly one course. A lesson belongs to exactly one module. So a lesson belongs to exactly one course transitively. The worker course has 5 modules (existing). The manager course will have its own module count — TBD by content, but the schema is independent.

### 4.2 Exam questions

An exam question belongs to a course. The exam-draw service today picks 25 random questions from `exam_questions`; tomorrow it picks 25 from `exam_questions where course_id = :courseId`. The draw weights by `difficulty` and `module_id`; those continue to work because both columns persist.

### 4.3 Mux video integration

No schema change. `lessons.video_mux_playback_id` already exists. Manager-course lessons get their own Mux assets, same column, same Mux account. The Mux signed-URL helper (if any — verify in `lib/video/`) is course-agnostic; it takes a playback ID and returns a signed URL, doesn't care which course the lesson belongs to.

### 4.4 Quick-check questions

`lessons.quick_check_question` and `lessons.quick_check_options` already exist. Manager-course lessons populate them the same way worker-course lessons do.

### 4.5 The order-index uniqueness gotcha

The existing schema has `lessons (module_id, order_index) unique` — fine, scoped to module. But `modules` has `order_index unique` globally. That has to drop and become `(course_id, order_index) unique` so the manager course can have its own module 1, module 2, etc.

---

## 5. Routes & URL topology

```
app/(manager)/                          # renamed from (admin)
  manager/dashboard/page.tsx            # current /admin/dashboard
  roster/page.tsx                       # current /admin/roster — GATED
  invite/page.tsx                       # current /admin/invite — GATED
  billing/page.tsx                      # current /admin/billing — NOT GATED (billing must work pre-course)
  submit/page.tsx                       # current /admin/submit — GATED
  course/                               # NEW — the manager course itself
    page.tsx                            # overview / module list
    [moduleId]/[lessonId]/page.tsx
    exam/page.tsx
    complete/page.tsx
  layout.tsx                            # calls requireManagerQualified; routes /manager/course exempt
```

**Why billing is not gated:** if a manager loses payment access until they pass the course, they can't pay for the subscription that funds the course, and the system deadlocks on the very first signup. Billing, plan management, and the initial restaurant submission must remain accessible to any `manager`-role user regardless of qualification. The gate applies to operational features (roster, invite, reminders), not commercial ones.

**API mirror:**

```
/api/manager/*           # was /api/admin/*
/api/manager/course/...  # new — exam submit, lesson progress for manager course
/api/manager/remind-worker  # new — manager-initiated worker reminder (see §6)
```

The `/api/admin/*` paths will need redirects (301s) or temporary aliases — see §9 migration strategy.

---

## 6. Reminder mechanics — the part you specifically asked about

Today's reminder infrastructure has two pieces:

1. **`/api/invites/remind`** — admin-initiated, re-sends an invite email to a specific pending learner.
2. **`/api/cron/weekly-admin-digest`** — weekly cron that emails admins a digest ("here's what's happening with your team").

The new architecture extends both with **manager-→-employee progress reminders**, distinct from invite reminders.

### 6.1 Manager-initiated reminders (synchronous)

New endpoint: `POST /api/manager/remind-worker`

Body: `{ learnerProfileId: string, scope: 'course_not_started' | 'course_in_progress' | 'exam_not_taken' | 'cert_expiring' }`

The handler:

1. Calls `requireManagerQualified` (must be qualified to send reminders).
2. Verifies the learner is at the same restaurant.
3. Picks the appropriate email template based on `scope`.
4. Rate-limits (per manager, per learner, per scope, e.g., once per 72h — prevent harassment loops).
5. Sends via Resend.
6. Logs `manager_reminder_sent` activity event for audit.

### 6.2 Automated reminders (cron-driven)

The existing `weekly-admin-digest` cron renames to `weekly-manager-digest` and additionally now generates per-learner reminder candidates. Two crons:

- **Weekly manager digest** (Mondays, current cadence): one email per qualified manager summarizing team status — who hasn't started, who's stalled, who's expiring within 30 days.
- **Auto-nudge cron** (new, daily or every-3-days): emails learners directly when they meet a threshold (e.g., invited >7 days ago and not started; in-progress >14 days with no activity). The email is "from your manager" — names the manager, comes from the system address.

Both crons need to be aware that a learner can only receive a finite number of nudges (cap at, say, 3 over the course lifetime) to avoid spam fatigue. State for "how many nudges has this learner received" goes on a new column or is computed from `activity_events` of type `manager_reminder_sent`. Recommend computed — `activity_events` is already the audit log of record.

### 6.3 The "invite shared, now remind" flow you described

When an invite link is shared with a learner and they don't act on it, two reminder paths fire:

1. Invite-not-accepted: the existing `/api/invites/remind` handles this (re-send the invite email to a still-pending account).
2. Invite-accepted-but-course-not-started: the new manager-initiated and cron-auto reminders handle this.

The distinction matters because the email copy is different: "you haven't accepted your invitation yet" vs "you've accepted but haven't started the course." Both should exist; the existing template `InviteReminder` covers the first, a new template `CourseProgressReminder` covers the second.

---

## 7. The data model end-to-end (mental picture)

```
restaurants
└── profiles (role: manager | learner | reviewer)
│     ├── manager_qualified_at        ← GATE
│     └── manager_course_attempt_id   ← AUDIT POINTER
│
courses
├── worker   ──┐
└── manager  ──┤
              ├──> modules (course_id)
              │      └── lessons
              ├──> exam_questions (course_id)
              └──> exam_attempts (course_id, profile_id)
                     └── on pass + course=manager → set profiles.manager_qualified_at
                     └── on pass + course=worker  → existing cert issuance flow (unchanged)
certificates (unchanged — worker cert only)
```

---

## 8. Concrete migration impact (this is the cost of the rename)

A grep across the repo found `'admin'` appearing many times across many files, including all the RLS policies, `middleware.ts`, every `/api/admin/*` route, the `(admin)/` route tree, type definitions, email templates, navigation helpers, signup/invite logic, and tests. The rename is mechanical but touches a lot of surface.

### 8.1 Files that change for the role rename

**Production code (must change):**

- `lib/types/db.ts` — `Role` union, `Profile` type
- `middleware.ts` — role redirect logic
- `lib/auth/signup.ts`, `lib/auth/invite.ts` — role assignment
- `lib/admin/csv.ts`, `lib/admin/eligibility.ts` — likely rename to `lib/manager/` (PR 2)
- `lib/billing/subscription.ts` — role checks
- `lib/account/deletion-warnings.ts` — role-aware messages
- `lib/email/templates/WelcomeAdmin.tsx`, `PlanExpiringSoon.tsx`, `RestaurantInfoRequested.tsx` — rename + copy (file renames in PR 2)
- `lib/nav.ts` — nav links
- `lib/reviewer/decide.ts` — role checks
- `components/shell/Sidebar.tsx` — role-aware nav
- All `/api/admin/*` routes (move + rename role string) — 8 routes
- All `app/(admin)/` pages (move to `(manager)/`) — 5 pages + 3 client components
- `app/(admin)/layout.tsx` — role check + gate
- `app/api/lesson/[lessonId]/*` — role checks
- `app/api/invites/*` — role checks
- `app/api/stripe/*`, `app/api/auth/signup/*`, `app/api/exam/submit/*` — role checks
- `app/api/account/me/request-deletion` — role-aware

**DB migrations (must change):**

- `0001_init.sql` — historical; the rename happens in a NEW migration, do not edit historical migrations
- `0003_rls.sql`, `0011_rls_hardening.sql` — historical; new migration drops/recreates affected policies with the new role string
- `0013_cert_state.sql` — historical (NOTE: its `revocation_reason='admin'` is a reason-code, NOT a role — do not rename)
- New migration `0019_rename_admin_to_manager.sql` — drops constraint, updates data, recreates constraint, drops + recreates all RLS policies referencing `'admin'`
- New migration `0020_courses_and_gate.sql` — courses table, course_id columns, manager_qualified_at, manager_course_attempt_id
- Update `db/seed.sql` and `db/seed-curriculum.sql` to use new role + course_id
- Update `scripts/seed-auth-users.ts`

**Test suite (must change):**

- Many test files reference `'admin'` role string explicitly. All have to flip. The test for the rename itself (does old role get blocked, does new role work) is a new test.

**Docs (must change):**

- `CONTEXT.md` — role description in roles section
- `docs/api-contracts/B-admin.md` → `B-manager.md`
- `audits/api-contract-for-ui-handoff.md` — references
- `design-system/allergenwise/MASTER.md` — if it references admin role (verify)

### 8.2 Files that change for the gate

- `lib/manager/gate.ts` — new helper
- `app/(manager)/layout.tsx` — calls gate
- All `/api/manager/*` routes that are gated — call gate at top of handler
- `middleware.ts` — fast-path redirect change

### 8.3 Files that change for the course model

- `lib/types/db.ts` — `Course` interface, `CourseSlug` type, update `Module`, `Lesson`, `ExamQuestion`, `ExamAttempt`
- `db/migrations/0020_courses_and_gate.sql` (above)
- `app/api/exam/submit/route.ts` — must read `course_id` from the attempt, branch on it for cert issuance vs manager-qualification
- `app/(learner)/learner/exam/page.tsx` — needs course context (which exam am I taking?)
- `app/(learner)/learner/courses/page.tsx` — filter by course_id
- Course-draw exam service — filter by course_id

---

## 9. Migration / rollout strategy

The rename and the new feature are best done as **two separate migrations and two separate PRs**, in this order:

**PR 1 — Rename `admin` → `manager` (mechanical, no behavior change).**

- Migration `0019_rename_admin_to_manager.sql`: update profiles.role data, drop/recreate check constraint, drop/recreate all RLS policies that reference `'admin'`.
- Codemod every `'admin'` string in role context to `'manager'`. Leave URLs as `/admin/*` to keep this PR purely about the role string (URL renames in PR 2). Add a code comment block at the top of the migration listing every dropped/recreated policy by name.
- Update all tests. Run full test suite. Run RLS integration tests specifically.
- This PR ships independently of the manager course feature. It's reversible by re-running the migration in reverse.

**PR 2 — Course model + manager gate + manager course content shell.**

- Migration `0020_courses_and_gate.sql`: create `courses` table, seed `worker` + `manager` rows, add `course_id` columns and backfill, drop old `modules.order_index` unique, add new composite uniques, add `manager_qualified_at` and `manager_course_attempt_id`.
- Add `lib/manager/gate.ts` and call it from `(manager)/layout.tsx` and `/api/manager/*` routes.
- Move `app/(admin)/` → `app/(manager)/` and `/api/admin/*` → `/api/manager/*`. Add 301 redirects from old paths.
- Update exam-submit handler to branch on `course_id`: worker → existing cert flow; manager → set `manager_qualified_at`.
- Add manager course route tree shell: `/manager/course`, `/manager/course/[moduleId]/[lessonId]`, `/manager/course/exam`, `/manager/course/complete`.
- DO NOT add manager course content (lessons, videos, exam questions) in this PR. That's PR 3 and is content work, not architecture.
- Add reminder endpoint `/api/manager/remind-worker` and the new cron `weekly-manager-digest` + auto-nudge.

**PR 3 — Manager course content seed.**

- Curriculum content goes in `db/seed-manager-curriculum.sql`.
- Mux assets uploaded; playback IDs go in the seed.
- Exam questions authored; go in the seed.
- This is content work; the architecture is already in place.

### 9.1 Backwards compatibility for in-flight users

The day the rename ships, every active manager session continues to work because the role string is read from the DB on every request — no JWT carries a stale role. A user mid-course on the worker side is unaffected because their `exam_attempts.course_id` is backfilled to `worker` and their progress continues unchanged.

The only risk is if any code path serializes the role string to a client cookie or JWT claim. Verify there is no such path — `auth_role()` reads from `profiles`, and the middleware reads from `auth.uid()` + a profile lookup. Confirm before shipping.

---

## 10. Open architectural questions (resolve before code)

These are decisions the architecture is *neutral on* — it works either way — but that should be resolved before implementation lands. Each one will silently shape behavior if left unanswered.

1. **Does `manager_qualified_at` expire?** Worker certs expire every 2 years. Manager qualification probably should too — same regulatory pressure. Recommend: yes, on the same 2-year cadence. Mechanism: a `manager_qualification_expires_at` column populated when `manager_qualified_at` is set, and a cron that clears the qualification at expiry. If yes, this is materially a "certificate" with no public verification page — worth revisiting whether option (b) "Internal cert, no verify page" from the earlier question is actually a better fit than a flag.
2. **What happens to the manager's access on the day their qualification expires?** Soft (warning banner, grace period of N days)? Hard (immediate gate-out, must retake to regain access)? Recommend soft 30-day grace, hard after — symmetric with worker cert renewal patterns.
3. **Reminder cadence and cap.** What's the max number of auto-nudges a learner can receive over the course lifetime? Recommend 3. What's the gap between manager-initiated reminders on the same learner? Recommend 72h. These are policy decisions, not technical ones, but the rate-limit code needs the numbers.
4. **Manager-on-manager visibility.** When restaurant X has 3 managers, can manager A see manager B's qualification status? Recommend yes — it's operationally important to know who else is qualified. But manager A should NOT be able to revoke manager B's qualification (that's an admin/billing-owner action). With the role flattened to just `manager`, there's no current concept of "billing owner vs floor manager." If you ever need that distinction, it's a per-profile boolean like `is_billing_owner`, not a new role.
5. **The "1 manager per restaurant signs up" bootstrapping question.** When a restaurant first signs up, the first manager has nobody qualified to invite them through the gated invite flow. How does manager #1 exist? Same way as today: the signup flow creates the first manager directly, bypassing the gate. The gate only protects ongoing invites, not first-account creation. **Audited 2026-05-29: signup is the ONLY production path that creates a manager-role profile. `/api/invites/send` hardcodes `role: 'learner'` and the `profiles_admin_insert_learner` RLS policy (becomes `profiles_manager_insert_learner` after rename) defense-in-depth blocks any other insert attempt. Lock this invariant with a test in PR 1.**
6. **Reviewer role's interaction with the rename.** Reviewer is flagged provisional in CONTEXT.md. This architecture leaves reviewer untouched. If the auto-grading work later removes the reviewer role, the manager course exam should auto-grade too — design the exam-submit handler so it can auto-grade independent of course type from day one (do not route manager-course attempts through `pending_review`).
7. **Existing CONTEXT.md note about lesson quizzes + auto-grading being a "combined redesign."** The manager course adds a third item to that bundle. Either: (a) bundle this work with the lesson-quiz / auto-grading redesign (cheaper overall, slower to ship) or (b) ship the manager course on the existing exam pattern (human-graded via reviewer) and migrate it along with the worker course later. Recommend (b) for speed — but design the exam-submit handler so the migration to auto-grading is a one-line change per course.

---

## 11. What this architecture does NOT solve

- **Incident logging / audit reports** — you mentioned this as a possible manager feature in conversation but did not select it. Not in scope. If added later, it's a new `incidents` table with `restaurant_id` and `logged_by_manager_id`, gated by `manager_qualified_at`, with its own RLS policies.
- **Org-level dashboards across restaurants** (franchise/HQ view) — not in scope. Would require a new `organizations` tenant above `restaurants`.
- **Differential pricing or Stripe SKU for the manager course** — explicitly out per locked decision (bundled with subscription).
- **Multi-language manager course content** — schema supports it (you can seed a third `courses` row with `slug: 'manager-es'`), but no i18n infrastructure exists in the codebase.

---

## 12. The single most important thing to get right

The gate helper. `lib/manager/gate.ts` is called by every gated route and every gated API handler. If it has a subtle bug — returns qualified when it shouldn't, or 403s a billing page that needs to stay open — the entire feature breaks. It needs:

- A dedicated unit test file covering: not-a-manager, manager-not-qualified, manager-qualified, manager-qualified-but-expired (if expiry recommended), profile-not-found, restaurant-not-found.
- An integration test that hits `/api/manager/roster` as an unqualified manager and verifies 403 + the specific error code that triggers the redirect to the course.
- An E2E test that walks a fresh manager through signup → land on dashboard → see "complete manager course" banner → take course → pass exam → see unlocked features.

The gate is one file, but it's the file that the whole feature lives or dies on. Boil the ocean on this one.

---

## Appendix A — DB migration sketches

### `0019_rename_admin_to_manager.sql` (PR 1) — renumbered from 0018 (taken)

```sql
-- 1. Update data
update profiles set role = 'manager' where role = 'admin';

-- 2. Update check constraint
alter table profiles drop constraint profiles_role_check;
alter table profiles add constraint profiles_role_check
  check (role in ('manager','learner','reviewer'));

-- 3. Drop + recreate every RLS policy referencing 'admin'
--    (exhaustive list — see the migration header for the authoritative,
--     post-0018 enumeration across 0003 tables, 0004 storage, and 0018 quiz tables)
-- ...
```

### `0020_courses_and_gate.sql` (PR 2) — renumbered from 0019

```sql
-- 1. courses table
create table courses (...);
insert into courses (slug, title, audience, ...)
  values ('worker', 'Worker Allergen Training', 'worker', ...),
         ('manager', 'Manager Allergen Operations', 'manager', ...);

-- 2. course_id columns + backfill
alter table modules add column course_id uuid references courses(id);
update modules set course_id = (select id from courses where slug = 'worker');
alter table modules alter column course_id set not null;
alter table modules drop constraint modules_order_index_key;
alter table modules add constraint modules_course_order_unique unique (course_id, order_index);

alter table exam_questions add column course_id uuid references courses(id);
update exam_questions set course_id = (select id from courses where slug = 'worker');
alter table exam_questions alter column course_id set not null;

alter table exam_attempts add column course_id uuid references courses(id);
update exam_attempts set course_id = (select id from courses where slug = 'worker');
alter table exam_attempts alter column course_id set not null;
create unique index exam_attempts_one_active_per_course
  on exam_attempts (profile_id, course_id)
  where submitted_at is null;

-- 3. gate columns
alter table profiles add column manager_qualified_at timestamptz;
alter table profiles add column manager_course_attempt_id uuid references exam_attempts(id);

-- 4. new activity event types — handled by lib/types/db.ts union expansion, not DB
```

---

## Appendix B — Quick reference: what changes where

| Layer | Today | Tomorrow |
|---|---|---|
| Role | `admin` / `learner` / `reviewer` | `manager` / `learner` / `reviewer` |
| Course | implicit single | `courses` table with `worker` + `manager` rows |
| Gate | n/a (admin = always allowed) | `profiles.manager_qualified_at not null` |
| Route prefix | `/admin/*`, `/api/admin/*` | `/manager/*`, `/api/manager/*` |
| Roster access | every admin | only qualified managers |
| Invite access | every admin | every manager (not gated) |
| Billing access | every admin | every manager (not gated) |
| Exam attempts | one history per learner | per-course history |
| Reminders | invite-only, admin-triggered | invite + course-progress, manager-triggered + cron |
| Certificate | worker cert | worker cert (manager has no cert) |
| Stripe SKU | quarterly / semiannual | unchanged (manager course bundled) |
