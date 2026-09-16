# Feature: Gemini medium production refresh

## Objective
Prepare #703 production PV refresh with Gemini 3.8 Flash medium and measured acceptance.

## Scope / Guardrails
- Existing conductor worktree and branch only; no production mutation or merge.
- Make-only, container execution; no credentials in output or artifacts.
- Test environment: test-mep-703; API 8873, UI 5373, Maildev 1173.
- English source/docs; owner requires French PR/report and no commit trailers.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `api/package.json`, `package-lock.json`
  - `api/src/scripts/refresh-pv.ts`
  - `api/src/services/graph/refresh-*.ts`
  - `deploy/k8s/34-refresh-cronjob.yaml`
  - `deploy/k8s/refresh-cronjobs*/**`
  - `docs/reviews/refresh-703/**`
  - `plan/R703-BRANCH_feat-refresh-mep-gemini.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`, `docker-compose*.yml`, `rules/**`
  - `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`
  - Other branch plans
- **Conditional Paths**:
  - `.github/workflows/**`

## Feedback Loop
- [x] BR703-EX1: fix production promotion image pin and refresh status in build-push-images.yml; required to deploy the accepted digest, rollback by reverting those hunks.
- [x] Current kube context is Scaleway; OVH geo identity cannot inspect Immo. Production observations must identify their cluster.
- [x] Production handoff documents tag/variable gates and missing OVH inventory access; no production mutation.

## Orchestration Mode (AI-selected)
- [x] Single existing branch; independent review only, no delegated implementation.

## UAT Management (in orchestration context)
- [x] No UI change; root UAT untouched.

## Plan / Todo (lot-based)
- [x] Lot 0 — Rules, baseline and deployment path inspected.
- [x] Lot 1 — Runtime dependency, Gemini medium defaults and regression tests authored.
- [x] Lot 2 — Only causal production schedule armed; quota-compatible resources; immutable CD pin.
- [ ] Lot 3 — Scoped tests, render assertions, harness gates and independent review.
  - [x] 19 mesh/state tests pass; exact tiered wire model, MEDIUM and 32768 asserted.
  - [x] Overlay regression checks require only PV active, Gemini defaults and production memory limit.
- [x] Lot 4 — Real Gemini cycle: document acceptance 1/1, 11 PG nodes, zero explicit Signal nodes; v2 receipt and infrastructure boundary recorded.
- [ ] Lot 5 — Push, French PR with Refs #703 and replacement of #682; CI checked.
- [ ] Merge and production activation reserved to conductor and k8s owner.
