# Feature: Artifacts provider 0.2.18 pin and provider MIME map

## Objective
Pin `@sentropic/artifacts@0.2.18` and resolve release content types through the provider extension map (`mimeTypeForPath` from the newly exported `server/mime` subpath), removing the immo-local extension table. The grant contract, git-backed artifact tooling and live tools shipped by 0.2.18 are NOT adopted here.

## Scope / Guardrails
- Scope limited to the provider pin, provider qualification lists, the immo release-file MIME seam and the #1014 review minors.
- No DB migration.
- Make-only workflow, no direct Docker commands.
- Root workspace `~/src/radar-immobilier` is reserved for user dev/UAT (`ENV=dev`) and must remain stable.
- Branch development happens in `./tmp/artifacts-0218`.
- Automated tests run on `ENV=test-art0218`, never on `dev`.
- In every `make` command, `ENV=<env>` is the last argument.
- All new text in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `package.json`, `package-lock.json`
  - `packages/artifacts-host/src/**`
  - `packages/immo-mcp/config/**`, `packages/immo-mcp/src/registry/**`
  - `api/src/artifacts/**`
  - `tools/mcp-p0b.mk`, `tools/mcp-p0b-candidate.sh`
  - `plan/ART0218-BRANCH_feat-artifacts-0218.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `rules/**`
  - `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`
  - `plan/NN-BRANCH_*.md` (except this branch file and exception ART0218-EX1)
  - `.github/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `api/drizzle/*.sql` (none in this branch)
  - `plan/ART0217-BRANCH_feat-artifacts-0217-app-mode.md` (ART0218-EX1)
- **Exception process**:
  - Declare exception ID `ART0218-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.

## Feedback Loop
- `ART0218-EX1`: fix the objective of `plan/ART0217-BRANCH_feat-artifacts-0217-app-mode.md` (review minor on #1014: the MIME map was kept local in 0.2.17).
- `attention`: the provider map carries bare media types; immo keeps the serving rule of `reader-storage` (`text/*` gets `charset=utf-8`, binary bare, `application/octet-stream` off-map). Equivalent for all 17 previously mapped extensions; `.avif`, `.ico`, `.woff`, `.ttf`, `.otf`, `.webm` now resolve to their provider type instead of octet-stream (in-memory test provider only; production serves the committed manifest type).
- `attention`: the provider catalogue grows from 24 to 35 tools; no immo test pins the provider catalogue count. The served definitions stay locked by `artifact-tool-definitions-hash.test.ts`.
- `attention`: the package migrations `0010_git_bindings.sql` and `0011_live_drafts.sql` shipped by 0.2.18 are intentionally NOT adopted: immo keeps its own `api/drizzle` migrations (provenance checked by `api/tests/integration/artifacts-provenance.spec.ts`), and the git/live tooling they back is not selected. Re-assess at the next provider pin.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (default for orthogonal tasks; single final test cycle)
- [ ] **Multi-branch** (only if sub-workstreams require independent CI or long-running validation)
- Rationale: one dependency bump plus one serving seam.

## UAT Management (in orchestration context)
- No UI surface change; UAT not required for this branch.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Create worktree `./tmp/artifacts-0218` from `origin/main`.
  - [x] Read #1014 and the 0.2.18 `server/mime` export.

- [x] **Lot 1 — Provider pin 0.2.18**
  - [x] Pin `@sentropic/artifacts` 0.2.18 in `package.json` and the lockfile (integrity `sha512-pCJ+q7Qn…xwxQ==`).
  - [x] Qualify 0.2.18 in the P0b/strict provider lists, profile configs and the P0b Make tooling.

- [x] **Lot 2 — Provider MIME map**
  - [x] Resolve `contentTypeForPath` through the provider `mimeTypeForPath`; delete the immo-local table.
  - [x] Lock the served types of every previously mapped extension in `release-files.test.ts`.
  - [x] Fix the #1014 plan objective (ART0218-EX1).

- [x] **Lot N — Final validation**
  - [x] Lot gate: `make typecheck`, `make lint`, api / artifacts-host / immo-mcp unit tests.
  - [x] Push branch and open the PR to `main` (#1015, merged).
