# Gemini CLI entry point

Canonical rules live in `AGENTS.md` and `rules/MASTER.md`. Read those first.

## Gemini-specific additions

- Gemini CLI auto-loads skill metadata at session start; activate skills
  via the `activate_skill` tool. The `graphifyy` and `impeccable` skills
  are multi-agent compatible — use them directly.
- For tool-name mappings vs Claude Code, see your local Gemini docs
  (`Bash` instead of `run_command`, `Edit` instead of `apply_patch`,
  etc.). The high-level workflow is identical.
- Configuration files specific to Gemini CLI live under `.gemini/`.

## Sub-agents

Use Gemini's sub-agent mechanism (or the equivalent shell-spawn pattern)
to dispatch isolated work. The dispatch packet contract in
`rules/subagents.md` is tool-agnostic — follow it verbatim.
