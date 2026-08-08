# AllergenWise — MVP Build Spec

**Version:** 0.1 (MVP)
**Audience:** This is the build spec Claude (or any contractor) follows to ship the MVP. Scope is pilot-grade: clean, credible, not Apple-keynote.
**Source of truth:** `wireframe.html` (19 screens). When this doc and the wireframe disagree, the wireframe wins for layout; this doc wins for behavior, data, and stack.
**Brand color rule:** Teal is the allergen color. Default every UI surface, badge, alert, chart, and accent to teal (Tailwind teal-50 → teal-900, hex `#14b8a6` / `#0d9488` / `#0f766e`). The wireframe uses placeholder blue + warm orange — these get replaced with teal at build time.

**UI direction:** Look and feel modeled after **TalentLMS** (the LMS Guillermo wants the product to evoke). Familiar, calm, professional SaaS. Not "vibe-coded" — no random gradients, no glassmorphism, no over-animated marketing site, no decorative emoji in the UI chrome. See Section 2A for the full UI Direction spec.

---

## 1. Scope summary

Build a pilot-ready SaaS that lets restaurant admins onboard, train, and certify their staff in food-allergen safety, then auto-lists certified restaurants in a public directory parents use to find safe places to eat. Three user roles, 19 screens, Stripe billing, video courseware, certificate generation, public directory with reviews.

**MVP target:** 10–100 paying restaurants in pilot. Single region (US). Web-only (responsive — usable on phone but no native app).

**Explicitly OUT of MVP scope:**
- Real-time websockets (everything is request/response or short polling)
- Native iOS/Android apps
- Multi-language / i18n
- SOC2 / HIPAA compliance audit
- Multi-tenant agency dashboards (chains/groups treated as separate accounts)
- AI-powered features (menu allergen detection, etc.)
- White-label / custom branding per restaurant
- Custom course authoring (curriculum is fixed; admin uploads/edits in DB only)
- SMS notifications (email only)
- Refund automation (handled manually via Stripe dashboard)

These are documented in `PRODUCTION_BUILD.md` for v1.0.

---

## 2A. UI direction (TalentLMS-inspired)

**Reference product: [TalentLMS](https://www.talentlms.com)**. Guillermo wants AllergenWise to feel familiar to anyone who has used a modern LMS — calm, structured, content-forward, slightly enterprise. Not Notion, not Linear, not Apple. Specifically: TalentLMS's clean role-based dashboards, soft-shadow card system, fixed left sidebar, top utility bar, and clear content hierarchy.

This section is non-negotiable for the build. Any contractor (or Claude) defaulting to generic "ShadCN + a gradient hero" is wrong. Reference TalentLMS screenshots before writing any new component.

### 2A.1 Anti-vibe-code rules

The product must NOT look like:
- A landing page with a giant animated gradient hero, a parallax video, and floating cards on scroll.
- "Glassmorphism" anything — no frosted backgrounds, no `backdrop-filter: blur`.
- Emoji used as functional icons in admin/learner chrome (`🎓`, `📚`, `🛡` are fine in marketing copy and on certificates, NOT in the sidebar nav, NOT in dashboard stat cards). Use **Lucide icons** instead, single-color, 16–20px.
- Over-rounded everything (no `rounded-3xl` on cards). TalentLMS uses ~6–8px corner radius.
- Bold accent colors on every surface. Teal is for action (primary buttons, active nav, status badges) and the AllergenWise mark — not for backgrounds, borders, or filler illustration.
- Auto-generated placeholder illustrations from undraw.co or similar. Either commission simple illustrations or use none.
- Three-step onboarding "modals" with cartoon mascots.
- "Powered by [framework]" badges anywhere visible.

The product MUST look like:
- A real B2B SaaS that a 45-year-old restaurant manager would trust with their compliance.
- Dense but readable. White space is functional, not decorative.
- Predictable. Same patterns repeated across screens. Sidebar in same place. Buttons same shape. Forms same layout.

### 2A.2 Design tokens (TalentLMS-mapped, AllergenWise-themed)

```ts
// tailwind.config.ts — extend
export default {
  theme: {
    extend: {
      colors: {
        // Teal (AllergenWise brand / allergen color) — primary action
        primary: {
          50:  '#f0fdfa',
          100: '#ccfbf1',
          200: '#99f6e4',
          300: '#5eead4',
          400: '#2dd4bf',
          500: '#14b8a6',   // primary 500
          600: '#0d9488',   // primary buttons, links
          700: '#0f766e',   // hover, active nav
          800: '#115e59',
          900: '#134e4a',
        },
        // Neutral surface system (TalentLMS uses warm-cool grays)
        surface: {
          page:   '#f6f7f9',  // app background
          card:   '#ffffff',  // card background
          muted:  '#f1f3f6',  // subtle inset surfaces, table headers
          border: '#e3e6eb',  // 1px borders
          divider:'#eef0f3',  // table row dividers
        },
        ink: {
          900: '#1a2332',     // primary text
          700: '#3d4759',     // secondary text
          500: '#6b7589',     // muted text
          400: '#8a93a6',     // placeholder
        },
        // Semantic — used sparingly, never on top of teal accents
        success: { 50: '#ecfdf5', 600: '#059669', 700: '#047857' },
        warning: { 50: '#fffbeb', 600: '#d97706', 700: '#b45309' },
        danger:  { 50: '#fef2f2', 600: '#dc2626', 700: '#b91c1c' },
        info:    { 50: '#eff6ff', 600: '#2563eb', 700: '#1d4ed8' },
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        serif: ['Georgia', 'serif'],   // certificate only
        mono: ['JetBrains Mono', 'ui-monospace', 'monospace'],
      },
      fontSize: {
        // TalentLMS-density: small, readable, no oversized headings outside marketing
        xs:  ['11px', '16px'],
        sm:  ['12px', '18px'],
        base:['13px', '20px'],   // default body in admin/learner
        md:  ['14px', '22px'],
        lg:  ['16px', '24px'],
        xl:  ['18px', '26px'],
        '2xl':['22px','30px'],   // page titles
        '3xl':['28px','36px'],   // marketing only
      },
      borderRadius: {
        sm: '4px',
        DEFAULT: '6px',
        md: '8px',
        lg: '10px',
        xl: '12px',
      },
      boxShadow: {
        // TalentLMS uses very soft, very low-spread shadows
        card:    '0 1px 2px rgba(15, 23, 42, 0.04), 0 1px 3px rgba(15, 23, 42, 0.05)',
        'card-hover': '0 2px 6px rgba(15, 23, 42, 0.06), 0 4px 12px rgba(15, 23, 42, 0.04)',
        focus:   '0 0 0 3px rgba(20, 184, 166, 0.25)',  // teal focus ring
      },
      spacing: {
        // 4px base unit
      },
    },
  },
}
```

### 2A.3 App shell (admin + learner + reviewer)

```
┌────────────────────────────────────────────────────────────────────┐
│  TOP UTILITY BAR — 56px, white, 1px bottom border                  │
│  [☰ collapse]   [🔍 search...]              [🔔]  [Jane ▾]         │
├────────────┬───────────────────────────────────────────────────────┤
│ SIDEBAR    │  PAGE HEADER — 64px, white, 1px bottom border         │
│ 240px      │  ┌─ Page title ────────────────── [Primary action] ┐  │
│ #1a2332    │  └─ Subtitle / breadcrumb ───────────────────────── ┘  │
│ (dark)     │                                                        │
│            │  PAGE BODY — surface.page background, padded 24px      │
│ AllergenWise│                                                        │
│ ▸ Dashboard│  ┌────────────────┐  ┌────────────────┐                │
│   Roster   │  │ Stat card      │  │ Stat card      │                │
│   Invite   │  └────────────────┘  └────────────────┘                │
│   Submit   │                                                        │
│   Billing  │  ┌────────────────────────────────────────────────┐   │
│            │  │ Card header                                    │   │
│ ───        │  │ Card body                                      │   │
│ Help       │  └────────────────────────────────────────────────┘   │
│ Settings   │                                                        │
└────────────┴────────────────────────────────────────────────────────┘
```

- **Sidebar** is dark navy (`#1a2332` matching `ink.900`), not pure black. White text, ~13px, 8px vertical padding per link. Active link gets teal-700 left border (3px) + slightly lighter background (`#243042`). Hover gets `#243042` background only. Collapsible to icon-only at 64px. Brand mark sits at top: small teal shield icon + "AllergenWise" wordmark in white.
- **Top bar** is white with 1px bottom border. Contains: collapse button (left), global search (centered, max 480px wide), notification bell + user dropdown (right). 56px tall.
- **Page header** is white, separates the chrome from content. Title in 22px/600. Optional subtitle 13px/muted. Primary action button right-aligned (max 1 primary, 1 secondary).
- **Page body** background is `#f6f7f9` (`surface.page`). Cards live on top with white background.
- **Cards** are white, 1px border `surface.border`, 8px radius, soft shadow (`shadow-card`), 20px padding default. Card title 14px/600 uppercase letter-spacing 0.03em colored `ink.500`. NOT bold black headlines.
- **Tables** have `surface.muted` headers, 1px row dividers, 12–16px cell padding, hover state `surface.muted`. Sortable column headers get a subtle ↕ icon when hoverable.
- **Forms** are vertical (label above input). Labels 12px/600 ink.700. Inputs 38px tall, 8px horizontal padding, 1px border `surface.border`, focus ring `shadow-focus` (teal). No floating labels. No placeholder-as-label.
- **Buttons**:
  - Primary: `bg-primary-600` text white, hover `bg-primary-700`, 38px tall, 16px horizontal padding, 6px radius, 13px/500.
  - Secondary: white bg, 1px `surface.border`, ink.900 text, hover `surface.muted` bg.
  - Tertiary (text link): no bg, primary-700 text, underline on hover.
  - Danger: `bg-danger-600` text white. Used only for destructive actions, with confirmation modal.
- **Icons**: Lucide, 16px in dense UI (sidebar, table actions), 20px in stat cards / page headers, 24px in empty states. Never colored except: success (green), warning (amber), danger (red). Default ink.500.
- **Modals**: max 480px wide, centered, white card, soft backdrop (rgba black 0.4). Title bar with close X. Footer with Cancel (secondary) + Confirm (primary) right-aligned.
- **Empty states**: simple — small monochrome Lucide icon (24px, ink.400), one-line title (14px ink.700), one-line subtitle (13px ink.500), optional CTA button. No illustrations.

### 2A.4 Dashboard widgets (the TalentLMS pattern)

TalentLMS dashboards are widget-based: small cards showing role-relevant data. AllergenWise mirrors this:

**Admin dashboard widgets:**
1. **Cert readiness** — donut chart (ink.500 ring + teal arc), big % in center.
2. **Employees stat** — number + delta vs last month, small sparkline.
3. **Plan ends in N days** — number + progress bar fraction of term used.
4. **Recent activity** — vertical timeline, last 5 events, each row 36px tall.
5. **Pending invites** — count + "Resend all" link.
6. **Renewal action card** — only appears in last 30 days of term.

**Learner dashboard widgets:**
1. **Continue training** — large card showing current module + progress bar + "Resume" CTA.
2. **My modules** — grid of 5 module cards (status: done/in-progress/locked).
3. **My certificate** — appears post-pass, links to printable cert.
4. **Tips of the day** — short card pulling from a `learner_tips` table; refreshable.

**Reviewer dashboard widgets:**
1. **Queue depth** — count of pending submissions, color-coded (>10 amber, >25 danger).
2. **My active reviews** — list of submissions reviewer has claimed.
3. **This week throughput** — bar chart (Mon–Sun) of approvals/rejections.
4. **Avg review time** — number + delta.

Widgets are NOT user-rearrangeable in MVP (TalentLMS lets admins drag-drop; we don't, to ship faster). Add drag-drop in v1.0.

### 2A.5 Course player chrome (the most TalentLMS-feeling screen)

The course player is the highest-touch surface — staff spend the most time here. Match TalentLMS pixel-for-spirit:

- **Top bar:** smaller (44px), shows breadcrumb (Module 4 / Lesson 2 of 6), exit course button (top-right).
- **Left sidebar:** lesson list within module. Each lesson row: status icon (✓ done, ▶ active, ○ pending) + title (max 2 lines, truncate). Active lesson has teal left border. Below lesson list: collapsible "Other modules" section with all 5 modules listed.
- **Main content:** centered max 760px wide, white background, generous line-height (1.7 for body text).
  - Lesson eyebrow (uppercase 11px tracking-wide ink.500): "LESSON 2 OF 6"
  - Lesson title (22px/600 ink.900)
  - Meta line (13px ink.500): "3:42 video · 2 min read · 1 quick check"
  - Video player (16:9, full-width-of-content, soft 8px radius, dark navy poster bg)
  - Body markdown (15px line-height 1.7, ink.700)
  - Quick check inline: light teal `primary-50` background, 1px `primary-200` border, 16px padding, 8px radius
- **Footer bar:** sticky at bottom of content column (NOT page bottom). "← Previous lesson" (secondary) + "Next lesson →" (primary). Disabled "Next" until video ≥90% watched.
- **Right gutter** (optional, hidden on <1280px): lesson resources — downloadable PDF cheatsheet, glossary terms.

### 2A.6 Public surfaces (marketing + directory)

The PUBLIC surfaces (landing, pricing, directory) get a slightly different treatment — still calm and professional, slightly more visual because they're consumer-facing. But still not "vibe-coded":

- **Landing** is single-color hero (`primary-700` solid background, white text), centered headline (32–40px on desktop, NOT 80px display type), subheadline, two CTA buttons. No animated background, no blob shapes, no scroll-triggered parallax. Three-up feature cards below, plain white with thin border. Logo strip of "trusted by" restaurants (real ones once we have them; placeholder grayscale logos until then).
- **Pricing** is two cards side-by-side, "Best Value" card has 2px teal border (the only place 2px borders are allowed). Same TalentLMS-density.
- **Directory** is the most consumer-feeling surface — looks like a stripped-down Yelp. Cream-tinted page background OK here (`#fbfaf6`), warmer than the SaaS chrome. Restaurant cards still follow the same border/shadow language. Map (Mapbox) on right, list on left, fixed sidebar filter rail on left of list.
- **Restaurant detail** uses a single hero photo (cropped 16:9, max 320px tall, NOT a giant header), restaurant name in 28px serif (Georgia), cert badge directly under name. Reviews use the same card pattern as the rest of the app.

### 2A.7 Cert design

The certificate IS allowed to be a little decorative — it's printed and framed.
- Letter-size landscape, white background.
- Teal-700 double-line border 12px from edge, 4px outer + 1px inner.
- Top center: AllergenWise mark (teal-700 shield with "AW" letterform, 80px wide).
- "Certificate of completion" eyebrow in ink.500 letter-spacing 0.2em.
- "AllergenWise Certified Staff" in 36px serif (Georgia), centered.
- Recipient name in 48px serif italic, centered, hand-signed feel.
- Body paragraph in 14px serif, justified, max 600px wide.
- Bottom: 3-column grid of (Issued / Expires / Cert ID) in label/value pairs, ink.500 labels.
- QR code bottom-right (40px) linking to verify URL.
- "Verify at allergenwise.com/verify/{code}" 10px ink.500 below QR.

### 2A.8 Component library: build vs use

Use **shadcn/ui** as the primitive layer (Button, Input, Select, Dialog, Tabs, Tooltip, DropdownMenu, Toast, Avatar, Badge, Card, Table). Override default styles to match Section 2A.2 tokens — the out-of-box shadcn look is too "developer demo" and not TalentLMS-feeling. Custom components live in `components/allergen/`, `components/course/`, `components/directory/`.

**Forbidden** without explicit Guillermo approval:
- Any pre-built admin template (Tailwind UI Application, Tremor blocks, etc.) — they'll fight the TalentLMS direction.
- Any animated landing-page component library (Aceternity, Magic UI, etc.).
- Headless UI's Combobox/Listbox without TalentLMS-style restyling.

**Approved** to pull from:
- Lucide icons (open source).
- shadcn/ui primitives (paste-into-repo, customize).
- Tremor charts (only if Recharts is too low-level; restyled to match teal+neutral palette).
- React Email components (transactional emails only).

### 2A.9 Per-screen UI mapping

Each wireframe screen maps to a TalentLMS analog. When in doubt, look at the TalentLMS analog before designing:

| AllergenWise screen | TalentLMS analog | Notes |
|---|---|---|
| `landing` | (TalentLMS public marketing) | Solid teal hero, simple feature cards |
| `pricing` | TalentLMS pricing page | Two-card comparison, FAQ accordion |
| `signup` | TalentLMS signup + Stripe | Multi-step form, sidebar order summary |
| `admin-dashboard` | Admin dashboard with widgets | Stat row + readiness donut + activity feed |
| `admin-roster` | Users table | Dense table, status badges, inline actions |
| `admin-invite` | Add users (bulk + single) | Tab between single-add and CSV upload |
| `admin-billing` | Subscription page | Plan card + invoice table |
| `admin-submit` | (custom — no direct analog) | Eligibility banner + form, follows admin shell |
| `learner-home` | My courses | Grid of module cards, progress bar |
| `learner-player` | Course player | Sidebar lesson list + main content + sticky next |
| `learner-exam` | Test/quiz player | Question card, progress bar, navigator strip |
| `learner-complete` | Course completion | Confetti, score card, cert link |
| `learner-cert` | Certificate page | Print-styled, full-bleed |
| `directory` | (custom — no analog) | Yelp-style, warmer surface |
| `directory-detail` | (custom) | Hero photo + tabs |
| `reviewer-queue` | Admin reports table | Same dense table pattern as roster |
| `reviewer-detail` | (custom) | Two-column: data left, decision sidebar right |

### 2A.10 Acceptance criteria (UI)

UI is "done" for MVP when:

1. A new visitor cannot tell the product was built by a solo developer in 10 weeks.
2. A 45-year-old restaurant manager can complete signup → invite → first cert without asking for help.
3. The admin dashboard, learner home, and reviewer queue all share the same visible chrome (sidebar + top bar + page header pattern).
4. Every primary button is teal-600. Every link in body text is teal-700. Every active nav state is teal accent.
5. No emoji icons in the chrome (sidebar, top bar, table actions, buttons). Lucide only.
6. No animated heroes, no glassmorphism, no gradients except the cert seal and (optionally) the landing hero solid color block.
7. All 19 screens look like they belong to the same product (not "designer pages" + "developer pages").
8. The product would be visually credible to someone who has used TalentLMS, Docebo, Lessonly, or Litmos — even if it's a different product.

---

## 2. Tech stack

| Layer | Choice | Why |
|---|---|---|
| Framework | **Next.js 14 (App Router)** + TypeScript | One repo for FE+API, RSC for fast pages, easy Vercel deploy |
| Styling | **Tailwind CSS** + **shadcn/ui** + **Lucide icons** + **Inter** font | TalentLMS-density, teal palette, no emoji in chrome (see Section 2A) |
| Database | **Supabase (Postgres)** | Postgres + auth + storage + RLS in one product |
| Auth | **Supabase Auth** (magic link + password) | Free, integrates with RLS, handles email invites for free |
| File storage | **Supabase Storage** | Restaurant photos, cert PDFs, CSV uploads |
| Payments | **Stripe** (Checkout + Customer Portal + Webhooks) | Industry standard; restaurant admins recognize it |
| Email | **Resend** + **React Email** | Transactional only; templates as React components |
| Video hosting | **Mux** (or Bunny.net for cheaper) | Adaptive bitrate, signed playback URLs, viewing analytics |
| PDF generation | **@react-pdf/renderer** | Server-side cert generation; print-quality |
| Maps | **Mapbox GL JS** (free tier ~50k loads/mo) | Directory map view |
| Search | **Postgres full-text + trigram** | Free, fast enough for <10k restaurants; upgrade to Algolia/Meili at scale |
| Hosting | **Vercel** (frontend + API routes) | Zero-config Next.js, free SSL, edge functions |
| Background jobs | **Vercel Cron** + Supabase Edge Functions | No queue infra needed at MVP scale |
| Monitoring | **Sentry** (free tier) + **Vercel Analytics** | Error tracking + page perf |
| Domain | Cloudflare or Namecheap | Move DNS to Cloudflare for free CDN/DDoS |

**Why this stack:** all services have generous free tiers, all Claude-friendly to scaffold, all replaceable later without rewriting business logic. Total monthly burn at 0–50 restaurants: **~$95/mo**.

---

## 3. Repository layout

```
/allergenwise
├── app/                          # Next.js App Router
│   ├── (public)/                 # Marketing + directory (public)
│   │   ├── page.tsx              # Landing (Screen: landing)
│   │   ├── pricing/page.tsx      # Pricing (Screen: pricing)
│   │   ├── directory/page.tsx    # Directory list+map (Screen: directory)
│   │   ├── directory/[slug]/page.tsx  # Restaurant detail (Screen: directory-detail)
│   │   └── verify/[certId]/page.tsx   # Public cert verification
│   ├── (auth)/
│   │   ├── signup/page.tsx       # Restaurant signup + Stripe Checkout (Screen: signup)
│   │   ├── login/page.tsx
│   │   └── invite/[token]/page.tsx  # Employee invite acceptance
│   ├── (admin)/                  # Restaurant admin (auth required, role=admin)
│   │   ├── dashboard/page.tsx    # (Screen: admin-dashboard)
│   │   ├── roster/page.tsx       # (Screen: admin-roster)
│   │   ├── invite/page.tsx       # (Screen: admin-invite)
│   │   ├── billing/page.tsx      # (Screen: admin-billing)
│   │   └── submit/page.tsx       # (Screen: admin-submit)
│   ├── (learner)/                # Employee learner (auth required, role=learner)
│   │   ├── courses/page.tsx      # (Screen: learner-home)
│   │   ├── courses/[moduleId]/[lessonId]/page.tsx  # (Screen: learner-player)
│   │   ├── exam/page.tsx         # (Screen: learner-exam)
│   │   ├── complete/page.tsx     # (Screen: learner-complete)
│   │   └── certificate/page.tsx  # (Screen: learner-cert)
│   ├── (reviewer)/               # AllergenWise internal staff (role=reviewer)
│   │   ├── queue/page.tsx        # (Screen: reviewer-queue)
│   │   └── queue/[submissionId]/page.tsx  # (Screen: reviewer-detail)
│   └── api/
│       ├── stripe/webhook/route.ts
│       ├── invites/send/route.ts
│       ├── certs/generate/route.ts
│       ├── reviews/submit/route.ts
│       └── search/route.ts
├── components/
│   ├── ui/                       # shadcn primitives
│   ├── allergen/                 # AllergenBadge, AllergenTag, CertBadge — all teal
│   ├── course/                   # VideoPlayer, QuizQuestion, LessonNav
│   └── directory/                # RestaurantCard, FilterChips, MapView
├── lib/
│   ├── supabase/{server,client,middleware}.ts
│   ├── stripe.ts
│   ├── mux.ts
│   ├── email/templates/          # React Email components
│   └── pdf/certificate.tsx       # @react-pdf/renderer
├── db/
│   └── migrations/               # Supabase SQL migrations
├── content/
│   └── curriculum.json           # 5 modules, lessons, quiz questions, exam questions
├── tests/
│   ├── e2e/                      # Playwright: signup→pay→invite→learn→cert→submit→approve
│   └── unit/                     # Vitest
├── tailwind.config.ts            # Teal palette as primary
└── README.md
```

---

## 4. Data model (Postgres / Supabase)

```sql
-- Tenants (restaurants)
create table restaurants (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,                      -- URL-safe, used in /directory/[slug]
  name text not null,
  cuisine text,                                   -- enum: italian|american|asian|mexican|...
  address text,
  city text,
  state text,
  zip text,
  lat numeric,
  lng numeric,
  phone text,
  website text,
  hero_photo_url text,                            -- Supabase storage path
  about text,
  hours_json jsonb,                               -- {mon:{open,close}, ...}
  allergen_specialties text[],                    -- ['tree_nut_aware','gluten_free_menu',...]
  status text not null default 'unlisted',        -- unlisted|pending_review|in_review|listed|paused|rejected
  listed_at timestamptz,
  listing_expires_at timestamptz,                 -- 12 months from listed_at
  stripe_customer_id text unique,
  created_at timestamptz default now()
);

-- All users — admin, learner, reviewer
create table profiles (
  id uuid primary key references auth.users on delete cascade,
  full_name text not null,
  email text not null unique,
  role text not null,                             -- admin|learner|reviewer
  restaurant_id uuid references restaurants,     -- null for reviewers
  job_role text,                                  -- server|host|line_cook|sous_chef|... (learners only)
  invited_at timestamptz,
  invited_by uuid references profiles,
  accepted_at timestamptz,
  created_at timestamptz default now()
);

-- Subscription term (Quarterly $90, Semiannual $120) — prepaid
create table subscriptions (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants,
  plan text not null,                             -- quarterly|semiannual
  starts_at date not null,
  ends_at date not null,
  amount_cents int not null,
  status text not null,                           -- active|expired|canceled
  stripe_subscription_id text,                    -- null if pure one-time charge
  stripe_invoice_id text,
  auto_renew boolean default false,
  created_at timestamptz default now()
);

-- Course content (seeded from content/curriculum.json)
create table modules (
  id uuid primary key default gen_random_uuid(),
  order_index int not null,
  title text not null,
  description text,
  estimated_minutes int
);

create table lessons (
  id uuid primary key default gen_random_uuid(),
  module_id uuid not null references modules on delete cascade,
  order_index int not null,
  title text not null,
  body_md text,                                   -- markdown body
  video_mux_playback_id text,                     -- Mux signed playback ID
  video_duration_seconds int,
  quick_check_question text,                      -- inline quiz
  quick_check_options jsonb,                      -- [{text, correct}]
  unique (module_id, order_index)
);

create table exam_questions (
  id uuid primary key default gen_random_uuid(),
  question text not null,
  options jsonb not null,                         -- [{id,text,correct}]
  module_id uuid references modules,              -- which module it tests
  difficulty text                                 -- easy|medium|hard
);

-- Learner progress
create table lesson_progress (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles,
  lesson_id uuid not null references lessons,
  status text not null,                           -- not_started|in_progress|complete
  watched_seconds int default 0,
  completed_at timestamptz,
  unique (profile_id, lesson_id)
);

create table exam_attempts (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles,
  started_at timestamptz default now(),
  submitted_at timestamptz,
  time_limit_seconds int default 1800,            -- 30 min
  score_percent int,
  passed boolean,
  answers jsonb                                   -- {question_id: chosen_option_id}
);

-- Issued certificates
create table certificates (
  id uuid primary key default gen_random_uuid(),
  cert_code text unique not null,                 -- AW-2026-0429 format
  profile_id uuid not null references profiles,
  restaurant_id uuid not null references restaurants,
  exam_attempt_id uuid references exam_attempts,
  issued_at timestamptz default now(),
  expires_at timestamptz not null,                -- issued_at + 12 months
  pdf_storage_path text,                          -- supabase storage
  revoked boolean default false,
  fee_charged_cents int,
  stripe_payment_intent_id text
);

-- Restaurant submissions for AllergenWise certification
create table submissions (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants,
  submitted_by uuid not null references profiles,
  submitted_at timestamptz default now(),
  status text not null,                           -- pending|in_review|approved|rejected|info_requested
  reviewer_id uuid references profiles,
  reviewer_notes text,
  decided_at timestamptz,
  cert_fee_total_cents int,                       -- sum of $35 × N employees
  stripe_payment_intent_id text
);

-- Public directory reviews
create table reviews (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants,
  author_name text not null,
  author_email text,                              -- not displayed; used for moderation
  rating int not null check (rating between 1 and 5),
  body text not null,
  allergen_context text,                          -- e.g. "tree_nut" — what allergy the reviewer has
  status text not null default 'pending',         -- pending|published|hidden
  created_at timestamptz default now()
);

-- Audit / activity feed (powers admin dashboard "Recent activity")
create table activity_events (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid references restaurants,
  actor_id uuid references profiles,
  type text not null,                             -- lesson_completed|exam_passed|invite_sent|cert_issued|...
  payload jsonb,
  created_at timestamptz default now()
);

-- Stripe webhook idempotency
create table stripe_events (
  id text primary key,                            -- stripe event ID
  type text not null,
  processed_at timestamptz default now()
);
```

**RLS policies (Supabase Row Level Security):**
- `restaurants`: admin can read/update own row; public can read where `status='listed'`; reviewer can read all.
- `profiles`: user can read self; admin can read all profiles where `restaurant_id=self.restaurant_id`; reviewer can read all.
- `lesson_progress`: learner can read/write own; admin can read for own restaurant.
- `certificates`: learner reads own; admin reads own restaurant; public can `select` by `cert_code` for verification page.
- `submissions`: admin can insert/read own restaurant; reviewer can read/update all.
- `reviews`: anyone can insert (status starts 'pending'); public can read where `status='published'`.

**Indexes:**
```sql
create index on profiles (restaurant_id, role);
create index on lesson_progress (profile_id, status);
create index on certificates (cert_code);
create index on certificates (profile_id) where revoked = false;
create index on restaurants (status, listed_at) where status = 'listed';
create index on restaurants using gin (to_tsvector('english', name || ' ' || coalesce(cuisine,'') || ' ' || coalesce(city,'')));
create index on restaurants (lat, lng) where status = 'listed';
create index on submissions (status, submitted_at);
```

---

## 5. Screen-by-screen build map

For each screen: route, components, data needed, key behaviors. Wireframe IDs in parentheses.

### 5.1 Public marketing

**Landing (`/`, screen `landing`)**
- Static hero, three feature cards, two CTAs ("Certify my restaurant" → `/pricing`, "Find safe restaurants" → `/directory`).
- Server-render. No data fetch.
- Teal hero gradient (teal-600 → teal-800).

**Pricing (`/pricing`, screen `pricing`)**
- Two cards: Quarterly ($30/mo × 3 = $90) and Semiannual ($20/mo × 6 = $120, "BEST VALUE").
- Add-on card: per-employee cert fee $35.
- FAQ accordion (3 Qs).
- Buttons → `/signup?plan=quarterly|semiannual`.

**Signup (`/signup`, screen `signup`)**
- Multi-section form: restaurant info + admin credentials + payment.
- On submit:
  1. Create `auth.users` (Supabase Auth with password).
  2. Insert `restaurants` row (status='unlisted').
  3. Insert `profiles` row (role='admin', restaurant_id=...).
  4. Create Stripe Customer, attach payment method via Stripe Elements.
  5. Create one-time PaymentIntent for plan amount; confirm.
  6. On success webhook: insert `subscriptions` row (active, ends_at = starts_at + 3 or 6 months).
  7. Redirect to `/admin/dashboard`.
- Order summary sidebar shows live plan choice.

### 5.2 Restaurant admin

**Dashboard (`/admin/dashboard`)**
- 4 stat cards: employees count, certified count, in-progress count, days until plan ends.
- Cert readiness card: % bar, disabled "Submit at 100%" button until 100%.
- Recent activity card: last 4 `activity_events` for `restaurant_id=self`.
- Header CTAs: "+ Invite employee" → `/admin/invite`, "Submit for certification" → `/admin/submit` (disabled if not 100%).

**Roster (`/admin/roster`)**
- Table of all `profiles` where `restaurant_id=self AND role='learner'`.
- Columns: name+email, job role, progress bar (X/5 modules), status badge (Certified/In progress/Invited), started date, cert ID, action link (View/Remind/Resend).
- "Remind" → POST `/api/invites/remind` → triggers Resend email to learner.
- "Resend" → re-sends original invite email.

**Invite (`/admin/invite`)**
- Single-add form: name, email, role dropdown.
- POST `/api/invites/send`:
  1. Create `auth.users` with `email_confirm=false`, generate magic-link token.
  2. Insert `profiles` (role='learner', restaurant_id=self.restaurant_id, accepted_at=null).
  3. Send Resend email with link `/invite/[token]`.
- CSV bulk upload: drop zone, max 200 rows, parse with `papaparse`, preview, then bulk-insert + bulk-send emails (chunked 50/sec to stay under Resend rate limit).

**Billing (`/admin/billing`)**
- Current plan card: name, dates, prepaid amount, auto-renew toggle (calls Stripe API).
- Cert fees this term card: list of certified employees × $35.
- Invoice history table: pulled from Stripe Invoices API; each row links to `invoice.hosted_invoice_url`.
- "Change plan" button → upgrade flow.

**Submit (`/admin/submit`)**
- Eligibility banner: warn if not 100% certified, success when 100%.
- "What happens" explainer.
- Form: cuisine dropdown, allergen specialty multi-select chips, restaurant photo upload (Supabase Storage).
- "Submit for certification ($X)" — calculates `$35 × certified_employee_count`.
- On submit:
  1. Charge Stripe (PaymentIntent for fee total).
  2. Insert `submissions` (status='pending').
  3. Update `restaurants.status='pending_review'`.
  4. Email reviewer team via Resend.

### 5.3 Learner

**Courses home (`/learner/courses`)**
- Welcome banner with overall progress %.
- Grid of 5 module cards (data from `modules` joined to `lesson_progress`):
  - Completed: green check, completion date.
  - In progress: highlight border, "Resume" button → `/learner/courses/[moduleId]/[lessonId]` (resume = first incomplete lesson).
  - Locked: faded, lock icon. (Module N is locked until module N-1 is complete.)
- Final exam card: locked until all 5 modules complete.

**Player (`/learner/courses/[moduleId]/[lessonId]`)**
- Two-pane layout: lesson list sidebar + lesson body.
- Sidebar shows current module's lessons (active highlighted) + collapsed list of other modules.
- Body: lesson eyebrow, title, video player (Mux signed URL), markdown body, optional quick-check inline quiz.
- Video tracking: on `play`/`pause`/`ended` events, POST `/api/lesson/progress` with `watched_seconds`. Mark `complete` when ≥90% watched.
- Quick-check: on submit, show correct answer + explanation. Doesn't gate progress (it's formative).
- Prev/Next buttons navigate within module; on last lesson "Next" → next module's first lesson, or → `/learner/exam` if module 5 done.

**Exam (`/learner/exam`)**
- 25 questions randomly drawn from `exam_questions` (5 from each module).
- 30-minute countdown timer (display + `setInterval`; on expire auto-submit).
- One question per page; question navigator strip at bottom (1–25, color-coded answered/current/unanswered).
- Prev/Next, "Submit" appears on Q25 or any time after Q15.
- On submit: calculate score, insert `exam_attempts`, redirect to `/learner/complete`.
- Pass = ≥80%. Fail allows retake after 24 hours (max 3 attempts; admin contact required after).

**Complete (`/learner/complete`)**
- Pass: confetti, score, "View my certificate" → `/learner/certificate`.
- Fail: encouragement, retry timer, link back to weakest module.
- On pass: insert `certificates` row, generate cert PDF (server-side `@react-pdf/renderer`), upload to Supabase Storage, charge restaurant $35 via Stripe, log activity event, email manager.

**Certificate (`/learner/certificate`)**
- Print-styled certificate (landscape letter): seal, name, restaurant, dates, cert ID, verify URL.
- "Print" button (window.print + `@page` CSS) and "Download PDF" button (links to stored PDF).
- Public verify URL: `/verify/[certCode]` — lookup `certificates` by `cert_code`, show name + restaurant + status (valid/expired/revoked).

### 5.4 Public directory

**Directory (`/directory`, screen `directory`)**
- Search bar (text), filter chips (allergen specialties, cuisine, distance).
- Map view (Mapbox) on right with pins for each listed restaurant.
- List view (left) of restaurant cards.
- Server-side query: `select * from restaurants where status='listed' and listing_expires_at > now()` + filters.
- Each card: hero photo, name, rating (avg from `reviews`), cuisine, distance, cert badge ("12/12 certified"), allergen tags.

**Restaurant detail (`/directory/[slug]`, screen `directory-detail`)**
- Hero: name, rating, cert badge with last verified date.
- About, allergen specialties chips, reviews list.
- Sidebar: hours, location/contact, certified staff avatars (initials).
- "Write a review" button → modal form (name, email, rating, allergen context, body) → POST `/api/reviews/submit` (status='pending', requires moderation).
- Geocoding: if `lat`/`lng` null, server-side geocode address with Mapbox Geocoding API on save.

### 5.5 Reviewer (internal)

**Queue (`/reviewer/queue`)**
- 4 stat cards: pending, approved this month, rejected this month, avg review time.
- Table of `submissions` where status in (pending, in_review).
- Sort: oldest pending first.
- Click row → `/reviewer/queue/[submissionId]`.

**Detail (`/reviewer/queue/[submissionId]`)**
- Restaurant info card.
- Full employee roster with cert IDs and exam scores.
- Auto-checks panel (✓ 100% staff certified, all scores ≥ 80%, payment valid, no prior rejections).
- Decision sidebar: notes textarea + 3 buttons (Approve & list / Request more info / Reject).
- On Approve:
  1. Update `submissions.status='approved'`.
  2. Update `restaurants.status='listed'`, `listed_at=now()`, `listing_expires_at=now()+12months`.
  3. Generate slug (kebab-case from name + city).
  4. Email admin with public listing URL.
- On Reject: status='rejected', email admin with notes.
- On Request more info: status='info_requested', email admin with notes.

### 5.6 Mobile views
Wireframe shows mobile-directory and mobile-player as separate screens, but in build these are just **the same routes with responsive Tailwind breakpoints**. No separate codebase. Use `md:` and `lg:` Tailwind prefixes; default mobile-first.

---

## 6. Curriculum content (`content/curriculum.json`)

Seed file with 5 modules, ~6 lessons each, 25-question exam pool. Each lesson:
```json
{
  "module": "Emergency response",
  "order": 4,
  "lessons": [
    {
      "title": "Recognizing anaphylaxis",
      "body_md": "...",
      "video_url": "mux://...",
      "duration_sec": 222,
      "quick_check": {
        "question": "...",
        "options": [
          {"text": "Bring water and wait", "correct": false},
          {"text": "Treat as anaphylaxis: alert + 911", "correct": true}
        ]
      }
    }
  ]
}
```

**Video for MVP:** record 5 modules × ~6 lessons ≈ 30 short clips (2-5 min each). DIY screen-recording with voiceover is acceptable for MVP. Upload to Mux. Total recording effort: ~2 weekends.

**Exam pool:** 50–75 questions in JSON, system randomly draws 25 per attempt (5 per module).

---

## 7. Email templates (Resend + React Email)

| Template | Trigger | Recipient |
|---|---|---|
| `EmployeeInvite` | Admin invites employee | Learner |
| `InviteReminder` | Admin clicks "Remind" | Learner |
| `ExamPassed` | Learner passes exam | Admin (manager notification) |
| `RestaurantSubmitted` | Admin submits restaurant | Reviewer team (`reviewers@allergenwise.com`) |
| `RestaurantApproved` | Reviewer approves | Admin |
| `RestaurantRejected` | Reviewer rejects | Admin |
| `RestaurantInfoRequested` | Reviewer requests info | Admin |
| `PlanExpiringSoon` | Cron: 14 days before `subscriptions.ends_at` | Admin |
| `CertExpiringSoon` | Cron: 30 days before `certificates.expires_at` | Admin + Learner |
| `ReceiptCertFee` | Stripe payment success | Admin |
| `WelcomeAdmin` | Signup complete | Admin |

All branded teal. All include unsubscribe link (transactional emails are still required to support unsubscribe under CAN-SPAM if they include any marketing content; keep them strictly transactional and skip unsubscribe).

---

## 8. Background jobs (Vercel Cron)

| Job | Schedule | Action |
|---|---|---|
| `expire-listings` | Daily 03:00 UTC | Set `restaurants.status='paused'` where `listing_expires_at < now()` |
| `expire-certs` | Daily 03:15 UTC | Mark certificates revoked=false but expired; email warnings at 30/14/7 days |
| `expire-subscriptions` | Daily 03:30 UTC | Set `subscriptions.status='expired'`; trigger paused listing if no renewal |
| `digest-reviewer-queue` | Daily 09:00 UTC | Email reviewer team with count of pending submissions >24h old |
| `weekly-admin-digest` | Mondays 08:00 UTC | Email admin: progress %, expiring certs, pending invites |

---

## 9. Stripe integration

**Products & prices (one-time charges, not subscriptions, since prepaid term):**
- `price_quarterly`: $90 one-time
- `price_semiannual`: $120 one-time
- `price_cert_fee`: $35 one-time (charged per cert issuance)

**Checkout flow:** use **Stripe Elements** embedded in `/signup` (better UX than redirect to Stripe Checkout for the first-touch). For cert fee charges (server-triggered when learner passes), use **PaymentIntents API** with the customer's saved default payment method (off-session).

**Webhooks (`/api/stripe/webhook`):**
- `payment_intent.succeeded` → mark related row paid (subscription, cert, submission).
- `payment_intent.payment_failed` → email admin, retain learner cert in 'pending_payment' state for 24h.
- `customer.updated` → sync customer details.

**Idempotency:** insert `stripe_events` row keyed by event ID before processing; skip if already present.

**Test mode setup:** use Stripe test cards in dev; use Stripe CLI (`stripe listen`) for local webhook testing.

---

## 10. Auth & roles

- Magic link for learners (no password — they get an email link, click, in).
- Email + password for admins and reviewers.
- Roles enforced at three layers:
  1. **Middleware** (`middleware.ts`): redirects unauthorized routes.
  2. **RSC layout guards**: each `(admin)` / `(learner)` / `(reviewer)` segment checks role in `layout.tsx`.
  3. **Supabase RLS**: defense in depth at DB layer.
- Reviewer accounts created manually in DB by Guillermo (no public signup for that role).

---

## 11. PDF certificate generation

`@react-pdf/renderer` server-side. Renders the certificate React component → PDF bytes → upload to Supabase Storage at `certs/{cert_code}.pdf` → return signed URL to learner.

Key visual elements (all teal):
- Border frame in teal-700
- Seal in teal-800 with "ALLERGY WISE ★ {year} ★"
- Name in serif, large
- Body text in sans, justified
- QR code (use `qrcode` npm package) linking to `/verify/{cert_code}`

Print-quality: 2× resolution PNG fallbacks for any raster art.

---

## 12. Search (MVP version)

Postgres full-text + trigram for fuzzy matching:
```sql
create extension if not exists pg_trgm;
create index on restaurants using gin (name gin_trgm_ops);
```

API `/api/search?q=pizza&allergen=tree_nut&near=92101&radius=5`:
- Text: `to_tsvector('english', name || cuisine || city) @@ plainto_tsquery($1)` OR `name % $1` (trigram).
- Allergen: `allergen_specialties && ARRAY[$2]`.
- Near: PostGIS optional for MVP; simpler to do haversine in SQL using lat/lng:
  ```sql
  select *, (3959 * acos(cos(radians($lat)) * cos(radians(lat)) * cos(radians(lng) - radians($lng)) + sin(radians($lat)) * sin(radians(lat)))) as distance_mi
  from restaurants where status='listed' having distance_mi < $radius order by distance_mi;
  ```

Adequate for <10k listings. Algolia/Meilisearch upgrade documented in `PRODUCTION_BUILD.md`.

---

## 13. File uploads

- Restaurant hero photos: client uploads via Supabase Storage signed URL → bucket `restaurant-photos`. Max 5MB. Server resizes to 1200×630 with `sharp` at upload edge function.
- CSV roster: client uploads to `roster-uploads/{restaurant_id}/{timestamp}.csv` → server parses, validates, then deletes file after processing.
- Cert PDFs: server generates and uploads to `certificates/{cert_code}.pdf`. Public-read with signed URLs (1-year expiry matches cert validity).

---

## 14. Environment variables (`.env.local`)

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=                    # server-only, never client
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=
RESEND_API_KEY=
RESEND_FROM_EMAIL=hello@allergenwise.com
MUX_TOKEN_ID=
MUX_TOKEN_SECRET=
MUX_SIGNING_KEY_ID=
MUX_SIGNING_KEY_PRIVATE=
NEXT_PUBLIC_MAPBOX_TOKEN=
SENTRY_DSN=
APP_URL=https://allergenwise.com
REVIEWER_EMAIL=reviewers@allergenwise.com
```

---

## 15. Testing strategy (MVP-appropriate)

- **Unit tests (Vitest):** business logic only — exam scoring, cert expiry calculation, fee calculation, RLS-affected queries.
- **E2E tests (Playwright):** ONE happy-path test that runs the full pilot loop: signup → pay → invite employee → employee accepts → completes 5 modules → passes exam → cert issued → admin submits → reviewer approves → restaurant appears in directory. If this test passes, MVP is shippable.
- **Manual QA checklist:** see `MANUAL_COMPONENTS.md` for what Guillermo must hand-verify before each release.

---

## 16. Deployment

1. **Vercel project** linked to GitHub repo. Auto-deploy on push to `main`.
2. **Preview deploys** on every PR (Vercel default).
3. **Supabase project** in same region as Vercel (us-east-1).
4. **Custom domain** `allergenwise.com` via Vercel; subdomain `app.allergenwise.com` for the SaaS app, root for marketing+directory.
5. **Stripe production keys** swapped only after a full E2E in test mode.
6. **DNS via Cloudflare** for free CDN + DDoS protection.
7. **Environment per branch:** `dev` (preview), `staging` (manual promote), `production` (main branch).

---

## 17. Build sequence (10–14 weeks part-time)

| Week | Phase | Deliverable |
|---|---|---|
| 1 | Foundation | Repo, Tailwind+teal theme, Supabase schema, auth scaffolding |
| 2 | Foundation | Marketing pages (landing, pricing) + admin layout shell |
| 3 | Billing | Stripe Elements signup flow, webhook handler, subscription model |
| 4 | Course platform | Modules/lessons schema seeded, learner home + player + Mux integration |
| 5 | Course platform | Quick-check quizzes, video progress tracking, lock/unlock logic |
| 6 | Course platform + cert | Final exam, scoring, cert PDF generation, public verify page |
| 7 | Admin tools | Roster, invites (single + CSV), billing page |
| 8 | Submission flow | Submit page, submission DB, reviewer queue + detail, approval flow |
| 9 | Directory | List + map view, search, filters, restaurant detail page |
| 10 | Directory | Reviews, geocoding, listing expiry cron |
| 11 | Polish | Email templates, all transactional flows, mobile responsive QA, full UI pass against Section 2A acceptance criteria |
| 12 | Polish | Cron jobs, monitoring, error boundaries, edge cases |
| 13 | Pilot prep | E2E test, seed pilot accounts, Loom walkthroughs for client |
| 14 | Buffer | Bug fixes from internal QA, soft launch with first 3 pilot restaurants |

---

## 18. Definition of "MVP done"

The MVP is shippable when **all twelve** of these pass:

1. New restaurant can sign up + pay quarterly or semiannual plan via Stripe.
2. Admin can invite an employee (single or CSV) and the employee receives a working magic-link email.
3. Employee can complete all 5 modules including video playback on mobile and desktop.
4. Employee can take and pass (or fail and retry) the 25-question exam.
5. Cert PDF generates correctly (teal styling, name, dates, QR code) and is downloadable.
6. Admin sees real-time-ish progress on dashboard (refresh-on-load is fine; no websockets).
7. Admin can submit restaurant for review at 100% certified; cert fees charge correctly.
8. Reviewer can see queue, open submission, approve/reject; admin gets notified.
9. Approved restaurant appears in public `/directory` with map pin and detail page.
10. Public can search directory by allergen + cuisine + location and see results.
11. Public can submit a review; review enters moderation queue.
12. Cert verification page works at `/verify/[certCode]`.
13. UI passes all 8 acceptance criteria in Section 2A.10 (TalentLMS-feel, no vibe-code).

Everything else is nice-to-have and lives in `PRODUCTION_BUILD.md`.

---

## 19. Cost forecast (MVP, monthly)

| Service | MVP cost |
|---|---|
| Vercel Hobby | $0 (upgrade to Pro $20 if hitting bandwidth caps) |
| Supabase Free | $0 (upgrade to Pro $25 once over 500MB DB or 1GB storage) |
| Stripe | 2.9% + $0.30 per transaction |
| Resend | $20/mo (10k emails) |
| Mux | $20–25/mo for ~30 short videos at low pilot view counts |
| Mapbox | $0 (free tier 50k loads/mo) |
| Sentry | $0 (developer plan) |
| Domain + Cloudflare | $1/mo amortized |
| **Total fixed** | **~$45–95/mo** + Stripe % |

---

## 20. What to ship to the client

At end of build, hand over:
1. Live production URL.
2. Admin credentials for the client (their account on the platform as the first restaurant).
3. Reviewer credentials for the client (so she can test the approval flow).
4. Loom walkthrough of every flow (signup, learn, cert, submit, approve, directory).
5. `MANUAL_COMPONENTS.md` so she knows what's not automated.
6. `PRODUCTION_BUILD.md` so she sees the v1.0 roadmap when she's ready to hire a real team.
7. GitHub repo access (read-only) — keep `main` branch protection so only Guillermo can deploy until handoff.
