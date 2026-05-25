# Feature: UI skeleton - Svelte 5 + Sentropic design system

## Objective
Stand up the first usable demo surface for `radar-immobilier`: a Svelte 5 + Vite SPA that presents a municipal radar workspace with signals, opportunity preview, API health, a map-oriented panel, and a chat shell wired through the Sentropic UI ecosystem.

## Scope / Guardrails
- Scope limited to `ui/**`, the GitHub Pages deployment workflow, and minimal root workspace/gate wiring required for UI build/test.
- UI implementation chooses pure Svelte 5 + Vite SPA for BR-03, not SvelteKit. This keeps GitHub Pages static deployment simple and avoids route framework work before the product surface exists.
- No API route or database changes in this branch.
- No production source adapters or scoring changes in this branch.
- Root workspace `~/src/radar-immobilier` is reserved for user dev/UAT (`ENV=dev`) and must remain stable.
- Branch development happens in repository-local worktree `./tmp/feat-ui-skeleton-svelte-ds`, never in system `/tmp` and never on the root checkout.
- Automated test campaigns run on dedicated environments (`ENV=test-feat-ui-skeleton` / `ENV=e2e-feat-ui-skeleton`), never on root `dev`.
- UAT qualification branch/worktree must be commit-identical to the branch under qualification (same HEAD SHA).
- In every `make` command, `ENV=<env>` must be passed as the last argument.
- UI display text may be French for the demo. Code, comments, commits, PR title/body, specs, rules, error messages, and Markdown stay in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `ui/**`
  - `.github/workflows/deploy-gh-pages.yml`
  - `plan/03-BRANCH_feat-ui-skeleton-svelte-ds.md`
- **Forbidden Paths (must not change in this branch)**:
  - `api/**`
  - `packages/radar-domain/**`
  - `packages/radar-sources/**`
  - `packages/radar-scoring/**`
  - `packages/radar-graph/**`
  - `e2e/**`
  - `docs/spec/input/**`
  - `CLAUDE.md`, `GEMINI.md`
  - `plan/NN-BRANCH_*.md` (other active branch files)
  - `plan/done/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `AGENTS.md`, `rules/MASTER.md`, `rules/workflow.md`, `plan/BRANCH_TEMPLATE.md`, `.gitignore` -> BR03-EX1.
  - `package.json`, `package-lock.json`, `Makefile`, `eslint.config.js` -> BR03-EX2.
  - `docker-compose.dev.yml`, `docker-compose.test.yml`, `docker-compose.e2e.yml` -> BR03-EX3 only if make-based UI gates cannot run with the existing services.
  - `.github/workflows/ci.yml` -> BR03-EX4 only if the existing CI cannot pick up UI gates through `make`.
- **Exception process**:
  - Declare exception ID `BR03-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.
  - Include reason, impact, and rollback strategy.

## Feedback Loop
- [x] `acknowledge` BR03-EX1 - Clarify repository-local worktree wording.
  - Reason: user explicitly requested worktrees to be documented as `./tmp/feat-*` with `.gitignore`, not system `/tmp`.
  - Impact: wording-only updates in `AGENTS.md`, `rules/MASTER.md`, `rules/workflow.md`, `plan/BRANCH_TEMPLATE.md`, and possibly `.gitignore`.
  - Rollback: revert the wording to `tmp/<slug>` if the team later chooses a different convention.
- [x] `acknowledge` BR03-EX2 - Wire UI workspace and gates.
  - Reason: BR-03 creates the first `ui` workspace, so root workspace metadata, lockfile, Makefile targets, and ESLint config may need updates.
  - Impact: root `package.json` gains `ui`; `package-lock.json` updates through make-only install; `Makefile` runs UI build/typecheck/test; `eslint.config.js` handles Svelte/TS lint boundaries.
  - Rollback: remove `ui` from workspaces and restore previous gate target bodies/config.
- [x] `acknowledge` BR03-EX3 - Compose UI changes.
  - Reason: the existing `ui` service did not run the Vite dev server, and the API health badge needs a same-origin Vite proxy to avoid browser CORS changes in the API.
  - Impact: limited to the dev `ui` service command and UI environment variables in `docker-compose.dev.yml`.
  - Rollback: restore BR-02 compose files.
- [ ] `deferred` BR03-EX4 - CI workflow changes.
  - Reason: existing CI calls `make typecheck`, `make lint`, `make build`, and `make test`; if Makefile integration is enough, no CI edit is needed.
  - Impact: limited to adding UI-specific CI steps only if make integration is insufficient.
  - Rollback: remove the extra CI steps and keep make-driven CI.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (default for orthogonal tasks; single final test cycle)
- [ ] **Multi-branch** (only if sub-workstreams require independent CI or long-running validation)
- Rationale: BR-03 is a coherent first UI slice. Dependencies, layout, demo state, chat shell, and gh-pages workflow are tightly coupled and should be validated together.

## UAT Management (in orchestration context)
- **Mono-branch**: UAT after the integrated UI can run locally through `make dev`.
- UAT target: `make dev API_PORT=8804 UI_PORT=5304 MAILDEV_UI_PORT=1104 OBSCURA_HOST_PORT=9324 ENV=feat-ui-skeleton`.
- UAT URL: `http://localhost:5304`.
- UAT checks:
  - [x] first viewport is the usable radar workspace, not a marketing landing page.
  - [x] desktop layout shows signal list, opportunity detail, map/status area, and chat shell without overlap.
  - [x] mobile layout remains usable and text fits controls/cards.
  - [x] API health state reads from the BR-02 `/health` endpoint when the API is running and degrades clearly when it is not.
  - [x] Chat shell visibly uses the package boundary from `@sentropic/chat-ui` or a documented adapter if package installation is blocked.

## Plan / Todo (lot-based)
- [ ] **Lot 0 - Baseline, worktree, and rule clarity**
  - [x] Confirm branch: `feat/ui-skeleton-svelte-ds`.
  - [x] Confirm worktree: `./tmp/feat-ui-skeleton-svelte-ds`.
  - [x] Confirm `tmp/` is ignored by `.gitignore`.
  - [x] Confirm port mapping: `API_PORT=8804`, `UI_PORT=5304`, `MAILDEV_UI_PORT=1104`.
  - [x] Apply BR03-EX1 wording clarification for repository-local worktrees if needed.
  - [x] Lot gate: `git status --short --branch`.
  - [x] Commit: branch plan + optional BR03-EX1 wording.

- [x] **Lot 1 - UI workspace and dependency wiring**
  - [x] Remove `ui/.gitkeep`.
  - [x] Create `ui/package.json` with scripts: `dev`, `build`, `preview`, `typecheck`, `test`.
  - [x] Create Vite/Svelte config files: `ui/vite.config.ts`, `ui/tsconfig.json`, `ui/tsconfig.node.json`.
  - [x] Create Tailwind files: `ui/tailwind.config.cjs`, `ui/postcss.config.cjs`.
  - [x] Create app entry files: `ui/index.html`, `ui/src/main.ts`, `ui/src/App.svelte`, `ui/src/app.css`, `ui/src/vite-env.d.ts`.
  - [x] Add `ui` to root workspaces and update `package-lock.json` through make-only install.
  - [x] Add target packages: Svelte 5, Vite 5, Tailwind 3, `@lucide/svelte`, `svelte-streamdown`, Sentropic design system packages, and `@sentropic/chat-ui`.
  - [x] If a Sentropic package is unavailable from the configured registry, stop and report the exact package/version failure before substituting.
  - [x] BR03-EX2: update `Makefile` so `make typecheck`, `make build`, `make test`, and `make test-ui` include the UI workspace through make targets only.
  - [x] Lot gate: `make install ENV=feat-ui-skeleton`, `make typecheck ENV=feat-ui-skeleton`.

- [x] **Lot 2 - Demo data, API health client, and pure tests**
  - [x] Create `ui/src/lib/demo/radar-demo-data.ts` with stable demo signals, opportunity summary, score factors, and municipal source labels.
  - [x] Create `ui/src/lib/api/health.ts` with a small typed client for `/health`.
  - [x] Create `ui/src/lib/state/dashboard.ts` for selected signal/opportunity state without global framework complexity.
  - [x] Create unit tests for score/status formatting and health response mapping.
  - [x] Lot gate: `make test-ui ENV=test-feat-ui-skeleton`.

- [x] **Lot 3 - Radar workspace components**
  - [x] Create `ui/src/lib/components/AppShell.svelte`.
  - [x] Create `ui/src/lib/components/TopBar.svelte`.
  - [x] Create `ui/src/lib/components/MetricStrip.svelte`.
  - [x] Create `ui/src/lib/components/SignalQueue.svelte`.
  - [x] Create `ui/src/lib/components/OpportunityPanel.svelte`.
  - [x] Create `ui/src/lib/components/MapPreview.svelte` as a non-interactive BR-03 preview for BR-10 map work.
  - [x] Create `ui/src/lib/components/ApiStatusBadge.svelte`.
  - [x] Compose the first screen in `App.svelte` as the actual operational dashboard.
  - [x] Lot gate: `make typecheck ENV=feat-ui-skeleton`, `make build ENV=feat-ui-skeleton`.

- [x] **Lot 4 - Sentropic chat/design-system shell**
  - [x] Add a thin local adapter component around `@sentropic/chat-ui/components/ChatPanel.svelte`.
  - [x] Provide BR-03 placeholder header/timeline/composer snippets that describe radar tools without implementing chat back-end calls.
  - [x] Apply Sentropic design tokens/themes if the packages expose CSS/theme entrypoints compatible with Vite.
  - [x] Use lucide icons for action buttons and status affordances.
  - [x] Keep component boundaries small and app-owned; do not fork Sentropic package internals.
  - [x] Lot gate: `make typecheck ENV=feat-ui-skeleton`, `make lint ENV=feat-ui-skeleton`.

- [x] **Lot 5 - Responsive polish and local UAT**
  - [x] Ensure desktop, tablet, and mobile layouts have stable dimensions and no text overlap.
  - [x] Start the stack with `make dev API_PORT=8804 UI_PORT=5304 MAILDEV_UI_PORT=1104 OBSCURA_HOST_PORT=9324 ENV=feat-ui-skeleton`.
  - [x] Verify `http://localhost:5304` manually.
  - [x] Capture Playwright screenshots if a browser runner is available in the make workflow; otherwise document manual viewport checks.
  - [x] Lot gate: `make typecheck ENV=feat-ui-skeleton`, `make lint ENV=feat-ui-skeleton`, `make build ENV=feat-ui-skeleton`, `make test ENV=test-feat-ui-skeleton`.

- [x] **Lot 6 - GitHub Pages deployment**
  - [x] Create `.github/workflows/deploy-gh-pages.yml`.
  - [x] Configure Vite base path for GitHub Pages without breaking local dev.
  - [x] Ensure the workflow uses make targets where applicable.
  - [x] Lot gate: `make build GITHUB_PAGES=true ENV=feat-ui-skeleton`.

- [ ] **Lot 7 - Push, PR, merge, and close**
  - [x] Run full scope check against Allowed/Conditional/Forbidden paths.
  - [x] Push branch `feat/ui-skeleton-svelte-ds`.
  - [x] Open PR with BR-03 scope, exceptions, UAT notes, and gate results.
    - PR: https://github.com/rhanka/radar-immobilier/pull/5
    - Ready for review after local BR-03 gates and Playwright UAT passed.
  - [ ] Verify CI green.
    - Blocked: GitHub reports no workflow runs and no commit statuses for the PR head after ready-for-review and a synchronize push.
  - [ ] Merge via merge commit only; do not squash or rebase.
  - [ ] Preserve source branch.
  - [ ] Pull/update local main.
  - [ ] Move this file to `plan/done/03-BRANCH_feat-ui-skeleton-svelte-ds.md`.
  - [ ] Update `PLAN.md` status.
