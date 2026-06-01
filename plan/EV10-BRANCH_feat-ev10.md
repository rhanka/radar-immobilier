# Feature: ÉV10 — Real @sentropic/h2a signed decision journal

## Objective
Make the radar decisions (qualifier / surveiller / approcher) flow through a
REAL `@sentropic/h2a` server-side journal: each decision is recorded as a
signed (ed25519), hash-chained h2a journal entry carrying a PRINCIPAL/CONDUCTOR
role + the radar POLICY references + a timestamp. A "Coordination" UI view shows
the REAL signed journal (chain-verified) and replaces the retired ÉV5 stub.
Per `SPEC_EVOL_DEMO_RECADRAGE.md` §10 (S2.c) + §11.

## Scope / Guardrails
- Make-only workflow, `ENV=test-ev10` last argument.
- Branch development in `./tmp/ev10` worktree.
- Automated tests on `ENV=test-ev10`.
- All new code/comments in English; French UI strings only.
- Legacy Svelte (`export let` / `$:`), type-only imports (verbatimModuleSyntax),
  ESM `.js` extensions, no em dash.
- Anti-invention: real h2a state only; API unreachable -> explicit "h2a non
  connecté" gated state, never fabricated entries.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `api/src/routes/h2a.ts`
  - `api/src/services/h2a/**`
  - `api/src/app.ts`
  - `api/package.json`
  - `ui/src/lib/h2a/**`
  - `ui/src/lib/coordination/**` (delete: legacy ÉV5 stub superseded by ÉV10)
  - `ui/src/lib/components/coordination/**`
  - `ui/src/lib/demo/views.ts`
  - `ui/src/lib/components/TopNav.svelte`
  - `ui/src/App.svelte`
  - `package-lock.json`
  - `plan/EV10-BRANCH_feat-ev10.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `rules/**`
  - `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`
  - `plan/NN-BRANCH_*.md` (other branches)

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (single integration branch)
- Rationale: one cohesive integration (server h2a journal + UI surface).

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read `rules/MASTER.md`, `AGENTS.md`, `SPEC_EVOL_H2A_CHAT.md`, `SPEC_EVOL_DEMO_RECADRAGE.md` §10/§11.
  - [x] Investigate h2a substrate: `@sentropic/h2a` 0.26.1 (journal/signature/roles/policy exports) + live h2a MCP server.
  - [x] Confirm worktree `./tmp/ev10`, env `test-ev10`, scope.

- [x] **Lot 1 — Server (real signed h2a journal)**
  - [x] Add `@sentropic/h2a` to api.
  - [x] `keyring.ts`: per-process ed25519 PRINCIPAL + CONDUCTOR keys.
  - [x] `policy.ts`: radar POLICY as real `H2APolicy` artifacts.
  - [x] `journal-store.ts`: wraps `createJournalEntry`/`appendJournalEntry`/`signCanonical`/`verifyJournalChain`.
  - [x] `h2a.ts` route: `GET /api/h2a/journal`, `POST /api/h2a/decisions`.
  - [x] Mount in `app.ts`.
  - [x] Lot gate: typecheck + lint + test-api.

- [x] **Lot 2 — UI (Coordination view on the real journal)**
  - [x] `h2a-client.ts`: browser client for the h2a journal API.
  - [x] `CoordinationView.svelte`: real signed journal + roles + POLICY + chain-verified badge + "non connecté" gated state.
  - [x] Wire `coordination` nav view (views.ts + TopNav + App).
  - [x] Lot gate: typecheck + lint + test-ui + DS-lint (0) + build.

- [x] **Lot 3 — Verify & close**
  - [x] Real round-trip: POST a decision, GET the chain-verified journal.
  - [x] Commit (no Co-Authored-By trailer).
