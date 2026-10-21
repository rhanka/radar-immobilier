# H3 activation — branch scope for feat/861c-h3-p2 (second PR: review rework, units 7 and 10)

**Type**: feature · **Base**: `main` at `cd52bd72` (H3 first PR merged) · **Branch**: `feat/861c-h3-p2`
**Workspace**: `/home/antoinefa/src/radar-immobilier/.worktrees/861c-h3-p2`
**Reference design**: `.lanes/conductor/tmp/861c/conception-h3-v1.md` (§10, units 7 and 10)
**Design review**: `.lanes/conductor/tmp/revues/astra-h3-p1.md` and `astra-h3-p1-indep.md` (approved, rework below)

## Objective

Deliver the second H3 pull request: rework requested by both P1 reviews
(complete publication receipts, cache policy on the unmounted prefix), unit 7
commit-time authorization with failure accounting, and unit 10 nginx control
route limit. No provider quota dependency, no other deployment change. Each
test below fails without its fix and carries its §H matrix identifier where
one exists. Units 1-4 (first PR) are merged and unchanged except for the
review rework listed here.

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
- Reuse `api/src/artifacts/` and `packages/artifacts-host/`; no copied domain logic.
- Do not touch `api/src/config.ts`, the root `Makefile`, or root `docker-compose*`.
- Isolated tooling only: `tools/artifact-host.mk`, extended solely for the proxy
  check; no root Makefile include or environment-file loading.
- Production activation wiring (`api/src/index.ts`,
  `api/src/artifacts/control-route-startup.ts`) is deferred to a later unit: this PR
  adds the admission seam as an optional dependency so existing H2 behavior is
  preserved when no activation reader is provided.

## Branch Scope Boundaries (MANDATORY)

- **Allowed Paths (implementation scope)**:
  - `plan/861C-BRANCH_feat-861c-h3-activation.md`
  - `packages/artifacts-host/src/admission.test.ts` (complete receipts, valid meta id)
  - `packages/artifacts-host/src/admission-commit.test.ts` (complete receipts, entry/final split)
  - `packages/artifacts-host/src/facade.ts` (commit-time recheck, failure ledger)
  - `packages/artifacts-host/src/commit-authorization.test.ts` (revocation while blocked)
  - `packages/artifacts-host/src/commit-failures.test.ts` (failure accounting)
  - `packages/artifacts-host/src/index.ts` (re-exports only)
  - `api/src/app.ts` (cache policy on the unmounted control prefix only)
  - `api/src/artifacts/control-cache-unmounted.test.ts` (unmounted prefix cases)
  - `deploy/overlays/preprod/nginx/default.conf` (control route 2m limit only)
  - `deploy/overlays/preprod/nginx/nginx-test-control-limit.conf` (isolated test conf)
  - `tools/h3-nginx-control-limit.sh` (isolated proxy check, no Python)
  - `tools/artifact-host.mk` (`test-h3-proxy` target only)
  - `RAPPORT-MUSE-H3-P2.md`, `RAPPORT-SOL-H3-P2.md` (uncommitted deliverables)
  - `tmp/861c-h3-p2/**` (ignored logs, copies, local Git and bundle)
  - `tmp/861c-h3-p2-fix/**` (astra correction evidence and local Git)
- **Forbidden Paths (must not change in this branch)**:
  - `api/src/config.ts`, root `Makefile`, root `docker-compose*.yml`
  - `rules/**`, agent bootstrap files, other `plan/*-BRANCH_*.md`
  - Business routes, MCP composition, product UI
  - Upstream `@sentropic/artifacts` library sources
  - Provider quotas/reservations (unit 5), migration (6), denial service (8),
    image (9), preprod resources except the unit 10 nginx limit (11-14)
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

## Deliverables (second PR)

- [x] **Review rework A — publication proofs**: complete stub receipts
      (`releaseId`, `manifest` with digest) and valid `artifactId`; a
      successful H3-admitted publication returning the full receipt; separate
      entry-denial and final-reread-denial cases.
- [x] **Review rework B — unmounted prefix cache** (§5.3, T29): the control
      prefix stays mounted with the private policy when the capability is
      absent; covered through `createApp` for anonymous, unavailable,
      origin and Bearer [REDACTED] responses.
- [ ] **Unit 7 — BLOCKED on an upstream dependency** (T05, T13): a publish
      revoked (suspension, cohort removal, expiration) while the provider is
      blocked is refused to the caller with no receipt and accounted
      (`unauthorized_at_commit`); provider lock/connection/S3 failures map
      to typed statuses and are accounted through the below-layer probe.
      The unit is NOT done: the 403 masks a possibly committed provider
      publication (release, S3 objects, idempotency result, current pointer)
      that a later replay can receipt, and Radar has no safe retraction for
      it. Blocked on the upstream request below (provider `authorizeCommit`
      mechanism after waits and before durable finalization).
- [x] **Unit 10 — nginx control route limit** (T11 transport part):
      `client_max_body_size 2m` on `/api/v1/artifacts/control` in the
      preprod overlay; isolated test config plus a proxy check proving a
      valid >1 MiB body passes, exactly 2 MiB passes, 2 MiB + 1 is refused,
      the generic route still refuses >1 MiB, and a chunked body past the
      limit is refused.

## Verification

Ports: API 18973, UI 15973, Maildev UI 11973; the test compose publishes none.
Environment: `test-861c-h3-p2`. Proxy containers use an internal project network,
with ports 8080 and 3000 inside that network and no host ports. The proxy loads
the actual preprod server block, with a valid publication and 1024 decoded bytes.

```sh
rtk make -f tools/artifact-host.mk test-host SCOPE=src/artifacts API_PORT=18973 UI_PORT=15973 MAILDEV_UI_PORT=11973 ENV=test-861c-h3-p2
rtk make -f tools/artifact-host.mk test-api SCOPE="--exclude tests/integration/** --no-file-parallelism" API_PORT=18973 UI_PORT=15973 MAILDEV_UI_PORT=11973 ENV=test-861c-h3-p2
rtk make -f tools/artifact-host.mk test-api SCOPE="tests/integration/artifacts --no-file-parallelism" API_PORT=18973 UI_PORT=15973 MAILDEV_UI_PORT=11973 ENV=test-861c-h3-p2
rtk make -f tools/artifact-host.mk test-h3-proxy API_PORT=18973 UI_PORT=15973 MAILDEV_UI_PORT=11973 ENV=test-861c-h3-p2
rtk make -f tools/artifact-host.mk typecheck API_PORT=18973 UI_PORT=15973 MAILDEV_UI_PORT=11973 ENV=test-861c-h3-p2
rtk make -f tools/artifact-host.mk lint API_PORT=18973 UI_PORT=15973 MAILDEV_UI_PORT=11973 ENV=test-861c-h3-p2
rtk make -f tools/artifact-host.mk down API_PORT=18973 UI_PORT=15973 MAILDEV_UI_PORT=11973 ENV=test-861c-h3-p2
rtk make -f tools/artifact-host.mk inspect API_PORT=18973 UI_PORT=15973 MAILDEV_UI_PORT=11973 ENV=test-861c-h3-p2
```

`ENV` stays last in every command. Teardown (`down -v --remove-orphans`) must be
followed by `inspect` proving no project containers, volumes or networks remain.

- [x] Complete admission receipt fixtures verified (90 package tests pass).
- [x] Unmounted capability cache regressions verified (3 cases pass).
- [x] Commit authorization and write-only failure ledger verified.
- [x] Blocked-provider revocation tests verified.
- [x] Provider failure and read-exclusion tests verified.
- [x] Probe-mapped provider failures and revocation residue against the real
      stack: four `artifacts-commit-probe.spec.ts` cases pass through the composed
      provider. Unit 7 stays blocked until the upstream contract below lands.
- [x] Concurrent dispatches retain separate typed causes (regression reproduced
      before AsyncLocalStorage isolation); connection acquisition is typed too.
- [x] Astra correction gates: 97 package tests, 67 targeted API tests,
      2537 API tests outside integration (7 skipped), 21 artifact integrations,
      lint, and ten proxy boundary cases pass. Seven Svelte warnings remain.
- [x] Discrimination in a copy: removing below-HTTP reporters breaks both 503
      mappings; restoration passes four cases and `cmp`. Removing the nginx
      path boundary breaks the neighboring-route case; restoration passes ten.
- [x] Nginx production configuration boundary verified.
- [x] Container-only proxy check and mutation proofs verified.
- [x] Final gates, per-commit typechecks, bundle and teardown verified.

Evidence before astra corrections: 90 package tests, 67 targeted API tests, 2537 API tests outside
`tests/integration` (7 skipped), 17 artifact integration tests and 6 proxy cases
pass. Lint and all nine commit source states pass typecheck (7 Svelte warnings).
Mutation proofs: three revocation failures, three unmounted-cache failures and
nginx 413 instead of 201 without the size directive; restored copies pass `cmp`.
Qualification uses local ignored Compose overrides for TCP readiness, isolated
workspace dependency volumes and in-memory PostgreSQL integration data. No test
timeout is increased. Physical database durability is not covered by that run.
Full commands, failed attempts, image identities, commit IDs and cleanup counts
are recorded in the uncommitted `RAPPORT-SOL-H3-P2.md` and ignored logs.

## Not covered (later H3 units)

Provider quota binding and migration, denial listener, runtime image smoke,
preprod resources (11-14), render/operator preflight, rollback documentation,
production startup wiring of the activation reader and ledger, deployed proxy,
TLS and routing. Physical prevention inside provider transactions is `unverified`.

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
