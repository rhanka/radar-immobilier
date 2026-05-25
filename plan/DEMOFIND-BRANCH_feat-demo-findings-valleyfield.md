# Feature: Demo findings — multi-agent PROMPT run on Valleyfield

## Objective
Run the analyst `docs/spec/input/PROMPT.md` on Salaberry-de-Valleyfield with FOUR
agent tracks, compare their outputs (differences + findings), and wire the real
findings into the **demo UI** (the original "Radar demo", not the source-value
review screen) to already illustrate results.

## Intention (user request, 2026-05-25)
- Execute the PROMPT with 4 tracks:
  1. **Claude Opus 4.7** — via `claude` CLI (done, `tmp/analyst-run-valleyfield/opus.md`).
  2. **Codex GPT-5.5 xhigh** — via `codex` CLI, auto-relaunched at 10:50 on credit
     reset (`tmp/analyst-run-valleyfield/gpt.md`).
  3. **GPT-5.5 (ChatGPT)** — additional track: scrape the user's shared conversation
     and transcribe it to `docs/spec/input/PROMPT_RESULT_GPT5.5.md` (done via
     Playwright MCP).
  4. **Gemini 3.5 high** — via `agy` (Antigravity) CLI, driven by a tmux steering
     loop because agy is agentic and drifts (`tmp/analyst-run-valleyfield/gemini.md`).
- Produce a comparison of the 4 outputs (coverage, sources, accuracy, divergences).
- Wire the findings into the demo UI to illustrate results now.

## Scope / Guardrails
- Make-only workflow, no direct Docker/npm/node commands.
- Root workspace reserved for user dev/UAT (`ENV=dev`, fixed ports); this branch
  develops in `./tmp/feat-demo-findings-valleyfield`.
- UAT presented on the root checkout fixed ports (stable URL `http://localhost:5301`),
  never a per-branch UAT port (per `rules/MASTER.md` UAT Environment).
- Automated tests on `ENV=test-demo-findings`, never `dev`.
- `ENV=<env>` last in every `make` command.
- New Markdown/spec/code in English; UI display text in French.
- No fabricated lot/parcel data: findings must trace to a real analyst track output
  with its source.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths**:
  - `plan/DEMOFIND-BRANCH_feat-demo-findings-valleyfield.md`
  - `PLAN.md`
  - `docs/spec/input/PROMPT_RESULT_GPT5.5.md` (scraped GPT-5.5 result)
  - `docs/spec/SPEC_EVOL_DEMO_FINDINGS.md` (comparison + wiring design)
  - `ui/src/**` (demo UI wiring)
  - `.agents/lanes`
- **Forbidden Paths**:
  - `Makefile`, `docker-compose*.yml`, `rules/**`
  - `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`
  - `plan/NN-BRANCH_*.md` (other branches), `plan/done/**`
  - `api/**`, `packages/**`
  - source-value-review components (BR-05R owns those)
- **Conditional Paths**:
  - `docs/spec/input/PROMPT.md` is immutable (read-only); only the RESULT file is added.
- **Exception process**: declare `BRxx-EXn` in `## Feedback Loop`.

## Feedback Loop
- `DEMOFIND-EX1` (acknowledge): writing a model RESULT under `docs/spec/input/`
  (normally immutable client inputs) is explicitly user-requested for the
  multi-agent comparison. Rollback: move/remove the RESULT file.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch** (conductor + opus lane); external CLI agents produce
  analyst artifacts consumed here.
- Rationale: one reviewable demo surface; the 4 analyst runs are inputs.

## UAT Management
- UAT on root fixed ports `http://localhost:5301` once the demo UI shows findings.

## Plan / Todo (lot-based)
- [ ] **Lot 0 — Baseline & branch**
  - [x] Create worktree `./tmp/feat-demo-findings-valleyfield`.
  - [x] Record the 4-track intention (this file).

- [ ] **Lot 1 — Four-track analyst execution**
  - [x] Track 1 Claude Opus — `opus.md` produced.
  - [x] Track 3 GPT-5.5 (ChatGPT) — scraped to `PROMPT_RESULT_GPT5.5.md`.
  - [ ] Track 2 Codex GPT-5.5 xhigh — auto-relaunch 10:50 → `gpt.md`.
  - [ ] Track 4 Gemini 3.5 via agy + tmux driver → `gemini.md`.

- [ ] **Lot 2 — Comparison of the 4 outputs**
  - [ ] `docs/spec/SPEC_EVOL_DEMO_FINDINGS.md`: differences + consolidated findings
    (coverage, sources, accuracy, divergences; e.g. Opus = plan d'urbanisme 450 /
    stratégie habitation vs GPT-5.5 = zoning amendments 150-49..51 zone-level).
  - [ ] Pick the consolidated finding set to surface in the demo.

- [ ] **Lot 3 — Wire findings into the demo UI**
  - [ ] Surface the consolidated Valleyfield findings in the original "Radar demo"
    screen (opportunities/signals with source links), in French.
  - [ ] Lot gate: `make typecheck`, `make lint`, `make build`, `make test-ui ENV=test-demo-findings`.

- [ ] **Lot 4 — UAT, PR & close**
  - [ ] UAT on root fixed ports `http://localhost:5301`.
  - [ ] Push; open PR; CI green (full 40-char SHA).
  - [ ] Merge commit only; preserve branch.
  - [ ] Move this file to `plan/done/`.
</content>
