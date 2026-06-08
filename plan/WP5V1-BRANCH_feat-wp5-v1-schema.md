# Feature: WP5 V1 — Ontology data model (Zod + PostGIS) + graphify profile

## Objective
Implement the SIGNED WP5 ontology spec V1 foundation: Zod schemas + bitemporal
as-of-date helpers for the 12 V1 entities, PostGIS/Drizzle tables + one migration
for entities and dated relations, and the real graphify profile + per-city/provincial
project files. Foundation only — no radar validators, no studio (next lot).

## Scope / Guardrails
- Implement `docs/spec/SPEC_ONTOLOGY_DATA_MODEL.md` (v2 signed) V1 exactly, on top of
  `docs/spec/SPEC_DESIGN_DATA_MODEL.md` (merged relational base).
- One migration max in `api/drizzle/*.sql`.
- Make-only workflow, `ENV=test-wp5v1` as the LAST argument, no direct Docker.
- Worktree `./tmp/wp5-v1`; root checkout untouched.
- All new text in English; no fabricated data — schemas only.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `packages/radar-domain/src/schemas/**`
  - `packages/radar-domain/src/ontology/**`
  - `packages/radar-domain/src/index.ts`
  - `packages/radar-domain/tests/**`
  - `api/src/db/schema.ts`
  - `radar/ontology/**`
  - `radar/cities/**`
- **Conditional Paths (with this branch's exception)**:
  - `api/drizzle/*.sql` + `api/drizzle/meta/*` (max 1 migration) — `BR-WP5V1-EX1`
- **Forbidden Paths**:
  - `Makefile`, `docker-compose*.yml`, `rules/**`, `CLAUDE.md`, `AGENTS.md`,
    `GEMINI.md`, other `plan/NN-BRANCH_*.md`

## Feedback Loop
- `BR-WP5V1-EX1` (conditional): one new Drizzle migration `api/drizzle/0001_*.sql` +
  journal/snapshot entry. Reason: V1 requires PostGIS tables + dated relations +
  non-overlap exclusion constraints. Impact: additive DDL only (new tables, new
  extensions `postgis`/`btree_gist`). Rollback: drop the new migration file + revert
  journal/snapshot to `0000`.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick**
- Rationale: single foundation deliverable (schemas + migration + profile), one CI cycle.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read `rules/MASTER.md`, `CLAUDE.md`, both specs, existing schemas.
  - [x] Confirm worktree `./tmp/wp5-v1`, env `test-wp5v1`, `ENV` last.
  - [x] Verify real graphify profile field names against `@sentropic/graphify@0.10.0`.

- [ ] **Lot 1 — Zod schemas (V1 entities + bitemporal + provenance)**
  - [ ] `temporal.ts` (TemporalSpan, resolveAsOf, projectAsOf).
  - [ ] `provenance.ts` (EvidenceItem reuse, ReconBridge, rawRef).
  - [ ] Entity schemas: municipality, zone, bylaw, designation-event, constraint,
        lot, adresse, valuation, source, signal (ontology), regulatory-stage.
  - [ ] city-profile (CityProfile + SourceBinding[] + ZoningRegime + DecisionProcess).
  - [ ] Wire exports in `schemas/index.ts` / `index.ts`.
  - [ ] Unit tests for schemas + resolveAsOf + projectAsOf.
  - [ ] Lot gate: `make typecheck` + `make lint`.

- [ ] **Lot 2 — PostGIS/Drizzle tables + migration**
  - [ ] Extend `api/src/db/schema.ts` with V1 tables + dated relation tables.
  - [ ] Hand-author `api/drizzle/0001_*.sql` (PostGIS geom nullable + geomSource +
        EXCLUDE non-overlap on versioned entities) + journal/snapshot.
  - [ ] Lot gate: `make typecheck` + `make lint` + `make test ENV=test-wp5v1`
        (boots postgres, db-migrate smoke).

- [ ] **Lot 3 — graphify profile files**
  - [ ] `radar/ontology/ontology-profile.yaml` (10 node types + relations +
        hardening.status_transitions + evidence_policy + inference_policy + registries).
  - [ ] `radar/cities/graphify.template.yaml` (per-city) + `radar/cities/_provincial/graphify.yaml`.
  - [ ] Validate against the real graphify profile format.

- [ ] **Lot 4 — Merge & close**
  - [ ] `make typecheck`/`lint`/`test`/`build` clean on `ENV=test-wp5v1`.
  - [ ] Commit per the requested message (no Co-Authored-By trailer).
  - [ ] Push + `gh pr create --draft`.
