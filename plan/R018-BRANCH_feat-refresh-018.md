# Feature: Complete the existing Graphify 0.18 Kubernetes refresh

## Objective
- [ ] Deliver autonomous PV-to-typed-Signal refresh with exact PDF evidence, reusing i-cond's existing work.

## Scope / Guardrails
- [x] Worktree `tmp/refresh-018`, branch `feat/refresh-018`, base `097036783006226afea53a6b49383bf70890774f`.
- [x] Make-only, Docker-first; preserve root UAT and all existing lanes.
- [x] Test environment `test-refresh-018`; API_PORT=8881 UI_PORT=5381 MAILDEV_UI_PORT=1181. Check port ownership before starting services; no root dev services.
- [x] No credentials in reports, prompts, logs or Git; no production writes by delegates.
- [x] Graphify 0.18.0 is published; direct Immo chat mesh migration and a new network mesh service are out of scope.

## Branch Scope Boundaries (MANDATORY)
- [x] Allowed: `plan/R018-BRANCH_feat-refresh-018.md`, `docs/spec/SPEC_EVOL_REFRESH_018.md`, `docs/reviews/refresh-018/**`.
- [x] Design phase only: no application, dependency, deployment or workflow edits until the conductor releases the reviewed build scope.
- [x] Forbidden: root `Makefile`, `docker-compose*.yml`, `rules/**`, agent entrypoints, `.track/**`, other branch plans, other repositories.
- [x] Conditional: app/dependency/Kubernetes paths require a file-level build scope in this plan; infra operations require conductor coordination.

## Feedback Loop
- [x] Owner routing: Astra design, Gemini 3.8 High pre-build review via h2a run agy, Sol xhigh build, Gemini 3.8 High post-build review. This is the requested review circuit, not a claim of the skill's two-host consensus.
- [x] Report to `codex:radar-immobilier:98cef8dfc274`, loop `loop:immo-transitions-2026-09-13`; do not mark the overall loop done.

## Orchestration Mode (AI-selected)
- [x] One writer at a time; design, review and build are separate bounded mandates.

## UAT Management
- [x] No root checkout switch or root UAT mutation by delegates.

## Plan / Todo (lot-based)
- [x] Lot 0: identify exact existing consumer/runner/canonical writer/projection/3.4 contracts and reusable CAS work; evidence and decisions in `docs/spec/SPEC_EVOL_REFRESH_018.md`.
- [x] Lot 1: deliver numbered continuation decisions, proposed exact build paths/commit caps and acceptance gates in `docs/spec/SPEC_EVOL_REFRESH_018.md` and `docs/reviews/refresh-018/build-handoff.md`; static design only.
- [x] Lot 1 gate: report first design handoff through h2a for independent Gemini review; package, typed Signal/PDF and scheduled-run acceptance remain unexecuted.
- [ ] Scope release: conductor reconciles Gemini findings and releases the exact C01–C25 paths from `docs/reviews/refresh-018/build-handoff.md`; no build permission is implied by this proposal.
- [ ] Lot 2: Gemini independent design review and conductor reconciliation.
- [ ] Lot 3: Sol builds the released scope with isolated tests and atomic commits.
- [ ] Lot 4: Gemini independent post-build review; fix verified findings.
- [ ] Lot 5: conductor-controlled preprod end-to-end and scheduled refresh acceptance, then gated production promotion.
- [ ] Lot 6: synchronize architecture reference and monthly evidence with actual transition state.

## Merge / Close
- [ ] CI and live acceptance evidenced; conductor integrates by merge commit only, preserving branch history.
