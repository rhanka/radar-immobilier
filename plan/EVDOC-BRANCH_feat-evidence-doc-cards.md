# Feature: Evidence-backed signal document cards

## Objective
Make graph-backed signal cards evidence-complete: preserve source publication dates during scraping, reconstruct missing document metadata from existing S3 manifests/URLs without a full rescrape, and expose description, citation, source PDF, and distinct document dates in the map selection UI.

## Scope / Guardrails
- Scope limited to PV/document metadata persistence, graph signal evidence DTOs, document serving, and signal card UI.
- One migration max in `api/drizzle/*.sql` only if the existing JSONB/document projection cannot satisfy the API contract.
- No full municipal document rescrape for the metadata repair path.
- No graphify `latest.json` patching as a substitute for v2.3; graphify output changes remain gated by the graphify contract.
- Raw S3 documents stay private; UI uses public `sourceUrl` when available or an API-controlled document route.
- Make-only workflow, no direct Docker commands.
- Root workspace `~/src/radar-immobilier` is reserved for user dev/UAT (`ENV=dev`) and must remain stable.
- Branch development must happen in repository-local isolated worktree `./tmp/feat-evidence-doc-cards`.
- Automated tests must run on dedicated environments (`ENV=test-evidence-doc-cards` / `ENV=e2e-evidence-doc-cards`), never on root `dev`.
- In every `make` command, `ENV=<env>` must be passed as the last argument.
- All new text in English. Discussions with the user may be in French.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `plan/EVDOC-BRANCH_feat-evidence-doc-cards.md`
  - `docs/spec/SPEC_INTENT_GRAPHIFY_V23_EVIDENCE.md`
  - `docs/spec/SPEC_INTENT_REDESIGN_SELECTION_BUCKETS.md`
  - `docs/spec/SPEC_PERSISTENCE_S3_FIRST.md`
  - `packages/radar-sources/src/RawDocument.ts`
  - `packages/radar-sources/src/RawDocument.test.ts`
  - `api/src/services/sources/**`
  - `api/src/routes/graph-signals.*`
  - `api/src/routes/documents.*`
  - `api/src/app.ts`
  - `api/src/db/schema.ts`
  - `api/drizzle/*.sql`
  - `ui/src/lib/signals/**`
  - `ui/src/lib/components/maps/SignauxSelPanel.svelte`
  - `ui/src/lib/components/maps/DocumentOverlay.svelte`
  - `ui/src/lib/components/maps/SignauxMapView.svelte`
  - `ui/src/lib/components/signals/**`
  - `radar/ontology/graphify-output-contract.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `rules/**`
  - `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`
  - `plan/NN-BRANCH_*.md` (except this branch file)
  - `.track/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `deploy/k8s/**`
  - `.github/workflows/**`
  - `../poc-k8s/**`
- **Exception process**:
  - Declare exception ID `EVDOC-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.
  - Include reason, impact, and rollback strategy.

## Feedback Loop
- `EVDOC-WP-PV`: Data PV / S3-first persistence. Owns `publishedAt` capture, metadata repair, and rebuild projection.
- `EVDOC-WP-GRAPHIFY`: Graphify ontology v2.3. Owns mandatory description/citation/document refs and gates; no rerun in this branch.
- `EVDOC-WP-API-UI`: Data model/API/UI selection bucket. Owns `GraphSignalCard`, document route, PDF overlay, and card rendering.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (default for orthogonal tasks; single final test cycle)
- [ ] **Multi-branch** (only if sub-workstreams require independent CI or long-running validation)
- Rationale: the changes cross one user-facing evidence path and share DTOs; splitting would create fragile integration edges.

## UAT Management (in orchestration context)
- UAT is always presented on the **root checkout**, `ENV=dev`, at fixed ports (`http://localhost:5301`).
- Branch-stack validation uses `API_PORT=8817`, `UI_PORT=5317`, `MAILDEV_UI_PORT=1117`, `ENV=test-evidence-doc-cards`.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline, specs, and track**
  - [x] Run two read-only `gpt-5.5` xhigh analyses for provenance/API/UI.
  - [x] Update intent specs with the final PV metadata, repair, graphify, API, and UI contract.
  - [x] Import this plan into track from the repository root.
  - [x] Lot gate: no runtime gate; branch plan and specs reviewed.

- [x] **Lot 1 — Persist `publishedAt` at recueil time**
  - [x] Extend `RawDocumentRecord` and `buildRawDocumentRecord` with optional `publishedAt` and `title`.
  - [x] Pass `RawDocumentRef.publishedAt` / `title` from `runRecueil`.
  - [x] Ensure meta sidecars and manifests preserve document date without inventing unknown dates.
  - [x] Lot gate:
    - [x] `make test-api SCOPE=src/services/sources/recueil.test.ts ENV=test-evidence-doc-cards-api`
    - [x] `make test ENV=test-evidence-doc-cards-all`

- [x] **Lot 2 — Metadata repair from existing S3**
  - [x] Add a pure repair service that reads existing `runs/**/manifest.jsonl` and `raw/**/*.meta.json`.
  - [x] Reconstruct `publishedAt` from manifests first, URL/title parsers second, and leave absent when precision is unsafe.
  - [x] Emit append-only repair output; do not rewrite raw PDFs.
  - [x] Lot gate:
    - [x] `make test-api SCOPE=src/services/sources/repair-published-at.test.ts ENV=test-evidence-doc-cards-lot2`
    - [x] `make test-api SCOPE=src/services/sources/rebuild-from-s3.test.ts ENV=test-evidence-doc-cards-lot2`

- [x] **Lot 3 — API evidence DTO and document route**
  - [x] Add server-side `GraphSignalCard` mapping that preserves label, description, citations, document metadata, and relations.
  - [x] Resolve `docSha`/`rawRef`/`sourceUrl` against projected document metadata when available.
  - [x] Add a controlled document endpoint for private `rawRef` fallback, while preferring public `sourceUrl`.
  - [x] Lot gate:
    - [x] `make test-api SCOPE=src/routes/graph-signals.test.ts ENV=test-evidence-doc-cards-lot3`
    - [x] `make test-api SCOPE=src/routes/documents.test.ts ENV=test-evidence-doc-cards-lot3`

- [x] **Lot 4 — UI signal card and PDF overlay**
  - [x] Extend graph-signal clients to read enriched evidence and distinct dates.
  - [x] Update the right selection panel to display description, citation, source PDF link, and incomplete-evidence states.
  - [x] Add a map-surface document overlay with page/hash fallback and yellow citation context; carry bbox metadata for the PDF.js/highlight follow-up.
  - [x] Lot gate:
    - [x] `make test-ui SCOPE=src/lib/signals/graph-signal-detail-client.test.ts ENV=test-evidence-doc-cards-lot4`
    - [x] `make test-ui SCOPE=src/lib/components/maps ENV=test-evidence-doc-cards-lot4`
    - [x] `make test-api SCOPE=src/routes/graph-signals.test.ts ENV=test-evidence-doc-cards-lot4`
    - [x] `make typecheck ENV=test-evidence-doc-cards-lot4`

- [ ] **Lot 5 — Graphify contract and non-regression gate notes**
  - [ ] Update `radar/ontology/graphify-output-contract.md` to align v2.3 with the intent spec.
  - [ ] Document that v2.3 uses existing raw/parsed/manifests, not full rescrape, and must protect the 33 priority detections.
  - [ ] Lot gate:
    - [ ] `make typecheck ENV=test-evidence-doc-cards`
    - [ ] `make lint ENV=test-evidence-doc-cards`

- [ ] **Lot 6 — Merge readiness**
  - [ ] Run focused tests for Lots 1-5.
  - [ ] Run `make build ENV=test-evidence-doc-cards`.
  - [ ] Push branch and open PR.
  - [ ] Verify CI green.
  - [ ] Merge commit only; preserve branch.
