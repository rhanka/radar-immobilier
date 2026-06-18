# Fix: PDF links and geo display routing

## Objective
Ensure Signaux map evidence documents remain linkable from raw document references, and ensure zones/lots render when the corresponding data is present.

## Scope / Guardrails
- Scope limited to Signaux map evidence references, OGC lot normalization, and UI nginx geo proxy routing.
- Make-only workflow for project tasks.
- Root workspace `/home/antoinefa/src/radar-immobilier` remains reserved for user dev/UAT and is not edited.
- Branch development happens in repository-local isolated worktree `./tmp/fix-pdf-geo-display`.
- Tests run on dedicated `ENV=test-fix-pdf-geo-display`.
- All new code/spec text is English.

## Branch Scope Boundaries
- **Allowed Paths (implementation scope)**:
  - `api/src/routes/documents.ts`
  - `api/src/routes/documents.test.ts`
  - `api/src/routes/graph-signals.ts`
  - `api/src/routes/graph-signals.test.ts`
  - `api/src/services/sources/document-resolver.ts`
  - `ui/src/lib/signals/graph-signal-detail-client.ts`
  - `ui/src/lib/signals/graph-signal-detail-client.test.ts`
  - `ui/src/lib/maps/lots-client.ts`
  - `ui/src/lib/maps/lots-client.test.ts`
  - `ui/src/lib/components/maps/SignauxSelPanel.svelte`
  - `ui/nginx/default.conf`
  - `deploy/k8s/50-ui.yaml`
  - `plan/PDFGEO-BRANCH_fix-pdf-geo-display.md`
- **Forbidden Paths**:
  - `Makefile`
  - `docker-compose*.yml`
  - `rules/**`
  - `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`
  - Other branch plan files

## Orchestration Mode
- [x] **Mono-branch + merge commit**
- Rationale: one incident fix across the UI/API contract and deployment routing.

## Plan / Todo
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read mandatory rules.
  - [x] Create isolated worktree `./tmp/fix-pdf-geo-display`.
  - [x] Confirm existing evidence and lot branches are already ancestors of `origin/main`.

- [x] **Lot 1 — Evidence document links**
  - [x] Normalize raw document references from embedded/local paths to canonical `raw/...` keys.
  - [x] Preserve a `/api/documents/raw` link when metadata is missing but the raw key is resolvable.
  - [x] Add focused API/UI tests.

- [ ] **Lot 2 — Geo display when data exists**
  - [ ] Preserve non-PII lot display fields from OGC collections.
  - [ ] Fix nginx routing so only `/api/geo/collections` goes to geo-api; native radar geo routes stay on radar-api.
  - [ ] Add focused UI tests.

- [ ] **Lot 3 — Verification**
  - [x] Run focused API tests through `make`.
  - [ ] Run focused UI tests through `make`.
  - [ ] Run typecheck/lint/build as feasible through `make`.
  - [ ] Commit and push.
