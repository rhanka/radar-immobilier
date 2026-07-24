# Feature: Graphify 3.4 foundation — Filter A goldens + InputSet contract + gate

## Objective
Freeze the pre-3.4 HEAD behaviour of legacy Filter A (`z|m|p`) and land the
canonical InputSet contract + an anti-regression gate, WITHOUT any materializer,
S3/LLM I/O, or cutover. Pure foundation: an exact HEAD inventory, faithful
goldens of the real A display path, the InputSet schema + canonical hash, and a
Make-driven gate.

## Scope / Guardrails
- Scope limited to test/contract/docs/scripts — no runtime A/B/vivier code change.
- No materializer, no S3/object-store I/O, no LLM call, no cutover, no pointer update.
- One migration max in `api/drizzle/*.sql` (not used here).
- Make-only workflow, no direct Docker/npm/npx commands.
- Root workspace is reserved for user dev/UAT (`ENV=dev`) and must remain stable.
- Branch development happens in repository-local `./tmp/graphify-3-4-foundation`.
- Automated tests run on `ENV=test-graphify34foundation`, never on root `dev`.
- In every `make` command, `ENV=<env>` is passed as the last argument.
- All new text in English. Discussions with the user may be in French.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `api/src/services/graph/replay/**` (InputSet contract + canonical JSON)
  - `api/src/services/graph/legacy-filter-a-golden.test.ts`
  - `api/tests/fixtures/graphify/legacy-filter-a/**`
  - `ui/src/lib/signals/legacy-filter-a-golden.test.ts`
  - `ui/src/lib/signals/fixtures/legacy-filter-a-*.json`
  - `scripts/graphify-legacy-a-gate.sh`
  - `docs/reports/consensus/**`, `docs/reports/geo-handoff/**`
  - `plan/GRAPHIFY34FND-BRANCH_feat-graphify-34-foundation.md` (this file)
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `rules/**`
  - `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`
  - `plan/*-BRANCH_*.md` (other branches)
  - any runtime A/B/vivier source (`vivier-view-mode.ts`, `graph-store.ts`,
    `graph-signals.ts`, `vivier-v2.ts`, `graph-signal-filter.ts`)
- **Conditional Paths (allowed only with explicit exception)**:
  - `api/drizzle/*.sql` (max 1 file)
  - `.github/workflows/**`
- **Exception process**:
  - Declare exception ID `BRxx-EXn` in `## Feedback Loop` before touching any
    conditional/forbidden path. Include reason, impact, and rollback strategy.

## Feedback Loop
- `attention` — SQL order decision: `getSignalNodesForCity` (`graph-store.ts:1528`)
  has no `ORDER BY`; the end-to-end A display order is NOT DB-guaranteed. This lot
  does NOT add an `ORDER BY` (that is a runtime change, out of foundation scope);
  it documents the absence honestly and the goldens pin only deterministic
  in-memory order (input-preserving server-side, authority-driven client-side).
- `attention` — commit-size note: the doc-restoration commits (`5f036a5`) exceed
  150 lines because each restores a single large design artifact (one logical
  change per file); corrective commits in this remediation stay atomic ≤150 lines.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (default for orthogonal tasks; single final test cycle)
- [ ] **Multi-branch**
- Rationale: one cohesive foundation lot; no independent sub-workstreams or CI.

## UAT Management (in orchestration context)
- No UI surface change (goldens/fixtures/docs only) → no UAT round required.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read `rules/MASTER.md` and pointers.
  - [x] Confirm isolated worktree `./tmp/graphify-3-4-foundation`.
  - [x] Env mapping `test-graphify34foundation`; `ENV` passed last.
  - [x] Confirm scope/guardrails.

- [x] **Lot 1 — Exact HEAD inventory of legacy Filter A**
  - [x] Map server predicates/counters, routes, and the UI display path.
  - [x] State the SQL-order limitation honestly.

- [x] **Lot 2 — Faithful goldens of the real A display path**
  - [x] Server golden: membership, 8 legacy keys, input-order A projection, parity.
  - [x] UI golden: `projectNodesForVivierKey`/`projectLegacyVivierA` — members,
        authoritative ids, order, empty, 404/null, corrupt-authority fail-closed,
        corrupt-membership fail-closed, URL-state normalization.

- [x] **Lot 3 — InputSet contract (schema + canonical hash)**
  - [x] Resolvable `sourceManifestRef` (`source`/`runId`/`sha256` → `manifestKey`).
  - [x] Single validate+normalize+serialize entry (`serializeCanonicalInputSet`);
        `parseInputSet` returns canonical form; `computeInputsetHash` validates.
  - [x] Known-answer hash + tests permuting members AND tombstones and mutating
        every authority field.

- [x] **Lot 4 — Gate + discipline**
  - [x] `scripts/graphify-legacy-a-gate.sh` runs via `make test-api`/`make test-ui`.
  - [x] `git diff --check` clean; new docs in English; atomic commits ≤150 lines.
  - [x] Lot gate:
    - [x] `bash scripts/graphify-legacy-a-gate.sh ENV=test-graphify34foundation`
