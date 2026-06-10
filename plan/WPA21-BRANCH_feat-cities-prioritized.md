# Feature: QC municipality reference — prioritized by distance to Montréal

## Objective
Build the canonical Québec municipality dataset (WP A.2.1): 1 106 municipalities
with WGS-84 coordinates, haversine distance to Montréal centre (45.5019, -73.5674),
priority rank (ascending distance), population, and MRC. Montréal and Laval are
excluded from active scraping scope; municipalities with pop > 100 000 are
deprioritized but retained.

## Scope / Guardrails
- Scope limited to `packages/radar-domain/src/schemas/municipality.ts`,
  `packages/radar-sources/src/municipalities.ts`,
  `packages/radar-sources/src/geo/municipalities.qc.json`,
  index exports, and matching test files.
- Make-only workflow, no direct Docker commands.
- Root workspace `~/src/radar-immobilier` is reserved for user dev/UAT and must remain stable.
- Branch development in repository-local isolated worktree `./tmp/cities`.
- No Docker stack started; typecheck/lint/vitest run via `make ENV=test-cities` and
  `npm test --workspace=@radar/*` in the dev container.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `packages/radar-domain/src/schemas/municipality.ts`
  - `packages/radar-domain/src/schemas/municipality.test.ts`
  - `packages/radar-domain/src/schemas/index.ts`
  - `packages/radar-sources/src/municipalities.ts`
  - `packages/radar-sources/src/municipalities.test.ts`
  - `packages/radar-sources/src/geo/municipalities.qc.json`
  - `packages/radar-sources/src/index.ts`
  - `plan/WPA21-BRANCH_feat-cities-prioritized.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `rules/**`
  - `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`
  - `plan/NN-BRANCH_*.md` (except this branch file)
- **Conditional Paths**: none.

## Feedback Loop
_No blockages._

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (single logical change, no sub-workstreams)
- Rationale: Pure data + schema addition; no API/UI surface; one lot sufficient.

## UAT Management
No UI surface impacted — no UAT checkpoint required.

## Plan / Todo (lot-based)

- [x] **Lot 0 — Baseline & constraints**
  - [x] Read `rules/MASTER.md`, `CLAUDE.md`, `AGENTS.md`.
  - [x] Confirm worktree `./tmp/cities` on branch `feat/cities-prioritized`.
  - [x] ENV: `test-cities`; no ports needed (no service stack).
  - [x] Confirm make-only workflow.

- [x] **Lot 1 — Municipality schema + data + helper**
  - [x] Fetch GeoNames Canada dump (CC BY 4.0) — QC ADM3, 1 106 entries.
  - [x] Join MAMH Répertoire (CC BY 4.0) by admin3Code ↔ mcode — population + MRC.
  - [x] Compute haversine distances; sort by distance; assign priorityRank.
  - [x] Mark Montréal/Laval excluded; mark pop > 100 000 deprioritized.
  - [x] Write `Municipality` Zod schema (`packages/radar-domain/src/schemas/municipality.ts`).
  - [x] Write `municipalities.qc.json` dataset (1 106 entries, sorted, 0 dup slugs).
  - [x] Write `prioritizedCities()` helper (`packages/radar-sources/src/municipalities.ts`).
  - [x] Export from both package indexes.
  - [x] Write vitest tests (schema, data integrity, haversine, helper).
  - [x] Lot gate:
    - [x] `make typecheck ENV=test-cities` → exit 0
    - [x] `make lint ENV=test-cities` → exit 0
    - [x] `npm test --workspace=@radar/domain` → 117/117 passed
    - [x] `npm test --workspace=@radar/sources` → 113/113 passed

- [x] **Lot 2 — Commit + Draft PR**
  - [x] Commit: `feat(domain): référentiel municipalités QC priorisé par distance à Montréal (hors MTL/Laval)`
  - [x] Push branch; open draft PR.

## Data sources (anti-invention)
- **Coordinates**: GeoNames.org Canada dump — CC BY 4.0
  `http://download.geonames.org/export/dump/CA.zip`
  (feature class A, feature code ADM3, admin1Code=10 for Québec)
- **Population + MRC**: MAMH Répertoire des municipalités — CC BY 4.0
  `https://donneesouvertes.affmunqc.net/repertoire/MUN.csv`
  (fields: mcode, munnom, mrc, mpopul — joined by admin3Code ↔ mcode)
- **Join key**: GeoNames field `admin3Code` (column 13) = MAMH `mcode` (column 1).
  Verified on Beauharnois (70022), Salaberry-de-Valleyfield (70052), Delson (67025),
  Brossard (58007), both Saint-Lambert entries (58012 ≠ 87120).
