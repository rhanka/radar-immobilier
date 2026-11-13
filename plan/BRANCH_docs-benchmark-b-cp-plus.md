# Feature: Measured CP+ precision cascade

## Objective
- [x] Replay GPT-6 Astra medium on the frozen corpus and measure Muse Spark 1.3 xhigh as the CP precision reviewer.

## Scope / Guardrails
- [x] Work in the owner-designated worktree and branch `docs/benchmark-b-cp-plus`.
- [x] No environment-file reads, secrets in output, Python, Gemini, AGY, merges, publication, or commit/PR trailers.
- [x] Make-only commands. Node runs in containers. Model cwd is empty and outside the repository.
- [x] Concurrency at most four. Initial Muse stop at 85%; owner authorized resumption without threshold. No further model calls in finalization.

## Branch Scope Boundaries (MANDATORY)
- [x] Allowed Paths: `tools/bench-v11/**`, `docs/reports/benchmark-v12-2026-11-13.*`, `docs/reports/assets/2026-11/benchmark-v12-*`, this plan.
- [x] Forbidden Paths: `Makefile`, `docker-compose*.yml`, `rules/**`, agent entry points, other plans, historical reports.
- [x] Conditional Paths: none. Owner forbids edits to `tmp/conductor/bench-v12-focus/` and any new decision.
- [x] Preserve the 42 published global-table rows byte for byte.

## Feedback Loop
- [x] BRCP-EX1: owner explicitly designates the existing `.claude/worktrees/` worktree. No relocation. No UAT stack.
- [x] BRCP-EX2: owner requests French report additions and no trailers. These override repository language/footer defaults.
- [x] Incident: overlapping replay runners could not attest the global concurrency bound. Archive excluded; restart all 100 documents under one global lock and reject overlap in scoring.
- [x] Finalization: meta.jsonl verifies 100 unique valid reviews; restart counts 64 and 78; three quota-interrupted attempts have no attributable usage. No new model calls or peer review requested, per owner prohibition.
- [x] BRCP-EX3: generated score JSON is committed intact despite the 150-line guideline (2,194 generated lines, two files). It preserves per-document evidence. No application impact; rollback removes these score files and regenerates the dossier.

## Orchestration Mode (AI-selected)
- [x] Single branch. Sequential extraction then precision filtering. No application change.

## UAT Management (in orchestration context)
- [x] No UAT deployment. Static dossier generation only. Focus untouched; no decision added.

## Plan / Todo (lot-based)
- [x] Lot 0 — Baseline and constraints: read protocol, confirm branch, rebase onto origin/main, verify all 100 frozen prompts.
- [x] Lot 1 — Capture real Astra replay, quotas, v9 validation, strict oracle-676 score.
  - [x] Freeze replay transport to llm-mesh 0.19.3; record prompt hashes, real usage and Codex quota.
  - [x] Require exactly 676 expected units in both strict scores.
- [x] Lot 2 — Capture real Muse precision decisions, quotas, access surface, strict score and costs.
  - [x] Verify 99 archived CP messages byte for byte; retain the frozen filter; prepare strict scoring and surface audit.
  - [x] Preserve every reviewer attempt and audit all captured streams; prepare separate replay and CP+ chart markers.
- [x] Lot 3 — Regenerate v12 dossier and SHA256SUMS; preserve published rows. No Focus or D1 update, per owner finalization instructions.
  - [x] Verify regeneration preserves all 42 published rows byte for byte; correct hypothesis A in prose, best-arms table and chart legend.
- [x] Lot 4 — Verify artifacts, commit selectively, push, open PR #1085 to main. Rebase confirms origin/main is already the base. No merge.
- [x] Lot 5 — Reproduce CI lint failures; declare script globals, simplify the PDF callback, and verify refreshed SHA256SUMS without model calls.
