# Feature: Explicit preprod network isolation waiver

## Objective
- [x] Implement the conductor-authorized preprod waiver without changing other guards.

## Scope / Guardrails
- [x] Branch `fix/bascule-preprod-network-waiver` from `origin/main` at `c3054476`.
- [x] Repository-local isolated checkout; no shared Git mutation, push, cluster, Docker or environment files.
- [x] Make-only shell tests, `ENV=test-bascule-waiver` last; commits ≤150 lines, subject only.

## Branch Scope Boundaries (MANDATORY)
- [x] Allowed Paths: `tools/make/base-preprod-{network.sh,input.jq,maintenance.sh,network.test.sh,operator.test.sh}`, `docs/spec/BASE_API_ACTIVATION.md`, this plan, `RAPPORT-SOL-BASCULE-WAIVER.md`.
- [x] Forbidden Paths: root Makefile, Compose, rules, other plans, app/domain code and build workflow.
- [x] Conditional Paths: none.

## Feedback Loop
- [x] Owner/conductor authorizes only the preprod NetworkPolicy/CNI exception, recorded in owner input and receipts.
- [x] Subject-only commits and French report follow the explicit task instructions.

## Orchestration Mode (AI-selected)
- [x] Single branch in a normal isolated checkout with writable Git metadata.

## UAT Management (in orchestration context)
- [x] No UAT or operational activation; synthetic shell verification only.

## Plan / Todo (lot-based)
- [x] Lot 0: read the afternoon refusal report and branch from the requested main SHA.
- [x] Lot 1: validate the namespace/reference/reason and record a waiver without weakening other checks.
- [x] Lot 2: 266 hermetic operator cases pass, covering waiver receipts, namespace refusal, absence and preserved guards.
- [x] Lot 3: short report and atomic commit audit completed; bundle target verifies the incremental delivery by separate import.
