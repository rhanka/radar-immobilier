# Feature: Artifacts provider 0.2.17 and application content mode

## Objective
Pin `@sentropic/artifacts@0.2.17` and serve immo artifacts with the provider's application content mode (CSP and extension MIME map from the package), removing the immo-local copies added in #1008.

## Scope / Guardrails
- Scope limited to the provider pin, provider qualification lists and the immo release-file CSP/MIME seam.
- No DB migration.
- Make-only workflow, no direct Docker commands.
- Root workspace `~/src/radar-immobilier` is reserved for user dev/UAT (`ENV=dev`) and must remain stable.
- Branch development happens in `./tmp/artifacts-0217-app-mode`.
- Automated tests run on `ENV=test-art0217` / `ENV=e2e-art0217`, never on `dev`.
- In every `make` command, `ENV=<env>` is the last argument.
- All new text in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `package.json`, `package-lock.json`
  - `packages/artifacts-host/src/**`
  - `packages/immo-mcp/config/**`, `packages/immo-mcp/src/registry/**`
  - `api/src/artifacts/**`, `api/tests/**`
  - `tools/mcp-p0b.mk`, `tools/mcp-p0b-candidate.sh`
  - `docs/spec/SPEC_ARTIFACT_UI_PUBLISH.md`
  - `plan/ART0217-BRANCH_feat-artifacts-0217-app-mode.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `rules/**`
  - `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`
  - `plan/NN-BRANCH_*.md` (except this branch file)
  - `.github/workflows/bascule-*`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `api/drizzle/*.sql` (none in this branch)
  - `.github/workflows/**`
- **Exception process**:
  - Declare exception ID `ART0217-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.

## Feedback Loop
- `attention`: the 0.2.17 npm package ships the content mode and the MIME map only. The generic grant contract (J1.3b route, neutral screen, typed 403 with `scopeId`) and the OAuth job fix live in the sentropic application (PR #930), not in the package; immo keeps its own #1009 consent screen.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (default for orthogonal tasks; single final test cycle)
- [ ] **Multi-branch** (only if sub-workstreams require independent CI or long-running validation)
- Rationale: one small dependency bump plus one serving seam.

## UAT Management (in orchestration context)
- No UI surface change; UAT not required for this branch.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read `rules/MASTER.md` and pointers.
  - [x] Create worktree `./tmp/artifacts-0217-app-mode` from `origin/main`.
  - [x] Read #1008, #1009, #1011, #1012 and the 0.2.17 package (CHANGELOG, typings, runtime diff vs 0.2.16).

- [ ] **Lot 1 — Provider pin 0.2.17**
  - [x] Pin `@sentropic/artifacts` 0.2.17 in `package.json` and the lockfile (`make install`).
  - [x] Qualify 0.2.17 in the P0b/strict provider lists, profile configs and the P0b Make tooling.
  - [ ] Lot gate: `make typecheck`, `make lint`, scoped `make test-api` / package tests.

- [ ] **Lot 2 — Application content mode from the provider**
  - [ ] Build the release CSP from `contentHeaders({ mode: "application", scriptHashes })` and `APPLICATION_HTML_CSP`.
  - [ ] Resolve release content types through the provider `mimeTypeForPath`.
  - [ ] Delete the immo-local CSP literal and extension map.
  - [ ] Lot gate: `make typecheck`, `make lint`, `make test-api SCOPE=src/artifacts`, artifacts integration specs.

- [ ] **Lot N — Final validation**
  - [ ] Push branch and open the PR to `main`.
