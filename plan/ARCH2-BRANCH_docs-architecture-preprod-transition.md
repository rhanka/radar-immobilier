# Feature: Record the preproduction object-storage cutover

## Objective
- [x] Update the architecture dossier and monthly artifacts with the accepted preproduction T2 evidence while preserving the immutable BEFORE capture and complete AFTER target.

## Scope / Guardrails
- [x] Documentation and its committed renderer only; no live-cluster, application or cross-repository mutation.
- [x] Worktree: `tmp/architecture-preprod-transition`, branch `docs/architecture-preprod-transition`, based on `origin/main` merge `7786daf0`.
- [x] Commands through Make; environment argument last; no application stack started.
- [x] Root checkout remains unchanged.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `docs/architecture/**`
  - `docs/reports/architecture-monthly/**`
  - `plan/ARCH2-BRANCH_docs-architecture-preprod-transition.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`, `docker-compose*.yml`, `rules/**`
  - `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`, `.track/**`
  - Other branch plans; application, infrastructure and other repositories.
- **Conditional Paths**:
  - None.

## Feedback Loop
- [x] Treat the supplied runtime evidence as authoritative for this dated transition update.
- [x] Keep production T2 in progress, T3 gated and SCW TEM retained.
- [x] Keep exactly two primary Focus graphs: immutable BEFORE and complete AFTER.
- [x] Independent review incomplete: both eligible Claude-hosted h2a launches were policy-rejected before execution; no verdict claimed.

## Orchestration Mode (AI-selected)
- [x] Single documentation branch; no additional delegated implementation.

## UAT Management (in orchestration context)
- [x] Standalone local Focus/browser checks; existing application UAT remains untouched.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline and scope.**
  - [x] Read required rules and harness entry point.
  - [x] Create the isolated repository-local worktree from `origin/main` at `7786daf0`.
- [x] **Lot 1 — D8 decision and transition sources.**
  - [x] Record exact preproduction parity, MinIO removal, retained migration PVC, quota delta, service health and TEM exception.
  - [x] Keep production T2 explicitly in progress and T3 gated.
- [x] **Lot 2 — Focus contract and regression coverage.**
  - [x] Update owner-facing presentation, summary and response JSON facts.
  - [x] Keep only `asis-1` and `target-3`; verify complete icons, repo provenance and nested subflows.
- [x] **Lot 3 — Monthly artifacts and evidence.**
  - [x] Update the monthly Markdown and regenerate portable HTML, report HTML/PDF and evidence hashes.
  - [x] Pass Focus tests, browser/clipboard checks and PDF report gates.
- [ ] **Lot 4 — Review and handoff.**
  - [x] Verify scope and atomic commit limits.
  - [ ] Push the branch and open a PR; report exact commits and gates.
