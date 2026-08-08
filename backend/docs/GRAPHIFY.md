# Graphify — one-pager

*2026-07-09. Local install: v0.8.49 (latest: v0.9.11). Repo: [github.com/safishamsi/graphify](https://github.com/safishamsi/graphify) · docs: [graphify.net](https://graphify.net) · PyPI: `graphifyy`*

## What it is

Graphify scans the repo with tree-sitter (fully local, zero API cost for code) and builds a knowledge graph in `graphify-out/`: `graph.json` (2108 nodes / 3502 edges), `graph.html` (interactive viewer — open in a browser), and `GRAPH_REPORT.md` (Leiden-clustered communities, god nodes, import cycles, suggested questions). Every edge is tagged EXTRACTED (parsed from source, trust it) or INFERRED (model-guessed, verify before relying on it). **Gitignored — never commit; source + CLAUDE.md/CONTEXT.md stay the source of truth.**

## How to use it optimally (agents)

1. **Check freshness first.** The graph was built at commit `99c2c106`. Run `git rev-parse HEAD`; if it differs, either refresh (`graphify ./ --update` — AST-only, free) or treat the graph as approximate.
2. **Orient before grep.** For structural questions, read `GRAPH_REPORT.md`'s community list and god nodes before crawling files — it's the cheapest map of what touches what.
3. **Query, don't read.** Focused questions go through the CLI instead of loading files into context:
   - `graphify query "what connects the stripe webhook to cert state?"` (BFS, broad; `--dfs` to trace one chain; `--budget 1500` to cap output)
   - `graphify path "generateCertCode" "verify route"` — shortest dependency path
   - `graphify explain "createServiceSupabase"` — one node, all its edges
4. **Blast radius before refactors.** Before touching a god node (`createServerSupabase` 78 edges, `cn` 71, `createServiceSupabase` 70, `createServiceDb` 46), query its connections and list affected communities in the plan. This maps directly onto the PAUL "declared files only" rule — use the graph to prove the declaration is complete, including barrel-file re-exports that grep misses.
5. **Distrust INFERRED edges.** 49 exist (avg confidence 0.82). Verify against source before acting on one.
6. **Don't use it for:** data-flow questions (call edge ≠ data flow), dead-code verdicts (framework entry points look uncalled), or anything the 888 isolated nodes / known-incomplete coverage would answer — fall back to source.

## Setup worth doing (Guillermo, one-time, ~2 min)

- `pip install -U graphifyy` — 0.8.49 → 0.9.11 (adds `graphify install`, hooks, merge driver).
- `graphify install` — registers a `/graphify` skill with Claude Code so agents query the graph natively.
- `graphify hook install` — auto-refreshes the graph after each commit (AST-only, free). Kills the staleness problem permanently; worktree-friendly since it keys off the shared `.git`.
- Optional: `graphify . --cluster-only --exclude-hubs 99` to stop `cn()` noise from dominating rankings.

## Cadence

| When | Do |
|---|---|
| After any commit | automatic once the hook is installed (else `graphify ./ --update`) |
| After merging the integration branch | full rebuild: `graphify .` (communities shift after big merges) |
| Planning a PAUL phase | `graphify explain`/`path` on every symbol in the declared file set |
| Report feels wrong | `graphify . --cluster-only` re-clusters without re-extraction (free, seconds) |

*Note: upstream docs recommend committing `graphify-out/` for team sharing — deliberately not done here (solo dev, 6.8MB, locked decision in `GITHUB_SETUP.md`).*
