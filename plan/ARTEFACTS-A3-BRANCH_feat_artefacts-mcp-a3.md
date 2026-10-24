# Feature: H4 P5 strict API receiver

## Objective
- [ ] Qualify the existing #865 receiver on the A3 baseline without activating it.

## Scope / Guardrails
- [x] Baseline: `b9eeca218f3ea09906e8064581703b00658625bf`; branch: `feat/artefacts-mcp-a3`.
- [x] Work only in the assigned repository-local worktree; keep root UAT unchanged.
- [x] Use standalone Make runners, synthetic inputs and no environment-file reads.
- [x] Use `ENV=test-artefacts-mcp-a3` last; reserve ports 18943/15943/11943.
- [x] Run one Docker campaign at a time, check disk and limit test workers to one.
- [x] Remove test volumes and orphans after every campaign, including failures.
- [x] Keep commits within 150 changed lines, one English subject, no trailers.

## Branch Scope Boundaries (MANDATORY)
- [x] **Allowed Paths**: `api/src/artifacts/strict-receiver{,.test}.ts`; this plan.
- [x] **Conditional Paths**: `api/src/config{,.test}.ts`, `api/src/routes/auth{,.test}.ts`, `api/src/services/auth/oidc{,.test}.ts` for approved A3 bindings only.
- [x] **Forbidden Paths**: root Makefile/Compose, rules/bootstrap, other plans, UI, manifests, SQL/journal, deployment and upstream repositories.
- [x] BRA3-EX1: deliver private auth/config deltas through the lane bundle; the integration writer applies shared changes under CT-1/CT-2 and rechecks CT-3/CT-9. Recovery removes the unactivated binding, with no data change.
- [x] BRA3-EX2: add this A3 lane plan to record bounded commits; keep the shared master plan with its integration writer. Recovery removes only this plan.

## Feedback Loop
- [x] Resume after interrupted qualification: retain prior reproduction logs and inspect the existing delivery clone before editing.
- [x] #865 remains an open draft at `7b12cd937f1e684a7bedb14784d158a420d74ae4`; reuse its verified API audience, actor/client, approved-human and route restrictions.
- [x] Fix negative fixtures that overwrote caller claims; bind the A2 receipt to client and explicit environment, derive the API origin and refuse armed auth-disabled configuration.
- [ ] Receiving-environment A2 receipt and strict recovery image/configuration qualification remain external activation prerequisites.
- [ ] Independent integration reviews and combined-SHA deployment qualification remain with the conductor.

## Orchestration Mode (AI-selected)
- [x] Single A3 lane; preserve the existing integration ancestry and publish no branch.
- [x] Shared files are submitted as lane deltas; no simultaneous integration writer.

## UAT Management (in orchestration context)
- [x] This lane uses synthetic automated tests only; root UAT remains on its fixed ports.

## Plan / Todo (lot-based)
- [x] Add receipt-gated strict receiver configuration.
- [x] Cover receipt mismatch, missing fields and auth-disabled refusal.
- [x] Verify exchanged tokens while retaining the pre-activation bearer path.
- [x] Cover token identity, audience, scope, lifetime and delegation refusals.
- [ ] Add the canonical search profile and strict recovery guard.
- [ ] Cover profile, activation and recovery behavior.
- [ ] Enforce the exchanged profile in the existing auth middleware.
- [ ] Add exchanged-search fixtures and preserve per-viewer identity.
- [ ] Cover cookie-free search, audience confusions and account refusal.
- [ ] Cover forbidden methods/paths and browser/public-route behavior.
- [ ] Pass focused auth/OIDC/session/signals tests and four restored mutations.
- [ ] Pass typecheck, lint, API declarations and the complete ordinary API suite.
- [ ] Verify every commit, bundle reconstruction and source byte equality.
- [ ] Hand off the bundle and uncommitted French evidence report.

## Merge & Close
- [ ] Conductor consumes the lane bundle under the shared-file lease.
- [ ] Record actual A2 environment and strict-preserving recovery receipts before activation.
- [ ] Qualify the combined image/SHA and merge through the integration workflow.
