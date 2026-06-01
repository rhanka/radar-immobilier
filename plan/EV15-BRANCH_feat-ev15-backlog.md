# Feature: ÉV15 — Vue Backlog (à faire / en cours / réalisé) pilotée par le chat

## Objective
Add a Backlog view (3-column board: À faire / En cours / Réalisé) seeded from the
real evolution track (`SPEC_EVOL_*` + `PLAN.md` + merged Git history), backed by an
in-memory backlog API (add/process), with an "Ajouter une demande" affordance. The
chat-tool wiring (`ajouter_demande` / `traiter_demande`) is investigated and, where
not feasible in one pass, delivered as a documented follow-up.

## Scope / Guardrails
- Scope: new Backlog view + nav/route wiring + backlog API route + clients/seed.
- Make-only workflow, no direct Docker commands.
- Root workspace reserved for user dev/UAT (`ENV=dev`); branch work in `./tmp/ev15`.
- Tests run on `ENV=test-ev15`, `ENV` last argument.
- All new code/comments in English; French UI copy. No em dash `—`.
- Chat service changed ONLY if tool-calling is feasible in one pass (it is not).

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `ui/src/lib/components/backlog/**`
  - `ui/src/lib/backlog/**`
  - `ui/src/lib/components/TopNav.svelte`
  - `ui/src/lib/demo/views.ts`
  - `ui/src/App.svelte`
  - `api/src/routes/backlog.ts`, `api/src/routes/backlog.test.ts`
  - `api/src/app.ts`
  - `plan/EV15-BRANCH_feat-ev15-backlog.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `rules/**`
  - `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`
  - `plan/NN-BRANCH_*.md` (except this branch file)
  - `ui/src/lib/components/chat/**`, `ui/src/lib/chat/**`, `api/src/routes/chat.ts`, `api/src/services/chat/**`

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (single UI + API surface, single final test cycle)
- Rationale: cohesive feature, no independent CI needed.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read `rules/MASTER.md`, `AGENTS.md`, `SPEC_EVOL_UAT_ROUND5.md` §3.
  - [x] Worktree `./tmp/ev15` on `feat/ev15-backlog`, env `test-ev15`.

- [x] **Lot 1 — Backlog data + API**
  - [x] Seed `ui/src/lib/backlog/backlog-data.ts` from real evolutions + PRs.
  - [x] Hono route `api/src/routes/backlog.ts` (in-memory) + mount in `app.ts`.
  - [x] Unit tests: backlog API route + backlog-data seed.

- [x] **Lot 2 — Backlog view + nav wiring**
  - [x] `BacklogView.svelte` (3 columns, w-72 left band, accordion cards, PR links).
  - [x] Add to TopNav, DemoView union, App route.
  - [x] "Ajouter une demande" affordance (POST /api/backlog/items).

- [x] **Lot 3 — Chat ↔ Backlog feasibility**
  - [x] Investigate llm-mesh tool-call contract + radar mesh-runtime.
  - [x] Verdict: NOT feasible in one pass (no `tools` payload, no tool_call parsing,
        chat-ui packaged). Documented follow-up + UI fallback shipped.

- [x] **Lot N — Verify & close**
  - [x] typecheck / lint / test-ui / build / test-api on `ENV=test-ev15`.
  - [x] DS-lint on touched `.svelte`.
  - [x] Prove backlog API via curl, then tear down.
