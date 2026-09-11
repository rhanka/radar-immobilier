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
  - MinIO decommissioning is gated: OVH bucket provisioned → objects migrated → clients repointed; the remaining `radar-minio` references are kept on purpose. The MinIO manifests (`25-minio.yaml`, network policies `71-*`/`72-*`, their `kustomization.yaml` entry) are RETAINED in this PR (reverted to `831cad2` on 2026-09-11); their removal is the LAST step, in a future PR B gated on the OVH bucket (see inventory "Séquencement — décom MinIO"). This PR stays DRAFT (merge hold).
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
  - [x] Delete provider-only workflows, mount helpers and one-shot manifests while preserving the live cluster MinIO network path.
  - [x] MinIO manifests (`25-minio.yaml`, network policies `71-*`/`72-*`, `kustomization.yaml` entry, README table row): RETAINED (k8s + i-infra sequencing, endorsed by the conductor 2026-09-11). The initial deletion was reverted to the `831cad2` state; removal is the LAST decom step, in a future PR B gated on the OVH bucket (provisioned → objects migrated → clients repointed).
  - [x] Transactional-email transport: RETAINED (owner decision 2026-09-11). The initial removal was reverted to the `831cad2` state (SCW TEM schema, resolver, mailer + tests, ConfigMap/secretKeyRef, example Secret); invitation-link log mode is unchanged from main. Removal deferred until i-infra proposes a replacement provider and the owner validates it.
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
  - [x] Run harness scope/branch verification and two independent Opus-correctness/Sonnet-safety review pairs; reconcile all findings to GO.
  - [x] Push `chore/eradicate-scw-refs` and open PR #670 to `main`.
  - [x] Verify CI green; preserve the branch after merge.
