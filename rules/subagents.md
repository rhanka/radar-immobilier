---
description: "Sub-agent contract — how the conductor delegates work and how sub-agents report back"
paths: ["plan/**"]
tags: [subagents]
---

# Sub-agent contract

## Roles

- **Conductor**: the agent that owns `PLAN.md`, schedules branches, and dispatches sub-agents. Usually the long-lived primary agent in the session.
- **Sub-agent**: a short-lived specialized agent that executes a bounded task (a single lot, a research dive, a test campaign).

## Dispatch packet (conductor → sub-agent)

The conductor prepares a self-contained brief that includes:

1. **Goal**: one sentence stating the outcome expected.
2. **Branch**: name + worktree path.
3. **Lot**: which checkbox(es) to close.
4. **Allowed paths**: copy from `BRANCH.md`.
5. **Forbidden paths**: copy from `BRANCH.md`.
6. **Env mapping**: `ENV=<slug>`, `API_PORT`, `UI_PORT`, `MAILDEV_UI_PORT`.
7. **Reporting format**: bulleted result summary + diff stats + any blocker.
8. **Exit criteria**: which `make` targets must pass; which files must be present.

The sub-agent is responsible for *its own context*: reading `rules/MASTER.md`, the branch file, and any referenced spec.

## Report packet (sub-agent → conductor)

A sub-agent's final message contains:

- **Status**: `done` / `blocked` / `partial`.
- **Lots closed**: list of checkbox paths.
- **Files changed**: paths + line counts.
- **Test results**: which `make` targets ran, pass/fail.
- **Open questions**: anything the conductor must decide.
- **Blockers**: external dependencies, missing creds, unclear spec.

## Neutral terminology

- Sub-agents may be any LLM-based tool. Do not assume Claude / Codex / Gemini specifics in the dispatch packet. Tooling glue lives in `CLAUDE.md` / `AGENTS.md` / `GEMINI.md`, not in the work brief.

## Parallel dispatch

- The conductor MAY dispatch multiple sub-agents in parallel ONLY when their work is on disjoint paths or different worktrees.
- The conductor MUST verify scope boundaries via the `scope-check` skill before allowing concurrent writes.

## Failure handling

- On `blocked`: the conductor either resolves the blocker (clarification, missing dep) and re-dispatches, or marks the lot `attention` and surfaces it to the user.
- On `partial`: the conductor reviews what was done, decides whether to continue, replan, or rollback.
- On `done` with broken tests: NEVER mark the lot complete; treat as `partial`.
