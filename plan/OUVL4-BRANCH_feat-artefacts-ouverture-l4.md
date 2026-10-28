# Feature: Artifact preprod publication and reader activation

## Objective
- [x] Deliver L4 from base `c189c188640d2495e00011023d0875c3ee472759` for approved-account publication and published-page basket reads.

## Scope / Guardrails
- [x] Follow the accepted opening design and L1/L2/L3 contracts; application changes limited to owner-requested Astra isolation corrections under OUVL4-EX2.
- [x] Work only in `tmp/artefacts-ouv-l4`, branch `feat/artefacts-ouverture-l4`.
- [x] No cluster access, push, Python, environment-file reads or secret values.
- [x] Make-only execution with `ENV` last; standalone ignored Makefile avoids root `.env` inclusion.
- [x] Use local recovery Git metadata because the shared Git directory is read-only.
- [x] Conventional English subjects, at most 72 characters and 150 changed lines per commit, no body/trailer.

## Branch Scope Boundaries (MANDATORY)
- [x] **Allowed Paths (implementation scope)**: `deploy/overlays/preprod/**`, `deploy/ci/*h3*`, `docs/runbooks/ARTIFACTS_PREPROD_ACTIVATION.md`, this plan; MCP packaging paths under exception OUVL4-EX1.
- [x] **Forbidden Paths**: root `Makefile`, `docker-compose*.yml`, `rules/**`, agent bootstrap files, other plans, `.track/**`, application code outside OUVL4-EX2, production manifests outside OUVL4-EX1 packaging.
- [x] **Conditional Paths**: `deploy/k8s/**` only for a demonstrated blocker; prefer preprod patches.
- [x] **Exception process**: record rationale, impact and rollback here before any exception.

## Feedback Loop
- [x] OUVL4-EX2: owner-requested Astra corrections allow `api/src/artifacts/content-{host,app}.ts`, their tests and `deploy/ci/check-preprod-auth-isolation.test.sh`. Impact: reserve every content-domain host before app authentication and repair the moved-import mutation. Rollback: revert the correction commits; no production manifest change.
- [x] Astra host isolation, CI fixture, independent rollback closure and application-time image pins verified.
- [x] Astra CI import mutation now removes the MCP directory base; all 25 auth-isolation checks pass with the missing-ConfigMap diagnostic retained.
- [x] Astra wildcard isolation reserves malformed content labels/authorities before app auth and refuses app/admin/auth/API paths; foreign hosts retain normal routing. Seven focused API suites pass (236 tests), after the baseline failed the new regressions; API typecheck and 24 publication/admission tests also pass.
- [x] Astra rollback attempts both restarts before readiness waits, aggregates failures and verifies `off` in both ConfigMaps and every API/MCP pod; 10 operator checks pass, including absent Ingress, API readiness failure and stale runtime refusal.
- [x] Astra operator apply/route require matching immutable API/MCP/denial images; mutable or divergent images trigger their expected diagnostics before cluster calls. All 13 operator checks pass; source/CD renders remain valid.
- [x] Astra correction gates: auth-isolation 25, general render 24, disabled render 41, activation 19, transition 57, discrimination 6, preflight 5 and operator 13 checks pass; k8s-validate passes offline and production SHA-256 remains unchanged.
- [x] Requested content DNS names, TLS Secret and dedicated bucket are deployment coordinates to provision, not a claim of existing infrastructure.
- [x] Runtime decision: API-mounted reader from L3; standalone `content-reader` has no production authority/storage composition.
- [x] OUVL4-EX1: allow `deploy/k8s/immo-mcp/**` and existing 40/41 entrypoints. Evidence: plain requested Kustomize command refuses external file resources. Package unchanged files in a directory base; retain production paths as symlinks. Impact: resource loading only, byte-identical production files/render. Rollback: restore regular 40/41 files and the overlay's file imports.
- [x] Review selection recorded as `selection-failed` (no live mesh catalog/two eligible Claude IDs); no sessions dispatched or consensus claimed. Candidate ready for conductor review.

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
- [x] **Lot 3 — Offline gates**
  - [x] Evolve H3 gates for general opening and mode-off rollback; retain the denial boundary checks.
  - [x] Adapt disabled/rehearsal/rollback fixtures and preserve mutation coverage.
  - [x] Check general configuration, routing and secret-reference mutations.
  - [x] Verify operator recipes with a recording kubectl double, including key custody and rollback.
  - [x] Make the exact requested default-loader Kustomize invocation pass; retain production MCP entrypoints as symlinks to byte-identical manifests.
  - [x] Add coverage for default/restricted render equality and preserved production MCP entrypoints.
  - [x] Run the existing `k8s-validate` recipe without reading `.env`; 158 offline checks pass.
  - [x] Compare production render byte for byte with the baseline.
- [x] **Lot 4 — Operator delivery**
  - [x] Provide standalone Make targets for private key creation, reviewed renders, runtime/routing apply and rollback.
  - [x] Document runtime, provisioning, persistent secrets and both DNS/TLS wildcard levels.
  - [x] Document provisioning, DNS/TLS, selected-resource apply, image pins, tests and rollback.
  - [x] Audit commit sizes/messages and reconstruct the delivery bundle from the base; repeat for final plan-only commit.
  - [x] Write the uncommitted French delivery report with operator responsibilities and limits.
- [x] **Merge and close**: conductor-owned; no push, PR mutation or merge in this lot.
