# AllergenWise — Production Build Spec (v1.0)

**Version:** 1.0
**Audience:** The team that builds the post-pilot, post-500-user, real-product version. Likely a hired professional dev team (2–4 people) plus a designer.
**Relationship to MVP:** Everything in `MVP_BUILD.md` continues to ship; this doc layers on what's needed to scale, harden, and professionalize.
**Brand color rule:** Teal stays the allergen color across every surface. Designer establishes the full design system on top of teal-50 → teal-900.

---

## 1. What changes between MVP and v1.0

| Dimension | MVP | v1.0 production |
|---|---|---|
| Users | 10–500 restaurants, ~5k learners | 2,000–10,000 restaurants, 100k+ learners, 1M+ public directory visitors/month |
| Real-time | Polling every 30s where needed | WebSockets / Server-Sent Events for live progress, reviewer queue, notifications |
| Geo | Single region (us-east-1) | Multi-region (US + EU at minimum), edge caching globally |
| Storage | Supabase Storage (~10GB) | S3 + CloudFront, image pipeline, signed URLs at scale |
| Auth | Supabase Auth | Supabase Auth + SSO (SAML/Okta for multi-location chains), MFA mandatory for admin |
| Search | Postgres full-text | Algolia or Meilisearch with typo tolerance + faceting |
| Video | Mux | Mux Pro tier with DRM, captions/transcripts (Whisper), multi-language audio |
| Mobile | Responsive web | Native iOS + Android (React Native or native) |
| Compliance | None | SOC 2 Type II, WCAG 2.2 AA, COPPA review, state food-handler equivalence filings |
| Background work | Vercel Cron | Inngest or Trigger.dev for durable workflows; Postgres-backed queue or SQS |
| Observability | Sentry + Vercel Analytics | Sentry + Datadog APM + LogRocket for session replay + PagerDuty rotations |
| CI/CD | Vercel auto-deploy | GitHub Actions with required checks, preview environments per PR, blue/green prod deploys |
| Data layer | Supabase RLS | Same + read replicas, connection pooler (PgBouncer/Supavisor), partitioned activity tables |

---

## 2. Real-time architecture (websockets)

The MVP gets away with polling. v1.0 needs live updates in three places. **All three are real-time pain points; the wrong implementation costs money and reliability.**

### 2.1 Where real-time matters

| Use case | Why real-time | Recommended channel |
|---|---|---|
| Admin dashboard live progress (employee X just finished module 3) | Managers feel the product is alive; reduces "is it broken" support tickets | **Supabase Realtime** (Postgres logical replication) on `lesson_progress` filtered by restaurant_id |
| Reviewer queue: new submission appears, claim/release indicator shows another reviewer is on it | Prevents two reviewers double-handling; speeds throughput | **Supabase Realtime** on `submissions` + presence channel for "who's viewing" |
| Learner: instructor/manager notes appear during course, exam time-remaining sync, soft-block on banned account | Immediate trust signals + abuse mitigation | **Supabase Realtime** + a `notifications` table |

### 2.2 Tech choice

**Recommended: Supabase Realtime (Phoenix Channels under the hood) + a thin client layer.**

Why not roll your own websockets:
- Supabase Realtime piggybacks on Postgres logical replication — DB-driven events without a separate event bus.
- Built-in presence + broadcast channels for things that don't need DB state.
- Auth flows through Supabase JWT, RLS still applies.
- Falls back to long-polling on hostile networks automatically.

Alternatives if Supabase becomes a bottleneck:
- **Ably** or **Pusher** for managed pub/sub (cheaper than self-hosting; ~$50–500/mo at scale).
- **Cloudflare Durable Objects** for per-restaurant ephemeral state (e.g., live exam proctoring).
- **Self-hosted Phoenix or socket.io on Fly.io** only if there's a specific reason — operational cost is real.

**Do NOT** use websockets for the public directory feed; CDN + ISR (Incremental Static Regeneration) is correct there.

### 2.3 Patterns to apply

- **Subscribe per-tenant**, never globally: `supabase.channel('restaurant:{id}').on('postgres_changes', {filter: `restaurant_id=eq.{id}`}, ...)`. Globals leak data and crush the broadcaster.
- **Reconnect with backoff** (1s → 2s → 5s → 30s). Show a subtle "reconnecting…" indicator. Never auto-reload the page on reconnect — preserves form state.
- **Event versioning**: include a `version` field in every realtime payload so old clients can ignore breaking shapes.
- **Snapshot + delta**: on connect, fetch current state via REST; then apply realtime deltas. Don't try to bootstrap from realtime alone.
- **Idempotent updates**: every realtime handler must be safe to receive the same event twice (it will happen during reconnect).

---

## 3. Scaling the data layer

### 3.1 Postgres scaling path

1. Vertical scaling on Supabase (Pro → Team → Enterprise) gets you to ~5k restaurants comfortably.
2. Add **read replicas** for the public directory queries (read-heavy, write-light).
3. Move to **Supavisor** (transaction-mode pooler) — Vercel serverless functions exhaust direct Postgres connections fast.
4. **Partition `activity_events`** by month (declarative partitioning) once you cross ~10M rows; archive partitions older than 12 months to cold storage.
5. **Partition `lesson_progress`** by restaurant_id hash if a single restaurant ever crosses 10k learners (chains).

### 3.2 Caching layers

| Layer | Tool | What goes there |
|---|---|---|
| CDN edge | Vercel / Cloudflare | All public marketing + directory pages (ISR with 60s revalidate) |
| Application | Upstash Redis | Hot lookups: `restaurant_by_slug`, `cert_by_code`, search results, exam question pool |
| DB query | Postgres `pg_stat_statements` + materialized views | Aggregations for reviewer queue stats, weekly digests, analytics |

Cache keys must include schema version so deploys auto-invalidate.

### 3.3 Search at scale

- Move from Postgres full-text to **Algolia** (~$500/mo at 100k restaurants) or self-hosted **Meilisearch** (~$50/mo on a small VM).
- Index on insert/update via Supabase Database Webhook → Inngest function → search index.
- Faceted search: cuisine, allergen specialty, distance bucket, rating range.
- Typo tolerance: 1 typo per 4 chars, 2 per 8, geo-aware ranking.
- Personalization later: weight results by what allergens the searching family follows (requires consumer-side accounts).

---

## 4. Auth & security hardening

- **Mandatory MFA** for admin and reviewer roles (TOTP via authenticator app; SMS as fallback).
- **SSO (SAML 2.0)** for multi-location chains — likely Okta or Azure AD on the client side. Use WorkOS as a connector to avoid implementing SAML from scratch.
- **Audit log** for all sensitive admin actions (role change, billing change, employee removal, submission decision). Stored in append-only `audit_log` table; mirrored to S3 with object lock for compliance.
- **Session policies**: 8-hour idle timeout for admin/reviewer; 30-day for learner; force re-auth before payment changes.
- **Rate limits** at the edge (Vercel Edge Middleware or Cloudflare WAF):
  - Auth endpoints: 5/min/IP.
  - Public review submission: 3/hour/IP, 1/day/restaurant per email.
  - Search: 60/min/IP.
- **CSRF** via SameSite=Strict cookies + double-submit token on form posts.
- **CSP** headers locked down: only `cdn.allergenwise.com`, Stripe, Mux domains.
- **Secret management**: Vercel env vars for runtime; Doppler or 1Password Connect for sharing across team.
- **Penetration test** before launch (Bishop Fox, Cure53, or HackerOne triage). Budget $15k–$30k.

---

## 5. Compliance & legal

| Area | What's needed | Why |
|---|---|---|
| **SOC 2 Type II** | Vanta or Drata onboarding (~$10k/yr tooling) + 6-month observation period + auditor (~$25k) | Required by enterprise restaurant chains |
| **WCAG 2.2 AA** | Accessibility audit by Deque or Level Access (~$10k); keyboard nav, screen reader testing, contrast pass | Public directory + course player must be accessible; legal exposure under ADA |
| **State food-handler equivalence** | File for state-level recognition (CA, NY, TX, FL first) so AllergenWise cert satisfies state food-handler requirements where applicable | Massive sales lever — converts "nice-to-have" to "required" |
| **COPPA** | Confirm no data collected from under-13s. Course content adult-only by default; gate any junior-staff cert with parental consent flow if pursued | Federal law, $50k/violation max |
| **GDPR/CCPA** | Data export + delete endpoints; cookie banner; DPA template for B2B contracts | EU and CA users; needed for any enterprise deal |
| **PCI DSS** | Stripe handles card data via Elements, so SAQ A applies. Annual self-assessment, no credentials stored | Payment processing |
| **Terms / Privacy / DPA** | Lawyer drafts, $5k–$10k. Include cert-revocation clause, content license clause, indemnity carve-outs | Contracts with restaurants |
| **Insurance** | Cyber liability ($1M+), E&O ($1M+), general liability | Required by many restaurant chains as vendor |

Total compliance spend year 1: **~$75k–$120k**.

---

## 6. Observability & ops

- **Sentry** for errors (FE + BE).
- **Datadog APM** or **Grafana Cloud** for traces, metrics, logs. Dashboards: signup funnel, learner completion funnel, exam pass rate by question (identify bad questions), Mux video QoE, Stripe payment success rate, reviewer queue age.
- **LogRocket** or **FullStory** session replay (sample 5%, 100% on error). PII-redacted.
- **PagerDuty** rotation. Alert on:
  - Stripe webhook failures > 3 in 5 min.
  - Cert PDF generation failures.
  - Realtime channel disconnect rate > 5%.
  - Database connection pool > 80%.
  - 5xx rate > 1% over 5 min.
- **Status page** (Statuspage.io or Better Uptime) at status.allergenwise.com.
- **SLOs**: 99.9% uptime for admin/learner, 99.95% for public directory, 99% for cert generation (it can retry).

---

## 7. Native mobile apps

Restaurant staff often train on personal phones. Responsive web works for MVP; native is a v1.0 differentiator.

**Recommended: React Native + Expo** (single codebase, share UI components with web via Tamagui or NativeBase).

Native-only features that matter:
- **Offline course playback** — staff at restaurants with bad WiFi can pre-download lessons.
- **Push notifications** — invite delivery is more reliable than email for hourly workers.
- **Native video** with PiP support.
- **Apple Wallet / Google Wallet pass** for the cert (replaces printable PDF).
- **Camera** for restaurant photo capture during submission.

Cost: 6–10 weeks dev, ~$40k contractor or in-house equivalent.

---

## 8. AI features (post-launch differentiation)

Once the core loop works, these are the highest-leverage additions:

| Feature | Approach | Value |
|---|---|---|
| **Menu allergen scanner** | Restaurant uploads PDF/image of menu → vision model + LLM tags allergens per dish → admin reviews → published as guest-facing menu | Becomes the reason customers visit the directory daily |
| **Voice-driven course content** | Whisper + TTS for line cooks who can't read while prepping | Accessibility + non-English speakers |
| **Translated cert + course** | LLM-generated translations reviewed by humans for top 5 languages (ES, ZH, VI, KO, AR) | Restaurant industry workforce reality |
| **Live allergen Q&A** during course | Inline chat with a model trained on the curriculum content | Reduces drop-off mid-course |
| **Auto-summarized incident reports** | Server staff records incident verbally → transcribed + summarized → stored | Risk-management upsell |
| **Reviewer co-pilot** | LLM pre-checks submissions (cert IDs valid, scores OK, no obvious red flags) → reviewer just confirms | 5x reviewer throughput |

Use Anthropic Claude API for content tasks, OpenAI Whisper for transcription. Budget ~$0.05–0.20 per restaurant/month at moderate use.

---

## 9. Multi-tenant chain support

Currently each restaurant is its own account. For chains (Chipotle has 3,000+ locations):

- New `organizations` table; `restaurants.organization_id` nullable FK.
- Org admin role: sees aggregated dashboard across all locations, manages billing centrally.
- Location admin role: scoped to single restaurant.
- Bulk operations: roster import across locations, location-level reports, org-wide compliance posture.
- Custom contract pricing (not Stripe Checkout — sales-led).

---

## 10. Background jobs at scale

Vercel Cron is fine for handful of jobs/day; v1.0 needs durable workflows.

**Recommended: Inngest** (managed) or **Trigger.dev**.
- Webhook-triggered workflows: Stripe event → 5-step retry-able workflow (charge → email → log → activity feed → notify).
- Scheduled: cron jobs become durable; failed runs retry with exponential backoff.
- Fan-out: "send 200 invite emails" becomes 200 individual jobs that retry independently.
- Observability: built-in run history, replay, debugger.

Patterns to enforce:
- Every external API call is idempotent (use idempotency keys on Stripe, dedupe on Resend by message ID).
- Long-running tasks (CSV import of 10k rows) split into chunks of 100, fan-out, aggregate results.
- Dead-letter queue for jobs that fail 5 times → email engineering on call.

---

## 11. Video pipeline at scale

- Mux is fine to ~50k MAU; switch to **Mux Pro + DRM** above that.
- Captions: auto-generate via Whisper, human-review, store in `lesson_captions` table with timestamps.
- Multi-language audio tracks for top 5 languages (record once, dub via ElevenLabs voice clones with talent consent).
- Quality of Experience (QoE) dashboard: which lessons have highest rebuffer rate, drop-off curve per lesson, completion rate by device class.
- Video CDN warming for new episode launches in major markets.

---

## 12. Public directory becomes a real product

The directory is the consumer side. It's a Yelp-shaped product, and at v1.0 it's the moat.

- **SEO obsession**: structured data (Schema.org `Restaurant` + custom `AllergenCertification`), unique content per restaurant page, sitemaps, hreflang once translated.
- **Allergy-family accounts**: parent creates account, lists their family's allergens, every search is auto-filtered, save favorite restaurants, get alerts when new certified restaurants open near them.
- **Reviews moderation**: ML pre-filter for spam + fake reviews + medical defamation; human moderator escalation queue; verified-diner badges via integration with OpenTable/Resy reservations.
- **Photos and menus**: parents can upload safe-meal photos with tags ("the GF pizza here is great").
- **Map enhancements**: cluster pins, search-as-you-pan, "open now" filter, walking/transit distance.
- **Native search ads** for restaurants that want top placement (separate revenue stream — be careful, this conflicts with the trust mission; if added, must be visibly labeled "Sponsored").

---

## 13. Notifications platform

Replace ad-hoc Resend emails with a notifications hub:

- **Channels**: email (Resend or Postmark), SMS (Twilio), push (Expo Push), in-app (websocket).
- **Per-user preferences**: each notification type has user-controlled channel + frequency. Quiet hours respected.
- **Templating**: React Email components with a per-restaurant theming layer.
- **Unsubscribe management**: hard list, per-channel, per-category; comply with CAN-SPAM and TCPA.
- **Deliverability monitoring**: bounce rates, spam complaints, sender reputation (Resend's dashboard or Mailgun's tools).

---

## 14. Internationalization

When ready to expand outside US:
- Routes prefixed by locale (`/es/directorio`, `/zh/...`).
- Course curriculum re-recorded per language (don't auto-translate certifications — accuracy matters legally).
- Per-region cert: a US AllergenWise cert may not satisfy EU rules; create regional cert tracks.
- Currency support: Stripe handles; pricing tables keyed per region.
- Date/time formatting: Intl.DateTimeFormat.
- Right-to-left for Arabic — design system needs RTL audit.

---

## 15. Content versioning & curriculum CMS

The curriculum will change. Build a CMS:
- Each course module/lesson has a `version` and `published_at`. Learners are pinned to the version they started; new starters get latest.
- Curriculum CMS panel for the AllergenWise team to edit without engineering deploys (Sanity, Payload, or custom on Supabase).
- Exam question pool versioned; A/B test new questions against existing pool to detect bad ones.
- Curriculum diff view: when a learner's restaurant requires re-cert, show what's new since last cert.

---

## 16. Analytics & data warehouse

- Event tracking: Segment or self-hosted Snowplow → BigQuery or Postgres analytics replica.
- Funnel analysis: PostHog (open source, self-hostable) or Mixpanel.
- Revenue analytics: ChartMogul or built on top of Stripe data.
- Internal BI: Metabase or Hex.
- Key dashboards:
  - North-star: weekly active certified restaurants.
  - Acquisition: signup → activation → first cert issued (time + drop-off per stage).
  - Retention: cohort retention by signup month.
  - Course health: completion rate per module, exam pass rate per question.
  - Directory: traffic, click-through to restaurant detail, conversion to review.

---

## 17. CI/CD

- **GitHub Actions** for lint, type-check, unit tests, E2E smoke (Playwright on preview deploy URL).
- **Preview environments per PR** — Vercel does this, plus Supabase branching for isolated DB per PR.
- **Migration safety**: every PR with a SQL migration runs against a clone of prod schema; changes require explicit approval.
- **Feature flags** via PostHog or LaunchDarkly so engineers ship behind flags and ramp gradually.
- **Blue/green production deploys** for the API surface; instant rollback capability.

---

## 18. Cost forecast (production, monthly)

| Service | At 500 rests | At 2,000 rests | At 10,000 rests |
|---|---|---|---|
| Vercel | $20 | $150 | $750 (Enterprise) |
| Supabase | $25 | $250 | $1,000 (Team/Enterprise) |
| Stripe % | $200 | $800 | $4,000 |
| Resend / Postmark | $35 | $100 | $500 |
| Mux | $100 | $300 | $1,500 |
| Mapbox | $50 | $200 | $800 |
| Algolia | $0 (still on PG) | $500 | $2,000 |
| Sentry + Datadog + LogRocket | $80 | $400 | $1,500 |
| Inngest / Trigger.dev | $20 | $80 | $300 |
| Twilio (SMS) | $20 | $100 | $500 |
| Compliance tooling (Vanta, etc.) | $800 | $1,000 | $1,500 |
| Misc (DNS, backups, dev tools) | $50 | $150 | $400 |
| **Total / month** | **~$1,400** | **~$4,000** | **~$15,000** |
| **Annual** | $17k | $48k | $180k |

At $150 ARPU and 10k restaurants → $18M ARR vs $180k infra = 1% infra-to-revenue ratio. Healthy SaaS economics.

---

## 19. Team to build v1.0

| Role | Allocation | Cost (US, FT) |
|---|---|---|
| Tech lead / staff engineer | 1.0 FTE | $200k–$280k |
| Senior full-stack engineer | 2.0 FTE | $160k–$220k each |
| Mobile engineer (RN) | 1.0 FTE | $160k–$200k |
| Senior product designer | 1.0 FTE | $160k–$200k |
| Product manager | 0.5 FTE | $90k (half) |
| QA / SDET | 1.0 FTE | $130k |
| DevOps / SRE | 0.5 FTE (or fractional) | $100k |
| Engineering manager | 0.5 FTE | $130k |
| **Annual run rate** | | **~$1.3M–$1.7M loaded** |

Or hire a **product agency** for 4–6 months at $300k–$600k for v1.0 launch, then build a smaller in-house team for ongoing.

Build calendar: **6 months** from MVP to v1.0 with the above team.

---

## 20. v1.0 launch checklist

A v1.0 isn't "done" until:

- [ ] SOC 2 Type II report in hand (or in observation period with completion path).
- [ ] WCAG 2.2 AA audit passed; remediations done.
- [ ] Penetration test passed; high/critical issues fixed.
- [ ] 99.9% uptime sustained for 30 days on staging with synthetic load.
- [ ] Native iOS + Android apps in App Store + Play Store with > 50 internal testers.
- [ ] Status page live; runbooks for top 10 incidents written.
- [ ] PagerDuty rotation staffed 24/7.
- [ ] State food-handler equivalence filed in CA (and at least 2 other states).
- [ ] Insurance bound (cyber, E&O, GL).
- [ ] DPA + MSA templates lawyer-approved for enterprise sales.
- [ ] First chain customer signed (10+ locations) — proves multi-tenant works at the contract layer.
- [ ] At least one major ML feature live (menu scanner is the highest-impact bet).
- [ ] Documentation: public API docs (if API exposed), help center, in-app onboarding tours.
- [ ] Data export + delete flows working end-to-end (GDPR compliance).
- [ ] Real-time subscriptions stress-tested at 10k concurrent connections.
- [ ] Backup + restore drill completed (full DB restore in <1 hour from cold).

---

## 21. Open architectural decisions for the v1.0 team

These are deliberately left for the team that builds v1.0, because they depend on talent + traffic patterns:

1. **Monolith vs services** — start as a modular monolith; extract services only when scaling pain forces it.
2. **TypeScript everywhere vs polyglot** — TS likely correct, but data team may want Python for analytics.
3. **Mobile: React Native vs native Swift+Kotlin** — RN is faster; native is better long-term if mobile becomes core.
4. **CMS for curriculum** — buy (Sanity, Contentful) or build on Supabase.
5. **Realtime: Supabase Realtime vs Ably/Pusher** — Supabase first, switch only if metered cost or feature gap.
6. **Search: Algolia vs Meilisearch self-hosted** — Algolia for speed-to-market, Meili to control cost.
7. **Workflow engine: Inngest vs Temporal vs build-on-Postgres** — Inngest for MVP-team speed, Temporal if engineering team is strong.
8. **Frontend: stay Next.js or switch to Remix/SvelteKit** — stay Next.js unless team has strong reason.

---

## 22. Migration path: MVP → v1.0 without a rewrite

Don't throw the MVP away. The path:

1. Ship MVP. Collect 6+ months of real usage data.
2. Hire team. They spend month 1 reading code + meeting users.
3. **Refactor in place**: extract `lib/` into proper packages; introduce feature flags; add Inngest workflows alongside cron; introduce Supabase Realtime to existing tables.
4. **Add the new product surface area** (chains, native, AI features) as new modules.
5. **Replace hot spots** (search → Algolia, video → Mux Pro) without changing UX.
6. **Launch v1.0** as a marketing event, not a code rewrite.

The MVP database schema is intentionally shaped to grow into v1.0 — `organizations` table can be added without breaking `restaurants`, `lesson_progress` can be partitioned without app changes.

---

## 23. What is explicitly not in v1.0

Even v1.0 should resist:
- **Restaurant POS integration** (Toast, Square) — talk about it, don't build it.
- **Reservations** — directory links to OpenTable, doesn't compete.
- **Payroll / hiring tools** — not the lane.
- **Health-inspector tooling** — adjacent but a different product.
- **Insurance product** — interesting but a 5-year journey, not v1.0.

Stay focused: certified restaurants, trained staff, trusted directory, AI-augmented allergen safety.
