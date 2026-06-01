# Feature: ÉV9 — Real @sentropic chat-ui mounted in the demo layout

## Objective
Replace the simulated `RadarChatPanel` stub with a REAL chat: the
`@sentropic/chat-ui` `ChatWidget` mounted in the main `App.svelte` layout
(docked | floating, localStorage `chatWidgetDisplayMode`), backed by a real
Hono SSE endpoint that streams LLM tokens via `@sentropic/chat-core` +
`@sentropic/llm-mesh`, provider-agnostic and neutral.

## Scope / Guardrails
- Make-only workflow, `ENV=<env>` last argument.
- Branch development in `./tmp/ev9-chat` worktree.
- Automated tests on `ENV=test-ev9`.
- All new code/comments in English; French UI strings only.
- Legacy Svelte (`export let` / `$:`), type-only imports (verbatimModuleSyntax),
  ESM `.js` extensions, no em dash.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `api/src/routes/chat.ts`
  - `api/src/services/chat/**`
  - `api/src/app.ts`, `api/src/config.ts`, `api/src/index.ts`
  - `api/package.json`
  - `ui/src/App.svelte`
  - `ui/src/lib/components/RadarChatPanel.svelte` (repurpose)
  - `ui/src/lib/components/chat/**`
  - `ui/src/lib/chat/**`
  - `ui/package.json`, `ui/vite.config.ts`
  - `package-lock.json`
  - `.env.example`
  - `plan/EV9-BRANCH_feat-ev9-chat.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `rules/**`
  - `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`
  - `plan/NN-BRANCH_*.md` (other branches)
- **Conditional Paths (allowed only with explicit exception)**:
  - `docker-compose*.yml` (see BR-EV9-EX1)

## Feedback Loop
- **BR-EV9-EX1** (`attention`): forward LLM provider env vars
  (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `GOOGLE_API_KEY`,
  `MISTRAL_API_KEY`, `COHERE_API_KEY`) to the `api` service in
  `docker-compose.yml`. Reason: the chat endpoint reads provider keys from
  `process.env`; without forwarding, the real chat cannot reach any provider
  in `make dev`. Impact: additive env passthrough only (empty by default, no
  behaviour change when unset). Rollback: drop the env lines.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (single integration branch)
- Rationale: one cohesive integration (server + UI), no independent CI needed.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read `rules/MASTER.md`, `AGENTS.md`, `CLAUDE.md`.
  - [x] Study `../sentropic` chat integration (ChatWidget, StreamHub, llm-mesh wiring).
  - [x] Confirm worktree `./tmp/ev9-chat`, env `test-ev9`, scope + EX1.

- [x] **Lot 1 — Deps**
  - [x] Add `@sentropic/chat-core@0.1.2` + `@sentropic/llm-mesh@0.1.2` to api.
  - [x] `@sentropic/chat-ui@0.1.1` already in ui.
  - [x] `make install ENV=test-ev9`.

- [x] **Lot 2 — Server (real SSE streaming)**
  - [x] `mesh-runtime.ts`: llm-mesh wiring + real provider clients from env.
  - [x] `mesh-dispatch-adapter.ts`: implements chat-core `MeshDispatchPort`.
  - [x] `stream-bus.ts`: in-memory StreamHub bridge (chat-core sequencer).
  - [x] `chat.ts` route: `/providers`, `/messages` (POST), `/streams/sse` (SSE).
  - [x] Mount in `app.ts`; forward env keys (EX1).
  - [x] Lot gate: typecheck + lint + test (api 20/20).

- [x] **Lot 3 — UI (ChatWidget mounted)**
  - [x] `chatWidgetLayout` usage + docked/floating store, localStorage key.
  - [x] Repurpose `RadarChatPanel` into a real chat panel (StreamMessage + composer).
  - [x] Neutral in-chat provider selector from `/api/chat/providers`.
  - [x] Unconfigured state when no provider key set.
  - [x] Mount `ChatWidget` in `App.svelte` (docked by default).
  - [x] Lot gate: typecheck + lint + DS-lint (0) + test (ui 212/212).

- [x] **Lot 4 — Verify & close**
  - [x] Prove real streaming: curl shows real provider call (401 from
    api.openai.com with a fake key) + `/providers` reports "none configured"
    when no key is set.
  - [ ] Commit, push.
