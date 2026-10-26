# Chore: qualify cluster-mesh 0.22.1 on artifacts A5

## Objective
- [ ] Upgrade only cluster-mesh to 0.22.1 and preserve the qualified A5 behavior.

## Scope / Guardrails
- [x] Base: `4660e201864c8678ddf249e5255d050c17bf0296`; branch: `feat/artefacts-mcp-a5-mesh`.
- [x] Assigned repository-local worktree; Make-only, container execution, no Python or environment-file reads.
- [x] Environment: `test-artefacts-a5m`; API/UI/Maildev: `18925/15925/11925`; ENV last.
- [x] One Docker campaign/build at a time; wait for foreign radar-test stacks/builds and stop below 8 GiB free.
- [x] Owned-resource teardown uses `down -v --remove-orphans`; no push or deployment.
- [x] Local delivery repository; English Conventional Commits, no body/trailer, at most 150 changed lines.

## Branch Scope Boundaries (MANDATORY)
- [x] Allowed Paths: `packages/immo-mcp/package.json`, `package-lock.json`, `tools/make/artefacts-a5*`, this plan.
- [x] Allowed Paths: companion `RAPPORT-SOL-A5-MESH.md` and ignored evidence under `tmp/a5-evidence/`.
- [x] Forbidden Paths: root Makefile, compose files, rules, agent bootstrap, other plans, application code, migrations, Track, security exceptions.
- [x] Conditional Paths: none; any unexpected dependency change blocks delivery.

## Feedback Loop
- [x] Owner instruction explicitly replaces the normal commit trailer and remote delivery requirements.
- [x] Existing standalone Make entrypoint avoids the environment-loading root Makefile.
- [x] BR-A5M-EX1: adapt only the A5 delivery/qualification helpers to this base, branch and environment; runtime unchanged; rollback by restoring helpers from the base.

## Orchestration Mode (AI-selected)
- [x] Single writer and sequential Docker campaigns under the existing machine lock and occupancy monitor.

## UAT Management (in orchestration context)
- [x] Synthetic isolated qualification only; no UI change or root UAT operation required.

## Plan / Todo (lot-based)
- [x] Lot 0: inspect mandatory rules, A5 reference report, CI test selection and assigned branch/base.
- [x] Lot 0: bind delivery helpers and isolated runner to the mesh task.
- [ ] Lot 1: verify published archive integrity before container installation.
- [ ] Lot 1: exact 0.22.1 pin; lockfile changes only MCP workspace and cluster-mesh package entry.
- [ ] Lot 1: prove frozen common-v1 contents and absence of Radar integration references.
- [ ] Lot 2: Q1/Q2/acceptance 31/32/6, MCP and CI-selected API suites.
- [ ] Lot 2: typecheck, lint, build, audit tests and audit gate.
- [ ] Lot 2: actual sixteen-tool runtime image, durable SQL/S3, replay/restart and revocation proofs.
- [ ] Lot 3: audit atomic commits and bundle from the sole 4660e201 prerequisite in a fresh repository.
- [ ] Lot 3: record exact evidence, delivered SHA, bundle path and SHA-256 in the French companion report.
