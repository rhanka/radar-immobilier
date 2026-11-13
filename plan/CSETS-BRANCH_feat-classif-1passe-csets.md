# Feature: Single-pass prompt on the C study sets

## Objective
- [ ] Measure PR #1099 unchanged on tuning and blind C reference units, Astra low.

## Scope / Guardrails
- [x] Dedicated worktree and branch `feat/classif-1passe-csets` confirmed.
- [x] No environment files, Python, production writes, merges or commit trailers.
- [x] Standalone Make entry point; native orchestration follows BRCLASSIF-EX1.
- [x] Private artifacts only in `~/.local/share/radar-classif/1passe-csets`.
- [x] Source C files and refresh-single-pass code are read-only.
- [x] No stack, ports or UAT; environment `test-csets`.

## Branch Scope Boundaries (MANDATORY)
- [x] Allowed Paths: `tools/classif/csets/**`, `tools/classif/csets.mk`, `docs/spec/reports/classif-csets/**`, this plan.
- [x] Forbidden Paths: `Makefile`, `docker-compose*.yml`, `rules/**`, `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, other branch plans, other lanes and their private outputs.
- [x] Conditional Paths: none.

## Feedback Loop
- [ ] Blind execution awaits the conductor's key-injection mechanism; no plaintext-label bypass.

## Orchestration Mode (AI-selected)
- [x] Mono-branch, no integration or merge.

## UAT Management (in orchestration context)
- [x] Offline experiment only; no application behavior changes.

## Plan / Todo (lot-based)
- [x] Lot 0: identify series 7, reference D used by C, immutable prompt and production composition.
- [ ] Lot 1: freeze protocol, capture prompts, execute tuning modes with quota guard.
- [ ] Lot 2: execute blind modes through sealed executor; publish aggregates only.
- [ ] Lot 3: verify metrics, publish report, push and open draft PR.
