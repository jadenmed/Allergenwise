# AllergenWise — Database Migrations

## Overview

Migrations are plain SQL files numbered sequentially. Run them in order against your Supabase project before starting the app.

```
db/migrations/
  0001_init.sql     — Extensions, all 13 tables, updated_at triggers
  0002_indexes.sql  — Performance indexes (FTS, trigram, geo, composite)
  0003_rls.sql      — Row Level Security on every table + policies
  0004_storage.sql  — Supabase Storage buckets + storage.objects RLS
  0005..0010_*.sql  — Phase 1 incremental: invite tokens, csv drafts, lesson started_at,
                       review rate limits, decide_submission fn, cert warnings
db/seed.sql            — Full demo data (restaurants + profiles + curriculum + reviews).
                         FKs to auth.users — needs a pre-script to create matching auth users.
db/seed-curriculum.sql — Curriculum-only subset (modules + lessons + exam_questions). No
                         auth FKs — safe to run anywhere; required by tests/e2e.
```

---

## Local development (recommended)

Migrations live in `db/migrations/`. The Supabase CLI reads `supabase/migrations/`,
so a symlink bridges the two: `supabase/migrations -> ../db/migrations`. Verify with
`ls -la supabase/migrations/` — should show all 10 SQL files.

```bash
brew install supabase/tap/supabase   # one-time
supabase init                        # creates supabase/config.toml (one-time)
supabase start                       # spin up local stack (Postgres + Auth + Storage)
pnpm db:reset                        # drops local DB + replays all migrations

# Seed curriculum so e2e tests can run (no auth FKs):
psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -f db/seed-curriculum.sql
```

After `supabase start`, copy the printed local URL + anon + service-role keys into
`.env.local`. The e2e suite skip-gate opens once `NEXT_PUBLIC_SUPABASE_URL` is the
local URL and the schema is applied.

## Cloud deploy

```bash
supabase link --project-ref <your-project-ref>   # one-time
pnpm db:push                                     # pushes pending migrations to linked project
```

To seed demo data locally:
```bash
supabase db reset --seed-file db/seed.sql
```

---

## Option 2 — Raw psql

```bash
# Set your connection string
export DATABASE_URL="postgresql://postgres:<password>@db.<project-ref>.supabase.co:5432/postgres"

# Run migrations in order
psql $DATABASE_URL -f db/migrations/0001_init.sql
psql $DATABASE_URL -f db/migrations/0002_indexes.sql
psql $DATABASE_URL -f db/migrations/0003_rls.sql
psql $DATABASE_URL -f db/migrations/0004_storage.sql

# Seed demo data (development only)
psql $DATABASE_URL -f db/seed.sql
```

---

## Notes

- `0003_rls.sql` creates `auth_role()` and `auth_restaurant_id()` helper functions. These are `security definer` functions — they run as the table owner, not the requesting user, to avoid infinite recursion in profile policies.
- Storage bucket creation in `0004_storage.sql` uses `ON CONFLICT DO NOTHING` — safe to re-run. If you create buckets manually in the Supabase dashboard, skip that section and only run the RLS policies.
- Never run `db/seed.sql` against production. It inserts rows with hard-coded UUIDs and `example.test` email addresses.
- The `updated_at` trigger is applied to: `restaurants`, `profiles`, `subscriptions`, `lesson_progress`, `submissions`. Append-only tables (`activity_events`, `stripe_events`) and content tables (`modules`, `lessons`, `exam_questions`, `certificates`, `reviews`) do not have `updated_at`.
