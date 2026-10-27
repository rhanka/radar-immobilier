# BASE activation and protected recovery

Status: B4 slices 1–15, dispatcher and guarded restart are implemented.
Qualified B3 is received by preserved merge history; the final B4 report binds
qualification to the delivery SHA. Operational activation remains unverified.
B5 and the nominal operational rehearsal retain their original scope and budget.

## Prerequisites

- Receive qualified B12 `4fc755e9f69daae2c32286dd3cf0069c5798ecd0`, including
  B1 `e2994f3646f6d8813bf334a60cfa2dd430e27824` and
  B2 `d033bc18bf9b9537c5c7a69311ebe44b0b545517` by their preserved merge history.
- Obtain a current CT-1 lease before any shared application/startup resolution.
  L3 is released; its receipt is acknowledged, not reused as a B4 grant.
- Qualified B3 `dbcd82a388d6be72fdefe1de927a2459afa0dbe8` is received
  through B123 `1c304311a5d3dede996a4c9307ffd6af1e4db8ef` and B4 merge
  `a1f20d7a9b2fbee0b20ea6e0f23501d30c926efa`. Its real-writer proof is
  retained; synthetic coverage does not establish deployed-image coverage.
- Use the delivered operator script and real reader. Prepare a persistent
  synthetic campaign for actual dispatcher calls; ordinary `base-api-verify`
  removes its database at exit.
- Retain a running, owned `radar-test-*`/`radar-e2e-*` campaign and its immutable
  source archive, runtime dependencies and PostgreSQL database across both calls.
  The dispatcher checks ownership, serializes access and refuses stale script bytes.
- Verify `df -h` before heavy campaigns and stop below 10 GiB available.
  Never load environment files, run Python, target dev, or publish a port here.

## Operator interface

The delivered 6K HTTP routes also accept server-held maintenance configuration
through `BASE_API_LOT_CUTOVER_CONFIG`, read once when `createApp` constructs
its routes (including the ordinary `index.ts` startup). Its JSON contains
`workspaceId`, `mapping` (`mappingVersion`, `importerVersion`,
`destinationsQualified: true`), and `maintenance` (`maintenanceAttemptId`,
`releaseId`, `instanceIds`, `evidence`, optional qualified-empty `options`).
The evidence has the same workspace/actor/attempt/release/instances and
drain/shutdown fields described below. This is deployment configuration,
never a client-supplied manifest or public readback bypass.

Each request derives its safety adapter from the authenticated session actor,
current workspace, recomputed manifest and D5 gate. Evidence for another actor
fails with `403 maintenance_evidence_actor_mismatch`; absent configuration
keeps activation unavailable. Every ready target and projected facet value
must match the qualified manifest before opening. The composed synthetic
invocation, including the exact configuration JSON, is executable in
`api/tests/integration/base-api-cutover-bound.spec.ts`.
Operational configuration values remain unverified until supplied and qualified.

Only `tools/make/base-api.mk` is used. All three ports are explicit and `ENV`
is last. Inputs are captured with Make's `value` before export, preserving literal
embedded Make functions as well as shell syntax without evaluating either:

| Make input | Validated script argument |
|---|---|
| `BASE_API_WORKSPACE` | `--workspace` (required UUID) |
| `BASE_API_ACTOR` | `--actor` (required, maximum 256 characters) |
| `BASE_API_REASON` | `--reason` (required, maximum 512 characters) |
| `BASE_API_MAINTENANCE_ATTEMPT` | `--maintenance-attempt` (required UUID) |
| `BASE_API_RELEASE` | `--release` (required, maximum 256 characters) |
| `BASE_API_INSTANCES` | repeated `--instance` (space-separated IDs, each matching `[a-zA-Z0-9_.:-]{1,256}`) |
| `BASE_API_MAINTENANCE_EVIDENCE` | required JSON file, read as data into `--evidence-json` inside the container |

Evidence must be a regular, nonempty file below `tmp/base-api-evidence/`, with
no traversal, environment-file component or symlink ancestor. It is mounted
read-only as `/maintenance-evidence.json`; its contents become one quoted script
argument and are never evaluated or printed by the dispatcher.
The dispatcher invokes `api/src/scripts/base-api-personal-activation.ts` with
positional action `activate` or `resume` in the API container on the same campaign.
It never starts a replacement database or silently chooses an operational target.

The dispatcher supplies the script's flat validated flags and positional action.
Attempt, release and expected instances are independent operator inputs; they are
never inferred from submitted evidence. Missing inputs, foreign evidence and stale
script bytes reject before activation. The actual runtime script must match the
immutable campaign archive. These targets accept only owned disposable test/e2e
campaigns; operational workspace/database values remain unverified.

The following exact **synthetic qualification commands executed successfully**
on the same owned `radar-test-base-api-b1` campaign. The two instance names and
drain/shutdown evidence are synthetic; no operational shutdown is established.
Evidence expires after seven days; a new rehearsal needs freshly qualified proof.

```sh
rtk make -f tools/make/base-api.mk base-api-activate-personal BASE_API_WORKSPACE=d2ec54f4-1afd-482b-986f-3814fd8d21f8 BASE_API_ACTOR=synthetic-slice8-manager BASE_API_REASON='synthetic slice 8 $(shell touch injected) `touch injected`' BASE_API_MAINTENANCE_ATTEMPT=22222222-2222-4222-8222-222222222222 BASE_API_RELEASE=synthetic-slice8-release BASE_API_INSTANCES='synthetic-old-a synthetic-old-b' BASE_API_MAINTENANCE_EVIDENCE=tmp/base-api-evidence/B4/slice-8/operator/maintenance.json API_PORT=18911 UI_PORT=15911 MAILDEV_UI_PORT=11911 ENV=test-base-api-b1
rtk make -f tools/make/base-api.mk base-api-resume-personal BASE_API_WORKSPACE=d2ec54f4-1afd-482b-986f-3814fd8d21f8 BASE_API_ACTOR=synthetic-slice8-manager BASE_API_REASON='synthetic slice 8 $(shell touch injected) `touch injected`' BASE_API_MAINTENANCE_ATTEMPT=22222222-2222-4222-8222-222222222222 BASE_API_RELEASE=synthetic-slice8-release BASE_API_INSTANCES='synthetic-old-a synthetic-old-b' BASE_API_MAINTENANCE_EVIDENCE=tmp/base-api-evidence/B4/slice-8/operator/maintenance.json API_PORT=18911 UI_PORT=15911 MAILDEV_UI_PORT=11911 ENV=test-base-api-b1
```

`base-api-tooling-proof` verifies literal argument transport, required-input
rejection and exact staging paths without a daemon. The PostgreSQL rehearsal below
separately records real Make calls, database identity, durable SQL and exit status.

Slice-8 evidence lives in `tmp/base-api-evidence/B4/slice-8/operator/`.
Database `radar`, PostgreSQL system identifier `7700072694517792808`, start time
`2026-10-24 03:34:43.49684+00`, remained identical across both calls. Both exited
0 with `open-success`. Activation changed absent epoch state and one legacy event
into scoped/open state with one stream, binding and head; already-open resume
preserved serialized rows of every public SQL table byte for byte. Missing drain,
missing shutdown and foreign workspace/attempt/release evidence each exited 2
through Make and preserved all SQL bytes. Exact arguments, proof files, before/
after states, checksums and per-command exits are retained; no shell marker ran.

## Qualified maintenance evidence

The internal validator requires workspace, actor, maintenance-attempt UUID,
release identifier, complete instance set and reason. Drain and shutdown each
carry a completion timestamp and coverage of every independently expected instance.
Workspace, actor, attempt, release and instances must match the independently
qualified operator/server binding; deriving that binding from the same submitted
evidence would defeat the comparison. Instance identifiers are case sensitive.
Future or expired proof is rejected; the default maximum age is seven days.
Supplying JSON alone does not establish actual shutdown or drainage.

The first signal authority transition affects global legacy storage and delivery.
Maintenance must cover every incompatible reader, writer, publisher and old
instance, including in-flight responses, streams, queued buffers and reconnects.
No operational workspace, actor, release, instance roster, maintenance attempt,
writer coverage, mapping, manifest or D5 disposition is verified by these examples.

## Durable operator recovery and qualified restart

| Durable state | Required recovery |
|---|---|
| Legacy, barrier committed | Keep public 503; retry protected activation only after fresh authorization/evidence. |
| Scoped, barrier committed | Forward resume through internal readback; never rerun legacy activation. |
| Scoped, open | Reauthorize; return status without changing SQL bytes. |
| Unreadable/ambiguous | Stay closed; do not default to legacy serving after restart. |

Under the closed barrier the real reader must validate PostgreSQL bindings,
terminal heads, projections, attachment rights and current manager authority.
Slice 3 adds internal PostgreSQL authorization under the workspace lock: current
manager and attached-account rights, scoped epoch and a closed barrier are required.
Slice 4 separately checks persisted stream/binding/head counts against explicit
expectations and verifies terminal projections under that same closed barrier.
Explicit zero counts qualify an empty history only when attached personal events
are neither unresolved nor bound outside the selected workspace. Slice 6 composes
both checks for activation, deriving expected stream/binding/head counts from
attached personal history rather than the projections being checked. A missing
persisted head rejects with 503 and retains the scoped barrier. Slice 5 rechecks
the manager and every qualified attached account before drainage and again in the final opening
transaction under the workspace lock. Account approval and active membership are
required; share locks retain those rights through commit. Revocation after real
readback rejects opening and preserves the closed barrier and history. A concurrent
opening returns `409 activation_already_open` without another SQL write. This
low-level guard remains distinct from already-open operator resume. Slice 7
rechecks manager and attached-account approval/membership under the workspace lock
before returning status without SQL mutation, including explicitly empty history.
Scoped/closed resume uses real persisted readback without rebinding event history;
projection mismatch and revoked rights retain the closed barrier. Public readers
remain closed during readback. Correction of the persisted mismatch permits resume.
Seeded mismatches must prevent opening. Recheck rights after readback and before
opening. Public inputs must never enable internal readback. 6H releases its
maintenance barrier; 6K retains legacy closure and opens `destinationOpen`.
Restart tests must prove durable 503/410 and retired publication behavior.
After the scoped epoch commits, recovery is forward resume only.

Slice-7 PostgreSQL qualification (helper execution, not actual operator targets):

```sh
rtk make -f tools/make/base-api.mk -f tmp/base-api-evidence/B4/slice-7.mk b4-slice-7-qualify B4_PHASE=full API_PORT=18911 UI_PORT=15911 MAILDEV_UI_PORT=11911 ENV=test-base-api-b1
```

## Verification and mutation tooling

Use `BASE_API_LINT_FILES="api/path.ts api/path.test.ts"` for explicit changed-file
lint receipts; API typechecking includes source tests and the exact operator script.
`base-api-b3-mutation-required`, `base-api-b4-mutation-required` and
`base-api-b5-mutation-required` use fixed suites, require real packet runners
and bound each runner to 600 seconds. Missing suites, runners or receipts fail
closed. Each receipt must prove an actual assertion failure between passing
baseline and restored runs, with unchanged selected cases, no skips,
original/mutant bytes, exact patch, command, exits and restored checksum.
The receipt contract is implemented in `tools/make/base-api-required-mutations.mjs`.
Setup errors do not qualify.

Historic B4 slices 1-8 state (snapshot retained on 2026-10-24):
the full packet mutation runners were still pending, and with the two B4
integration suites still absent the fixed B4 target rejected before creating
a campaign rather than reporting a mutation pass. No final B4 bundle was
issued for slices 1-8; the slice-8 rehearsal qualified only operator transport
and seeded activation/resume, with shared retirement/restart wiring, final
integrations, mutations and qualified B3 history still open. That historic
state is superseded by the current qualification below.

Qualified baseline B5 `965cd42b` before review corrections (2026-10-24, evidence in
`tmp/base-api-evidence/B5/report.md`): the B4 integration suites
(`base-api-activation.spec.ts`, `base-api-activation-resume.spec.ts`) are
delivered and executed; the B5 mutation runner records 15 strict `0/1/0`
cycles with a genuine restored pass of 44/44 tests in 11 suites
(`20261024T190434-28-b5-mutation-required`); the B4 mutation rerun records
19 strict `0/1/0` cycles with a genuine restored pass of 56/56 tests in 10
suites (`20261024T184504-24-b4-mutation-required`); the final API gate records
3,549 passed with zero failures in 346 files and 1,072 passed with zero
failures or skips across the required 150 suites, plus both typechecks,
explicit changed-file lint, declaration build, CT-7 and standalone CT-8
(`20261024T191509-28-b5-verify`); retained compatibility records UI 262/262
and MCP 217/217 (`20261024T191018-24-b2-6l2`); the B5 bundle SHA-256 is
`907bca19e319d18b6ab83851bd1a54fecb55637d8efb3ed76ff3cd5cb2e209d5`.
Review-correction qualification and its incremental bundle are recorded in
`RAPPORT-SOL-BASE-B5.md`, section `Corrections revues astra B5`.

Standalone CT-8 fresh/upgrade/rerun and frozen 0022/0023 bytes remain required
and are qualified on synthetic databases only. Synthetic databases cannot
establish deployment migration state. If ARTEFACTS is joined, qualify the
actual combined frozen order and exact SHA/image under CT-8/CT-9.
After scoped epoch change, use forward resume only.

Remaining open (operational only): receiving-branch integration SHA and
evidence, remote CI, deployed state, combined CT-8/CT-9 qualification, and
operational activation with real workspace, actor, maintenance evidence,
mapping, drain/shutdown proof and target database identity.

## Initial slice 10 and L6 synthetic restart rehearsal

This section records the pre-clarification state at `a5789f81`. The completed
correction and fresh verification are recorded in the next section.

Slice 10 qualifies `readDurableLegacyRetirement` before startup integration:
595 tests in 60 suites, API/source-test typechecks, explicit changed-file lint
and standalone CT-8 pass. The exact deferred L5 `index.ts` patch has a separate
TS2379 failure: `AppDeps.legacyRetirement` is optional, but cannot explicitly
receive `undefined` with `exactOptionalPropertyTypes`. That patch remains
uncommitted and its startup integration is not qualified. A one-line conditional
property spread is proposed in the L6 evidence; applying it requires resolving
the owner's exact-patch instruction. No `app.ts` type change is authorized by L6.

The behavioral rehearsal executes the real `index.ts` against PostgreSQL,
with the listener and object storage mocked and artifact configuration absent.
Two imports from a committed legacy barrier return 503 on eight legacy paths;
two imports after the scoped switch return 410. An unavailable durable table
also starts closed in each phase. The existing stream-retirement suites remain
separate from this startup proof. Four temporary startup tests pass; this does
not override the failed compiler gate.

Exact synthetic operator invocations, each exiting 0 on the same campaign DB:

```sh
rtk make -f tools/make/base-api.mk base-api-activate-personal BASE_API_WORKSPACE=248ebbb7-2c4d-44cb-8985-d8eafb1faea4 BASE_API_ACTOR=synthetic-l6-manager BASE_API_REASON='synthetic L6 $(shell touch injected) `touch injected`' BASE_API_MAINTENANCE_ATTEMPT=22222222-2222-4222-8222-222222222222 BASE_API_RELEASE=synthetic-l6-release BASE_API_INSTANCES='synthetic-old-a synthetic-old-b' BASE_API_MAINTENANCE_EVIDENCE=tmp/base-api-evidence/B4/l6/operator/maintenance.json API_PORT=18911 UI_PORT=15911 MAILDEV_UI_PORT=11911 ENV=test-base-api-b1
rtk make -f tools/make/base-api.mk base-api-resume-personal BASE_API_WORKSPACE=248ebbb7-2c4d-44cb-8985-d8eafb1faea4 BASE_API_ACTOR=synthetic-l6-manager BASE_API_REASON='synthetic L6 $(shell touch injected) `touch injected`' BASE_API_MAINTENANCE_ATTEMPT=22222222-2222-4222-8222-222222222222 BASE_API_RELEASE=synthetic-l6-release BASE_API_INSTANCES='synthetic-old-a synthetic-old-b' BASE_API_MAINTENANCE_EVIDENCE=tmp/base-api-evidence/B4/l6/operator/maintenance.json API_PORT=18911 UI_PORT=15911 MAILDEV_UI_PORT=11911 ENV=test-base-api-b1
```

Database `radar`, PostgreSQL system identifier `7700099786958155814`, started
`2026-10-24 05:19:51.51585+00`, project `radar-test-base-api-b1`: before activation,
legacy epoch/closed barrier and one attached personal event; after activation,
scoped epoch/open barrier, dropped legacy index and one event/stream/binding/head.
Missing drain, missing shutdown and foreign workspace/attempt/release each exit 2
with byte-equivalent SQL state. Already-open resume and subsequent startup tests
preserve the complete public-table SQL snapshot. The maintenance proofs are
synthetic; operational values and deployed-instance shutdown remain unverified.
Full commands, database identity, SQL snapshots and statuses are under
`tmp/base-api-evidence/B4/l6/`. Recovery after scoped activation remains forward
resume only. Qualified B3 reception, the two named B4 integration suites and the
nine mutation families remain required; B5 and nominal activation keep their
original position and budget.

## Completed L6 startup integration

The owner clarified that the preserved hunk requires exact functional content
and authorized the one-line optional-property spread in `index.ts`. It omits
`legacyRetirement` when the durable reader returns undefined; each defined state
is forwarded unchanged. No application type, service contract or compiler option
changes. The delivered file equals the original deferred patch plus that proposal.

Fresh API/source-test and integration-test typechecks, fixed and explicit lint,
595 tests in 60 suites, CT-3 and standalone CT-8 pass. Four additional temporary
tests import the real entry point against PostgreSQL before and after activation,
including unavailable durable storage. Actual activation and already-open resume
pass on one synthetic database; rejected evidence and reopened state preserve SQL
bytes. The previous failed compiler run remains evidence of the resolved blocker.
The completed CT-2 receipt is `tmp/base-api-evidence/B4/l6/ct2-l6.md`.
Slice 11 adds `qualifiedLotCutoverSafety`: bound maintenance validation followed
by real internal readback for each ready city/mode under the closed barrier.
It rejects an empty valid target set and adds no public bypass or opening write.
Both typechecks, explicit lint, 595 tests/60 suites and standalone CT-8 pass.
Direct 6K adapter qualification, including qualified empty history, is expected
in Muse slice 12. Qualified B3, named B4 integrations and mutations remain open.

## Slice 12 reception and qualified empty-history finding

`base-api-activation.spec.ts` exercises the real qualified 6K adapter against
PostgreSQL. Public city reads return 503 before and after internal readback
under the durable closed barrier, then succeed after opening. Current manager
rights and workspace binding are checked. This is direct service qualification;
the actual Make activation/resume rehearsal remains recorded in the L6 section.

Qualified empty history is already required by plan B2.6 and qualified in
`lots/lot-cutover-empty-db.test.ts:26`, using the recording safety probe at
`lots/cutover-fixture.ts:168`. B4's real evidence adapter still rejects an empty
ready set at `activation-maintenance-safety.ts:140`; the real reader factory
also rejects an empty city set at `lots/lot-cutover-safety.ts:80`.
Slice 12 reproduces that 503 through `runLotCutover` and checks that durable and
public state stay closed. This is a B4 integration gap against existing B2
acceptance, not a missing empty-history requirement. No solution is selected.
Stop after this reception; slice 13 and final B4 qualification remain pending.

## Slice 13: protected resume and qualified empty history

The B2 empty-history path now uses the real qualified 6K safety adapter.
An empty ready set remains rejected unless the server explicitly supplies
`qualifiedEmptyManifest: true` and a nonempty `emptyReadbackScope` containing
`citySlugs` and `modes`. The synthetic case uses the fixture city and `["real"]`.
These are internal adapter options, never a public readback bypass or new
operator Make inputs. The existing manifest gate still qualifies destinations,
rights, epoch and writer coverage before opening.

For every declared city/mode the real internal reader must return zero heads;
missing scope or persisted visible heads returns 503. Public reads stay closed
before and after that readback. Opening creates no artificial business events,
then the first ordinary selection is accepted and publicly readable, preserving
B2.6. Failed readback leaves the durable barrier; protected resume rechecks the
current manager and maintenance evidence while retaining the legacy fence.
After epoch change, recovery remains forward resume only.

This closes the slice 12 empty-history integration finding. Final B4, qualified
B3 reception and the mutation campaign remain open. Next slice: 14/15.
Operational values and deployed state remain unverified; B5 and nominal
activation retain their original position and budget.

## Slice 14: discriminating maintenance safety tests

The new safety suite covers reason bounds, malformed attempts, absent releases,
invalid proof timestamps, validation before 6H/6K drainage, validation before
6H delegation, cross-workspace readback and explicit qualified empty history.
Sixteen individual mutations run in the disposable API copy: each has a passing
baseline, the intended behavioral assertion failure and a passing restored run.
Both complete safety suites execute in every phase: 34 tests, no skipped cases.
Missing drain and shutdown validation are removed independently; workspace,
attempt and release binding are also removed independently. Restored source
SHA-256 is `032267ff01a1e803e00cf6a759cce050b59438dd758a5fa05b3826fb9ee592b1`.

Primary B4 integration passes 10 tests/3 suites; retained regressions pass
611 tests/63 suites, with API/source-test typechecks, explicit changed-file lint
and standalone CT-8. Exact commands, hunks, exits, logs and restoration receipts
are under `tmp/base-api-evidence/B4/slice-14/`. Temporary mutation tooling is
retained there and excluded from the delivered source.

This adapter packet does not qualify the complete B4 integration mutations.
`base-api-b4-mutation-required` still refuses the absent full runner with exit 2.
Slice 15 must retain that gate, receive qualified B3 by merge commit and qualify
the exact resulting SHA. Operational inputs and deployed shutdown remain
unverified. After the scoped switch, recovery remains protected forward resume.

## Slice 15: activation commands and recovery evidence

This section is the operator runbook. It records only already tested
synthetic commands and their evidence. It authorizes no operational activation,
deployment or production shutdown.

Run the dispatcher on the same owned disposable campaign for both calls.
Keep `tmp/base-api-evidence/B4/l6/` and the campaign database across the
interruption and resume phases. Clean the campaign only after its evidence
is captured. Never point the dispatcher at an operational target.

Tested L6 operator invocations, each exiting 0 on project
`radar-test-base-api-b1`, database `radar`, PostgreSQL system identifier
`7700099786958155814`, started `2026-10-24 05:19:51.51585+00`:

```sh
rtk make -f tools/make/base-api.mk base-api-activate-personal BASE_API_WORKSPACE=248ebbb7-2c4d-44cb-8985-d8eafb1faea4 BASE_API_ACTOR=synthetic-l6-manager BASE_API_REASON='synthetic L6 $(shell touch injected) `touch injected`' BASE_API_MAINTENANCE_ATTEMPT=22222222-2222-4222-8222-222222222222 BASE_API_RELEASE=synthetic-l6-release BASE_API_INSTANCES='synthetic-old-a synthetic-old-b' BASE_API_MAINTENANCE_EVIDENCE=tmp/base-api-evidence/B4/l6/operator/maintenance.json API_PORT=18911 UI_PORT=15911 MAILDEV_UI_PORT=11911 ENV=test-base-api-b1
rtk make -f tools/make/base-api.mk base-api-resume-personal BASE_API_WORKSPACE=248ebbb7-2c4d-44cb-8985-d8eafb1faea4 BASE_API_ACTOR=synthetic-l6-manager BASE_API_REASON='synthetic L6 $(shell touch injected) `touch injected`' BASE_API_MAINTENANCE_ATTEMPT=22222222-2222-4222-8222-222222222222 BASE_API_RELEASE=synthetic-l6-release BASE_API_INSTANCES='synthetic-old-a synthetic-old-b' BASE_API_MAINTENANCE_EVIDENCE=tmp/base-api-evidence/B4/l6/operator/maintenance.json API_PORT=18911 UI_PORT=15911 MAILDEV_UI_PORT=11911 ENV=test-base-api-b1
```

Literal transport is proven: the dispatcher preserves Make functions and shell
syntax without evaluation. Missing, foreign or stale inputs and stale script
bytes reject before any mutation. The calls above changed legacy/closed epoch state
into scoped/open state with one stream, binding and head. Already-open resume
preserved every public SQL row byte for byte. Missing drain, missing shutdown
and foreign workspace/attempt/release each exited 2 with unchanged SQL bytes.

Bindings per call: `BASE_API_WORKSPACE`, `BASE_API_ACTOR`,
`BASE_API_MAINTENANCE_ATTEMPT`, `BASE_API_RELEASE` and `BASE_API_INSTANCES`
are independent operator inputs, never inferred from the evidence file. The
evidence file must be a regular nonempty JSON file below
`tmp/base-api-evidence/`, mounted read-only at `/maintenance-evidence.json`.

Recovery after interruption, on the same database:

| Durable state | Required recovery |
|---|---|
| Legacy, barrier committed | Keep public 503; retry protected activation only after fresh authorization and evidence. |
| Scoped, barrier committed | Forward resume through internal readback; never rerun legacy activation. |
| Scoped, open | Reauthorize; return status without changing SQL bytes. |
| Unreadable or ambiguous | Stay closed; never default back to legacy serving after restart. |

Durable restart reuses `readDurableLegacyRetirement` through `createApp`:
closed barrier returns 503 on legacy paths, proven scoped epoch returns 410,
and any read error, missing proof or ambiguous epoch starts closed. Four
temporary real-entrypoint tests prove 503 then 410 across activation, plus
closed start on unavailable storage. Stream retirement alone proves nothing.

B34 integration evidence, received in this chain without new shared writes:
`B123_SHA 1c304311` at 471 tests/96 suites; integrated `a1f20d7a` at 946
tests/123 suites; final `d779d460` with twelve mutation families at 0/1/0,
restored bytes identical, final pass at 26 tests/6 suites, both typechecks,
explicit lint, CT-7 on the witness baseline and CT-8 on fresh, upgraded and
rerun databases. Application and migrations at `d779d460` are identical to
`a1f20d7a`; `app.ts`, `index.ts`, `auth.ts`, `schema.ts` and SQL bytes are
unchanged. Receipt `ct2-l7.md` and runtime receipts are retained in the B34
evidence lane. The final standalone bundle follows tranche 15; a future ARTEFACTS join
requires its own frozen-order CT-8 and exact-image CT-9.

Stop and drain all three source writers (`ogc-pull`, `populate-geo`,
`projection`) before any reconciliation. Any coexistence needs its
deterministic PostgreSQL lock-order proof. No operational stop is executed
here.

Outstanding operational inputs, still unverified: real workspace, actor,
reason, maintenance attempt, release, instance roster, qualified maintenance
evidence, qualified mapping, drain proof, old-instance shutdown proof, writer
coverage, manifest and D5 dispositions, deployment access and target database
identity. B5, final reviews, remote CI and combined delivery keep their scope.

## Preprod short path: P1/O1 operator vehicle

This section governs the preprod personal-signals/baskets path
(6G + attachments + 6H), with 6K closed. It delivers an administrator-operated vehicle, not a
deployment or an activation receipt. **Do not open 6H until the successor MCP
adapter for `search_signals` is deployed and qualified.** UI-H, P2/6K and the MCP
implementation are separate deliveries. UI and MCP remain unavailable during
this API-only window; CD remains frozen by default.

Use `deploy/base-preprod/operator.mk` from the repository root. It includes no
other Makefile, discovers no environment file and runs no host Node/Python.
Prerequisites are GNU Make, Bash, jq, kubectl, gh, RTK and an authorized namespace
administrator. The conductor needs no exec/admin identity. Never extract a Secret,
print container environments, transfer cookies/bearers, or put access parameters
in references. The Job consumes existing ConfigMap/Secret **references** only.

Prepare owner JSON outside Git using `deploy/base-preprod/owner-input.example.json`.
Every angle-bracket value is deliberately rejected until replaced. Subjects are
opaque explicit inputs. Preserve immutable per-action input files and evidence.
Remove optional fields that are not yet applicable (especially attachments before
initialization), rather than leaving unused placeholders in the input document.
`database` must match the effective database name, role and schema. The release
reference starts with the full 40-character SHA and points to the qualified image
digest dossier. Supply backup SHA-256 and a restore-rehearsal receipt/timestamp;
this tool neither dumps nor restores the operational database.

The operator image must be built with `GIT_SHA` equal to the **full** release
SHA. `/workspace/api/release-sha` is written in the image layer and checked
before any database connection; an environment override cannot change that
identity. Images stamped with a short SHA must be rebuilt for this vehicle.
CI passes the full commit SHA to the API Dockerfile, including build-at-tag;
the Dockerfile rejects nonempty release identities other than 40 lowercase hex
characters (`unknown` remains the local-build default, refused by the operator).
Image tags and UI `build.json` keep seven characters. CD compares API `/health`
against the full SHA and UI against the short SHA; rollback recognizes either
full API identities or their failed seven-character release tag.
Use the published platform manifest digest observed in the pod's `imageID`,
not a multi-platform index or a local image configuration ID. Collection
compares the input, Job template, pod specification, runtime digest, full
receipt and termination receipt. A mismatch retains the boundary and fails.

Initially bind the target workspace slug with `workspaceId:null` for inspection
and initialization. The initializer creates or resolves its UUID; copy the actual
`result.workspaceId` into subsequent inputs. Never invent a destination UUID.
Use a fresh `jobName` per action. Set `operation` to the exact script action.
An `init` input with any non-null workspace UUID is refused, including replay.
The returned UUID is resolved back to the declared slug before emitting the
receipt; collection checks `result.workspaceSlug` as well.
The two distinct subjects in `moderators` and `managers` must be the same approved
pair. Include **every** approved account in attachments, including empty history.

The examples below are templates for the administrator, not commands executed
against preprod by this delivery. Every OUTPUT is a new absolute directory.

```sh
rtk make -f deploy/base-preprod/operator.mk validate INPUT='<OWNER_INPUT_JSON>' OUTPUT='<NEW_VALIDATION_DIR>' ENV=preprod
rtk make -f deploy/base-preprod/operator.mk permissions INPUT='<OWNER_INPUT_JSON>' OUTPUT='<NEW_PERMISSION_DIR>' ENV=preprod
rtk make -f deploy/base-preprod/operator.mk inventory INPUT='<OWNER_INPUT_JSON>' OUTPUT='<NEW_INVENTORY_DIR>' ENV=preprod
rtk make -f deploy/base-preprod/operator.mk render-job INPUT='<INSPECT_INPUT_JSON>' OUTPUT='<NEW_RENDER_DIR>' ENV=preprod
rtk make -f deploy/base-preprod/operator.mk inspect INPUT='<INSPECT_INPUT_JSON>' OUTPUT='<NEW_INSPECTION_DIR>' ENV=preprod
rtk make -f deploy/base-preprod/operator.mk init INPUT='<INIT_INPUT_JSON>' OUTPUT='<NEW_INIT_DIR>' ENV=preprod
rtk make -f deploy/base-preprod/operator.mk attach INPUT='<ATTACH_INPUT_JSON>' OUTPUT='<NEW_ATTACHMENT_DIR>' ENV=preprod
```

Inspection performs a repeatable-read, read-only transaction: identity, release
migration hashes, approved `id/sub/status`, workspace identities, memberships,
separate capabilities, attachments and discrepancies, global 6H/6K states,
effective table/lock/function/index-owner privileges and transaction counts.
It does not query documents, event payloads, account names/emails, connection
parameters or other sessions' SQL. A missing migration/table fails closed;
inspection never migrates or repairs it. Compare the readback with the ratified
roster/grants; excess grants require the audited membership command.

All Jobs use the qualified API digest, `/workspace`, `radar-app`, no automounted
service-account token, uid/gid 1001, no privilege escalation, no retry, 540-second
deadline and permanent `/bin/false` readiness. Check `radar-api`'s selector and
`publishNotReadyAddresses`, and verify no ready EndpointSlice selects the Job.
Do not exec into a scaled-down API Deployment. A compact termination receipt
hashes the complete stdout receipt; collection checks both. Job Complete alone
is insufficient. Keep the Job on any failure, and retain the full hashed evidence.
Both Complete and Failed outcomes trigger collection. A nonzero script outcome
still fails the Make command after retaining its verified receipt, including
`activation-committed-readback-pending`. To recover receipts without creating
or mutating any Job, use a fresh OUTPUT directory:

```sh
rtk make -f deploy/base-preprod/operator.mk collect-job INPUT='<EXACT_JOB_INPUT_JSON>' OUTPUT='<NEW_COLLECTION_DIR>' ENV=preprod
```

Freeze and close before the first 6H transition. `freeze-cd` saves the workflow
state, disables `build-push-images.yml`, and refuses remaining nonterminal runs.
Only explicitly listed numeric `cancelRuns` are cancelled. Never toggle
`PREPROD_CD_ENABLED`: its false branch can select the historical prod path.

Author an independent `expected-instances.json` array from the initial inventory:
each entry has `id` (old pod UID or external process identifier), `role`, and
preferably image/owner metadata. Cover API, UI nginx, MCP, readers, writers,
publishers, workers, SSE, requests/buffers and external launchers. The roster
must be nonempty and unique. Do not derive it from maintenance evidence.

```sh
rtk make -f deploy/base-preprod/operator.mk freeze-cd INPUT='<OWNER_INPUT_JSON>' OUTPUT='<NEW_FREEZE_DIR>' ENV=preprod
rtk make -f deploy/base-preprod/operator.mk close INPUT='<OWNER_INPUT_JSON>' EXPECTED='<INDEPENDENT_ROSTER_JSON>' OUTPUT='<NEW_CLOSURE_DIR>' ENV=preprod
rtk make -f deploy/base-preprod/operator.mk stop-job INPUT='<INPUT_WITH_RECORDED_STOPJOB_NAME_AND_UID>' OUTPUT='<NEW_STOP_DIR>' ENV=preprod
```

Closure requires no Traefik CRD or cluster-scoped installation. Set
`maintenance.service` to a fresh `base-maintenance-<attempt>` Service name and
`maintenance.ingresses` to **every** namespace Ingress, including content hosts.
The tool refuses incomplete coverage. Before any routing mutation it saves
`ingress-snapshot.json` (binding, image, name, UID, resourceVersion, complete spec). Original
replicas/images, CronJob suspend states/schedules, Jobs, relevant annotations
and workflow state are also retained. Restricted evidence is checksummed on exit.

It creates a selectorless ClusterIP Service on port 80, checks that neither
EndpointSlices nor legacy Endpoints contain addresses, and rewrites **all**
Ingress path backends and default backends to that Service. JSON Patch tests
the original UID, resourceVersion and complete spec before replacing the spec.
Each patch response records the closed spec and resourceVersion in
`closedIngresses` inside the snapshot. Hosts, TLS,
Ingress class and annotations, including existing middleware chains, survive.
All public callers, including the operator, receive refusal (normally HTTP
503; controller handling of an empty backend can also produce 404). No status
code alone proves closure: readback verifies the Service, zero endpoints and
every backend again. The operator Job remains never-ready and unexposed.
The tool then suspends
all namespace CronJobs and scales consumer Deployments to zero, leaving
`radar-postgres` intact. Existing Jobs are not stopped by suspension: wait for
completion or use the separate UID-preconditioned `stop-job` recipe. Explicitly
stop other StatefulSet/DaemonSet/external consumers; the collector refuses any
surviving process. This is process termination, not a claim of graceful drain.

Verify refusal from independent external sources across all public hosts/paths.
Use the namespace-admin Job for maintenance: namespace administration never
replaces the approved business actor, membership or operation-specific rights.
After activation, Q1/Q2 use a namespace-admin loopback tunnel to the qualified
API, still requiring an authenticated business session; public routes remain
on the refusal Service until Q2 passes. Preserve hostname/TLS/OIDC and do not
copy credentials into evidence. The operator needs `pods/portforward` create
authority for this tunnel. Keep full route snapshots in restricted evidence
storage, never environment dumps or document content.

Ingress routing alone does not close direct network paths. Before closure or
API access, the tool inventories **all** namespace Services, EndpointSlices,
legacy Endpoints, pod/workload host networking and discoverable alternative
routes. It refuses NodePort, LoadBalancer, ExternalName, external IPs, nodePort
fields, unready address publishing, hostNetwork and hostPort (including init
containers and suspended workload templates). Nonempty alternative route or
custom network-policy resources, including Gateway API/Traefik routes, are
unsupported and refused; failed discovery/list permissions also fail closed.
During closed maintenance, every ready endpoint must identify an inventoried
database pod by name and UID. Q1/Q2 may additionally admit qualified API-image
pods under the verified network boundary. There is no three-Service exception.

The supported policy shape is namespace-wide default-deny ingress. Additive
ingress grants may target database pods exclusively, or admit only Traefik
pods (`app.kubernetes.io/name=traefik`) in namespace `traefik` or `kube-system`,
using both pod and namespace selectors. Broad intra-namespace/UI/MCP grants,
IP blocks and unsupported selectors are refused, even if currently unused.
The tool **does not install or rewrite policies**. An administrator must prepare
and independently verify this isolation before attempting maintenance; existing
policies are never assumed compatible. Required permissions stay namespace-scoped.

Supply `maintenance.networkIsolation`: an attestation with exact `binding`,
`image`, `context`, `namespace`, immutable `reference`/`sha256`, fresh UTC
`observedAt` (at most 24 hours), `passed:true`, `policySha256`, and true
`networkPolicyEnforced`, `podIPDenied`, `serviceIPDenied`, `nodeOriginDenied`.
`policySha256` hashes the newline-terminated canonical output of:
`jq -Sc '[.items[]|{metadata:(.metadata|{name,uid,resourceVersion}),spec}]|sort_by(.metadata.name)'`
on the live NetworkPolicy list. Inventory receipts retain that hash and the
full attestation. The probes must exercise consumer-selected canaries/pods,
direct pod IPs and Service IPs from same-node, other-node, cross-namespace and
node-origin sources, plus public/alternative ports; keep the actual probe
results and source/node coverage. Kubernetes policy acceptance is **not** proof
that the CNI enforces it, and node-origin exceptions must be tested explicitly.
The authenticated administrator tunnel remains the qualified exception.
Missing/expired/foreign probes, changed policies, unsupported CNI or failed
probes cause an explicit refusal. Do not set a boolean from inference. Cluster
support and direct-network closure remain unverified until these real probes pass.

If closure must be undone while consumers are still stopped, explicitly restore
the saved complete specs, using the same binding/image and independent roster:

```sh
rtk make -f deploy/base-preprod/operator.mk restore-ingresses INPUT='<OWNER_INPUT_JSON>' EXPECTED='<INDEPENDENT_ROSTER_JSON>' ROUTES='<CLOSURE_DIR>/ingress-snapshot.json' OUTPUT='<NEW_RESTORATION_DIR>' ENV=preprod
```

Restoration requires frozen CD, full closure, no surviving process/active Job,
zero consumer replicas/endpoints and suspended CronJobs. It checks **all** saved
Ingress UIDs before the first patch and compares **every** current spec with
the closed state derived from the initial snapshot, as well as its saved
post-closure resourceVersion. Host, TLS or metadata/version divergence is
refused before any patch. Each restoration patch atomically tests the saved
UID/resourceVersion/closed spec, then replaces only the spec. A concurrent
write between preflight and patch fails explicitly; it is never accepted as
the new baseline. Final readback compares the restored specs with the initial
snapshot, ignoring the resourceVersion advanced by restoration itself.
Old snapshots without complete `closedIngresses` versions are refused.
The tool never restarts a
consumer, unsuspends a schedule, reenables CD or changes database state. An
identity/concurrent-change/readback failure retains evidence and requires
inspection; no automatic rollback is attempted. The empty refusal Service can
remain inert. After a scoped transition, recovery remains forward-only; exact
route restoration does not authorize restarting legacy consumers.

Prepare observation JSON with `binding` and `image` identical to the input, and
`observations.networkAllowed`, `networkDenied`, `sessionRequired`,
`externalStopped`, `streamsTerminated`, `mcpSuccessor`. Each attestation carries
the same `binding`, `reference`, `sha256`, `observedAt` and `passed:true`;
`mcpSuccessor` also carries its qualified image digest. Embed the complete
post-closure inspect receipt as `databaseInspection`. Use actual observations,
not synthetic campaign evidence. Timestamps are UTC ISO-8601 and at most
24 hours old, including the backup restore rehearsal. The seven-day 6H runner
limit remains unchanged; this operator vehicle uses a tighter freshness gate.
With CRD-free closure, `networkAllowed` attests authorized Job/tunnel access;
`networkDenied` attests public refusal for all sources. `sessionRequired`
attests business authorization and unauthenticated HTTP refusal through the
tunnel (or the pre-closure session check, followed by the Job's business-actor
checks while all consumers are stopped). These existing receipt fields do not
assert a public IP exception.

```sh
rtk make -f deploy/base-preprod/operator.mk collect-maintenance INPUT='<ACTIVATION_INPUT_JSON>' EXPECTED='<INDEPENDENT_ROSTER_JSON>' PROOFS='<ACTUAL_OBSERVATIONS_JSON>' OUTPUT='<NEW_MAINTENANCE_DIR>' ENV=preprod
rtk make -f deploy/base-preprod/operator.mk activate INPUT='<ACTIVATION_INPUT_JSON>' EXPECTED='<INDEPENDENT_ROSTER_JSON>' PROOFS='<COLLECTED_MAINTENANCE_JSON>' OUTPUT='<NEW_ACTIVATION_DIR>' ENV=preprod
rtk make -f deploy/base-preprod/operator.mk resume INPUT='<RESUME_INPUT_JSON>' EXPECTED='<INDEPENDENT_ROSTER_JSON>' PROOFS='<FRESH_COLLECTED_MAINTENANCE_JSON>' OUTPUT='<NEW_RESUME_DIR>' ENV=preprod
```

The collector verifies stopped old UIDs, no newly running consumers, zero
consumer replicas, suspended schedules, no active Jobs, no ready consumer
endpoints, API Service selector/no publishing of unready addresses, disabled CD
and no nonterminal Actions runs. It checks DB migration/roster/attachment,
manager, lock/drop/function/statistics authority and quiet transaction receipts.
`base-preprod-rights.json` is the shared per-operation SQL matrix. SELECT FOR
SHARE/UPDATE needs UPDATE, which DELETE/TRUNCATE lock authority cannot replace.
Activation requires all five ACCESS EXCLUSIVE locks (including bindings),
context insertion, state updates, function execution and effective index-owner
authority. The Job rechecks actual rights before launching any mutating child;
missing privileges never trigger automatic grants or barrier persistence.
It derives drain/shutdown coverage from the independent roster after these
controls; the separate stream/buffer/external observations remain mandatory.
Activation/resume repeat live closure checks and verify that the configured MCP
Deployment actually references the qualified successor digest. Reappearance
invalidates the window. JSON declarations alone never establish real maintenance.

For recovery after a scoped epoch, keep the boundary and use protected forward
`resume`; never recreate the old index, alter barriers by SQL, or roll back to
an unqualified old image. Ambiguous/unreadable state stays closed.

After successful activation, start a new qualified API under the same operator
boundary. Keep 6K configuration absent. `start-api` leaves every public Ingress
on the refusal Service; the qualified API and legacy retirement checks are
reachable through the administrator tunnel. UI/MCP stay at zero.

```sh
rtk make -f deploy/base-preprod/operator.mk start-api INPUT='<OWNER_INPUT_JSON>' PROOFS='<FULL_ACTIVATION_RECEIPT_JSON>' OUTPUT='<NEW_RESTRICTED_START_DIR>' ENV=preprod
rtk make -f deploy/base-preprod/operator.mk tunnel-api INPUT='<OWNER_INPUT_JSON>' OUTPUT='<NEW_TUNNEL_DIR>' ENV=preprod
rtk make -f deploy/base-preprod/operator.mk restart-api INPUT='<OWNER_INPUT_JSON>' PROOFS='<Q1_ACCEPTANCE_JSON>' OUTPUT='<NEW_RESTART_DIR>' ENV=preprod
rtk make -f deploy/base-preprod/operator.mk reopen-api INPUT='<OWNER_INPUT_JSON>' PROOFS='<Q1_Q2_ACCEPTANCE_JSON>' OUTPUT='<NEW_REOPEN_DIR>' ENV=preprod
rtk make -f deploy/base-preprod/operator.mk delete-job INPUT='<EXACT_JOB_INPUT_JSON>' PROOFS='<SAVED_TERMINATION_JSON>' OUTPUT='<NEW_JOB_DELETION_DIR>' ENV=preprod
```

Q1/Q2 acceptance is a separate JSON document with exact `binding` and `image`,
`personal:{writerEpoch:"scoped",maintenanceBarrier:false}`, `lotsOpen:false`,
and `mcpSuccessorDeployed:true`. `q1` and `q2` each carry `reference`, `sha256`,
UTC `observedAt` and `passed:true`; Q2 additionally requires `afterRestart:true`
and an observation after Q1. Q1 is required to request the restart; both are
required to reopen. Re-read durable states and actual served image in each pass.
Each qualification also carries `instance`, copied from the relevant
`api-instance.json`: deployment UID/generation, template hash, restart annotation,
pod UID, container ID, restart count, start time, image and runtime image ID.
`restart-api` verifies Q1 against the live instance, then writes `restart.json`
after rollout. Embed that full object as `restart` in Q2 acceptance and copy
its `instance` into `q2.instance`. Q2 must be observed after the restart
completion, container start and restart annotation. Reopening compares Q2 to
the live instance again: another rollout, configuration change, replacement
pod or container restart invalidates Q2 even with the same digest and attempt.
Requalify Q1/restart/Q2 for the current instance; never reuse an older receipt.
These fields summarize the referenced full tests; they never replace them.

Under authenticated sessions through the administrator tunnel, qualify workspaces, coherent-city signals,
personal baskets, archive/reason/reveal, idempotent replay, conflicts, scoped
projections/SSE, two-member isolation and scoped refusal after revocation.
Do not revoke the owner/moderator as a test. After restart, verify the retained
authority and retirements again: `/api/graph-signals/:city`, `/api/graph-signals/by-city`
and the old `/api/v1/signal-facets` endpoints must return **410**, not 404 or empty
200. A closed retirement fence returns 503. `/api/graph/:city` is a separate
mounted route and has no expected 410. Personal BASE lot reads remain
**503 `lot_cutover_closed`**. Legacy prospect marks are not retired by 6H and
remain excluded from this profile. No lot grants, mapping or 6K transition occurs.

`reopen-api` rechecks the qualified API image, stopped other consumers, suspended
schedules, no active Jobs and frozen CD, then exposes only health/auth/workspace
prefixes on the preprod hostname, preserving existing annotations and TLS.
All other Ingress backends remain on the refusal Service; UI/MCP remain stopped.
Verify public paths and excluded
surfaces immediately and retain the final receipt. Announce only personal
signals/baskets API availability.

CronJobs initially suspended stay suspended. Restore only initially active,
individually qualified writers using the saved inventory and a separate explicit
administrator change; this API-only recipe restores none automatically. Keep CD
disabled until a separately delivered partial-profile reconciler preserves this
routing, consumer set, writer authority and rollback constraints. A green rollout
or Complete Job does not restore either launchers or public access. In an
emergency, re-establish the boundary and stop affected consumers; preserve DB
barriers and evidence. A database restore is a separate fully stopped operation.

## B5 standalone acceptance profile

B5 proves the B1–B4 implementation through `createApp` and PostgreSQL,
with artifact configuration absent and no live artifact backend:

- B5.1: composed lot authority, transitions, destination/source-history
  pagination and exact receipt replay with deterministic SQL snapshots
  (`base-api-lot-{http-fixture,authority,transitions,receipts}.spec.ts`).
- B5.2: deterministic command races (one 200, one 409, one committed
  transition), identical-key replay with one SQL mutation, stale
  fingerprint conflicts returning the current version, revoked replay
  denials and atomic 500-target batches with replay (`base-api-lot-
  {concurrency,batches}.spec.ts`).
- B5.3: `base-api-cutover-readback.spec.ts` observes public 503 before
  and during the qualified persisted 6K empty readback, then public 200
  and the first ordinary mark without any fabricated history. It also
  attempts unresolved-only activation and checks SQL closure/public 503.
  `base-api-lot-closed-replays.spec.ts` closes an already-populated
  destination and refuses existing single/batch receipts without mutation.
  `base-api-cutover-acceptance.spec.ts` retains additional gate
  and explicit legacy 503/410 witnesses. Proof-binding, protected interruption, forward
  resume, current authority and durable reconstruction remain qualified by
  inherited `base-api-activation{,-resume}.spec.ts`,
  `base-api-mutation-closure.spec.ts` and `base-api-cutover-bound.spec.ts`.
- B5.4: successful BASE operations with absent configuration, zero
  artifact backend calls observed by counting/failing boundary doubles,
  and the closed control router staying `cookie`/`origin` guarded
  (`base-api-independence.spec.ts`).
- B5.5: `docs/spec/SPEC_BASE_API.md` is the single normative
  specification; this section is the B5 runbook delta.

What B5 does not do: no `stop`/`down -v` outside the Sol-owned
`radar-test-base-api-b5` project, no dev/UAT change, no production
access or activation. The three source writers (`ogc-pull`,
`populate-geo`, `projection`) stay drained before any reconciliation.
Standalone CT-8 governs this delivery; combined CT-8/CT-9 waits for the
frozen combined journal and the exact combined image. Evidence is synthetic;
exact tested revisions, commands, results and review receipts are recorded in
`tmp/base-api-evidence/B5/report.md` outside source commits. Final executed
evidence at `965cd42b` (2026-10-24): final API `20261024T191509-28-b5-verify`
with 3,549 passed and required 150 suites with 1,072 passed; B5 mutations
`20261024T190434-28-b5-mutation-required` with 15 strict `0/1/0` cycles;
B4 rerun `20261024T184504-24-b4-mutation-required` with 19 strict `0/1/0`
cycles; compatibility `20261024T191018-24-b2-6l2` with UI 262/262 and MCP
217/217; bundle SHA-256
`907bca19e319d18b6ab83851bd1a54fecb55637d8efb3ed76ff3cd5cb2e209d5`.
Receiving-branch integration and operational activation have their own
receipts and are not established by the B5 branch bundle.
