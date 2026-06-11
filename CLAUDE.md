# Claude Code entry point

Canonical rules live in `AGENTS.md` and `rules/MASTER.md`. Read those first.

## Claude-specific additions

- **`@sentropic/harness` is the SINGLE front door** for code-work + PR-workflow
  and SUPERSEDES superpowers. Load `harness/using-harness` first, then use the
  `harness <verb>` CLI + `harness/*` skills (installed in `.claude/skills/harness-*`):
  - `harness brainstorm` — ideation/spec (NOT superpowers:brainstorming).
  - `harness test [--category unit|integration|e2e] [--watch]` — test-first
    discipline (NOT "tdd ritual", NOT superpowers:test-driven-development).
  - `harness verify --category static|unit|integration|e2e|ci|uat` ·
    `harness check scope|branch` — the gate (NOT superpowers:verification…).
  - `harness debug`, `harness review [--consensus]`, `harness plan [--lots]`,
    `harness branch init|close <slug>`, `harness adopt`.
  - Make-only ENV (ENV is the LAST make arg) + **always `down -v` after a stack**.
- Other repo-local skills in `.claude/skills/`: `source-spike` (bootstrap a source
  spike), `ingest-test` (test a source adapter against fixture data). The older
  `branch-init`/`lot-gate`/`scope-check` are superseded by the `harness` equivalents.
- `superpowers` plugin is present but SUPERSEDED by harness for the acts above.

When in doubt about a skill, list `.claude/skills/` and read the
`SKILL.md` inside the matching directory.

## Sub-agents

Use `Agent` tool with the most specific subagent_type available
(`Explore`, `Plan`, `general-purpose`, `claude-code-guide`). Pass a
self-contained brief per `rules/subagents.md`.
