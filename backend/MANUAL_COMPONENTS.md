# AllergenWise — Manual Components (Guillermo's Private Notebook)

**Audience:** Guillermo only. This is the list of things AI/Claude is bad at, slow at, or risky on. These are the human-owned pieces of the build. Don't hand any of these wholesale to Claude — review every line yourself, or pay an expert.

---

## 1. Why this doc exists

Claude is great at scaffolding code, writing typed APIs, generating CRUD, building forms, drafting copy, and translating wireframes into Tailwind. Claude is not great at things where:

- **Wrongness costs real money or harms a user** (Stripe webhooks, payment math, security boundaries).
- **The "right answer" depends on context Claude can't see** (your bank, your jurisdiction, your tax setup).
- **Subtle bugs hide for weeks** (race conditions, websocket reconnect, retry loops).
- **It requires a human signature** (legal docs, contracts, insurance forms).
- **It's pure judgment** (pricing decisions, what to ship vs cut, who to trust).

Treat this doc as your pre-flight checklist. Anything in here, if Claude touches it, you re-read every diff line by line.

---

## 2. Stripe & money

### 2.1 What Claude can do
- Stripe Elements form scaffolding.
- Webhook route boilerplate.
- Test-mode happy-path flows.

### 2.2 What you must own
- **Webhook signature verification** — read every line. A bug here means anyone can fake a paid signal.
- **Idempotency on every charge** — Stripe will retry; double-charging is the #1 source of refunds.
- **Off-session vs on-session** — cert fees are off-session (charged after the fact). Wrong setting = SCA failures in EU and locked-up payments.
- **Refund policy** — code does NOT auto-refund. Set up a manual refund process you do via Stripe Dashboard. Document it.
- **Tax** — Stripe Tax costs 0.5% per transaction but handles sales-tax compliance in 50 states. **Turn it on before your first paid customer.** Otherwise you owe sales tax personally to every state where you have nexus, and reconstructing it later is brutal.
- **1099-K threshold** — Stripe will issue a 1099-K to you over $20k or 200 transactions (federal). Track this in your bookkeeping from day one.
- **Bank account verification** — Stripe needs your business bank account, EIN, and personal ID. **This requires a real business entity** (LLC at minimum) before launch. Don't accept money under your personal SSN — pierces the corporate veil.
- **Chargebacks** — set up email forwarding for `chargebacks@allergenwise.com` so you see disputes immediately. Lost chargebacks cost the disputed amount + $15 fee + reputation hit on Stripe.

### 2.3 Pre-launch checklist
- [ ] LLC formed (or S-corp / C-corp if intending VC fundraise).
- [ ] EIN issued.
- [ ] Business bank account opened (Mercury, Brex, or local bank).
- [ ] Stripe account verified (KYC complete).
- [ ] Stripe Tax enabled.
- [ ] First test-mode → live-mode transition done with a $1 charge to your own card.
- [ ] Refund policy documented and linked from `/pricing` and `/signup`.
- [ ] Bookkeeping tool (QuickBooks, Xero, Pilot, or Bench) connected.

---

## 3. Legal documents (do not let Claude draft these)

You need a lawyer for:

- **Terms of Service** — covers content license, indemnity, dispute resolution, cert revocation rights.
- **Privacy Policy** — covers data collection, third-party processors, retention, deletion rights.
- **Cookie Policy** — required if any non-essential cookies (analytics).
- **Data Processing Addendum (DPA)** — for B2B contracts; restaurants will ask.
- **Master Services Agreement (MSA)** — for chains/multi-location accounts.
- **AllergenWise Certification Agreement** — what restaurants agree to when they get certified (audit rights, revocation rights, brand mark usage).
- **Reviewer NDA** — internal reviewers see business-confidential restaurant data.
- **Independent Contractor Agreement** — for any contractor you hire (including video producers, designers).
- **Trademark filing** for "AllergenWise" name + logo — USPTO ($350 per class, ~6–12 months processing).

**Cost estimate:** $5k–$15k for the full set with a startup-focused lawyer (Cooley GO, Stripe Atlas docs, or ClerkyLaw as cheaper templates). **Templates from the internet are not a substitute** — pay the lawyer.

**Do NOT** copy another company's terms and search-replace the name. That's a copyright violation AND it usually contains clauses that don't apply to you.

---

## 4. Insurance (Claude can't get you a policy)

Required before first paying customer:

| Policy | Purpose | Approx cost yr 1 |
|---|---|---|
| **Cyber liability** | Data breach, ransomware, customer notification costs | $1,500–$3,000 |
| **Errors & Omissions (E&O / Tech E&O)** | Customer sues claiming product caused loss | $1,500–$3,000 |
| **General liability** | Slip-and-fall, basic business liability | $500–$1,000 |
| **Workers' comp** | Required by law if you hire employees in most states | varies |

Brokers to call: Embroker, Vouch, Founder Shield (these specialize in tech startups). Get 3 quotes minimum. Many enterprise restaurant chains will require certificates of insurance (COI) before signing — your broker generates these.

---

## 5. Course content (curriculum, video, exam questions)

Claude can generate first drafts but **do not ship Claude-generated medical content as authoritative without expert review.**

### 5.1 You must hire / consult
- **Registered Dietitian Nutritionist (RDN)** with food-allergen specialty — review every module for accuracy. Budget $1,500–$3,000 for full review.
- **Restaurant operations consultant** — review kitchen-protocol module for real-world feasibility. Often a friend who runs a restaurant, or a paid advisor at $200–500.
- **Allergist or pediatric immunologist** — sign off on emergency-response module (anaphylaxis, EpiPen). $500–$1,500 for review.

### 5.2 Video production options

| Option | Cost / module | Quality |
|---|---|---|
| Screen-record + your voice (Loom, Camtasia) | $0 | MVP-acceptable, looks scrappy |
| Hire VO talent on Voices.com or Voice123 | $200–500 | Good narration, you keep visuals scrappy |
| Hire video producer for full module | $2k–8k | Professional, slow turnaround |
| Use synthesized video (Synthesia, HeyGen) | $30/mo subscription + writing time | Uncanny but consistent; useful for translations later |

**MVP recommendation:** screen-record + decent USB mic (~$80 Blue Yeti or Shure MV7). Re-record after pilot feedback.

### 5.3 Exam question pool

Claude can generate questions but you need 50–75 questions reviewed for:
- Single correct answer (no ambiguous "best of these").
- No trick wording.
- Calibrated difficulty (mix easy/medium/hard).
- Legal claims accurate (Top 9 allergens per FALCPA + FASTER Act 2021).
- No state-specific claims unless you've verified that state.

**Have the RDN review the question pool.** A bad question that fails everyone makes the exam look broken; a bad question that passes everyone makes the cert worthless.

---

## 6. Websockets / real-time (you'll touch this in v1.0)

Claude can scaffold Supabase Realtime channels. Where Claude commonly gets it wrong:

- **Reconnect storms** — when Supabase Realtime restarts, every client reconnects at once. Default config will hammer your DB. Stagger reconnects with random jitter (0–10s).
- **Memory leaks on unmount** — every `.subscribe()` needs a `.unsubscribe()` in React `useEffect` cleanup. Claude often forgets the cleanup. Audit this manually.
- **Auth token refresh** — JWT expires every hour. Realtime channels using stale tokens silently stop receiving messages. Wire up a token-refresh listener that re-subscribes channels.
- **Race conditions on optimistic UI** — when you optimistically mark a lesson "complete" then the realtime confirmation arrives, don't double-apply. Use the realtime payload as source of truth, not as a duplicate.
- **Presence drift** — Supabase Realtime presence has known stale-presence issues; "John is viewing this" can persist after John closed the tab. Add a 30s heartbeat ping.
- **Cost surprises** — Realtime is free up to 200 concurrent clients then $10 per 100 additional. Set up a budget alert in Supabase. A buggy auto-subscribe can spike bills.

**Test plan:** open the same admin dashboard in two browsers. Have one disconnect/reconnect 20 times. The other should never see duplicate events.

---

## 7. Email deliverability (subtle, not technical)

Claude can write the React Email templates. What Claude can't do:

- **Set up SPF, DKIM, DMARC records** in your DNS — required or you go straight to spam. Resend has a setup wizard; follow it precisely.
- **Warm up your domain** — sending 10k emails on day one from a new domain triggers spam filters. Send 100, then 500, then 2k, then unlimited over 2 weeks.
- **Avoid spam-trigger words** in subject lines: "free", "act now", "100%", excessive caps, exclamation points, dollar signs.
- **Authenticate the sending domain** with Google Postmaster Tools and Microsoft SNDS so you can monitor reputation.
- **Set up a separate subdomain** for transactional vs marketing email (`mail.allergenwise.com` for transactional, never send marketing from your main domain).
- **Bounce / complaint handling** — every hard bounce should auto-suppress that email address forever; every spam complaint should remove that account from all email entirely.

**Fastest fix when emails go to spam**: send 5 personal emails from `hello@allergenwise.com` to friends and have them reply. Replies build sender reputation faster than anything else.

---

## 8. Database migrations (deploy-time risk)

Claude writes SQL migrations. The category of bug Claude misses:

- **Migrations that lock tables** — `ALTER TABLE ADD COLUMN NOT NULL DEFAULT 'x'` rewrites every row and locks the table. Always: add nullable column, backfill in batches, then add NOT NULL constraint.
- **Migrations that downtime an app** — dropping a column the running code reads = 500s for everyone. Two-phase: deploy new code that doesn't read it, THEN drop column.
- **Foreign key cascades** — `ON DELETE CASCADE` is great until someone deletes a restaurant and you lose all their data forever. Audit cascade behavior.
- **Index creation locks** — `CREATE INDEX` locks writes; `CREATE INDEX CONCURRENTLY` doesn't. Always use CONCURRENTLY in prod.
- **Migration order across environments** — staging gets migrations before prod. If you skip staging, you'll find out about prod-only failures during a customer call.

**Rule:** before any migration runs in prod, you've personally read the SQL, run it on a clone of prod data, and timed how long it takes. Anything over 30s gets a maintenance window.

---

## 9. Security boundaries

Categories where Claude scaffolds insecure-by-default code:

- **Service role keys leaked to client bundles** — Next.js `NEXT_PUBLIC_*` env vars ship to the browser. Never put `SUPABASE_SERVICE_ROLE_KEY` behind `NEXT_PUBLIC_`. Audit your bundle.
- **RLS bypass via service role** — server actions that use the service-role client skip RLS entirely. Every server action touching user data must scope explicitly to the authenticated user, OR enforce permissions in app code. Default to using the user-scoped client; only use service-role when you've thought about it.
- **Open redirect vulns** — any `?redirect=` param needs to be checked against an allowlist. Otherwise attackers craft `/login?redirect=https://evil.com`.
- **CSRF on POST endpoints** — Next.js Server Actions are CSRF-protected by default; raw API routes are not. Audit.
- **Webhook endpoints** — Stripe, Mux, Resend webhooks need signature verification. Anyone can hit your URL.
- **File upload XSS** — uploaded SVGs can contain `<script>`. Disallow SVG in user-uploaded photos OR sanitize server-side OR serve from a separate cookieless domain.
- **Server-side request forgery (SSRF)** — if your app fetches URLs based on user input (e.g., import restaurant from website), block private IP ranges (10.x, 192.168.x, 169.254.x, localhost).

**Mandatory before public launch:** read OWASP Top 10 once, scan with `npm audit`, run a free Snyk or Socket.dev scan on dependencies, do one round of Burp Suite manual probing on auth flows.

---

## 10. AI / Claude-generated code review checklist

When Claude writes code for you, check for:

- [ ] Are there `any` types? (TypeScript, replace with proper types.)
- [ ] Are errors silently swallowed? (`try { ... } catch {}` — almost always wrong.)
- [ ] Are there hardcoded credentials, API keys, or test data?
- [ ] Does the code have tests?
- [ ] Does the code handle the empty case (no rows returned)?
- [ ] Does the code handle the auth-failure case?
- [ ] Are there `console.log` statements left in?
- [ ] Are there `// TODO` comments that aren't tracked anywhere?
- [ ] Does it call any external service without a timeout?
- [ ] Does it retry without backoff?
- [ ] Does it assume a list is non-empty before `.map()` or `.[0]`?
- [ ] Does it leak secrets in error messages or logs?
- [ ] Does it use `Math.random()` for anything security-related? (Use `crypto.randomUUID()`.)

If any answer is wrong, push back and have Claude fix it. Claude responds well to direct correction.

---

## 11. Pricing & contracts with the client (your friend/family)

This is the most important section in the whole doc. **Get the contract signed before you write a single line of code.**

### 11.1 Contract must contain
- Scope: list of every screen and feature included (paste the "Definition of MVP done" from `MVP_BUILD.md`).
- Out-of-scope: list everything in `PRODUCTION_BUILD.md` as v2 work, explicitly excluded.
- Payment schedule: $X upfront, $Y at midpoint, $Z at completion.
- Definition of "midpoint" and "completion" — measurable acceptance criteria, not vibes.
- Timeline: target weeks with explicit "scope vs schedule tradeoff" clause (you can slip if she adds scope).
- IP ownership: she owns the code on full payment; you keep right to reuse non-restaurant-specific patterns/libs.
- Hosting/cost passthrough: she pays for Vercel/Supabase/Stripe/Mux/Resend/Mapbox subscriptions directly under her account, OR you bill her monthly with a 0% markup. **Do not pay these out of your pocket and forget to invoice — happens constantly.**
- Change request process: anything outside scope = written change order with new fee + new timeline.
- Termination: either party can terminate with 14 days notice; she pays for work completed.
- Warranty: 30-day bug-fix window post-launch on MVP-scope features only.
- Equity (if applicable): vesting schedule, cliff, what triggers vesting, what happens on termination.

### 11.2 Cost passthrough recommendation
Have her create the Stripe / Vercel / Supabase / Mux / Resend / Mapbox accounts in **her** name with **her** credit card from day one. You get added as a developer/team member. This:
- Keeps your books clean.
- Means you don't owe her receipts every month.
- Means when you hand off to the v2 team, ownership transfer is one click (just remove your access).

### 11.3 Watch out for scope creep with friends
Friends ask for "small changes" because the relationship feels casual. Each small change is real time. Either:
- Build a small-change buffer into the price (~10–15% padding), OR
- Charge hourly for anything not in the original scope at $75–125/hr.

Write this in the contract. **Always.**

---

## 12. Data you should keep out of Claude's hands

When working with Claude on this project, do NOT paste:

- Real customer payment info (test data only).
- Real employee SSNs / DOB / personal addresses (use synthetic data).
- Production database dumps with real emails (anonymize first).
- Production API keys (use test keys).
- Health information from any beta user (you're not HIPAA-covered; don't get mistaken for it).
- Real reviewer notes that mention restaurant business strategy.

Claude is generally privacy-respecting but treat any conversation as if it could be reviewed. Use synthetic / anonymized data for prompts.

---

## 13. Support & customer service (you, then someone else)

For pilot, you're support. Set up:

- **Help email**: `help@allergenwise.com` — forward to your inbox; reply within 24h.
- **Help widget**: skip Intercom for pilot (expensive); use Plain.com or Crisp ($0 plan) or just an email link.
- **Bug report path**: button in admin nav that prefills `mailto:bugs@allergenwise.com?subject=Bug: ...`.
- **Status page**: needed only after first real outage; Better Uptime free plan works.

When you can't be on call (vacation, sleep), set up an auto-reply: "We've received your message and will respond within X hours. For payment issues, manage your subscription directly via Stripe at..."

Hire a part-time support rep at ~50 paying restaurants, full-time at ~150.

---

## 14. Things to re-evaluate every 4 weeks

Set a calendar reminder. Every month, ask yourself:

1. Are pilot users actually using it? (Login frequency, lessons completed.)
2. Are they paying on time? (Failed-charge rate.)
3. What feature gets asked for most? (Even if you said "v2 only", track it.)
4. What's eating my time? (Anything taking >5h/week is a candidate to automate or hire.)
5. Is the friendship still healthy? (Pilot deals with friends/family fail when the work feels unfair to either side. Course-correct early.)
6. Am I still excited about this? (If not, why? Talk it through with someone.)

---

## 15. When to call in a real engineer

Even with Claude, there are moments you should hire a senior engineer for a 1–2 hour code review or pair session. Triggers:

- Before going live with payments — security audit.
- Before scaling past 100 paying restaurants — performance review.
- Before adding any new role to the auth system — RLS review.
- Before hiring the v1.0 team — code quality assessment so you know what they inherit.
- Anytime something feels weird and you can't articulate why.

Rate: $200–$400/hr for a senior dev on Codementor or similar. Worth every dollar; cheaper than a breach.

---

## 16. Files to keep updated

- `MVP_BUILD.md` — Claude reads this; keep current as scope evolves.
- `PRODUCTION_BUILD.md` — you read this; revisit when raising or hiring.
- `MANUAL_COMPONENTS.md` (this file) — you read this; update when you learn a lesson the hard way.
- `CHANGELOG.md` — every shipped change in date order. Future-you will thank present-you.
- `RUNBOOK.md` — start it day one. "What to do if Stripe webhooks fail." "What to do if a learner can't access course." Each incident → entry.

---

## 17. Personal reminder

You're building this for a friend/family member. Two failure modes are equally bad:
1. You undercharge, resent the work, ship slow, friendship damaged.
2. You overdeliver to prove yourself, burn out, ship late, friendship damaged.

**The safe middle:** clear contract, fair price, weekly check-in, demo every Friday, milestones with money attached. Treat her like a real client with a real timeline, and the friendship will be fine because the project will be good.

Boil the ocean on the BUILD. Do NOT boil the ocean on the relationship.
