# Feature: Measured CP+ precision cascade

## Objective
- [ ] Replay GPT-6 Astra medium on the frozen corpus and measure Muse Spark 1.3 xhigh as the CP precision reviewer.

## Scope / Guardrails
- [x] Work in the owner-designated worktree and branch `docs/benchmark-b-cp-plus`.
- [x] No environment-file reads, secrets in output, Python, Gemini, AGY, merges, publication, or commit/PR trailers.
- [x] Make-only commands. Node runs in containers. Model cwd is empty and outside the repository.
- [x] Concurrency at most four. Muse weekly stop at 85%; quota failures never count as model refusals.

## Branch Scope Boundaries (MANDATORY)
- [x] Allowed Paths: `tools/bench-v11/**`, `docs/reports/benchmark-v12-2026-11-13.*`, `docs/reports/assets/2026-11/benchmark-v12-*`, this plan.
- [x] Forbidden Paths: `Makefile`, `docker-compose*.yml`, `rules/**`, agent entry points, other plans, historical reports.
- [x] Conditional Paths: owner-authorized local Focus dossier at `tmp/conductor/bench-v12-focus/`; no publication.
- [x] Preserve the 42 published global-table rows byte for byte.

## Feedback Loop
- [x] BRCP-EX1: owner explicitly designates the existing `.claude/worktrees/` worktree. No relocation. No UAT stack.
- [x] BRCP-EX2: owner requests French report additions and no trailers. These override repository language/footer defaults.

## Orchestration Mode (AI-selected)
- [x] Single branch. Sequential extraction then precision filtering. No application change.

## UAT Management (in orchestration context)
- [x] No UAT deployment. Static dossier generation and local Focus build only.

## Plan / Todo (lot-based)
- [x] Lot 0 — Baseline and constraints: read protocol, confirm branch, rebase onto origin/main, verify all 100 frozen prompts.
- [ ] Lot 1 — Capture real Astra replay, quotas, v9 validation, strict oracle-676 score.
  - [x] Freeze replay transport to llm-mesh 0.19.3; record prompt hashes, real usage and Codex quota.
- [ ] Lot 2 — Capture real Muse precision decisions, quotas, access surface, strict score and costs.
- [ ] Lot 3 — Regenerate v12 dossier and SHA256SUMS; preserve published rows; update Focus and D1.
- [ ] Lot 4 — Verify artifacts, commit selectively, push, open PR to main. Never merge.
