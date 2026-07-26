# Feature: Graphify 3.4 deterministic delta enrichment

## Objective

Protect city snapshots from business-property loss, then persist the
deterministic Phase A enrichment from existing graph nodes. Keep
`ontology_version: "2.3"` for contract compatibility and identify the pass as
`graphify_pass: "3.4"` in graph manifests/snapshots. Stop Phase B before any
large-scale LLM work and document its cumulative-input gap.

## Scope / Guardrails

- Phase 0 is mandatory and lands before any enrichment writer.
- The property gate compares `props.properties` per city and node and rolls
  back a projection when an existing business key would disappear.
- Phase A reads existing projected nodes; it does not read raw documents and
  does not calculate density effects.
- `effet_densifiant` is written only as the placeholder `inconnu`.
- `instrument` reuses the existing classifier as the single source of truth.
- Every city write is a complete snapshot; partial deltas are forbidden.
- Production is read-only for measurement only. No production writes and no
  Kubernetes changes.
- Tests use `ENV=test-g34` with dedicated ports, never `ENV=dev`.
- No `preflight.sh` use as a read-only preflight: it writes and deletes an S3
  test object and remains a documented debt.
- No push. Commits are atomic, selective, and no larger than 150 lines.

## Branch Scope Boundaries (MANDATORY)

### Allowed Paths

- `api/src/services/graph/graph-store.ts`
- `api/src/services/graph/graph-store.test.ts`
- `api/src/services/graph/vivier-v2.ts`
- `api/src/services/graph/graphify-34-*.ts`
- `api/src/services/graph/graphify-34-*.test.ts`
- `api/src/scripts/graphify-34-*.ts`
- `api/tests/fixtures/graphify/graphify-34/**`
- `radar/ontology/graphify-output-contract.md`
- `radar/ontology/ontology-profile.yaml`
- `docs/spec/SPEC_EVOL_FILTRAGE_VIVIER_v2.md`
- `docs/reports/graphify-34-*.md`
- `plan/G34D-BRANCH_feat-graphify-34-deltas-enrichment.md`

### Forbidden Paths

- `Makefile`
- `docker-compose*.yml`
- `rules/**`
- `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`
- `PLAN.md`
- `ui/**`
- `packages/radar-sources/**`
- `packages/radar-domain/**`
- `deploy/k8s/**`
- `tools/graphify-v23/**`
- `../poc-k8s/**`, `../sentropic/**`, `../graphify/**`
- `plan/*-BRANCH_*.md` other than this file

### Conditional Paths

- `api/drizzle/*.sql` — forbidden unless a schema change is proven necessary;
  would require a new `BRG34D-EXn` entry with rationale, impact, and rollback.
- `api/src/services/sources/**` — forbidden unless Phase B input discovery
  proves the existing manifest boundary cannot be reused; same exception rule.

## Plan / Todo (lot-based)

- [x] **Lot 0 — Baseline & constraints**
  - [x] Read canonical rules and harness testing/debug instructions.
  - [x] Confirm branch and preserve unrelated `.h2a/` changes.
  - [x] Establish `ENV=test-g34` and dedicated ports for automated checks.

- [x] **Lot 1 — Phase 0 property-preservation gate**
  - [x] Add pure per-city/per-node missing-key detection under
    `props.properties`.
  - [x] Integrate it into `upsertGraphAtomic` before commit and rollback on
    any business-property loss.
  - [x] Add the exact 39→9 regression test and a non-regression/idempotence
    test.

- [x] **Lot 2 — Phase A deterministic producer**
  - [x] Build complete city snapshots from existing graph nodes only.
  - [x] Persist `effet_densifiant: "inconnu"`, derived `etape`, and `instrument`
    through the shared classifier.
  - [x] Add `graphify_pass: "3.4"` while retaining `ontology_version: "2.3"`.
  - [x] Prove replay idempotence and field-level before/after counts on the
    test witness city.

- [x] **Lot 3 — Phase B checkpoint**
  - [x] Map the missing cumulative raw→schema input and the PV-complete scan
    wiring point.
  - [x] Do not launch broad LLM processing; record cost, determinism, and
    homonymy boundaries for `usage_dominant`.

- [x] **Lot 4 — Documentation & verification**
  - [x] Document the formal 3.4→ontology 2.3 mapping and snapshot contract.
  - [x] Report impossible items and the `preflight.sh` S3 write/delete debt.
  - [x] Run scoped Make gates on `ENV=test-g34`; do not push.

## Feedback Loop

- [x] Record any test or environment flakiness with the exact command and
  signature before accepting it.
