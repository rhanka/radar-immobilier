# Feature: Artifact preprod publication and reader activation

## Objective
- [x] Deliver L4 from base `c189c188640d2495e00011023d0875c3ee472759` for approved-account publication and published-page basket reads.

## Scope / Guardrails
- [x] Follow the accepted opening design and L1/L2/L3 contracts; no application changes.
- [x] Work only in `tmp/artefacts-ouv-l4`, branch `feat/artefacts-ouverture-l4`.
- [x] No cluster access, push, Python, environment-file reads or secret values.
- [x] Make-only execution with `ENV` last; standalone ignored Makefile avoids root `.env` inclusion.
- [x] Use local recovery Git metadata because the shared Git directory is read-only.
- [x] Conventional English subjects, at most 72 characters and 150 changed lines per commit, no body/trailer.

## Branch Scope Boundaries (MANDATORY)
- [x] **Allowed Paths (implementation scope)**: `deploy/overlays/preprod/**`, `deploy/ci/*h3*`, `docs/runbooks/ARTIFACTS_PREPROD_ACTIVATION.md`, this plan.
- [x] **Forbidden Paths**: root `Makefile`, `docker-compose*.yml`, `rules/**`, agent bootstrap files, other plans, `.track/**`, application code, production manifests.
- [x] **Conditional Paths**: `deploy/k8s/**` only for a demonstrated blocker; prefer preprod patches.
- [x] **Exception process**: record rationale, impact and rollback here before any exception.

## Feedback Loop
- [x] Requested content DNS names, TLS Secret and dedicated bucket are deployment coordinates to provision, not a claim of existing infrastructure.
- [x] Runtime decision: API-mounted reader from L3; standalone `content-reader` has no production authority/storage composition.
- [ ] Record independent review selection and reconcile any available findings.

## Orchestration Mode (AI-selected)
- [x] One branch, sequential implementation; no push or merge authorized.

## UAT Management (in orchestration context)
- [x] No UAT or services started; all branch checks are offline.
- [x] Reserved mapping if required: `API_PORT=18939 UI_PORT=15939 MAILDEV_UI_PORT=11939 ENV=test-artefacts-ouv-l4`.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline and scope**
  - [x] Read project rules, design/review and delivery reports; confirm branch/base.
  - [x] Save production render before modifications; initialize isolated Git metadata.
- [x] **Lot 1 — Shared publication configuration**
  - [x] Configure API/MCP `general`, storage scope/org/bucket and content base.
  - [x] Bind MCP publication DB and S3 credentials with opaque Secret references.
- [x] **Lot 2 — Reader and routing**
  - [x] Bind persistent reader signing and cursor secrets, cursor key ID and approval runtime.
  - [x] Route stable and pinned content hosts to the API; preserve rollback denial boundary.
- [ ] **Lot 3 — Offline gates**
  - [x] Evolve H3 gates for general opening and mode-off rollback; retain the denial boundary checks.
  - [x] Adapt disabled/rehearsal/rollback fixtures and preserve mutation coverage.
  - [ ] Check general configuration, routing and secret-reference mutations.
  - [ ] Run the existing `k8s-validate` recipe without reading `.env`.
  - [ ] Compare production render byte for byte with the baseline.
- [ ] **Lot 4 — Operator delivery**
  - [ ] Document provisioning, DNS/TLS, selected-resource apply, image pins, tests and rollback.
  - [ ] Audit commit sizes/messages and reconstruct the delivery bundle from the base.
  - [ ] Write the uncommitted French delivery report with operator responsibilities and limits.
- [x] **Merge and close**: conductor-owned; no push, PR mutation or merge in this lot.
