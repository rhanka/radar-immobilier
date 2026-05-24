# Claude Code entry point

Canonical rules live in `AGENTS.md` and `rules/MASTER.md`. Read those first.

## Claude-specific additions

- Custom skills live in `.claude/skills/`. The most useful for this repo:
  - `branch-init` — initialize a worktree + plan file from `BRANCH_TEMPLATE.md`.
  - `branch-close` — finalize a branch (move plan to `plan/done/`, update `PLAN.md`).
  - `scope-check` — verify a diff stays within the branch's Allowed/Forbidden paths.
  - `lot-gate` — run the canonical lot-gate checklist (`typecheck`, `lint`, `test`).
  - `source-spike` — bootstrap a new source spike in `packages/radar-sources/src/sources/_spikes/`.
  - `ingest-test` — quick test of a source adapter against fixture data.
- Plugin marketplace skills available: `superpowers` (`brainstorming`,
  `writing-plans`, `executing-plans`, `test-driven-development`,
  `verification-before-completion`, …).

When in doubt about a skill, list `.claude/skills/` and read the
`SKILL.md` inside the matching directory.

## Sub-agents

Use `Agent` tool with the most specific subagent_type available
(`Explore`, `Plan`, `general-purpose`, `claude-code-guide`). Pass a
self-contained brief per `rules/subagents.md`.
