# Feature: Demo — 3 navigable views

## Objective
Make the three deliverables navigable in one app behind a nav menu:
1. **Radar (démo)** — verified Valleyfield findings (best-of the 4 agents) on the dashboard.
2. **Comparaison des agents** — the 4-track PROMPT benchmark (scores, ranking, verdict, fabrication audit).
3. **Revue des sources** — the BR-05R source-value review screen.

## Scope / Guardrails
- Make-only; UAT on root fixed ports (`http://localhost:5301`, `ENV=dev`).
- Develops in `./tmp/feat-demo-3-views`; tests on `ENV=test-demo-3views` / safe static checks.
- French UI text; English code/specs.
- No fabricated data: the comparison view shows the independently-scored results;
  the radar view shows only verified findings (fabricated G2 items excluded).

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths**: `ui/src/**`, `PLAN.md`, `plan/3VIEWS-BRANCH_feat-demo-3-views.md`.
- **Forbidden**: `Makefile`, `docker-compose*.yml`, `rules/**`, `CLAUDE.md`/`AGENTS.md`/`GEMINI.md`,
  `api/**`, `packages/**`, other `plan/*`.
- Merged `feat/source-value-review-ui` into this branch to obtain the source-review
  screen (App.svelte conflict resolved into the 3-view switcher).

## Orchestration Mode
- [x] Mono-branch.

## Plan / Todo
- [x] **Lot 1 — Merge source-review + nav scaffold**
  - [x] Merge `feat/source-value-review-ui` (brings source-review components/data).
  - [x] `NavMenu.svelte` (3 links) + `lib/demo/views.ts` (DemoView type).
  - [x] Rewire `App.svelte` to a 3-view switcher (radar / comparison / source-review).
- [x] **Lot 2 — Comparison view**
  - [x] `lib/demo/benchmark-data.ts` (M1-M7 scores, ranking, verdict, method — from
    the independent scoring; A2 34 > C2 31 > H1 30 > G2 14).
  - [x] `components/comparison/BenchmarkComparison.svelte` (ranking cards + score
    matrix + verdict + anti-cheating method).
  - [x] Lot gate: typecheck (0 err), lint, test-ui (16/16), build (ok) `ENV=dev`.
- [ ] **Lot 3 — UAT + PR + close**
  - [x] UAT: 3 views navigate on `http://localhost:5301` (verified via Playwright:
    nav menu + radar / comparison matrix / source-review all render).
  - [ ] Push; PR; CI green; merge commit; archive this file. [awaiting go-ahead]
