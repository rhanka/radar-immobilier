# H3 activation — branch scope for feat/861c-h3-p4-preprod-resources (fourth PR: units 11 to 15)

**Type**: feature · **Base**: `main` (H3 first, second and third PRs merged; H4 P0 to P3 present) · **Branch**: `feat/861c-h3-p4-preprod-resources`
**Workspace**: `/home/antoinefa/src/radar-immobilier/.worktrees/861c-h3-p4`
**Reference design**: `.lanes/conductor/tmp/861c/conception-h3-v1.md` (§6 deployment, §7, §9, §10 units 11 to 15, §11 activation and rollback)

## Objective

Deliver the fourth H3 pull request: units 11 to 15 (named preprod
configuration patches, denial Deployment/Service, NetworkPolicy and
wildcard/TLS routing, render/operator preflight checks, activation and
rollback documentation), everything disabled by default with no activation,
plus the third-PR review rework (image smoke distinguishes the api mode from
the denial service and exercises no-argument startup; the denial isolation
test detects every environment read in both modules through the TypeScript
AST). No provider quota dependency, no migration, no real cluster apply.
Units 1-4 (first PR), review rework A/B, unit 7 (blocked, pinned leak
documented), unit 10 (second PR) and units 8-9 (third PR) are merged and
unchanged apart from the two review-rework files named below.

Review integration (both non-blocking points):

- Concurrency wording (review point 1, §8 line 363): precise multi-process,
  distinct-idempotency-key competition for the last reservation belongs to unit 5
  (provider budgets). This PR only guarantees refusal paths never allocate, which
  holds regardless of process count.
- Commit-time authority (review point 2, §5.1 + §8 line 366): the authority source,
  and the result are defined in `packages/artifacts-host/src/admission.ts`:
  reread `account_users.status` and activation before storage dispatch, without
  deliberate grace. This seam does not cover a provider commit already in flight;
  no measured drain bound or instantaneous cutoff is claimed.

## Scope / Guardrails

- English code, tests and identifiers; no Python; never read `.env`.
- Opaque credential references only; no secret or real credential value in git.
- Do not touch `api/src/config.ts` or root `docker-compose*`.
- Root `Makefile`: only the minimal `k8s-validate` wiring of the new offline
  render gate (existing convention: `k8s-validate` already runs the
  `deploy/ci` offline gates `check-image-entrypoints.sh` and its hermetic
  test); no other change.
- Isolated tooling only: `tools/artifact-host.mk` gains `test-h3-render`;
  no root Makefile or environment-file loading beyond the `k8s-validate`
  exception above.
- Quotas (unit 5), migration (6), unit 7 (blocked) and any real cluster apply
  stay out of scope. The real content domain, DNS and certificate are unknown:
  placeholders only, never invented values.

## Branch Scope Boundaries (MANDATORY)

- **Allowed Paths (implementation scope)**:
  - `plan/861C-BRANCH_feat-861c-h3-activation.md`
  - `deploy/overlays/preprod/patch-artifacts-control.yaml` (unit 11, control off)
  - `deploy/overlays/preprod/patch-artifacts-api-env.yaml` (unit 11, opaque refs)
  - `deploy/overlays/preprod/artifact-content-deny.yaml` (unit 12)
  - `deploy/overlays/preprod/artifact-content-networkpolicy.yaml` (unit 13)
  - `deploy/overlays/preprod/artifact-content-ingress.yaml` (unit 13)
  - `deploy/overlays/preprod/kustomization.yaml` (unit 11-13 wiring; Ingress
    host patch restricted to the named `radar` and `radar-immo-mcp` Ingresses)
  - `deploy/k8s/secrets.example.yaml` (unit 11 operator Secret shape, example only)
  - `deploy/ci/check-h3-preprod-render.sh` (unit 14 render gate, no Python)
  - `deploy/ci/check-h3-activation-render.sh` (unit 13/14 activation-time gate)
  - `deploy/ci/check-h3-{preparation,rollback}-render.sh` (operator transitions)
  - `deploy/ci/check-h3-transition-render.test.sh` (transition regressions)
  - `deploy/ci/check-h3-preprod-render.test.sh` (unit 14 hermetic tests)
  - `deploy/ci/h3-render-*.awk` (canonical rendered-object checks)
  - `deploy/ci/check-h3-activation-render.test.sh` (activation regressions)
  - `deploy/ci/check-h3-discrimination.test.sh` (copy/restore/cmp proofs)
  - `deploy/ci/preflight-h3-preprod.test.sh` (offline and fail-closed preflight)
  - `deploy/ci/preflight-h3-preprod.sh` (unit 14 read-only operator preflight)
  - `docs/operator/h3-preprod-activation.md` (unit 15 runbook)
  - `tools/h3-image-runtime-smoke.sh` (review rework: api/deny discrimination,
    no-argument startup)
  - `api/src/artifacts/content-deny-isolation.test.ts` (review rework: AST env reads)
  - `tools/artifact-host.mk` (`test-h3-render` target only)
  - `Makefile` (`k8s-validate` wiring of the render gate only)
  - `RAPPORT-MUSE-H3-P4.md` (uncommitted deliverable)
  - `RAPPORT-SOL-H3-P4.md` (uncommitted integration report)
  - `tmp/861c-h3-p4/**` (ignored evidence, copies, local Git and bundle)
  - `tmp/861c-h3-p4-fix/**` (review correction evidence, local Git and bundle)
- **Forbidden Paths (must not change in this branch)**:
  - `api/src/config.ts`, root `docker-compose*.yml`
  - `rules/**`, agent bootstrap files, other `plan/*-BRANCH_*.md`
  - Business routes, MCP composition, product UI
  - Upstream `@sentropic/artifacts` library sources
  - Provider quotas/reservations (unit 5), migration (6), unit 7, any real
    cluster apply or automated suite against preprod
- **Conditional Paths (allowed only with an explicit exception recorded here)**:
  - `tools/artifact-host.mk` — extended with `test-h3-proxy` (unit 10, no Python, no `.env` load)
  - `api/src/app.ts` — closed-capability control mount (review rework, guards unchanged)
  - `api/src/index.ts`, `api/src/artifacts/control-route-startup.ts`
    — deferred (production wiring of the activation reader and ledger)
  - `packages/artifacts-host/src/composition.ts` — threads an optional
    failure sink (`onProviderFailure`) into the locked store and the timeout
    blob wrapper (astra review point 2, no behavior change when absent)
  - `packages/artifacts-host/src/storage.ts` — forwards the sink to the
    lock path, reporting only lock-minted failures (same review point)
  - `packages/artifacts-host/src/s3-timeout.ts` — forwards the sink to the
    blob wrapper (same review point)
  - `packages/artifacts-host/src/idempotency.ts` — preserve typed connection
    acquisition failures before provider HTTP conversion (same review point)
  - `api/tests/integration/artifacts-commit-probe.spec.ts` — new real-stack
    proof for the probe mapping and the revocation residue (astra points
    1b-1c and 2, isolated database and bucket, no new harness dependency)

## Deliverables

- [x] BR861C-EX1: root Makefile exception limited to `k8s-validate` offline
  gate/test calls, matching the existing entrypoint-check convention; rollback
  removes only those calls, with no impact on other targets.
- [x] BR861C-EX2: retain the assigned `.worktrees/861c-h3-p4` checkout;
  external Git metadata is read-only, so commits and bundle live under
  `tmp/861c-h3-p4`; no root checkout or external metadata is modified.

- [x] **Unit 1 — scope**: this plan; isolated tooling statement (no Makefile change).
- [x] **Unit 2 — activation parser** (§5.1): absent, incomplete, malformed and
      expired inputs stay closed by default; `off` disables; `validation` with exact
      subjects and a future `ARTIFACTS_VALIDATION_UNTIL` enables.
  - [x] Activation parser and exports.
  - [x] Parser regression tests.
- [x] **Unit 3 — cohort/approval admission** (T02, T05, T17, T24; T05, T13):
      unknown, suspended, expired or non-cohort subjects are refused with no storage
      dispatch; authority is reread before dispatch, including suspension after entry.
      Authorization inside an in-flight provider commit remains unverified.
  - [x] Shared admission and facade seam.
  - [x] Refusal regression tests.
  - [x] Async query and pre-dispatch reread tests.
  - [x] HTTP admission seam.
  - [x] HTTP entry regression tests.
  - [x] HTTP reread regression tests.
- [x] **Unit 4 — control cache headers** (§5.3, T29): `Cache-Control: private, no-store`
      plus `Vary: Cookie, Authorization` on control successes, errors and account-switch
      responses.
  - [x] Final-response cache middleware.
  - [x] Success, refusal and account-switch cache tests.
  - [x] Parent-handler exception cache tests.

## Deliverables (earlier PRs, merged and unchanged)

- [x] Units 1-4, review rework A/B, unit 10: merged (see Git history).
- [ ] Unit 7 stays BLOCKED on the upstream `authorizeCommit` request below.

## Deliverables (third PR, merged and unchanged except review rework)

## Deliverables (fourth PR, this branch)

- [x] **Unit 11 — named preprod configuration patches** (§6.1): ConfigMap
  patch pins `ARTIFACTS_CONTROL_MODE: "off"`; subjects, window and storage
  coordinates stay absent (closed); S3 keys bind through optional opaque
  `radar-artifacts-preprod` Secret references; Secret shape recorded in
  `secrets.example.yaml` (example only). Existing preprod isolation checks
  remain valid.
- [x] **Unit 12 — denial Deployment/Service** (§5.4): unit 9 image in
  `content-deny` mode through `args` (never `command`), distinct
  `content-deny` selectors, no credential, no token mount, minimal probes.
- [x] **Unit 13 — NetworkPolicy and wildcard/TLS routing** (§6.2):
  Traefik-to-deny ingress policy plus deny-all egress; content Ingress with
  both wildcard levels to the denial Service only, `.invalid` domain/TLS
  placeholders marked `unverified`, activation-time gate refusing unfilled
  values. The shared Ingress host patch is restricted to the named `radar`
  and `radar-immo-mcp` Ingresses.
- [x] **Review rework (third PR)**: image smoke distinguishes the api mode
  from the denial service (`GET /` banner vs `404 not_found`) and exercises
  no-argument startup (entrypoint default); the denial isolation test detects
  every environment read (dotted access included) in both modules through the
  TypeScript AST.
- [x] **Unit 14 — render and preflight checks** (`deploy/ci/`, no Python):
  exact objects, single-image identity, no prod leakage, no activation by
  default; companion activation-time gate refusing unfilled values; read-only
  operator preflight (never applies); hermetic tests; `test-h3-render`
  isolated target and minimal `k8s-validate` wiring (existing offline-gate
  convention).
- [x] **Unit 15 — activation and rollback documentation**
  (`docs/operator/h3-preprod-activation.md`): §11 order, rollback to H2 by
  removing the complete activation group, data preservation, retained-data
  record, credential cycle.
- [x] Review correction 1: reject additive egress on the named denial ingress
  policy; exact policy types, disabled/activation copy mutations and `cmp`.
- [x] Review correction 2: computed global `process` reads fail AST isolation
  in both denial modules; 35 tests and copy/failure/restore/`cmp` pass.

- [x] **Unit 8 — isolated denial listener** (§5.4, T02/T23/T24): new
      `api/src/artifacts/content-deny.ts` exposes the shared denial
      response plus `createContentDenyApp()`, which denies every request
      unconditionally (401 under `/api/*`, 404 elsewhere), serves only
      GET/HEAD `/livez` and `/health`, never redirects, serves HTML or
      emits a cookie. `content-app.ts` reuses the shared response with no
      behavior change. `content-deny-server.ts` starts the app standalone
      with no application import. `content-deny.test.ts` denies every host
      form (stable, pinned, case/port/dot variants, non-UUID, extra labels,
      two UUIDs, foreign, apex, IP, single label, overlong, underscore,
      empty segments, missing dot) across pages, API routes, all methods,
      forged forwarding headers, cookies and HTML Accept, plus probe cases.
      `content-deny-isolation.test.ts` pins the import graph and the
      `PORT`-only environment reads, including side-effect imports. The HTTP
      listener supplies a fixed internal authority to Hono before URL conversion,
      so malformed Host values get the same denial. No host policy is added.
- [x] **Unit 9 — runtime image entrypoint and smoke** (§6.4): new
      `api/docker-entrypoint.sh` validates the mode (`api` default,
      `content-deny`, anything else refused with exit 2). `api/Dockerfile`
      bundles `content-deny-server.ts`, copies the entrypoint, and sets
      `ENTRYPOINT`/`CMD ["api"]` (manifests with `command:` bypass it).
      The esbuild metadata guard rejects application dependencies in the denial
      bundle. Empty modes and extra arguments also fail with exit 2.
      New `tools/h3-image-runtime-smoke.sh` plus the `image-runtime-smoke`
      Make target build the real runtime image and prove both modes boot
      with closed denial, and that an unknown mode is refused. Isolated
      (no root Makefile, no `.env`, internal network, no host ports),
      `ENV` last, trap cleanup, no Python.

## Integration checkpoints

- [x] Shared denial module and H1 header reuse.
- [x] Host and probe behavior regression coverage.
- [x] Isolated HTTP listener and import-graph checks.
- [x] Runtime bundling and strict service-mode selection.
- [x] Real-image smoke and isolated CI build targets.

## Verification

Ports: API 18984, UI 15984, Maildev UI 11984 (availability unverified); the
test compose publishes none. Environment: `test-861c-h3-p4`. Smoke containers
use an internal project network with no host ports.

```sh
rtk make -f tools/artifact-host.mk test-host SCOPE=src/artifacts API_PORT=18984 UI_PORT=15984 MAILDEV_UI_PORT=11984 ENV=test-861c-h3-p4
rtk make -f tools/artifact-host.mk test-api SCOPE="--exclude tests/integration/** --no-file-parallelism" API_PORT=18984 UI_PORT=15984 MAILDEV_UI_PORT=11984 ENV=test-861c-h3-p4
rtk make -f tools/artifact-host.mk test-api SCOPE="tests/integration/artifacts --no-file-parallelism" API_PORT=18984 UI_PORT=15984 MAILDEV_UI_PORT=11984 ENV=test-861c-h3-p4
rtk make -f tools/artifact-host.mk test-h3-render API_PORT=18984 UI_PORT=15984 MAILDEV_UI_PORT=11984 ENV=test-861c-h3-p4
rtk make -f tools/artifact-host.mk image-runtime-smoke API_PORT=18984 UI_PORT=15984 MAILDEV_UI_PORT=11984 ENV=test-861c-h3-p4
rtk make -f tools/artifact-host.mk typecheck API_PORT=18984 UI_PORT=15984 MAILDEV_UI_PORT=11984 ENV=test-861c-h3-p4
rtk make -f tools/artifact-host.mk lint API_PORT=18984 UI_PORT=15984 MAILDEV_UI_PORT=11984 ENV=test-861c-h3-p4
rtk make -f tools/artifact-host.mk build-api API_PORT=18984 UI_PORT=15984 MAILDEV_UI_PORT=11984 ENV=test-861c-h3-p4
rtk make -f tools/artifact-host.mk check-image-entrypoints API_PORT=18984 UI_PORT=15984 MAILDEV_UI_PORT=11984 ENV=test-861c-h3-p4
rtk make k8s-validate ENV=ci
rtk make -f tools/artifact-host.mk down API_PORT=18984 UI_PORT=15984 MAILDEV_UI_PORT=11984 ENV=test-861c-h3-p4
rtk make -f tools/artifact-host.mk inspect API_PORT=18984 UI_PORT=15984 MAILDEV_UI_PORT=11984 ENV=test-861c-h3-p4
```

`ENV` stays last in every command. Teardown (`down -v --remove-orphans`) must be
followed by `inspect` proving no project containers, volumes or networks remain.

- [x] Deny behavior: every host form refused with identical closed headers
      (`content-deny.test.ts`, new cases; `content-app.test.ts` unchanged).
- [x] Deny isolation: import graph and `PORT`-only reads pinned
      (`content-deny-isolation.test.ts`).
- [x] No regression on the H1 gate: existing `content-app`/`content-host`/
      `content-config` suites stay green.
- [x] Real-image smoke: `image-runtime-smoke` passes (both modes boot with
      closed denial; unknown mode refused), then `down` + `inspect` prove no
      project containers, volumes or networks remain.
- [x] Per-commit typechecks, lint, and `check-image-entrypoints.sh` stay green
      (the new esbuild entrypoint is picked up automatically).
- [x] Discrimination in copies: accepting a malformed host or adding a side-effect
      application import fails the unit suite; accepting an unknown mode fails
      the real-image exit assertion. Restored copies pass, with bytewise `cmp`.

- [x] Final evidence: 153 hosting-package tests, 104 targeted API tests,
      2653 API tests outside integration (8 skipped), and 26 artifact integrations
      pass. Exact CI API declaration build, lint and runtime smoke pass; seven
      Svelte warnings remain. Logs and the transfer bundle are under
      `tmp/861c-h3-p3/`; the French report is `RAPPORT-SOL-H3-P3.md` (uncommitted).
- [x] Security boundary recorded: npm audit reports Vite GHSA-587h-7wmj-h5pm
      (high) in the unchanged dependency tree. No dependency update or risk
      acceptance is included; dependency remediation belongs on its own branch.

## Not covered (this branch is unapplied configuration)

- [x] H3 P4 integration: 114 artifact API tests including 13 AST cases;
  98 relevant shell checks (34 H3, 39 entrypoint, 25 auth isolation) and real runtime smoke pass.
  Activation requires filled values, future expiry and pinned reviewed digests.
  Copy mutations fail, restored bytes match with `cmp`. See uncommitted report
  and `tmp/861c-h3-p4/evidence/` for exact commands and commit checks.

Provider quota binding (5) and migration (6), unit 7 (blocked, see below),
supplier quotas (design §5 lots 5-6), deployed proxy behavior, live TLS/DNS
and routing state, real content domain, private bucket and credentials,
capacity for the extra denial pod, and any real cluster apply. Physical
prevention inside provider transactions is `unverified`. Nothing in this
branch was executed against a cluster; all automated checks are offline.

## Upstream request — provider commit-time authorization (blocks unit 7)

**Context.** Radar's facade (`packages/artifacts-host/src/facade.ts`) rereads
admission after the provider dispatch settles. When revocation lands while
the provider is blocked (lock, connection, S3), the 403 masks a publication
the provider may already have committed: `releases` row (`ready`), S3
objects, idempotency result and current pointer persist, and replaying the
same idempotency key after re-approval receipts that publication. The
provider (`@sentropic/artifacts@0.1.2`) runs in the isolated qualification
container. No supported safe retraction usable from the facade is established;
0016 widens release states without exposing a
facade-level retire. Direct SQL/S3 surgery from Radar would bypass provider
invariants (current pointer, idempotency replay, blob refcounts/GC pins)
and is therefore NOT implemented.

**Owner and contract (H4 v3).** Sentropic supplies a generic, supported
authorization mechanism. H3 supplies current admission/object/quota policy;
H4 binds it through HTTP and MCP. The host supplies an immutable, request-bound
callback identifying verified actor, operation, scope and object, never tool
arguments or mutable global app state. The provider invokes it after relevant
lock, connection and S3 waits and before durable finalization. It covers
release readiness, current pointer, provenance/lifecycle, and idempotency success;
for `ensure`, binding and ACL/lifecycle effects also belong to that boundary.
No unchecked connection/lock wait may follow the decision: coordinated writes,
revalidation or a qualified authorization revision must retain its validity.
Unavailable authority and revocation fail closed, with
`unauthorized_at_commit` accounting. Retraction alone does not satisfy H4.

**Typed failure contract.** Sentropic must preserve the original typed cause
privately, before HTTP conversion, correlated to the immutable invocation.
Both transports and the write ledger consume that same classified outcome:
S3/connection unavailability → 503/`provider_unavailable`; genuine conflicts →
409/`provider_conflict`; finalization denial → refusal/`unauthorized_at_commit`;
unexpected failures → sanitized 500/`provider_error`. Internal causes must not
reach public bodies. The Radar probe is a temporary local classification seam,
not proof of the absent upstream contract or MCP parity.

**Acceptance criteria.** Through real `createHttpArtifactApp` or
`composeArtifactHost`, block each relevant boundary, revoke, then inspect
PostgreSQL/S3 from another instance or after reconnect/restart. Denial leaves
no ready publication, advanced pointer or reusable idempotency success.
Earlier staging may leave only accounted, nonvisible intermediate objects with
a bounded cleanup/recovery rule; zero raw S3 objects is not the H4 requirement.
Reauthorize and retry the same key: it must execute a newly authorized attempt,
never retrieve denied success. Replay of an earlier valid success remains
subject to current admission/object authorization. Cover `ensure`, quotas,
provenance/lifecycle and both HTTP/MCP outcomes as well as publication.
Inject typed failures below the real HTTP app, asserting sanitized status/body,
one correlated write-ledger entry, no read entries, and MCP code/retry parity.

Until the upstream lands, `artifacts-commit-probe.spec.ts` ("documents the
uncompensated residue") pins the leak: one ready release, one current pointer,
one success idempotency result and one new S3 object survive. Replay while
suspended is denied; after reauthorization, another composed instance returns
201 with that same release and no new release/key/object. It must be inverted
when the upstream lands: no denied success; same-key retry freshly authorized.
These are PostgreSQL/S3 API observations (S3 mock), with PostgreSQL on isolated tmpfs;
durability after database restart, other wait/revocation boundaries, `ensure`
finalization, quotas, persistent ledger and HTTP/MCP parity remain unverified.

## Feedback Loop

- Reviewer selection: exact Muse model/effort unavailable; no complementary peer
  consensus claimed. Local integration review and executable evidence are required.
