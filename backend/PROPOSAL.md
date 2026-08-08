# AllergenWise MVP — Project Proposal

**Prepared for:** [CLIENT NAME]
**Prepared by:** Guillermo Amador
**Date:** April 30, 2026
**Status:** Draft for review

---

## 1. Summary

This proposal covers the design and development of the **AllergenWise MVP** — a working pilot version of the platform sufficient to onboard up to ~100 paying restaurants, train their staff, issue certifications, and run a public restaurant directory. The MVP will be built end-to-end (admin tools, learner course platform, public directory, payment processing, certification flow) by Guillermo, with the explicit understanding that a professional design + engineering team will be hired to build the full v1.0 product once the pilot validates the model.

**Total project price:** $9,000
**Timeline:** ~10 weeks (heavy part-time)
**Payment schedule:** $2,000 upfront / $3,500 at midpoint / $3,500 at launch

A reduced-cash equity-inclusive option is also presented in Section 8.

---

## 2. What you're getting

A live, production-deployed web application at **allergenwise.com** with three connected products under one roof:

**For restaurant admins** — sign up, choose a billing plan, pay via Stripe, invite staff, see training progress on a dashboard, manage billing, and submit the restaurant for AllergenWise certification once 100% of staff are trained.

**For restaurant staff (learners)** — receive a magic-link invite email, take a 5-module video course on food-allergen safety with inline quick-checks, sit a 25-question final exam, and receive a printable digital certificate (PDF) on passing.

**For the AllergenWise reviewer (you)** — a private internal queue showing all pending restaurant submissions, with one-click approve/reject and automatic listing to the public directory.

**For the public** — a Yelp-style searchable directory of certified restaurants with map view, filtering by allergen specialty (tree-nut-aware, gluten-free menu, dairy-free, etc.), reviews submission, and a public certificate-verification page.

The product is built mobile-responsive, so staff can train on their phones, parents can search the directory on the go, and admins can manage on a laptop or tablet.

---

## 3. Visual direction

The UI will be modeled on **[TalentLMS](https://www.talentlms.com)** — a calm, familiar, professional learning-management feel that restaurant managers will recognize and trust. Specifically:
- A fixed left navigation, top utility bar, and clean dashboard widgets in the admin and learner experiences.
- Soft-shadow card system with thin borders and generous white space.
- Inter typeface, dense readable type, no oversized display headlines outside the marketing pages.
- The brand color throughout is **teal** (your established AllergenWise allergen color), used for primary actions, active navigation, status badges, and the certificate seal.

Explicitly NOT in the visual direction:
- Animated gradient heroes, "vibe-coded" landing pages, glassmorphism, or decorative illustrations.
- Emoji as functional icons (Lucide icons only in the chrome).
- Anything that looks like a developer demo rather than a real B2B product.

The MVP will look credible, trustworthy, and pre-professional-design-team. When it's time to scale, you'll hire a design team to evolve the visual identity. The MVP visual system is built on tokens (typography scale, spacing, color ramps) so a designer can refine without rebuilding.

---

## 4. Scope (what's in the MVP)

The full feature scope is documented in `MVP_BUILD.md` (delivered alongside this proposal). At a glance, the MVP includes:

**Restaurant admin product**
- Account signup, restaurant info, Stripe billing (Quarterly $90 / Semiannual $120 prepaid plans).
- Admin dashboard with cert readiness widget, employee count, plan status, recent activity feed.
- Employee roster table (single-add and CSV bulk import up to 200 employees).
- Invite flow with magic-link email; resend and remind actions.
- Billing page with plan, certification fee history, downloadable receipts.
- Certification submission flow with cuisine, allergen specialty multi-select, restaurant photo upload, eligibility gating (100% staff certified required), per-employee cert fee charging ($35 each).

**Learner product**
- Magic-link invite acceptance.
- Course home with 5 modules (Cross-contamination, Top 9 Allergens, Kitchen Protocols, Emergency Response, Guest Communication), progress tracking, lock/unlock progression.
- Course player: video (Mux), markdown lesson body, inline quick-check quizzes, lesson navigation.
- 25-question randomized final exam (drawn from 50–75 question pool, 5 per module), 30-minute timer, question navigator.
- Pass/fail flow with retry policy (24-hour cooldown, max 3 attempts).
- Printable PDF certificate with QR code linking to public verify page.

**Reviewer product (internal)**
- Queue of pending submissions with stats (pending, approved-this-month, rejected, avg review time).
- Submission detail with full restaurant info, employee roster, exam scores, auto-checks panel.
- Decision actions: approve & list, request more info, reject — each triggers an email to the admin.

**Public surfaces**
- Marketing landing page.
- Pricing page with FAQ.
- Restaurant directory (list + map view) with search and allergen/cuisine/distance filters.
- Restaurant detail page with hero photo, allergen specialties, reviews, hours, contact, certified-staff list.
- Public review submission with moderation queue.
- Certificate verification page (`/verify/{cert-code}`).

**Backend & ops**
- Stripe integration (Elements signup, off-session cert charges, webhooks, idempotency).
- Supabase Postgres + Auth + Storage + Row-Level Security.
- Mux video hosting with signed playback URLs.
- Resend transactional email (welcome, invite, reminder, exam-passed, submission-decided, plan-expiring, cert-expiring).
- Vercel Cron jobs for listing/cert/subscription expiry warnings and weekly admin digest.
- Sentry error monitoring + Vercel Analytics.
- One end-to-end test running the full pilot loop (signup → pay → invite → learn → cert → submit → approve → directory).

**Infrastructure**
- Production deployment to Vercel.
- Custom domain (allergenwise.com).
- DNS via Cloudflare (free CDN + DDoS).
- All environment variables documented in a private `.env.template` file.

---

## 5. Scope (what's NOT in the MVP)

The following are explicitly **out of scope** for the MVP and will be addressed in v1.0 by the professional team you'll hire post-pilot. Full v1.0 plan in `PRODUCTION_BUILD.md`.

- WebSockets / real-time presence (admin sees progress on page-load only; no live-update without refresh).
- Native iOS / Android apps (mobile-responsive web only).
- Multi-language support / i18n.
- SOC 2 / WCAG 2.2 AA / penetration test certifications.
- Multi-tenant / chain support (each restaurant is a separate account in the MVP).
- AI-powered features (menu allergen scanner, transcription, translation, reviewer co-pilot).
- White-label / per-restaurant branding.
- Custom course authoring tools (curriculum is fixed; updates are JSON edits).
- SMS notifications (email only).
- Automated refund flows (handled manually via Stripe Dashboard).
- Custom analytics dashboards / data warehouse (Vercel Analytics + Stripe data are sufficient at pilot scale).
- Public API / developer platform.

If you'd like any of these items pulled into the MVP, see Section 9 (Change Orders).

---

## 6. Timeline

Total build window: **10 weeks**, with a 3-week buffer for pilot prep, soft-launch with first restaurants, and bug fixes from your testing. Estimated start date: **[START DATE]**. Estimated launch date: **[LAUNCH DATE]**.

| Week | Phase | Deliverable / what you can see |
|---|---|---|
| 1 | Foundation | Repo + Supabase schema + auth scaffolding + Tailwind theme (teal) live on staging URL |
| 2 | Foundation | Marketing pages (landing, pricing) live on staging |
| 3 | Billing | Stripe signup flow end-to-end; you can test-mode pay for a plan |
| 4 | Course platform | Learner home, module/lesson player, Mux video integration |
| 5 | Course platform | Quick-check quizzes, video progress tracking, lock/unlock logic |
| 6 | Course + cert | Final exam, scoring, cert PDF generation, public verify page → **Midpoint demo** |
| 7 | Admin tools | Roster, invites (single + CSV), billing page |
| 8 | Submission flow | Submit page, reviewer queue + detail, approval flow |
| 9 | Directory | Public list + map, search, filters, restaurant detail page |
| 10 | Directory | Reviews, geocoding, listing expiry cron |
| 11 | Polish | Email templates, mobile QA, full UI pass against TalentLMS direction |
| 12 | Polish | Cron jobs, monitoring, error boundaries, edge cases |
| 13 | Pilot prep | E2E test, seed pilot accounts, Loom walkthroughs |
| 14 | Buffer | Bug fixes from internal QA, soft launch with first 3 pilot restaurants → **Launch** |

You'll see progress weekly. Every Friday you'll receive a 5-minute Loom video showing what shipped that week, plus the staging URL to click through it yourself.

---

## 7. Payment schedule

**Total:** $9,000 — paid in three milestones, each with explicit, demoable acceptance criteria. No vibes, no "trust me, it's almost done." If any item below isn't shippable on staging, the milestone isn't met and payment doesn't trigger.

### 7.1 Signing — $2,000

**When:** Within 7 days of this proposal being countersigned.

**What it pays for:** Infrastructure setup, first sprint of code, project kickoff. **Non-refundable** because it covers real subscription costs and Week 1–2 work the moment it's paid.

**You'll see by end of Week 2:**
- [ ] Repository created on GitHub with read access shared to you.
- [ ] Vercel, Supabase, Stripe, Resend, Mux, Mapbox accounts created (in your name — see Section 10).
- [ ] Staging URL live (e.g., `staging.allergenwise.com`) showing the marketing landing page and pricing page in the teal TalentLMS visual direction.
- [ ] Database schema deployed (all 14 tables with relationships, indexes, RLS policies as documented in `MVP_BUILD.md` Section 4).
- [ ] Auth scaffolding working — you can sign up and log in as a test admin user.

### 7.2 Midpoint — $3,500

**When:** End of Week 6 (target). Triggered when **all 14** of the following are demonstrably true on the staging URL during a live 30-minute walkthrough demo with you.

**You'll be able to do all of this on staging, end-to-end, before paying:**

**Restaurant signup + billing**
- [ ] **KPI 1.** A new visitor can sign up at `/signup`, fill restaurant info + admin credentials, enter a Stripe test card, and complete checkout for either the Quarterly ($90) or Semiannual ($120) plan.
- [ ] **KPI 2.** After signup, a `restaurants` row + `profiles` row + `subscriptions` row are visibly written to the database, and the admin lands on the admin dashboard logged in.
- [ ] **KPI 3.** The Stripe webhook handler verifies signatures and processes `payment_intent.succeeded` correctly (demoable by triggering a test event).

**Admin dashboard (read-only, no edits yet)**
- [ ] **KPI 4.** Admin dashboard at `/admin/dashboard` shows the four real-data widgets: employee count, certified count, in-progress count, days until plan ends.
- [ ] **KPI 5.** Cert readiness donut renders with real percentage from the database.
- [ ] **KPI 6.** Recent activity widget shows the last 5 events from the `activity_events` table.

**Employee invite flow**
- [ ] **KPI 7.** Admin can invite an employee at `/admin/invite` (single-add by name + email + role).
- [ ] **KPI 8.** The invited employee receives a working magic-link email via Resend within 60 seconds, branded teal.
- [ ] **KPI 9.** Clicking the magic link logs the employee into `/learner/courses` and creates their `profiles` row.

**Course player — the heaviest piece**
- [ ] **KPI 10.** Learner home at `/learner/courses` shows all 5 modules (Cross-contamination, Top 9 Allergens, Kitchen Protocols, Emergency Response, Guest Communication) with lock/unlock state and progress bars.
- [ ] **KPI 11.** Learner can open any unlocked module/lesson at `/learner/courses/[moduleId]/[lessonId]` and play a Mux-hosted video that streams correctly on desktop AND on mobile (verified on a real phone during demo).
- [ ] **KPI 12.** Video progress is saved to the database in real time; closing and reopening the lesson resumes at the watched position.
- [ ] **KPI 13.** Inline quick-check quiz renders, accepts an answer, and shows correct/incorrect feedback (does not need to gate progress in the midpoint demo).

**Certification generation**
- [ ] **KPI 14.** A passing exam can be simulated (test endpoint or DB stub) and the system generates a teal-styled PDF certificate via `@react-pdf/renderer`, uploads it to Supabase Storage, and serves it at a downloadable URL.

**What's NOT in midpoint** (intentionally, to be honest about what $3,500 buys):
- The full final exam UI with timer + question navigator (built in Week 7).
- The admin roster table (Week 7).
- The CSV bulk import (Week 7).
- The submission flow + reviewer queue (Week 8).
- The public directory (Weeks 9–10).
- All transactional emails beyond the invite (Week 11).
- Cron jobs (Week 12).

If any of KPI 1–14 isn't demoable on staging at end of Week 6, the midpoint payment doesn't trigger and we extend by up to 1 week at no additional cost. Beyond that, we discuss scope adjustment in writing.

### 7.3 Launch — $3,500

**When:** End of Week 14 (target). Triggered when **all 13** acceptance criteria from Section 11 are demoable on the **production** URL `allergenwise.com` and at least one real pilot restaurant has been onboarded successfully.

**Summary of what's added between midpoint and launch:**

- [ ] Final exam UI: 25-question randomized exam, 30-min timer, question navigator, pass/fail flow.
- [ ] Admin roster table with progress bars, status badges, single-add invite, CSV bulk import (200-row max).
- [ ] Admin billing page with Stripe invoice history.
- [ ] Submit-for-certification flow: cuisine, allergen specialties, photo upload, $35-per-employee cert fee charge.
- [ ] Reviewer queue at `/reviewer/queue` with stat cards and submission table.
- [ ] Reviewer detail page with restaurant info, employee roster, exam scores, auto-checks, decision sidebar (approve / request info / reject).
- [ ] Public directory at `/directory` with list view + Mapbox map + search + allergen/cuisine/distance filters.
- [ ] Restaurant detail page at `/directory/[slug]` with hero photo, allergen specialties, reviews list, hours, contact, certified-staff avatars.
- [ ] Public review submission form with moderation queue.
- [ ] Public certificate verification page at `/verify/[certCode]`.
- [ ] All 11 transactional email templates working (welcome, invite, reminder, exam-passed, submitted, approved, rejected, info-requested, plan-expiring, cert-expiring, cert-fee-receipt).
- [ ] All 5 Vercel Cron jobs deployed (expire-listings, expire-certs, expire-subscriptions, digest-reviewer-queue, weekly-admin-digest).
- [ ] End-to-end Playwright test passing the full pilot loop.
- [ ] All 8 UI acceptance criteria from `MVP_BUILD.md` Section 2A.10 met (TalentLMS visual direction, no vibe-code, consistent chrome).
- [ ] Production deployed to `allergenwise.com` (not just staging), DNS via Cloudflare, SSL active.
- [ ] First real pilot restaurant onboarded end-to-end (signup → invite → train → cert → submit → approved → publicly listed).

### 7.4 General terms

Invoices sent via Stripe Invoicing or Wise. Payment due within 7 days of milestone sign-off (signature on a one-line email confirming the demo passed is sufficient).

If a milestone slips for reasons on my side, the timeline extends at no extra cost. If a milestone slips because you're unavailable to demo or take >5 business days to give feedback, that time doesn't count against my schedule.

**For context:** market rate for an MVP of this scope from an agency or independent contractor is **$25,000–$45,000** (~$75–120/hr × ~270 hours). The $9,000 price reflects our relationship and is roughly one-third of the agency floor — possible only because there's mutual trust and an explicit understanding that v2 is a separate, paid engagement with a real team.

---

## 8. Alternative: cash + equity option

If you'd prefer a smaller upfront cash outlay in exchange for a small equity stake, here's that option:

| Item | Amount |
|---|---|
| Cash | **$8,000** total ($1,500 signing / $3,250 midpoint / $3,250 launch) |
| Equity | **5–10%** common stock, vesting monthly over 12 months with no cliff |

Equity terms to be defined in a separate one-page agreement (vesting schedule, what happens on termination, drag-along/tag-along, voting rights). Anchored to the company being structured (LLC or C-corp) at signing.

This option is on the table because you've described AllergenWise as a real product you're building, not a one-off contract job. If we both believe in the long-term outcome, equity aligns incentives better than cash alone — I'm motivated to make sure v2 is set up well, you preserve cash for the v1.0 team, and the project upside is shared.

This option is **mutually optional**: pick whichever framework feels right.

---

## 9. Change orders

The scope in Section 4 is fixed. Anything outside that scope will be handled as a written **change order** with new fee + new timeline before work begins.

Change orders are billed at **$85/hour** with a 4-hour minimum estimate. Examples of likely change requests during the build:
- Add a new email template not listed in Section 4: ~2 hours.
- Add a new field to a form + database schema: ~3–6 hours.
- Build a new screen not in the wireframe: ~16–40 hours depending on scope.
- Add an integration not in Section 4 (e.g., Calendly, OpenTable): ~8–24 hours.

To keep the project on rails, change orders are agreed via email or text, with the new amount added to a running tally invoiced at the next milestone.

---

## 10. Cost passthrough (third-party subscriptions)

The infrastructure subscriptions required to run the MVP will be set up in **your** name with **your** payment method, not mine. This keeps your books clean, gives you direct ownership, and makes the eventual hand-off to the v1.0 team a single permission change.

You'll create accounts at:

| Service | Estimated MVP cost | Purpose |
|---|---|---|
| Vercel | $0 (Hobby tier) — upgrade to Pro $20/mo if traffic spikes | Hosting + auto-deploy |
| Supabase | $0 (Free tier) — Pro $25/mo once over 500MB | Database, auth, file storage |
| Stripe | 2.9% + $0.30 per transaction (no monthly fee) | Payment processing |
| Resend | $20/mo (10k emails/mo) | Transactional email |
| Mux | $20–25/mo at pilot view counts | Video hosting |
| Mapbox | $0 (free tier 50k loads/mo) | Directory map |
| Sentry | $0 (developer plan) | Error monitoring |
| Cloudflare + Domain | ~$1/mo amortized + ~$12/yr | DNS + CDN + domain registration |
| **Total fixed** | **~$45–95/mo** | + Stripe % on revenue |

I'll be added as a developer/team member on each account during the build. After launch, you can remove my access at any time.

If you'd prefer I create the accounts under my own name and bill you monthly with no markup, that's also fine — just let me know which approach you want.

---

## 11. Definition of "done" (acceptance criteria)

The launch payment is triggered when **all thirteen** of these are demonstrably true on the production URL:

1. A new restaurant can sign up and pay (Quarterly or Semiannual) via Stripe.
2. An admin can invite an employee (single or CSV) and the employee receives a working magic-link email.
3. An employee can complete all 5 modules including video playback on mobile and desktop.
4. An employee can take and pass (or fail and retry) the 25-question exam.
5. The PDF certificate generates correctly (teal styling, name, dates, QR code) and is downloadable.
6. The admin dashboard reflects employee progress accurately on page load.
7. The admin can submit the restaurant for review at 100% certified; cert fees charge correctly via Stripe.
8. The reviewer can see queue, open submission, approve/reject; admin gets notified by email.
9. An approved restaurant appears in the public `/directory` with a map pin and detail page.
10. The public can search the directory by allergen, cuisine, and location and see results.
11. The public can submit a review; the review enters a moderation queue.
12. The certificate verification page works at `/verify/{cert-code}`.
13. The UI passes the TalentLMS visual direction acceptance criteria (no vibe-code, no emoji in chrome, all 19 screens share consistent chrome).

You'll have full access to the staging environment from Week 1 to test as we go. Final acceptance is a 30-minute video walkthrough where I demo each item on production.

---

## 12. What you receive at handoff

On launch day, you receive:

1. Live production URL at **allergenwise.com**.
2. Admin and reviewer credentials for your own use.
3. Loom walkthrough video (~20 min) covering every flow.
4. **`MVP_BUILD.md`** — full technical spec (your reference + future engineering team's onboarding doc).
5. **`PRODUCTION_BUILD.md`** — the v1.0 roadmap (what to brief the future team on).
6. **`MANUAL_COMPONENTS.md`** — the operational checklist for things software doesn't handle (legal, insurance, content review, support).
7. GitHub repository (read access for you, write transferred on final payment).
8. Document with all account credentials and recovery codes for the cost-passthrough services.
9. 30-day warranty: any bug in MVP-scope features is fixed at no charge during the first 30 days post-launch.

---

## 13. Hand-off to v1.0 team

When you're ready to scale past pilot (typically after the first 50–100 paying restaurants validate the model), you'll hire a real team — likely a tech lead + 2 senior engineers + 1 designer + 1 PM, or a product agency for a fixed-fee v1.0 build. Estimated v1.0 budget:
- Agency route: $300k–$600k for 4–6 months.
- In-house team route: ~$1.3M–$1.7M loaded annual run rate.

The MVP I'm building is intentionally shaped to grow into v1.0 **without a rewrite**. The data schema, role system, payment model, and component library are all designed for the v1.0 team to extend, not throw away. `PRODUCTION_BUILD.md` lays out the migration path explicitly.

I'm available (paid hourly) to help interview engineering candidates, brief the chosen team on the codebase, or sit in on architectural reviews during the v1.0 build.

---

## 14. Working agreement

A few practical norms to set expectations:

- **Communication:** weekly Friday update (Loom + email). Mid-week questions via text/Slack — I aim to respond within 24h.
- **Decision speed:** I'll need decisions from you on small items (copy, photos, edge-case behavior) within 48h to keep the schedule on track. If a decision blocks me for >5 days, I'll move on to other tasks and adjust the timeline.
- **Demo cadence:** every 2 weeks I'll send a clickable staging link with what's new. Your feedback during demos becomes either same-week fixes (if in-scope) or change orders (if out-of-scope).
- **Time off:** I'll give 7 days notice of any 2+ day break. The schedule includes built-in buffer for both of us to take time off without affecting launch.
- **Slack/text after 9pm and weekends:** non-emergency only. Emergency = production is down or money is being lost.

---

## 15. Risk & mitigation

| Risk | Likelihood | Mitigation |
|---|---|---|
| Stripe verification delays prevent signup launch | Low | Stripe account verified in Week 1; full test-mode flows complete by Week 3 |
| Mux video hosting becomes expensive at pilot scale | Low | Mux pricing capped at ~$25/mo for pilot view counts; Bunny.net fallback documented |
| Curriculum content not ready by Week 4 | Medium | We'll align in Week 1 on whether you write the content, I write first drafts you edit, or we hire a registered dietitian for review (~$2k extra) |
| Scope creep | Medium | Change-order policy in Section 9; weekly demos catch creep early |
| You change priorities mid-build | Low | Same change-order policy applies; I'll surface the impact on timeline within 48h of a pivot request |
| Pilot restaurants don't show up | Out of my scope | Pilot recruitment is yours; I'll deliver the product whether 1 or 100 restaurants are waiting |

---

## 16. Acceptance

If this proposal works for you, sign and date below. I'll send a short formal contract incorporating this proposal verbatim, plus standard clauses (IP ownership transfers on full payment, 30-day warranty, mutual termination with 14 days notice, dispute resolution).

Once signed, I'll send the first invoice for $2,000. Work begins the next business day after that invoice clears.

---

**Client signature**

Name: ___________________________________

Title: ___________________________________

Date: ___________________________________

---

**Service provider signature**

Name: Guillermo Amador

Date: ___________________________________

---

**Selected pricing option** (check one):

- [ ] **Option A:** $9,000 cash, paid $2,000 / $3,500 / $3,500.
- [ ] **Option B:** $8,000 cash + 5–10% equity (terms in separate agreement), paid $1,500 / $3,250 / $3,250.

---

*This proposal is valid for 30 days from the date above.*
