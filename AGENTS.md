# AI Assistant Bootstrap — `radar-immobilier`

This file is the **canonical entry point** for any AI coding agent
(Claude Code, Codex CLI, Gemini CLI, Aider, OpenCode, Copilot CLI, Kimi
Code, …). Tooling-specific entry points (`CLAUDE.md`, `GEMINI.md`) point
back here.

Read `rules/MASTER.md` before any action. It contains the consolidated
project rules.

## Mandatory read order

1. `rules/MASTER.md` — consolidated rules (always).
2. `rules/workflow.md` — branching, commits, PR, orchestration (when
   working on branches / plans).
3. `rules/subagents.md` — sub-agent contract (when launching sub-agents).
4. `rules/sources.md` — when working on a source adapter (`packages/radar-sources/**`).
5. `rules/scoring.md` — when working on scoring (`packages/radar-scoring/**`).
6. `rules/testing.md` — when authoring or running tests.
7. `rules/security.md` — when touching secrets, Dockerfiles, IAM.
8. Domain rules loaded conditionally by file path (see `rules/` directory).

## Project context

- **Mission**: build an automated municipal-document radar that detects
  residential densification opportunities (zonage, PPCMOI, dérogations,
  CPTAQ) in Québec municipalities. Pilot city:
  Salaberry-de-Valleyfield.
- **Phase 1 deliverable**: a polished demo serving as the basis for a
  client proposal and pricing. The more of the vision is real at demo
  time, the better the pricing leverage.
- **Inputs**: `docs/spec/input/{VISION,PROMPT,PROCESS}.md` — immutable
  client materials.
- **Specs**: `docs/spec/SPEC_INTENT_*` → `SPEC_EVOL_*` → `SPEC_*`
  (initial → evolving during dev → finalized).
- **Plan**: `PLAN.md` + `plan/NN-BRANCH_<slug>.md` per branch.

## Quick reference

- All commands via `make` targets only (no direct `npm` / `node` / `docker`).
- `ENV=<env>` always last argument in `make` commands.
- Branch work in `tmp/<slug>` worktrees, never on the root checkout.
- Tests on `ENV=test-*` or `ENV=e2e-*`, never `ENV=dev`.
- Atomic commits (~150 lines max between commits), selective staging.
- Merge commits only — no squash, no rebase merge.

## Discussion language

- Code, commits, PR titles, specs, rules: **English**.
- Conversations with the user: **French** (or English on request).

## Reusable ecosystem

- `@sentropic/llm-mesh` — multi-provider LLM access.
- `@sentropic/chat-core` + `@sentropic/chat-ui` — chat orchestration + UI.
- `@sentropic/contracts` + `@sentropic/events` — wire-level types.
- `@sentropic/design-system-svelte` + `-themes` + `-tokens` — design system.
- `graphifyy` — knowledge graph (relating documents, regulations, files, lots).
- `obscura` — Rust headless browser (anti-detect, sidecar).
- `impeccable` — design-skill anti-pattern detection for AI coding agents.
- `superpowers` (Claude Code plugin) — meta-skills: brainstorming,
  writing-plans, executing-plans, TDD, verification.

Refer to `docs/spec/SPEC_EVOL_SCAFFOLDING.md` §6 for the full stack and
exact version pins.
