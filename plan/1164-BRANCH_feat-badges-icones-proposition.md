# Proposal: Compact icon + tooltip signal annotation badges

## Objective
Propose three visual variants for compact signal annotation badges (icon + tooltip on hover and keyboard focus) using only Sentropic design system components (`Badge`, `Tag`, `Tooltip`) and existing `@lucide/svelte` icons, without changing any existing business behavior.

## Scope / Guardrails
- Design proposal only (no merge requested, no production deployment, no business behavior change).
- Zero new dependencies; Sentropic DS components and existing Lucide icons only.
- Isolated repository-local worktree `./tmp/feat-badges-icones-proposition` from fresh `origin/main`.
- All new text in English in branch plan/code; French in user-facing labels and report.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `ui/src/lib/signals/annotation-badge-model.ts`
  - `ui/src/lib/signals/annotation-badge-model.test.ts`
  - `ui/src/lib/components/maps/SignalAnnotationBadgesDemo.svelte`
  - `ui/e2e-qa/harness/BadgesProposalHarness.svelte`
  - `ui/e2e-qa/harness/badges-proposal-main.ts`
  - `ui/e2e-qa/harness/badges-proposal.html`
  - `ui/vite.config.ts`
  - `plan/1164-BRANCH_feat-badges-icones-proposition.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `rules/**`
  - `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`
  - `plan/NN-BRANCH_*.md` (except this branch file)
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `api/drizzle/*.sql`
  - `.github/workflows/**`

## Feedback Loop
- Owner prompt (2026-11-21): "Badge ia - raccourcir. Détail modèle au hover stp. Privilégier badge icône + hover, propose stp."

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (self-contained UI design proposal + demo harness)
- [ ] **Multi-branch**
- Rationale: Isolated UI demo harness and pure badge model with zero impact on production code paths.

## UAT Management (in orchestration context)
- Visual review via Chrome 9222 screenshots in scratchpad and local harness page.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Fetch fresh `origin/main` (`git fetch --prune --tags origin`) and create isolated worktree `./tmp/feat-badges-icones-proposition`.
  - [x] Audit current annotation labels, Sentropic DS components, and Lucide icons.

- [x] **Lot 1 — Badge model, Svelte demo component & QA harness**
  - [x] Implement pure badge descriptor model (`ui/src/lib/signals/annotation-badge-model.ts`) covering all 10 states across variants A, B, and C.
  - [x] Add unit tests (`ui/src/lib/signals/annotation-badge-model.test.ts`).
  - [x] Build Sentropic DS badge component and demo harness page (`BadgesProposalHarness.svelte`, `badges-proposal.html`, `badges-proposal-main.ts`, `ui/vite.config.ts`).

- [x] **Lot 2 — Captures, draft PR & report**
  - [x] Serve demo harness locally and capture PNG screenshots (variants A, B, C in light & dark with open tooltip).
  - [x] Inspect captured PNGs and verify legibility, contrast, and tooltip positioning.
  - [x] Write comparison report and push branch `feat/badges-icones-proposition`.
