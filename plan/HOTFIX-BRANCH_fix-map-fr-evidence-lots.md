# Hotfix: Signaux map French labels, evidence cards, and Saint-Eustache lots

## Objective
Fix the production regression observed on the Signaux map: French labels must be correct, the selected city must expose a signal evidence card without an extra hidden step, and lot data must be loaded from the live OGC geo collections exposed by the deployed proxy.

## Scope / Guardrails
- Scope limited to the Signaux map right selection panel, graph signal evidence reference parsing, and geo lots client wiring to `/api/geo/collections`.
- Make-only workflow for project tasks.
- Root workspace `/home/antoinefa/src/radar-immobilier` remains reserved for user dev/UAT and is not edited.
- Branch development happens in repository-local isolated worktree `./tmp/fix-map-fr-evidence-lots`.
- Tests run on dedicated `ENV=test-fix-map-fr-evidence-lots` / `ENV=e2e-fix-map-fr-evidence-lots` environments.
- All new code/spec text is English.

## Branch Scope Boundaries
- **Allowed Paths (implementation scope)**:
  - `ui/src/lib/components/maps/SignauxSelPanel.svelte`
  - `ui/src/lib/components/maps/SignauxMapView.svelte`
  - `ui/src/lib/signals/graph-signal-detail-client.ts`
  - `ui/src/lib/signals/graph-signal-detail-client.test.ts`
  - `ui/src/lib/maps/lots-client.ts`
  - `ui/src/lib/maps/lots-client.test.ts`
  - `ui/src/lib/components/maps/EvaluationMapView.test.ts`
  - `plan/HOTFIX-BRANCH_fix-map-fr-evidence-lots.md`
- **Conditional Paths**:
  - `deploy/k8s/40-api.yaml`
  - `deploy/k8s/50-ui.yaml`
- **Forbidden Paths**:
  - `Makefile`
  - `docker-compose*.yml`
  - `rules/**`
  - `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`, `AGENTS.md`
  - Other branch plan files

## Orchestration Mode
- [x] **Mono-branch + merge commit**
- Rationale: this is one incident fix with tightly coupled UI/API behavior and one validation cycle.

## Plan / Todo
- [x] **Lot 0 — Baseline & constraints**
  - [x] Use isolated worktree `./tmp/fix-map-fr-evidence-lots`.
  - [x] Confirm root checkout is dirty and out of scope.
  - [x] Confirm issue from screenshots and local code.

- [x] **Lot 1 — UI correctness**
  - [x] Replace `signal(s)` with correct French `signal/signaux`.
  - [x] Auto-focus the first loaded signal in the right selection bucket.
  - [x] Preserve right-panel description/citation/PDF card behavior.

- [x] **Lot 2 — Evidence reference parsing**
  - [x] Accept graphify refs stored as `file`, `ref`, `sourceUrl`, `citation`, `quote`, or top-level evidence props, not only `docSha`.
  - [x] Update focused unit tests.

- [x] **Lot 3 — Live geo collections**
  - [x] Load lots from `/api/geo/collections/qc-lots-{citySlug}/items`.
  - [x] Use `numberMatched` as the available lot total when returned by OGC.
  - [x] Return an explicit `ok:false` response when a lot collection is not configured.
  - [x] Update focused unit tests.

- [ ] **Lot 4 — Verification & release**
  - [x] Run focused tests through `make`.
  - [x] Run lint/typecheck/build gates through `make` as feasible.
  - [ ] Commit and push.
  - [ ] Open PR, merge with a merge commit when green.
  - [ ] Publish/update deployed app if image/deploy update is required.
