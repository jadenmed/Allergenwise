# AllergenWise — Project Context

> **Purpose of this file:** Onboard a fresh Claude session (or human collaborator) on what AllergenWise is, where the project stands, and what design/UX infrastructure has already been wired up. Read this before doing any non-trivial work in the repo.

---

## What AllergenWise Is

AllergenWise is a **B2B SaaS allergen-safety certification platform** for restaurants. Two halves of one product:

1. **Certification side (B2B):** Restaurants pay to certify their staff via a structured 5-module course with videos, readings, and a 25-question exam. On pass, the restaurant gets a verifiable certificate they can display.
2. **Discovery side (consumer-facing):** A public directory of certified restaurants so allergic diners (or parents of allergic kids) can find safe places to eat. A QR code on a restaurant window leads to a public verification page proving the certification is real and current.

**Four user roles share one design system:**

- **Learner** — restaurant staff member taking the course + exam
- **Reviewer** — internal/contracted reviewer of exam submissions
- **Admin** — restaurant owner/manager handling roster, billing, invites
- **Public diner** — uses the directory + scans QR codes for verification

The product must read as **trustworthy, clinical, credentialed** — closer to ServSafe / FDA / healthcare compliance tools than to a consumer startup. The canonical user moment is *a parent at a birthday party scanning a cert QR code on a restaurant window*. They need "real, recent, verified" communicated in under two seconds.

---

## Tech Stack (as of 2026-04-30)

- **Framework:** Next.js 14 (full-stack)
- **Auth + DB:** Supabase (Postgres, server-side auth, invite tokens)
- **Payments:** Stripe
- **Video hosting:** Mux
- **Email:** Resend
- **PDF generation:** react-pdf (certificates with QR codes)
- **UI primitives:** Radix UI (dropdown-menu, dialog, select, tabs, avatar, label, slot)
- **Styling:** Tailwind CSS 3 + shadcn/ui-compatible token system (already configured)
- **Testing:** Vitest (unit) + Playwright (e2e)
- **Package manager:** pnpm
- **Language:** TypeScript

---

## Project State

Partial / mid-build. The skeleton is real:

- Three role-based route trees scaffolded: `(learner)`, `(reviewer)`, `(admin)`
- Public surfaces: landing, pricing, directory (browsable by slug), certificate verification
- Auth flows: login, signup, invite-token redemption
- Tailwind design tokens fully extended (teal scale, surface, ink, semantic, shadcn aliases)

The repo is being prepared for a **backend audit pass first**, **UI build second**. UI work does not start until backend is signed off.

---

## Design System — Status: LOCKED

A complete design system has already been authored and lives at:

**`design-system/allergenwise/MASTER.md`**

This is the authoritative source for all UI/UX decisions on AllergenWise. Read it before doing any UI work. Key locked decisions captured there:

- **Color:** Teal-based system. Primary action color is `primary-700` (`#0f766e`). The full teal scale (`primary.50`–`primary.900`) is defined in `tailwind.config.ts`. **Do not propose cyan, blue, or emerald-as-brand alternatives.** Cyan was rejected. Teal is settled.
- **Typography:** Inter for both heading and body. Single-family system. **Do not propose serif headings or restaurant-flavored type pairings (Playfair, Lora, etc.).**
- **Type scale:** Compact "TalentLMS density" — 11px (xs) to 28px (3xl). Defined in `tailwind.config.ts`.
- **Radius scale, shadow tokens, component sizing, spacing grid:** All locked in `tailwind.config.ts`.
- **Style frame:** "Trust & Authority + Minimal." WCAG AAA target, AA floor.
- **Allergen-specific UX rules:** Six domain rules documented in MASTER.md (e.g., "contains" vs "may contain" must be visually distinct; severity is never communicated by color alone; certificates have three states: Active / Expired / Revoked).

`tailwind.config.ts` is the **implementation source of truth** for all tokens. MASTER.md documents the system in human terms and adds rules the config can't express.

---

## Phase Plan

The project is being built in phases. The current phase is **backend audit + bug fixes**. UI work does not begin until the backend phase is signed off.

| Phase | Focus | UI/UX Pro Max skill |
|-------|-------|---------------------|
| **Phase 2 (current)** | Backend audit, bug fixes, security review, data integrity | Not used. Skill is staged but dormant. |
| **Phase 3 (later)** | UI build out across all four role surfaces | Skill active in **reference mode** only. MASTER.md governs. |

---

## Working Standards (from CLAUDE.md)

- **"Boil the ocean."** Permanent fixes over workarounds. Tests over hand-waves. Documentation over tribal knowledge. The standard is *"holy shit, that's done"* — not *"good enough."*
- **Teal-only UI default.** All UI work defaults to teal-based palettes. Only deviate on explicit request.
- **Search before building. Test before shipping. Ship the complete thing.**

---

## Where to Look First

1. `CLAUDE.md` — working standards
2. `CONTEXT.md` — this file (product, state, design system, skill rules)
3. `design-system/allergenwise/MASTER.md` — locked design system
4. `tailwind.config.ts` — implementation source of truth for tokens
5. `app/` route trees — what's built (`(learner)`, `(reviewer)`, `(admin)`, public)

---

## Last Updated

2026-04-30 — Initial authorship after the design-system + skill staging session.
