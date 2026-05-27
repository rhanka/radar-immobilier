# Feature: ÉV5 h2a coordination + chat (decoupled V1)

## Objective
A "Coordination" demo view making the human↔agent model tangible: role label (PRINCIPAL=human),
a POLICY summary, and an in-memory append-only decision journal fed by a stub chat. Decoupled
interface mirroring `@sentropic/h2a` concepts — no external dep, no crypto (socle §11).

## Scope / Guardrails
- UI-only (+ a pure coordination lib in ui/lib). NO `@sentropic/h2a`/`@sentropic/flow` dependency added
  (spike concluded Node-oriented/crypto-deferred — escalation logged). No domain/scoring change expected.
- Make-only, `ENV=test-h2a-spike-chat` last; root `dev` stable; worktree `tmp/h2a-spike-chat`.
- English code; French UI. No Co-Authored-By trailer. Type-only imports (verbatimModuleSyntax).

## Branch Scope Boundaries
- **Allowed**: `docs/spec/SPEC_EVOL_H2A_CHAT.md`, `docs/spec/UAT_EV2_EV7_ESCALATIONS.md`,
  `ui/src/lib/coordination/**`, `ui/src/lib/components/coordination/**`, `ui/src/lib/demo/views.ts`,
  `ui/src/lib/components/NavMenu.svelte`, `ui/src/App.svelte`, `docs/superpowers/plans/**`, `plan/EV5-BRANCH_*`.
- **Forbidden**: `Makefile`, `docker-compose*.yml`, `rules/**`, `CLAUDE.md`/`AGENTS.md`/`GEMINI.md`,
  other `plan/*BRANCH*`, `api/**`, `ui/package.json` (do NOT add the h2a/flow dep this branch).
- **Conditional**: `packages/**` only if a missing field is found (log `EV5-EXn`).

## Orchestration Mode
- [x] Mono-branch.

## Plan / Todo (lot-based)
- [x] **Lot 0 — spike** (DONE): @sentropic/h2a 0.8.0 + @sentropic/flow 0.1.1 exist but Node-oriented/crypto → V1 decoupled stub (escalations SPIKE/D13/D14). Env `test-h2a-spike-chat` (ports 8817/5317/1117); `make install ENV=test-h2a-spike-chat`.
- [ ] **Lot 1 — coordination interface**: `ui/src/lib/coordination/coordination.ts` (+ test) — `Role` + French labels, `Policy` + default `radarPolicy`, `JournalEntry`, `createJournal()` (in-memory append-only, corrections = new entry), `appendDecision`, `summarizePolicy`. Tests: append-only (length grows, no mutation of prior), PRINCIPAL role label, policy has the key rules. Gate.
- [ ] **Lot 2 — CoordinationView.svelte**: role-label header (+ "l'IA n'est jamais PRINCIPAL"), POLICY panel, journal panel (append-only log), stub chat composer (human instruction → PRINCIPAL journal entry + canned CONDUCTOR "réponse simulée" turn, no LLM). Reuse @sentropic/chat-ui ChatPanel if clean else simple panel. Component/data test. Gate (typecheck/lint/test-ui/build).
- [ ] **Lot 3 — wire**: add `"coordination"` to `DemoView`; NavMenu item (icon e.g. MessagesSquare/Workflow); App.svelte branch. Gate + UAT note.
- [ ] **Lot 4 — docs + close**: update spec/escalations; `PLAN.md` ÉV5 status; PR + CI (full SHA) + merge-commit + archive plan to `plan/done/`.
