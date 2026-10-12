# Feature: Immo annotations host

## Objective
- [ ] Implement the immo host against M1, remove active legacy annotation code and resolve the independent implementation reviews.

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
  - [x] `docs/spec/reports/dossier-retours-steve/README.md`, `docs/spec/ANNOTATIONS_STEVE_PREPARATION.md`.
  - [x] `.github/workflows/build-push-images.yml`, `.github/workflows/rollback.yml`, `.github/workflows/bascule-preprod.yml`, `deploy/ci/annotations-guard.sh`, `deploy/ci/annotations-guard.test.mjs`, `deploy/ci/rollback-release.sh`.
  - [x] `.github/workflows/ci.yml`, `docs/spec/SPEC_FIX_GRAPH_CITY_KEY.md`.
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
- [x] ANNOTATIONS-D5: owner-supplied Opus 5.5 max and Fable 5.1 max reviews both reject merge at 80105624; accept the evidenced migration/cutover blockers and preserve both original verdicts.
- [x] BR1001-EX5: permit the named deployment/rollback/restore guard paths because ordinary CD can retire legacy before conversion, copy it during cutover or restore an incompatible writer; offline qualification only, no live configuration change, rollback by reverting these guard changes before adoption.
- [x] BR1001-EX6: permit the Steve report supersession notice and preparation spec to close the inventory and retain immo-owned IM-1/IM-2 work; preserve historic decisions, rollback by reverting the notices/preparation changes.
- [x] BR1001-EX7: the required complete immutable installation lock fills resolved/integrity metadata for 710 existing exact-version entries and exceeds 150 lines as one generated artifact; no versions or dependency edges change, image install becomes npm ci, rollback by reverting this software-qualification commit before adoption.
- [x] BR1001-EX8: allow CI wiring of the new offline operation/software gates and the corrected migration-summary literals in the graph spec; these verify the evidenced review fixes, no environment activation, rollback by reverting these verification/documentation hunks.

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
- [x] **Lot 4 — Remove legacy domain/API/UI/MCP consumers and adapt retained tests.**
  - [x] Remove domain note contracts, Drizzle exports and dormant MCP note scope.
  - [x] Remove API note commands and qualify endpoint retirement.
  - [x] Remove legacy integration assertions and cleanup while retaining marks/contact coverage.
  - [x] Delete UI clients, subscriptions, components and mounts; preserve marks.
  - [x] Remove lot/signal panel mounts and ambient annotation badges.
  - [x] Delete private UI note types, HTTP client and SSE subscription with their suites.
  - [x] Load lot marks independently of retired note endpoints.
- [x] **Lot 5 — Guard migration/retirement and document operational eradication.**
  - [x] Account for every historical SQL and the known 0009 journal omission.
  - [x] Serialize host DDL and guarded legacy retirement with checksum/predecessor checks.
  - [x] Wire migration entrypoint and standalone empty/deleted-only retirement CLI.
  - [x] Qualify fresh install, receipt drift, active-note refusal and aggregate-only deleted retirement.
  - [x] Publish the exact eradication inventory, operational sequence and bounded M2/M3 handoff.
- [ ] **Lot 6 — Run scoped tests, static checks, build and independent review.**
  - [x] Host and PostgreSQL scoped tests, full API with four workers, full UI/packages pass.
  - [x] Reconcile per-workspace totals from captured logs; 5,575 passing tests overall.
  - [x] Workspace typecheck/full lint, build, API image smoke, artifact reconstruction and C1/C2 pass.
  - [ ] Complementary code consensus: selection-failed; exact author model/effort are missing, no leg dispatched.
- [x] **Lot 7 — Commit selective atomic changes and provide evidence plus bounded M2/M3 handoff.**
- [ ] **Lot 8 — Resolve migration and retirement blockers on synthetic restored databases.**
  - [x] Remove destructive retirement from ordinary migrations; regression runs the actual deployment entrypoint with an active synthetic note.
  - [x] Remove retirement from ordinary migrations; explicit retirement requires a closed-window reference, verified 0014 receipt/catalog and five-second lock bounds.
  - [x] Ship controlled catalog attestation for manual 0009 under the migration lock; native Drizzle upgrade, divergent catalog and missing final receipt qualify in 32 scoped tests.
  - [x] Package catalog-only 0009 attestation with checks on columns, constraints and indexes; native/extension/attestation receipts commit together under the same bounded lock.
  - [x] Qualify step rollback, retry, concurrent migration, and synthetic database restoration before/after retirement; 34 scoped tests pass.
  - [x] Qualify the extended host schema and assignment history in 36 integration/retired-route tests; repeatable assertions bind the new membership UUID, preserving prior audit history.
- [ ] **Lot 9 — Complete immo-owned synthetic preparation and contract receipt.**
  - [ ] Retain and acknowledge the exact frozen manifest, receipt and erratum; replay the entire vector corpus.
  - [x] Retain the exact frozen manifest/receipt/erratum, acknowledge their digests and preserve the producer reserves and immo D4 authority.
  - [x] Replay all 11 record, 6 canonical, 8 geometry and 12 rejection vectors; all 50 host/contract unit tests pass.
  - [ ] Correct host capacity/error/identity/evidence boundaries and retain assignment/resource history.
  - [x] Keep capacity in host options, leave module absence outside the closed canonical wire, require UUID-native evidence, distinguish unresolved digests, and prepare unknown historical sources without review authority.
  - [x] Qualify the corrected host boundaries on 13 unit tests, including absent capacity and unknown historical evidence.
  - [x] Retain immutable source snapshots and append-only assignment/version-link history; match the SQL capability CHECK with M1.
  - [x] Keep historical resources unresolved and deny review even with a permissive grant; only frozen source bytes permit candidate preparation.
  - [ ] Prepare a complete synthetic workbook inventory/manifest and explicit map-category dispositions, without canonical writes.
  - [ ] Require locked API image installation and document every contracts resolver.
- [ ] **Lot 10 — Qualify operational guards and reconcile the reviews.**
  - [x] Implement pre-copy deployment fence bound to an exact operation receipt; suspend ordinary restore and image-only rollback pending canonical recovery qualification.
  - [ ] Block ordinary promotion during unqualified adoption, incompatible rollback and preprod restore before their first mutation/copy.
  - [ ] Document operator entrypoints, merge/deployment prerequisites, remaining immo and module acceptance separately.
  - [ ] Run current scoped/full gates, image smoke, scope checks and independent review; report any external gate accurately.
