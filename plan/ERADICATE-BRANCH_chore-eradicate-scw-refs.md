# Chore: Eradicate decommissioned infrastructure references

## Objective
Remove dead provider-specific infrastructure paths from the repository, switch container images to the verified GHCR path, and inventory every unresolved storage dependency without changing the running OVH production configuration.

## Scope / Guardrails
- Scope is limited to repository references identified by the owner brief.
- No changes to another lane, repository, live cluster, secret, bucket, or registry setting.
- Unknown OVH values remain unchanged and are recorded as explicit follow-ups.
- Make-only workflow; no direct Docker commands.
- Root workspace is reserved for user dev/UAT and remains stable.
- Work runs in `tmp/eradicate-scw-refs` from `origin/main` at `831cad2`.
- Automated checks use `ENV=test-eradicate-scw`; never `ENV=dev`.
- In every `make` command, `ENV=<env>` is the last argument.
- All new repository text is English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `.remote/ERADICATE_SCW_INVENTORY.md`
  - `.remote/ERADICATE_REVIEW*.md`
  - `.github/workflows/**`
  - `.env.example`, `.gitignore`, `README.md`, `Makefile`
  - `api/**`, `deploy/**`, `docker-compose*.yml`
  - `packages/radar-sources/**`, `radar/ontology/**`, `scripts/**`, `tools/**`, `ui/**`
  - `docs/**`, `rules/**`
  - `plan/ERADICATE-BRANCH_chore-eradicate-scw-refs.md`
- **Forbidden Paths (must not change in this branch)**:
  - `.track/**`
  - `.agents/**`, `.h2a/**`, `.lanes/**`, `tmp/**`
  - `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`
  - `plan/NN-BRANCH_*.md` and `plan/done/**`
- **Conditional Paths**:
  - Production storage endpoint, region, bucket, credentials, and mail provider require verified values from k8s/infra.
- **Exceptions**:
  - `ERADICATE-EX1`: `Makefile`, Compose files, workflows, and `rules/**` are explicitly in the owner-mandated residue sweep. Impact is limited to removing obsolete provider wiring; rollback is a revert of the affected commit.

## Feedback Loop
- A missing verified OVH value is recorded in the inventory with owner `k8s`; no placeholder is deployed.
- Any ambiguity that affects the running OVH production path is classified C and left unchanged.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch**
- [ ] **Multi-branch**
- Rationale: one repository-wide consistency change with a single final verification cycle.

## UAT Management
- No UI behavior changes are planned; UAT is not required.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline and constraints**
  - [x] Read the owner brief and mandatory project, workflow, source, testing, security, and harness instructions.
  - [x] Create the isolated branch worktree from `origin/main` at `831cad2`.
  - [x] Run the requested tracked-file inventory and verify the live OVH cluster evidence.
  - [x] Confirm GHCR package visibility and the successful build for `831cad2`.
- [x] **Lot 1 — Remove dead infrastructure paths**
  - [x] Delete provider-only workflows, mount helpers, one-shot manifests, and retired MinIO manifests/policies while preserving the live cluster MinIO network path.
  - [x] Remove the retired transactional-email transport while preserving invitation-link log mode.
- [x] **Lot 2 — Replace verified image registry references**
  - [x] Make GHCR the build/push source of truth.
  - [x] Rewrite deploy image references to the verified public GHCR packages.
  - [x] Run scoped workflow and manifest validation.
- [x] **Lot 3 — Inventory and current documentation**
  - [x] Reword active documentation that presents retired infrastructure as current.
  - [x] Record A/B/C baseline locations, actions, evidence, and missing OVH values.
  - [x] Preserve immutable history and ambiguous functional local-test references as classified entries.
- [x] **Lot 4 — Verification and delivery**
  - [x] Run the repository-wide residue sweep and review every remaining match.
  - [x] Run the full validation gates (local offline k8s validation passed; GitHub CI passed Compose validation, k8s validation, typecheck, lint, build, UI smoke, and unit/integration tests after the shared local Docker address pools blocked container startup).
  - [x] Run harness scope/branch verification and independent consensus review (Opus correctness + Sonnet safety); reconcile all findings to GO.
  - [x] Push `chore/eradicate-scw-refs` and open PR #670 to `main`.
  - [x] Verify CI green; preserve the branch after merge.
