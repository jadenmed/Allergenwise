# AllergenWise — The "Holy Shit That's Done" Plan

> **Where you are:** Phases 0-3 shipped. 388 unit tests pass. 50/50 e2e pass. typecheck 0, lint 0, build 0. All 5 role surfaces built. Locked design system in place.
>
> **Where you're going:** Phase 4 wraps up the loose threads, then 8 focused weeks turn this from "functionally complete" into "obviously professional." Not TalentLMS-tier yet — that's another 60-100 hrs after pilot validates the model — but clearly not amateur.
>
> **Time commitment:** ~20 hrs/week × 8 weeks = ~160 hrs. Roughly 30 learning, 130 building.
>
> **Mood:** Boil the ocean. Ship every Friday. Test on a real phone every weekend.

---

## The Rules of the Road

- [ ] Print these. Tape them above your monitor.

1. **Reference comparison is the fastest way to develop taste.** Open TalentLMS, Linear, Stripe side-by-side with your app. Spot 3 differences. Fix the worst one. Repeat.
2. **Learn by doing on the actual product.** No 40-hour Figma courses. Watch a 30-min video on one concept, apply it immediately to one surface.
3. **Use Claude Code as a pair.** Tell it what you want, ask for 3 variants, pick the best. Your time goes to taste, not typing.
4. **Ship every Friday.** Push to Vercel preview. Click through on your phone over the weekend. Real-device feedback is brutal and necessary.
5. **No skipping mobile.** Half your traffic will be phones. Mobile is not a "polish pass" — it's a must-pass gate for every surface.
6. **Boil the ocean.** When the right answer takes 30 more minutes, take the 30 minutes. Never present the workaround.

---

## Phase 4 — Finish what you started (~6-8 hrs, knock out before Week 1)

The loose threads from BUILD_STATE.md. Get these done before the polish journey starts so they don't haunt you.

- [ ] Sign-out + account UI wired across all 3 role layouts (admin, learner, reviewer)
  - Server-component wrapper to fetch profile (name + email)
  - Client-side sign-out handler (`supabase.auth.signOut()` then `router.push('/')`)
  - Thread `userName` / `userEmail` / `onSignOut` props through all three role layouts uniformly
- [ ] PDF cert font embedding — drop Crimson Text font files in `lib/pdf/fonts/`, swap `Font.register` to local source, smoke-test cert generation
- [ ] Real Resend API key in `.env.local`, send all 11 email templates to yourself, fix any rendering issues
- [ ] Lesson body rendering — install `react-markdown`, replace `<pre>` tag in lesson player with proper markdown component + Tailwind typography
- [ ] Mapbox geocode wired in `app/api/search/route.ts` (only if you have a Mapbox token; otherwise mark as post-pilot)
- [ ] Delete `pageMeta.learner.*` entries OR move to server-component wrappers (cleanup)
- [ ] Run full pilot loop e2e against real local Supabase + real `sk_test_*` Stripe key — confirm 50/50 still passes

**Phase 4 wrapped when:** all checkboxes above are done AND e2e green on real services AND you can sign out from every role surface.

---

## 🌱 Week 1 — Foundation + the Trust Artifact

> **Theme:** Polish the verify page first. It's the single highest-leverage surface in the entire product. A diner with a peanut-allergic kid loads this page in 1 second on a sidewalk and decides if she trusts the restaurant. Nothing matters more.

### Learning (5 hrs) — develop taste

- [ ] Watch Adam Wathan's free YouTube videos on spacing/hierarchy (~2 hrs) — *bookmark "Refactoring UI" patterns you spot*
- [ ] Read Refactoring UI's "Hierarchy is everything" + "Spacing and sizing" sections (~1 hr)
- [ ] Open TalentLMS, Linear, Stripe in three tabs. Spend 2 hours writing down 10 patterns you notice — button sizes, section padding, card shadows, type scale, color usage discipline (~2 hrs)

### Build (15 hrs)

- [ ] **Verify page hero** — subtle gradient on the colored background, animated shield icon (Framer Motion `whileInView` with scale + opacity stagger) on Active state (~2 hrs)
- [ ] **Verify page restaurant photo** — display the submitted restaurant photo prominently in the verify card (~2 hrs)
- [ ] **Verify page allergen summary** — show which allergens this cert covers, with the AllergenBadge component (~3 hrs)
- [ ] **Verify page mobile pass** — one-handed-thumb-reach buttons, sticky disclaimer at bottom, larger tap targets (~3 hrs)
- [ ] **Verify page loading.tsx** — proper skeleton instead of blank screen on slow connections (~1 hr)
- [ ] **Open graph image generator** — dynamic OG image showing "Restaurant X · Certified Active" for verify page social sharing (~3 hrs)
- [ ] **Restaurant photo on verify page tested with real submission** (~1 hr)

### 🎯 Friday Deploy

- [ ] Push to Vercel preview
- [ ] Print a real QR code linking to a real verify URL, tape it to a wall
- [ ] Scan it from your phone outside, in sunlight, while walking
- [ ] Note 3 things that felt wrong. Add them to next week's list.

---

## 🎨 Week 2 — Landing Page Polish

> **Theme:** This is what restaurant owners see before they trust you with their subscription. First impressions from a stranger's perspective.

### Learning (4 hrs)

- [ ] Framer Motion intro video (~1 hr)
- [ ] 2-3 YouTube videos on "landing page design principles" — focus on hero design + section transitions (~2 hrs)
- [ ] Pull up 5 SaaS landing pages you admire. Screenshot. Identify what makes them feel premium (~1 hr)

### Build (16 hrs)

- [ ] Install Framer Motion + react-intersection-observer
- [ ] **Hero stagger** — fade-in for headline → subheadline → CTA buttons in sequence (~2 hrs)
- [ ] **Stat pills count-up** — 0 → 142 on scroll-into-view (~2 hrs)
- [ ] **Scroll-triggered fade-ins** for each section (subtle, not flashy) (~3 hrs)
- [ ] **FAQ accordion section** — 8-10 common Qs covering: what does AllergenWise verify, how is this different from local food safety cert, refund policy, certificate expiry, what happens if a staff member fails the exam, liability disclaimers (~3 hrs)
- [ ] **Footer** — 4 columns: Product (features, pricing, directory) / For diners (search, verify) / Resources (FAQ, contact) / Legal (terms, privacy, allergen disclaimer) (~2 hrs)
- [ ] **"Trusted by" logo strip** placeholder — grayscale text logos for now, real ones once pilot restaurants approve (~2 hrs)
- [ ] **Mobile pass** — hero text size tuning, stat pill stacking, section padding (~3 hrs)

### 🎯 Friday Deploy

- [ ] Show landing page to 3 people who aren't you
- [ ] Ask: "What does this product do?" and "Would you trust it with $200/quarter?"
- [ ] Note every place they hesitated, squinted, or asked a clarifying question
- [ ] Add them to next week's list

---

## 📚 Week 3 — Learner Flow Part 1: Catalog + Lesson Player

> **Theme:** This is where 95% of user-time happens. Restaurant staff completing training on their phones during a break. Has to feel premium and respect their time.

### Learning (5 hrs)

- [ ] "Skeleton screens vs spinners" + "Empty states design" videos (~1 hr)
- [ ] 2-3 videos on micro-interactions and motion principles (~2 hrs)
- [ ] Study Coursera, Udemy, TalentLMS course catalog pages. Note progress visualization, lesson row design, lock states (~2 hrs)

### Build (15 hrs)

- [ ] **Course catalog: overall progress ring** — big circular SVG showing % complete across all 5 modules (~3 hrs)
- [ ] **Course catalog: skeleton loading state** on initial fetch (~2 hrs)
- [ ] **Course catalog: "continue where you left off" hero card** at the top, deep-linking to the exact next lesson (~2 hrs)
- [ ] **Course catalog: animated accordion** expand/collapse with Framer Motion height-auto (~2 hrs)
- [ ] **Lesson player: react-markdown** with Tailwind typography for lesson body — *folded in from Phase 4* (~2 hrs)
- [ ] **Lesson player: next-lesson auto-advance** with 5-second countdown after marking complete (~2 hrs)
- [ ] **Lesson player: keyboard shortcuts** — space to play/pause, → for next lesson, ← for previous (~2 hrs)

### 🎯 Friday Deploy

- [ ] Complete a full lesson on your phone end-to-end
- [ ] Time how long it takes
- [ ] Note any friction (loading lag, fat-finger taps, awkward video sizing)
- [ ] Add to next week's list

---

## 🎓 Week 4 — Learner Flow Part 2: Exam + Completion + Certificate

> **Theme:** The exam is where users feel either professional rigor or amateur hour. The certificate is what they share publicly. Both need to feel earned.

### Learning (3 hrs)

- [ ] Study how Khan Academy, Duolingo, and TalentLMS handle exam UI — question palette, timer, review screens (~2 hrs)
- [ ] 1 video on "celebrating user achievements without being cheesy" (~1 hr)

### Build (17 hrs)

- [ ] **Exam: question palette grid** showing answered/flagged/current state for all 25 questions (~3 hrs)
- [ ] **Exam: flag-for-review** functionality with visual indicator on palette (~2 hrs)
- [ ] **Exam: review-before-submit screen** with skipped/flagged question warnings (~2 hrs)
- [ ] **Exam: keyboard shortcuts** — 1-4 to select option, →/← to navigate (~1 hr)
- [ ] **Exam: timer pulse-red** in last 5 minutes (~1 hr)
- [ ] **Complete page: subtle achievement treatment** — no confetti, but a gradient background, formal serif typography for the achievement language, animated checkmark (~2 hrs)
- [ ] **Certificate page: hero treatment** — full-bleed background, centered cert preview with subtle border glow, prominent download/share/copy-verify-link CTAs (~3 hrs)
- [ ] **Certificate page: larger QR code** preview + share-to-LinkedIn button with formal achievement-style copy (~3 hrs)

### 🎯 Friday Deploy

- [ ] Take the exam yourself end-to-end
- [ ] Pass it
- [ ] Share the certificate to LinkedIn
- [ ] Have a friend copy the verify URL and load it on their phone
- [ ] Note every step that felt off

---

## 🛠️ Week 5 — Admin + Reviewer Surfaces

> **Theme:** These are internal tools. They don't need TalentLMS-level polish but they shouldn't embarrass you when you screen-share with a partner, investor, or restaurant during the pilot.

### Learning (3 hrs)

- [ ] Study Linear, Stripe Dashboard, Notion admin views. Note table density, filter UX, empty states (~2 hrs)
- [ ] 1 video on data table best practices (~1 hr)

### Build (17 hrs)

- [ ] **Admin dashboard: skeleton states + real DB-backed StatCards** (replace any hardcoded counts) (~3 hrs)
- [ ] **Admin roster: better empty states + mobile-friendly card view fallback** (~3 hrs)
- [ ] **Admin invite flow: inline validation, success toast, recently-sent list polish** (~2 hrs)
- [ ] **Admin billing: Stripe Customer Portal redirect tested with real Stripe test mode** (~2 hrs)
- [ ] **Admin submit-listing: photo upload preview + allergen chip animations** (~3 hrs)
- [ ] **Reviewer queue: FIFO sort visual indicator + status tab counts + mobile pass** (~2 hrs)
- [ ] **Reviewer detail: dialog polish on approve/reject/request-info** (~2 hrs)

### 🎯 Friday Deploy

- [ ] Click through every admin action end-to-end
- [ ] Click through every reviewer action end-to-end
- [ ] Make sure no flow has a dead-end or unclear next step
- [ ] If a flow ends with you wondering "what now?" — that's a gap to fix

---

## 📱 Week 6 — Mobile-First Pass + Accessibility

> **Theme:** Half your users will be on phones. Restaurant staff doing training during a break, diners scanning QR codes. Mobile cannot be an afterthought.

### Learning (4 hrs)

- [ ] Read Apple HIG and Material Design mobile guidelines — touch target sizes, safe areas, scroll behavior (~2 hrs)
- [ ] WebAIM accessibility primer + focus management + ARIA basics (~2 hrs)

### Build (16 hrs)

- [ ] **Sidebar → bottom drawer on mobile** across admin/learner/reviewer (~4 hrs)
- [ ] **All tables → card view on mobile** (admin roster, reviewer queue, learner courses) (~3 hrs)
- [ ] **Multi-step forms** (signup, submit-listing, invite-accept) → mobile-optimized step navigation with progress indicator (~3 hrs)
- [ ] **Run axe-core or Lighthouse accessibility audit** on every public-facing surface, fix all errors (~3 hrs)
- [ ] **Keyboard navigation pass** across all dialogs and forms — confirm focus traps work, tab order is logical (~2 hrs)
- [ ] **Color contrast audit** — fix any teal-on-teal failures with WebAIM contrast checker (~1 hr)

### 🎯 Friday Deploy

- [ ] Spend the **entire weekend** using ONLY your phone to test the app
- [ ] Do every single flow: sign up, complete a lesson, take the exam, submit for review, verify a cert
- [ ] Note every thumb-reach issue, every fat-finger tap, every text that feels too small
- [ ] You will find at least 15 issues. Add them to Week 7.

---

## 📊 Week 7 — Data Viz + Onboarding Tours + Visual Identity

> **Theme:** The differentiation layer. Charts, tours, and visual consistency that separate "obviously professional" from "actually impressive."

### Learning (4 hrs)

- [ ] Recharts or Tremor tutorial (~1 hr)
- [ ] Study Stripe Dashboard, Linear analytics charts. Note styling and labeling discipline (~1 hr)
- [ ] 2 videos on user onboarding tours (Driver.js, Shepherd.js, Userflow patterns) (~2 hrs)

### Build (16 hrs)

- [ ] **Admin dashboard: 2-3 real charts** — staff signups over time, exam completion rate over time, certs issued by week (~5 hrs)
- [ ] **Learner course catalog: progress visualization improvements** — module-level rings, lesson dots progress trail (~2 hrs)
- [ ] **First-time admin onboarding tour** with Driver.js or Shepherd.js — covers: dashboard, invite first staff member, billing, submit-listing (~4 hrs)
- [ ] **First-time learner tour** for course catalog — covers: where modules are, exam unlock, certificate (~2 hrs)
- [ ] **Replace placeholder logos and illustrations** with consistent set from Storyset, unDraw, or Midjourney prompts. Pick ONE source and stick with it for visual consistency (~3 hrs)
- [ ] **Bug-bash from Week 6 weekend mobile testing** — fix as many as you can in remaining hours

### 🎯 Friday Deploy

- [ ] Invite 2 real people (friends/family) to actually sign up as restaurants
- [ ] Watch them go through the entire flow
- [ ] Take notes silently. Don't help. Don't explain. Don't apologize.
- [ ] Their confusion is data. Use it for Week 8.

---

## 🚀 Week 8 — QA, Bug Bash, Production Prep, Launch Readiness

> **Theme:** Production hardening. Real-services smoke testing. Marketing-ready polish. The week where you go from "demo-ready" to "let real customers in."

### Learning (2 hrs)

- [ ] Vercel production deployment checklist (~1 hr)
- [ ] SEO basics for SaaS landing pages (~1 hr)

### Build (18 hrs)

- [ ] **Real Resend API key**, send all 11 email templates to yourself in production, fix rendering issues (~3 hrs)
- [ ] **PDF cert font** — embed Crimson Text font locally (already done in Phase 4 — verify in production) (~1 hr)
- [ ] **Stripe production setup** — real webhook endpoint, live mode testing with a real card and a real $0.50 charge that you refund (~3 hrs)
- [ ] **Sentry or LogRocket integration** for production error tracking + alerting (~2 hrs)
- [ ] **SEO pass** — open graph images for every public page, sitemap.xml, robots.txt, structured data (LocalBusiness schema) for restaurant directory entries (~3 hrs)
- [ ] **Bug bash on production preview** — invite 2 friendly testers, give them a Notion doc to log bugs (~3 hrs)
- [ ] **Fix everything found in bug bash** (~3 hrs)

### 🎯 Friday Deploy — Soft Launch Day

- [ ] Push to production (real domain, real SSL, real Stripe live mode)
- [ ] Soft-launch to 5 friendly restaurants
- [ ] Watch what happens
- [ ] Pop a beverage of choice. You earned it.

---

## 🏁 What you'll have at the end of Week 8

A pilot-ready web app where:

- ✅ Restaurants can sign up, pay, invite staff, train them, certify them, submit for directory listing, and get listed
- ✅ Staff can complete the curriculum, take the exam, and earn a real verifiable certificate
- ✅ Reviewers can approve listings
- ✅ Admins can monitor everything with real charts and dashboards
- ✅ Diners can search the directory and verify any certificate via QR code in under 2 seconds
- ✅ Every surface looks "obviously professional"
- ✅ Mobile works as well as desktop
- ✅ Production monitoring is in place
- ✅ Soft launch is live

Not TalentLMS-tier yet. That's another 60-100 hrs of polish *after* the pilot validates the model and you have real user feedback to direct it. But clearly not amateur. Clearly something a restaurant would trust with their subscription and their reputation.

---

## What this plan deliberately does NOT include

- **Custom illustrations / brand identity work** — that's a designer's job. Use Storyset, unDraw, or Midjourney to 80% consistency. Hire a designer for ~$3-8k after pilot validates.
- **Marketing site beyond the landing page** — no blog, help center, docs site. Pre-launch concerns, not pilot concerns.
- **Multi-tenant theming / white-labeling** — TalentLMS does this because it's horizontal. AllergenWise is vertical. Don't build it.
- **Native mobile apps** — web is fine for the pilot. PWA optimization in Week 6 covers the gap.

---

## If you have less than 20 hrs/week

- Drop Week 7's onboarding tours and Week 8's SEO pass — nice-to-have, not pilot-blocking
- Stretch the timeline to 10-12 weeks instead of 8

## If you have 25-30 hrs/week

- Add an extra polish week between Weeks 4 and 5 dedicated to motion/animation refinement across already-built surfaces
- Add a Week 9 dedicated to user testing with real restaurants and iterating on findings

---

## Progress tracker — update after each Friday deploy

| Week | Theme | Friday deploy date | Status |
|------|-------|-------------------|--------|
| Phase 4 | Loose threads | _____ | ⬜ |
| Week 1 | Verify page | _____ | ⬜ |
| Week 2 | Landing page | _____ | ⬜ |
| Week 3 | Learner P1 | _____ | ⬜ |
| Week 4 | Learner P2 | _____ | ⬜ |
| Week 5 | Admin + Reviewer | _____ | ⬜ |
| Week 6 | Mobile + a11y | _____ | ⬜ |
| Week 7 | Data viz + tours | _____ | ⬜ |
| Week 8 | Launch prep | _____ | ⬜ |

---

*Boil the ocean. Ship every Friday. The standard isn't "good enough" — it's "holy shit, that's done."*
