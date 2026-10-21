# Feature: H4 P3 embedded configuration and registry definitions — 861c

## Objective
Prepare the data-and-contracts slice of P3: versioned Immo provider and artifact configuration plus local registry validation, without the cluster-mesh compiler integration.

## Scope / Guardrails
- English code, tests and identifiers; no Python; never read `.env`.
- No `@sentropic/*` dependency added or updated; no central-registry request.
- No test capture used as production configuration; non-secret values and opaque references only.
- Isolated tooling only: `tools/immo-mcp-test.mk` (unchanged); root `ENV=dev` stays reserved for the user.
- Every commit stays within 150 changed lines and 15 files, including its plan update.
- Integration uses `ENV=test-861c-h4-p3` with no published ports; API/UI/Maildev ports are not used.
- Shared Git metadata stays read-only; commits and the delivery bundle live under `tmp/861c-h4-p3/`.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `plan/861C-BRANCH_feat-861c-h4-p3-embedded-config.md`
  - `packages/immo-mcp/config/immo-tools.v1.json`
  - `packages/immo-mcp/config/immo-artifacts.v1.json`
  - `packages/immo-mcp/src/registry/**`
  - `RAPPORT-MUSE-H4-P3.md` (uncommitted deliverable)
  - `RAPPORT-SOL-H4-P3.md`, `tmp/861c-h4-p3/**` (uncommitted integration evidence)
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `rules/**`
  - `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`
  - `plan/NN-BRANCH_*.md` (except this branch file)
  - `api/**`, `packages/artifacts-host/**`, `packages/immo-mcp/src/tools.ts`
  - `packages/immo-mcp/src/fixtures/**`, `packages/immo-mcp/package.json`, `package-lock.json`
  - `tools/**`, `deploy/**`, upstream `@sentropic/*` sources
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - None in this branch.
- **Exception process**:
  - Declare exception ID `BRxx-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.
  - Include reason, impact, and rollback strategy.

## Feedback Loop
- Compiler integration (last P3 commit unit) stays parked: it waits for published Sentropic packages with capability selection, effective profiles, finalization authorization and typed-failure contracts.
- Required provider-contract revisions are recorded as `pending-upstream` in config and tests; no compatible export is claimed.
- Integration inspection found two TypeScript errors and thirteen failing regression cases; corrections remain inside registry scope.
- Harness consensus review is `selection-failed`: the handoff lacks supported author host/model/effort metadata; no consensus is claimed.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch** (no history copying; local commits and base-relative bundle)
- [ ] **Multi-branch** (only if sub-workstreams require independent CI or long-running validation)
- Rationale: data-and-contracts slice only, no parallel validation needed.

## UAT Management (in orchestration context)
- No UI surface impacted; no UAT session required.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline and constraints**
  - [x] Read `conception-h4-v3.md` P3 scope and acceptance.
  - [x] Read `plan/BRANCH_TEMPLATE.md`, reference branch plans and immo-mcp sources.
  - [x] Confirm scope and guardrails; no `BRxx-EXn` exception required.
- [ ] **Lot 1 — Immo provider definition and tools config**
  - [x] `src/registry/immo-provider.ts`: twelve locked names, scopes, bindings.
  - [x] `config/immo-tools.v1.json`: versioned embedded twelve-tool configuration.
  - [ ] Lot gate: `typecheck` + `lint` + full `test-immo-mcp` on `ENV=test-861c-h4-p3`.
- [ ] **Lot 2 — Artifact effective profile and selection config**
  - [x] `src/registry/artifact-profile.ts`: four-tool selection, input bounds, caller key, durable identity, required contract revisions.
  - [x] `config/immo-artifacts.v1.json`: versioned embedded artifact configuration.
  - [ ] Lot gate (same checklist as Lot 1).
- [ ] **Lot 3 — Local registry validation and digest freeze**
  - [x] `src/registry/mcp-registry.ts`: provider, tool, scope and contract validation.
  - [x] `src/registry/composition.ts`: detached frozen candidate and binding-aware digest.
  - [x] `src/registry/index.ts`: public re-exports.
  - [ ] Lot gate (same checklist as Lot 1).
- [ ] **Lot 4 — Compatibility tests**
  - [x] `src/registry/immo-provider.test.ts`: provider and embedded-config parity.
  - [x] `src/registry/artifact-profile.test.ts`: effective-profile parity and bounds.
  - [ ] `src/registry/mcp-registry.test.ts`: local registry refusal cases.
  - [ ] `src/registry/artifact-activation.test.ts`: artifact activation guards.
  - [ ] `src/registry/validation-regressions.test.ts`: integration regression cases.
  - [ ] `src/registry/binding-parity.test.ts`: twelve actual handler seams and scopes.
  - [ ] Lot gate (same checklist as Lot 1).
- [ ] **Lot 5 — Integration evidence and delivery**
  - [ ] Mutate copies: removed tool, duplicate name, missing finalization and missing error binding; require refusals, restore and `cmp`.
  - [ ] Audit dependencies, secrets, network-free registry and forbidden paths.
  - [ ] Teardown with `down -v`; verify zero remaining project resources.
  - [ ] Produce uncommitted `RAPPORT-SOL-H4-P3.md` and base-relative bundle.
- [ ] **Lot 6 — Merge and close**
  - [ ] Push branch (excluded from this integration assignment).
  - [ ] Open PR, verify CI green.
  - [ ] Merge commit (NO squash, NO rebase merge).
  - [ ] Preserve branch (DO NOT delete on merge).
  - [ ] Move this file to `plan/done/861C-BRANCH_feat-861c-h4-p3-embedded-config.md`.
