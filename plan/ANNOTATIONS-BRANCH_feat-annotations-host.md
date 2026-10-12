# Feature: Immo annotations host

## Objective
- [ ] Implement the immo host against M1 and remove active legacy annotation code.

## Scope / Guardrails
- [x] Isolated worktree `tmp/annotations-host`, branch `feat/annotations-host`.
- [x] Make-only, Docker-first; `ENV` last; no real imports or root UAT mutation.
- [x] Shared model and storage remain Sentropic/cluster-mesh responsibilities.
- [x] No copy of deleted notes; existing backups expire unchanged.
- [x] Tests use `test-annotations-host`; optional browser `e2e-annotations-host`.
- [x] Ports: API 8897, UI 5397, mail UI 1197, PG 5597, S3 9197, Obscura 9297, SMTP 1097.

## Branch Scope Boundaries (MANDATORY)
- [x] **Allowed Paths (implementation scope)**:
  - [x] `api/src/services/annotations/**`, `api/src/routes/annotations*`, `api/src/app.ts`, `api/src/index.ts`, `api/annotations-host.mk`, `api/Dockerfile`.
  - [x] `api/src/db/**`, `api/src/services/prospect/marks-service.ts`, `api/src/routes/prospect-marks*`.
  - [x] `api/tests/**`, `api/drizzle/0014_annotations_host.sql`, `api/drizzle/meta/_journal.json`.
  - [x] `packages/radar-domain/src/**`, `packages/immo-mcp/src/auth-context.ts`, `packages/immo-mcp/README.md`.
  - [x] `ui/src/lib/collab/**`, `ui/src/lib/components/collab/**`, `ui/src/lib/prospect/prospect-marks-client*`.
  - [x] `ui/src/lib/components/maps/LotFichePanel*`, `ui/src/lib/components/maps/SignauxSelPanel*`, `ui/e2e-qa/**`.
  - [x] `api/package.json`, `package-lock.json`, `vendor/comments-m1/**`, `docs/spec/SPEC_EVOL_ANNOTATIONS_HOST.md`, `docs/spec/ANNOTATIONS_ERADICATION.md`, `docs/spec/ANNOTATIONS_HOST_REVIEW.md`, `plan/ANNOTATIONS-BRANCH_feat-annotations-host.md`.
  - [x] `docs/spec/SPEC_CONTRAT_ANCRE_ANNOTATIONS_v1.md`, `docs/spec/SPEC_EVOL_INTEGRATION_CARTE_STEVE.md`, `docs/spec/SPEC_CONSOLIDATED_2026-07.md`.
  - [x] `docs/spec/reports/wp4-produit-coverage.md`, `docs/spec/reports/wp5-plateforme.md`, `docs/spec/mcp/immo-mcp-provider-v0.md`.
- [x] **Forbidden Paths (must not change)**:
  - [x] `Makefile`, `docker-compose*.yml`, `rules/**`, `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, other branch plans, other repositories.
- [x] **Conditional Paths**:
  - [x] `.github/workflows/**`, `deploy/**` only after an evidenced blocking need and explicit exception.
- [x] Exceptions require rationale, impact and rollback in Feedback Loop.

## Feedback Loop
- [x] ANNOTATIONS-D1: latest owner decision accepts M1 without waiting for formal freeze; cluster-mesh owns storage/API.
- [x] ANNOTATIONS-D2: M1 declares but does not deliver M2/M3 runtime; synthetic seams never enable a production fallback.
- [x] ANNOTATIONS-D3: both independent design reviews reconciled in the spec; source-version, authentication and receipt gaps remain explicit M3 qualification requirements.
- [x] BR1001-EX1: complete legacy consumer removals and immutable software artifacts may exceed 150 diff lines where splitting would retain broken partial artifacts; isolate each removal/receipt, preserve the source history, and roll back by reverting that commit.
- [x] BR1001-EX2: allow `api/src/index.ts` and `api/src/db/{host-migrations,migration-assets,retire-legacy-notes}.ts` for required production composition and guarded installation; no live operation, rollback by reverting these host changes.
- [x] BR1001-EX3: allow retirement CLI and `api/Dockerfile` to ship the exact contract archive and guard entrypoint; no image promotion, rollback by reverting those files.
- [x] BR1001-EX4: allow the eradication inventory and supersession notices in the six former annotation/MCP specs and reports; preserve owner quotations/history, rollback by reverting the notices.
- [x] ANNOTATIONS-D4: full-suite evidence found the 0012 fixture retaining new 0014 and silently skipping 0013; bound its journal to 0012. Local full API qualification uses four workers after connection/timeouts under concurrent builds; no timeout is increased.

## Orchestration Mode (AI-selected)
- [x] Mono-branch; sequential writes; independent design reviewers read only.

## UAT Management (in orchestration context)
- [x] Root UAT remains unchanged; operational adoption requires integrated module qualification.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Read rules, reference specs, owner decisions and exact M1 surfaces.**
- [x] **Lot 1 — Reconcile independent design reviews and pin the shared contract.**
- [x] **Lot 2 — Implement explicit host membership, capabilities and resource resolver.**
  - [x] Implement shared-contract host ports and Postgres assignment reads.
  - [x] Install assignment/resource schema and qualify revocation/version denials.
- [x] **Lot 3 — Compose the canonical module and prepare synthetic Steve units.**
  - [x] Verify every M1 canonical/hash vector, deterministic retry and faithful provenance.
- [ ] **Lot 4 — Remove legacy domain/API/UI/MCP consumers and adapt retained tests.**
  - [x] Remove domain note contracts, Drizzle exports and dormant MCP note scope.
  - [x] Remove API note commands and qualify endpoint retirement.
  - [x] Remove legacy integration assertions and cleanup while retaining marks/contact coverage.
  - [ ] Delete UI clients, subscriptions, components and mounts; preserve marks.
  - [x] Remove lot/signal panel mounts and ambient annotation badges.
  - [x] Delete private UI note types, HTTP client and SSE subscription with their suites.
  - [x] Load lot marks independently of retired note endpoints.
- [ ] **Lot 5 — Guard migration/retirement and document operational eradication.**
  - [x] Account for every historical SQL and the known 0009 journal omission.
  - [x] Serialize host DDL and guarded legacy retirement with checksum/predecessor checks.
  - [x] Wire migration entrypoint and standalone empty/deleted-only retirement CLI.
  - [x] Qualify fresh install, receipt drift, active-note refusal and aggregate-only deleted retirement.
- [ ] **Lot 6 — Run scoped tests, static checks, build and independent review.**
- [ ] **Lot 7 — Commit selective atomic changes and provide evidence plus bounded M2/M3 handoff.**
