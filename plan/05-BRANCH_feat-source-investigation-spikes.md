# Feature: Source investigation spikes

## Objective
Investigate every source family listed in `VISION.md` and `PROCESS.md`, then
deliver a consolidated feasibility matrix with automation level, access/cost,
sample URLs, risks, and production-adapter effort estimates.

## Scope / Guardrails
- Scope limited to source feasibility documentation and spike notes.
- Spike notes live under `packages/radar-sources/src/sources/_spikes/**`.
- No production source adapter ships in this branch.
- No scraping credentials, paid data, downloaded large samples, or private
  datasets are committed.
- Make-only workflow, no direct Docker commands.
- Root workspace `~/src/radar-immobilier` is reserved for user dev/UAT
  (`ENV=dev`) and must remain stable.
- Branch development happens in repository-local isolated worktree
  `./tmp/feat-source-investigation-spikes`; never use system `/tmp`.
- Automated test campaigns use `ENV=test-source-spikes`, never `dev`.
- In every `make` command, `ENV=<env>` is the last argument.
- All new text is English. Conversations with the user may be French.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `plan/05-BRANCH_feat-source-investigation-spikes.md`
  - `PLAN.md`
  - `docs/spec/SPEC_EVOL_SOURCE_FEASIBILITY.md`
  - `packages/radar-sources/src/sources/_spikes/**`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `rules/**`
  - `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`
  - `plan/NN-BRANCH_*.md` except this file
  - `docs/spec/input/**`
  - production source adapters outside `_spikes/**`
- **Conditional Paths**:
  - `.github/workflows/**`
  - `api/**`
  - `ui/**`
  - `packages/radar-domain/**`
  - `../poc-k8s/**`
- **Exception process**: declare reason, impact, and rollback here before
  touching any conditional path.

## Feedback Loop
No exceptions declared at branch start.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + parallel source agents**
- [ ] **Multi-branch**
- Rationale: source families are independent enough for parallel research, but
  the deliverable is one consolidated feasibility spec and one PR.

## UAT Management
- No UI UAT. This branch is documentation and spike inventory only.

## Source Families
- Municipal web and media: avis publics, proces-verbaux, council videos,
  PPCMOI, zoning bylaws, zoning plans/grids, construction permits, MRC planning
  schemes.
- Quebec public geospatial/open data: Donnees Quebec, roles d'evaluation,
  zonage municipal open data, CPTAQ zones/decisions, BDZI flood zones, GRHQ
  hydrography, Adresses Quebec, orthophotos.
- Property, ownership, and market data: Cadastre/Infolot, Registre foncier,
  transactions immobilieres, JLR, Centris/MLS.
- Socio-economic and infrastructure context: StatCan, MTQ/ARTM/municipal
  transport and infrastructure projects.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read `rules/MASTER.md`, `rules/workflow.md`, and `rules/sources.md`.
  - [x] Create isolated repository-local worktree
    `./tmp/feat-source-investigation-spikes`.
  - [x] Confirm `tmp/` is ignored.
  - [x] Capture Make targets available on the `main` baseline.
  - [x] Define environment mapping: `ENV=test-source-spikes`.
  - [x] Confirm scope and guardrails.

- [x] **Lot 1 — Feasibility spec scaffold**
  - [x] Create `docs/spec/SPEC_EVOL_SOURCE_FEASIBILITY.md` with the canonical
    evaluation rubric.
  - [x] Create `_spikes/**` directory structure and README template.
  - [x] Lot gate: `git diff --check`.

- [x] **Lot 2 — Municipal web and media source spikes**
  - [x] Investigate avis publics, proces-verbaux, and council videos for the
    Valleyfield pilot.
  - [x] Investigate PPCMOI, zoning bylaws, zoning plans/grids, construction
    permits, and MRC planning schemes.
  - [x] Record source URLs, observed formats, sample inventory, automation
    level, risks, and effort estimates.
  - [x] Lot gate: `git diff --check`.

- [x] **Lot 3 — Public geospatial and provincial open data spikes**
  - [x] Investigate Donnees Quebec discovery/access paths.
  - [x] Investigate roles d'evaluation, zoning open data, CPTAQ zones and
    decisions, BDZI, GRHQ, Adresses Quebec, and orthophotos.
  - [x] Record API/file formats, refresh cadence where visible, geospatial
    tooling needs, risks, and effort estimates.
  - [x] Lot gate: `git diff --check`.

- [x] **Lot 4 — Property, ownership, market, and context spikes**
  - [x] Investigate Cadastre/Infolot and Registre foncier access/cost path.
  - [x] Investigate transactions immobilieres, JLR, and Centris/MLS feasibility
    and licensing blockers.
  - [x] Investigate StatCan and transport/infrastructure context sources.
  - [x] Record automation limits, legal/commercial blockers, and effort
    estimates.
  - [x] Lot gate: `git diff --check`.

- [ ] **Lot 5 — Consolidation**
  - [x] Consolidate all source rows in
    `docs/spec/SPEC_EVOL_SOURCE_FEASIBILITY.md`.
  - [x] Mark recommended BR07 vertical-slice sources and deferred sources.
  - [x] Update this plan with final evidence: 34 spike notes under
    `packages/radar-sources/src/sources/_spikes/**`.
  - [x] Lot gate: `make typecheck ENV=test-source-spikes`,
    `make lint ENV=test-source-spikes`, `make test ENV=test-source-spikes`,
    and `make build ENV=test-source-spikes`.

- [ ] **Lot 6 — PR and merge**
  - [ ] Push branch.
  - [ ] Open PR.
  - [ ] Verify CI green.
  - [ ] Merge via merge commit only.
  - [ ] Preserve source branch.
  - [ ] Move this file to `plan/done/05-BRANCH_feat-source-investigation-spikes.md`.
