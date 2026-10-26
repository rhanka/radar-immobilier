# Chore: qualify cluster-mesh 0.22.1 on artifacts A5

## Objective
- [x] Upgrade only cluster-mesh to 0.22.1 and preserve the qualified A5 behavior.

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
- [x] Lot 1: published archive verified before installation; `20261026T140119-18/upgrade-integrity.json`.
- [x] Lot 1: exact 0.22.1 pin; two lock entries, four replaced lines; strict full-lock comparison and audit gate pass.
- [x] Lot 1: common-v1 accepts comments/engram-live and rejects engram-memory/future modules; zero integration references in 1,485 files (`20261026T140259-18`).
- [x] Qualification preflight: correct the lock verifier's ESLint global reference; retain the full-lock equality assertion.
- [x] Extend occupancy guards to the observed foreign E2 qualification stack; guard both memory and disk at 8 GiB.
- [x] Include every test/e2e stack service in the guard after observing E2 PostgreSQL alongside qualification clients; preserve all completed application proofs.
- [x] Guard controls: E2 intrusion and low memory pass with status 143 and zero owned resources (`intrusion-control.gD4Yye`, `memory-control.wSuqsb`).
- [x] Lot 2: Q1/Q2/acceptance 31/32/6; PostgreSQL/S3 21/21 before/after 20 killed mutants; `20261026T145859-18`, source c702cbd9.
- [x] Lot 2: API 3938 passed/76 pending, MCP 401/401, host 165/165; `20261026T152506-18`, source 0c783559; product diff from c702cbd9 is empty.
- [x] Lot 2: typecheck (zero errors, seven Svelte warnings), lint, API build, 66 audit tests, audit gate and two authority mutants pass.
- [x] Lot 2: HTTP exchange 1/1; `20261026T154219-18`; same committed source.
- [x] Lot 2: sixteen-tool image f691e3fe, source 0c783559; SQL/S3, restart/replay, ordered conflict and revocations pass; `20261026T154322-18`.
- [x] Lot 2: image and full-suite source archives are byte-identical; two foreign intrusions caused clean aborts, then all remaining suites completed.
- [x] Lot 3: atomic commits and pre-close bundle audited from sole 4660e201 prerequisite in fresh `mesh-0221-bundle-audit.Jb4OrZ`; re-anchor this documentation-only commit with the same audit.
- [x] Lot 3: French companion report records exact proofs and final delivery identity outside history, including the final bundle digest; no push.
