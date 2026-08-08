Always use `/caveman full` for all responses in this project to minimize token usage.

**Read `CONTEXT.md` at the project root before doing any non-trivial work.** It documents what AllergenWise is, the locked design system at `design-system/allergenwise/MASTER.md`, and the phase plan. Every fresh session must orient there first.

## Graphify usage protocol

A Graphify code-graph exists on disk at `graphify-out/` (graph.json + report) — you may read it locally for structural context like call-graphs and change blast-radius, but do NOT commit it (it's gitignored); treat the actual source + CLAUDE.md/CONTEXT.md as the source of truth, since the graph is known to be incomplete.

Usage protocol (full guide: `docs/GRAPHIFY.md`):
1. Freshness first — compare `git rev-parse HEAD` to the "Built from commit" line in `graphify-out/GRAPH_REPORT.md`; refresh with `graphify ./ --update` (free, AST-only) if stale.
2. For structural questions, orient with GRAPH_REPORT.md (communities, god nodes) before grepping; use `graphify query|path|explain` instead of loading files into context.
3. Before refactoring any god node (`createServerSupabase`, `cn`, `createServiceSupabase`, `createServiceDb`), run a blast-radius query and list affected files in the plan — the graph must confirm a PAUL phase's declared file set is complete.
4. INFERRED-tagged edges are model guesses — verify against source. Never use the graph for data-flow or dead-code verdicts.

## Model selection — recommend before you execute

Cost matters on this project. Opus is roughly 5x the cost of Sonnet per token. Before starting any non-trivial task, **silently classify it** using the table below, then **state at the top of your response which model is appropriate and why** in one sentence. If the user is on the wrong model for the task, say so plainly and let them switch before you do the work.

**Use Opus for:**
- Architectural decisions with long shelf life (schema design, auth/RLS strategy, multi-tenant boundary, state machines for payments/certificates/exam-attempts)
- Multi-file subtle reasoning (race conditions, security review, RLS correctness, exam scoring edge cases)
- Backend/security audits, pre-launch reviews, App Store review-rules checks
- Tasks where wrong output wouldn't be caught until production
- Planning a complex piece of work end-to-end (then hand off to Sonnet for execution)
- Reviewing Sonnet's output on tricky work before merge

**Use Sonnet for:**
- Implementing against an existing spec, plan, or audit finding
- Wiring code to an existing pattern (route handler, webhook, query)
- UI work against the locked design system in `design-system/allergenwise/MASTER.md`
- Tests, refactors within a small cluster of files, mechanical changes
- Anything where running the result immediately reveals whether it's correct
- Following a step-by-step todo list

**The classifying question:** *"If this output is wrong, how would I find out?"* If the answer is "I run it and the test/UI breaks" → Sonnet. If the answer is "a customer or auditor would discover it months from now" → Opus.

**Format for the recommendation line at the top of responses:**
`> Model: [Opus|Sonnet] — [one-sentence why]. [If wrong model: "Switch before I proceed."]`

Keep this lightweight. Don't lecture about it on simple conversational turns. Don't suggest switching for trivial tasks.

== Standards (non-negotiable) ==

Boil the ocean. The marginal cost of completeness is near zero with AI. Do
the whole thing. Do it right. Do it with tests. Do it with documentation.
Do it so well that Guillermo is genuinely impressed — not politely
satisfied, actually impressed. Never offer to "table this for later" when
the permanent solve is within reach. Never leave a dangling thread when
tying it off takes five more minutes. Never present a workaround when the
real fix exists. The standard isn't "good enough" — it's "holy shit, that's
done." Search before building. Test before shipping. Ship the complete
thing. When Guillermo asks for something, the answer is the finished
product, not a plan to build it. Time is not an excuse. Fatigue is not an
excuse. Complexity is not an excuse. Boil the ocean.

Domain-specific non-negotiables for this build:
- RLS on every tenant-scoped table; never trust client-supplied tenant_id
- Stripe webhook handlers verify signature AND dedupe on event_id
- Public verification endpoint leaks nothing beyond Active/Expired/Revoked
  + restaurant name + issue date
- Every external integration verified end-to-end with a test
- Every state machine (cert, exam attempt, subscription) covered by tests
  for every transition, including invalid transitions

UI color rule: teal is the allergen color. All UI work in this project — components, badges, alerts, charts, mockups, slides, marketing visuals — must default to teal-based palettes (e.g., Tailwind teal-50 → teal-900, or hex like #14b8a6 / #0d9488 / #0f766e). Only deviate when Guillermo explicitly asks for a different color.
