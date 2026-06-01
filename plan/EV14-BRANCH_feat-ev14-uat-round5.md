# Feature: ÉV14 — UAT round 5 (bande latérale uniforme, Automatisation→Sources)

## Objective
Standardize the left control band across the 5 demo views via `ViewLayout`, move
the Automatisation view into Sources/Console as a tab, clarify Jobs vs
Automatisation, and reinforce the Opportunités dossier selection.

## Scope / Guardrails
- Scope limited to `ui/src` (views, nav, demo views union, tour steps).
- Make-only workflow, no direct Docker commands.
- Root workspace reserved for user dev/UAT (`ENV=dev`); branch work in `./tmp/ev14`.
- Tests run on `ENV=test-ev14`, `ENV` last argument.
- All new code/comments in English; French UI copy. No em dash `—`.
- Chat is OUT of scope.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `ui/src/lib/components/**`
  - `ui/src/lib/demo/views.ts`
  - `ui/src/lib/tour/tour-steps.ts`
  - `ui/src/App.svelte`
  - `docs/spec/SPEC_EVOL_UAT_ROUND5.md`
  - `plan/EV14-BRANCH_feat-ev14-uat-round5.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `rules/**`
  - `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`
  - `plan/NN-BRANCH_*.md` (except this branch file)
  - `ui/src/lib/components/chat/**`, `ui/src/lib/chat/**`, `api/src/routes/chat.ts`, `api/src/services/chat/**`

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (orthogonal UI work, single final test cycle)
- Rationale: single UI surface, no independent CI needed.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read `rules/MASTER.md`, `AGENTS.md`, `SPEC_EVOL_UAT_ROUND5.md`.
  - [x] Worktree `./tmp/ev14` on `feat/ev14-uat-round5`, env `test-ev14`.

- [x] **Lot 1 — Bande latérale uniforme (5 vues) + selection Opportunités**
  - [x] Onboarding: municipality selector in left band via ViewLayout.
  - [x] Opportunités: dossier list as left band, reinforced selection (fill + bar + check + label + aria-current).
  - [x] Signaux / Grilles: confirm standard `w-72` band.
  - [x] Lot gate.

- [x] **Lot 2 — Automatisation dans Sources + Jobs vs Automatisation**
  - [x] Console: tab selection as vertical left-band list; Automatisation as new tab.
  - [x] Remove Automatisation top-nav entry + route; update DemoView union + tour steps.
  - [x] Clarify Jobs (runs) vs Automatisation (cadences/connecteurs) in copy.
  - [x] Lot gate.

- [x] **Lot N — Merge & close**
  - [x] Push branch + PR.
</content>
