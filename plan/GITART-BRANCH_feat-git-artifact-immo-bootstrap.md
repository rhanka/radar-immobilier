# Feature: Git-backed artifacts, immo-side bootstrap (OP2, OP1/P7)

## Objective
- [ ] Deliver the immo prerequisites of G0 v3: root descriptor and `build:artifact`, artifact-ref CI exclusion and protected-environment guards, the A1 registry note for the sentropic builder, and their tests.

## Scope / Guardrails
- [x] Branch `feat/git-artifact-immo-bootstrap` from `origin/main`; one PR, one commit per wagon.
- [x] Make-only container execution; `ENV=test-git-artifact`; every stack removed with `down -v`.
- [x] No Python, no `.env` read, no secret, no cluster action, no repository-setting change.
- [x] `PREPROD_CD_ENABLED` and `BASCULE_SCHEDULE_ENABLED` gates untouched; #926, DB cutover and PG18 untouched.
- [x] Commits carry no attribution trailer.
- [x] CI never builds or publishes artifacts; the builder is the sentropic server-side sandbox.

## Branch Scope Boundaries (MANDATORY)
- [x] Allowed Paths: `sentropic.artifact.json`, `package.json` (root `scripts` only).
- [x] Allowed Paths: `tools/make/git-artifact*`, `docs/spec/SPEC_ARTIFACT_UI_PUBLISH.md`, `docs/operator/git-artifact-*`, this plan.
- [x] Conditional Paths: `Makefile` (BRGITART-EX1), `.github/workflows/**` (BRGITART-EX2).
- [x] Forbidden Paths: `docker-compose*.yml`, `rules/**`, agent bootstrap files, other branch plans, `package-lock.json`.

## Feedback Loop
- [x] BRGITART-EX1 `Makefile`: `build-ui-artifact` delegates to `npm run build:artifact` so the artifact variables have one source. Impact: same variables, same container. Rollback: restore the previous `-e` list.
- [x] BRGITART-EX2 `.github/workflows/**`: P7 artifact-ref exclusion and protected-environment ref guards only. Rollback: revert the wagon commit.
- [x] clarification: conductor narrowed the A1 writable set to `ui/**` and `packages/radar-{domain,scoring,sources}/src/**`, refusing `packages/immo-mcp/**`.
- [x] refuse: owner removed the CG6 CI publish workflow; the A1 set is a registry note for the sentropic builder, with no workflow behind it.

## Orchestration Mode (AI-selected)
- [x] Mono-branch train; the three wagons share one checkout and one CI cycle.

## UAT Management (in orchestration context)
- [x] No UI behaviour change; app build proved byte-identical; no root UAT mutation.

## Plan / Todo (lot-based)
- [x] Lot 0: Read rules and G0 v3 §2.1, §3.1, §4, §5 P7, §7, §8.
- [x] Lot 1 (OP2): root descriptor, root `build:artifact`, Makefile delegation, clean-container proof tooling.
- [x] Lot 1 (OP2): `build:artifact` runs with an allowlisted VITE_* environment and refuses ui/.env* (review F1).
- [x] Lot 1 (OP2): proof run: clean install + build pass, app build byte-identical to origin/main, closure measured.
- [ ] Lot 2 (OP1/P7): artifact-ref exclusion on push/pull_request workflows; protected-environment ref guards; A1 registry note.
- [ ] Lot 3: descriptor, pre-flight and workflow-guard tests through `make -f tools/make/git-artifact.mk test`, wired in CI.
- [ ] Conductor: environment branch policies via `gh api`, CI, merge with a merge commit.
