# Feature: ÉV3 Opportunités T2 — funnel + honest scoring + global réel/sim + signal→N

## Objective
Rework the "Opportunité" demo view into a T2 funnel: 6-phase progression from `evidence[]`,
`aggregate(d.axes, WEIGHTS)` honest score (partial/cap/ScoreHover), global réel/sim toggle,
and signal→N linking (Approfondir filters by `signalId`). Supersedes legacy `scoreGlobal`.

## Scope / Guardrails
- UI-focused (+ a tiny state store + pure helpers). No `@radar/domain`/`@radar/scoring` change expected (log if needed).
- Make-only, `ENV=test-opportunites-t2-funnel` last; root `dev` stable; worktree `tmp/opportunites-t2-funnel`.
- English code; French UI. No Co-Authored-By trailer. Type-only imports (verbatimModuleSyntax).

## Branch Scope Boundaries
- **Allowed**: `docs/spec/SPEC_EVOL_OPPORTUNITES_T2.md`, `docs/spec/UAT_EV2_EV7_ESCALATIONS.md`,
  `ui/src/lib/state/**`, `ui/src/lib/opportunites/**`, `ui/src/lib/components/opportunity/**`,
  `ui/src/lib/components/NavMenu.svelte`, `ui/src/lib/components/TopBar.svelte`, `ui/src/App.svelte`,
  `docs/superpowers/plans/**`, `plan/EV3-BRANCH_*`.
- **Forbidden**: `Makefile`, `docker-compose*.yml`, `rules/**`, `CLAUDE.md`/`AGENTS.md`/`GEMINI.md`,
  other `plan/*BRANCH*`, `api/**`.
- **Conditional**: `packages/**` only if a missing field is found (log `EV3-EXn`).

## Orchestration Mode
- [x] Mono-branch.

## Plan / Todo (lot-based)
- [ ] **Lot 0 — baseline**: worktree + env `test-opportunites-t2-funnel` (ports 8815/5315/1115); `make install ENV=test-opportunites-t2-funnel`.
- [ ] **Lot 1 — global mode store + pure helpers**: `ui/src/lib/state/mode.ts` (`appMode` store real|simulation, default real) + `ui/src/lib/opportunites/funnel.ts` (groupEvidenceByPhase ordered, deriveTimeline, filterDossiersBySignalId, applyMode via filterRealMode) + tests. Gate.
- [ ] **Lot 2 — rework OpportunityFunnel.svelte**: render 6 phases from evidence[] + provenance badges; `aggregate(d.axes, WEIGHTS)` score/partial/cap + reuse `ScoreHover`; drop raw legacy scoreGlobal (keep recommendation text); compact timeline; accept `selectedSignalId` filter. Component/data test (asserts 3.18/3.35/2.59 + cap + no raw scoreGlobal). Gate (typecheck/lint/test-ui/build).
- [ ] **Lot 3 — wire global toggle + Approfondir signalId**: mount réel/sim switch (TopBar/NavMenu) bound to the store; Signaux applies it; App.svelte carries `selectedSignalId` from Approfondir → Opportunités filter + reset. Gate + UAT note.
- [ ] **Lot 4 — docs + close**: update spec/escalations; `PLAN.md` ÉV3 status; PR + CI (full SHA) + merge-commit + archive plan to `plan/done/`.
