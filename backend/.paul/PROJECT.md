---
type: Project
about: allergenwise
---

# AllergenWise — PAUL Project

## What
B2B SaaS allergen-safety certification platform for restaurants. Next.js 14 (App Router) + Supabase (Postgres/auth) + Stripe (payments) + Mux (video) + Resend (email). Deployed on Vercel. pnpm, TypeScript, Vitest + Playwright.

## Current Milestone — v0.1 Perf-Hardening + Simplification
Source: `~/Documents/Claude/Projects/OS BUILD/allergenwise-audit.md` (read-only audit, 2026-06-28).
Convert approved audit items into individual PAUL plan→apply loops, one at a time. No two loops on the same files concurrently.

## Constraints (non-negotiable)
- **Behavior-preserving** unless a plan explicitly states otherwise. Callers unchanged.
- RLS on every tenant-scoped table; never trust client tenant_id.
- Stripe webhooks verify signature AND dedupe on event_id.
- Public verification endpoint leaks nothing beyond Active/Expired/Revoked + restaurant name + issue date.
- Every external integration verified end-to-end with a test.
- Scope discipline: a plan touches ONLY its declared files. No drive-by edits.
- One loop at a time; do not chain loops without explicit user pick.

## Value
Trustworthy, clinical, credentialed product. Reliability + latency on payment/exam/cert paths matter most.
