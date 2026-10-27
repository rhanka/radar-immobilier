# Feature: Preprod cutover tooling blockers

## Objective
- [x] Fix CRD-free closure and full API build identity; no push or live activation.

## Scope / Guardrails
- [x] Worktree `tmp/bascule-fix`; no environment files, Python or cluster writes.
- [x] Host shell tests and offline rendering only; no Docker stack required.
- [x] Standalone Make entrypoint; `ENV=test-bascule-fix` last.
- [x] Shared Git metadata is read-only; local backup repository and audited bundle.
- [x] Commits at most 150 changed lines, subject only, at most 72 characters.

## Branch Scope Boundaries (MANDATORY)
- [x] Allowed Paths: `tools/make/bascule-fix*`, `tools/make/base-preprod*`, `deploy/base-preprod/*`, `deploy/ci/check-release-sha.test.sh`, `deploy/ci/rollback-release*`, `api/Dockerfile`, `.github/workflows/build-push-images.yml`, `docs/spec/BASE_API_ACTIVATION.md`, this plan, `RAPPORT-SOL-BASCULE-FIX.md`.
- [x] Forbidden Paths: root `Makefile`, Compose, rules, other plans, app/domain code.
- [x] Conditional Paths: none beyond explicitly authorized build workflow/Dockerfile.

## Feedback Loop
- [x] BASCULEFIX-EX1: user authorizes build workflow edits; tags remain short; revert workflow/Dockerfile together to undo.
- [x] User requires subject-only commits and French report, overriding trailer/language defaults.

## Orchestration Mode (AI-selected)
- [x] Single branch; isolated backup Git metadata.

## UAT Management (in orchestration context)
- [x] No UI change or root UAT; qualification of live preprod is a separate operation.

## Plan / Todo (lot-based)
- [x] Lot 0: read constraints and complete previous operator report.
- [x] Lot 1: close all Ingress backends without CRDs; retain exact restoration and survivor guards.
- [x] Lot 2: stamp full API SHA; preserve short tags and served-build/rollback guards.
- [x] Lot 3: operator regressions, workflow guards, offline kustomize rendering.
- [x] Lot 4: manual review and unavailable peer selection recorded; report, commit audit and verified bundle; no push.
- [x] Astra lot 0: read both PR #929 reviews completely; fixes start at `76636465`, no push.
- [x] Astra lot 1: qualification uses checkout Git and source fingerprints, independently of delivery metadata.
- [x] Astra lot 2: restore only the saved closed state with UID/resourceVersion preconditions.
- [ ] Astra lot 3: control alternate routes, exposed ports and enforced consumer pod isolation; otherwise refuse.
- [ ] Astra lot 4: regression evidence, report correction section and audited incremental bundle.
