# AllergenWise

AllergenWise is a B2B SaaS platform that certifies restaurant staff in food-allergen safety, then lists certified restaurants in a public directory so allergy-aware diners can find safe places to eat. Restaurant admins onboard and invite their team, staff complete a 5-module course and 25-question exam, and approved restaurants earn a public listing with an AllergenWise Certified badge.

---

## Tech stack

| Layer | Choice |
|---|---|
| Framework | Next.js 14 (App Router) + TypeScript |
| Styling | Tailwind CSS (teal palette) + shadcn/ui primitives (custom-restyled) |
| Icons | Lucide React |
| Database | Supabase (Postgres + Auth + Storage + RLS) |
| Auth | Supabase Auth (magic link for learners, email+password for admins/reviewers) |
| Payments | Stripe (Checkout + Customer Portal + Webhooks) |
| Email | Resend + React Email |
| Video | Mux (adaptive bitrate, signed playback URLs) |
| PDF | @react-pdf/renderer (server-side cert generation) |
| Maps | Mapbox GL JS |
| Search | Postgres full-text + pg_trgm trigram |
| Hosting | Vercel |
| Testing | Vitest (unit) + Playwright (E2E) |

---

## Run locally

### 1. Install dependencies

```bash
pnpm install
```

> **CI gate (P1-15):** Enforced in `.github/workflows/ci.yml`, which runs `pnpm install --frozen-lockfile` (not plain `pnpm install`). Runtime dependencies in `package.json` are exact-pinned for reproducible builds; `--frozen-lockfile` fails CI if `package.json` and `pnpm-lock.yaml` drift, preventing silent transitive bumps from reaching production.

### 2. Set up environment variables

Copy `.env.example` to `.env.local` and fill in all values:

```bash
cp .env.example .env.local
```

Required services:
- **Supabase**: Create a project at [supabase.com](https://supabase.com). Copy the project URL and anon key. Set `SUPABASE_SERVICE_ROLE_KEY` from Settings > API.
- **Stripe**: Create an account, get test-mode keys. Run `stripe listen --forward-to localhost:3000/api/stripe/webhook` for local webhook testing.
- **Mux**: Create an account at [mux.com](https://mux.com). Get token ID + secret + signing key.
- **Resend**: Create an account at [resend.com](https://resend.com). Get API key. Set `RESEND_FROM_EMAIL`.
- **Mapbox**: Create an account at [mapbox.com](https://www.mapbox.com). Get a public token.

### 3. Run database migrations

```bash
# Using Supabase CLI (recommended)
supabase link --project-ref <your-project-ref>
supabase db push

# Or using psql
psql $DATABASE_URL -f db/migrations/0001_init.sql
psql $DATABASE_URL -f db/migrations/0002_indexes.sql
psql $DATABASE_URL -f db/migrations/0003_rls.sql
psql $DATABASE_URL -f db/migrations/0004_storage.sql
```

Seed demo data (**local database only** — the command refuses anything else):
```bash
pnpm db:seed
```

`pnpm db:seed` runs `scripts/seed-db.ts`, which defaults to the local Supabase
Postgres and refuses any non-local `DATABASE_URL` (T-37). Do not run
`psql $DATABASE_URL -f db/seed.sql` by hand — that is the unguarded form, and
`.env.local` points at the hosted project.

See `db/README.md` for full migration documentation.

### 4. Start the dev server

```bash
pnpm dev
```

App runs at [http://localhost:3000](http://localhost:3000).

---

## pnpm scripts

| Command | Description |
|---|---|
| `pnpm dev` | Start Next.js dev server |
| `pnpm build` | Production build |
| `pnpm start` | Start production server |
| `pnpm typecheck` | TypeScript type check (no emit) |
| `pnpm lint` | ESLint |
| `pnpm test` | Run Vitest unit tests |
| `pnpm test:watch` | Vitest in watch mode |
| `pnpm test:e2e` | Run Playwright E2E tests |
| `pnpm db:push` | Push migrations via Supabase CLI (can target the linked hosted project) |
| `pnpm db:reset` | Reset the local Supabase database |
| `pnpm db:seed` | Seed `db/seed.sql` — local databases only, refuses a non-local `DATABASE_URL` |
| `pnpm db:seed-auth` | Create the 3 demo auth users — local only, refuses a non-local target |
| `pnpm db:seed-with-auth` | `db:seed-auth` then `db:seed` — both halves guarded |
| `pnpm email:dev` | React Email dev server on :3001 |

---

## Project structure

```
/allergenwise
├── app/                          # Next.js App Router
│   ├── (public)/                 # Marketing + directory (public, no auth)
│   │   ├── layout.tsx            # Top nav + footer
│   │   ├── page.tsx              # Landing page
│   │   ├── pricing/page.tsx      # Pricing cards
│   │   ├── directory/page.tsx    # Restaurant directory list + map
│   │   ├── directory/[slug]/page.tsx   # Restaurant detail
│   │   └── verify/[certId]/page.tsx    # Public cert verification
│   ├── (auth)/                   # Auth flows
│   │   ├── layout.tsx            # Centered card layout
│   │   ├── login/page.tsx
│   │   ├── signup/page.tsx
│   │   └── invite/[token]/page.tsx
│   ├── (admin)/                  # Restaurant admin (role=admin)
│   │   ├── layout.tsx            # Sidebar + TopBar shell
│   │   ├── dashboard/page.tsx
│   │   ├── roster/page.tsx
│   │   ├── invite/page.tsx
│   │   ├── billing/page.tsx
│   │   └── submit/page.tsx
│   ├── (learner)/                # Employee learner (role=learner)
│   │   ├── layout.tsx
│   │   ├── courses/page.tsx
│   │   ├── courses/[moduleId]/[lessonId]/page.tsx
│   │   ├── exam/page.tsx
│   │   ├── complete/page.tsx
│   │   └── certificate/page.tsx
│   ├── (reviewer)/               # Internal reviewer (role=reviewer)
│   │   ├── layout.tsx
│   │   ├── queue/page.tsx
│   │   └── queue/[submissionId]/page.tsx
│   ├── 403/page.tsx              # Access denied
│   ├── not-found.tsx             # 404
│   ├── loading.tsx               # Global loading skeleton
│   ├── error.tsx                 # Global error boundary
│   └── api/
│       ├── search/route.ts
│       ├── certs/generate/route.ts
│       ├── invites/send/route.ts
│       ├── stripe/webhook/route.ts
│       └── reviews/submit/route.ts
├── components/
│   ├── ui/                       # shadcn primitives (AllergenWise-restyled)
│   │   ├── button.tsx            # Primary=teal-600, Secondary=white, Danger=red
│   │   ├── input.tsx             # 38px, teal focus ring
│   │   ├── select.tsx, textarea.tsx, label.tsx
│   │   ├── card.tsx, dialog.tsx, tabs.tsx
│   │   ├── tooltip.tsx, dropdown-menu.tsx
│   │   ├── avatar.tsx, badge.tsx, table.tsx
│   │   ├── separator.tsx, skeleton.tsx, progress.tsx
│   │   ├── alert.tsx, form.tsx (react-hook-form + zod)
│   │   ├── data-table.tsx        # Sortable table wrapper
│   │   └── sonner.tsx            # Toast re-export
│   ├── shell/                    # App chrome (already built)
│   │   ├── Sidebar.tsx, TopBar.tsx, PageHeader.tsx
│   │   ├── RoleGate.tsx, StatCard.tsx, EmptyState.tsx
│   ├── allergen/                 # AllergenWise brand components
│   │   ├── AllergenBadge.tsx     # Small pill per allergen
│   │   ├── AllergenTag.tsx       # Icon + label tag (restaurant detail)
│   │   ├── CertBadge.tsx         # "AllergenWise Certified" shield badge
│   │   └── index.ts
│   ├── course/index.ts           # Phase 1 Agent C populates
│   └── directory/index.ts        # Phase 1 Agent D populates
├── lib/
│   ├── supabase/{server,client,middleware}.ts
│   ├── stripe.ts, mux.ts
│   ├── email/client.ts
│   ├── types/db.ts               # All table + enum types
│   └── utils.ts                  # cn() helper
├── db/
│   ├── migrations/
│   │   ├── 0001_init.sql         # Extensions + 13 tables + triggers
│   │   ├── 0002_indexes.sql      # FTS, trigram, geo, composite indexes
│   │   ├── 0003_rls.sql          # RLS on every table + all policies
│   │   └── 0004_storage.sql      # Storage buckets + storage.objects RLS
│   ├── seed.sql                  # Demo data (development only)
│   └── README.md
├── content/
│   └── curriculum.json           # Phase 1 Agent C populates
├── tests/
│   ├── e2e/                      # Playwright
│   └── unit/                     # Vitest
├── middleware.ts                 # Auth + role redirects
├── tailwind.config.ts            # Teal design tokens
└── .env.example                  # All required env vars
```

---

## Design system

All UI follows the **TalentLMS-inspired** design direction from `MVP_BUILD.md §2A`:

- **Primary color**: Teal (`primary-600` = `#0d9488`) for all primary buttons, active nav, badges
- **Fonts**: Inter (UI), Georgia (certificates only), JetBrains Mono (code)
- **Density**: TalentLMS-compact — 13px body, 38px inputs/buttons, 12-16px table cell padding
- **Sidebar**: Dark navy (`#1a2332`), teal-700 active left border, collapsible
- **No emoji in chrome**: Lucide icons only in sidebar, buttons, table actions

Key component conventions:
- `<Button variant="primary">` — teal-600, 38px tall
- `<Button variant="secondary">` — white bg, surface-border
- `<Input>` — 38px, teal focus ring (`shadow-focus`)
- `<Card>` + `<CardTitle>` — white card, uppercase label, ink-500
- `<DataTable>` — sortable, with EmptyState when no rows
- `<StatCard>` — for dashboard metric widgets
- `<EmptyState>` — for zero-data states (Lucide icon + title + optional CTA)
- `<AllergenBadge>` — small teal pill per allergen
- `<CertBadge>` — "AllergenWise Certified" shield badge
