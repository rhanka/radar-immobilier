# BASE activation and protected recovery

Status: B4 slices 1–7 and standalone tooling preparation only. Activation and
durable resume have scoped PostgreSQL coverage; dispatcher integration,
restart wiring and B3 qualification remain pending. This document does not
authorize operational activation.
B5 and the nominal operational rehearsal retain their original scope and budget.

## Prerequisites

- Receive qualified B12 `4fc755e9f69daae2c32286dd3cf0069c5798ecd0`, including
  B1 `e2994f3646f6d8813bf334a60cfa2dd430e27824` and
  B2 `d033bc18bf9b9537c5c7a69311ebe44b0b545517` by their preserved merge history.
- Obtain a current CT-1 lease before any shared application/startup resolution.
  L3 is released; its receipt is acknowledged, not reused as a B4 grant.
- Receive qualified B3 with its real-writer coverage matrix before the final B4
  gate. Synthetic coverage does not establish deployed-image writer coverage.
- Install the Muse operator script and its internal real reader. Preparing a
  persistent synthetic campaign is still an integration requirement for slice 8;
  ordinary `base-api-verify` removes its database at exit.
- Retain a running, owned `radar-test-*`/`radar-e2e-*` campaign and its immutable
  source archive, runtime dependencies and PostgreSQL database across both calls.
  The dispatcher checks ownership, serializes access and refuses stale script bytes.
- Verify `df -h` before heavy campaigns and stop below 10 GiB available.
  Never load environment files, run Python, target dev, or publish a port here.

## Operator interface

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

## Durable operator recovery; restart wiring still to qualify

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
`base-api-b3-mutation-required` and `base-api-b4-mutation-required` use fixed suites,
require real packet runners and bound each runner to 600 seconds. Missing suites,
runners or receipts fail closed. Each receipt must prove an actual assertion
failure between passing baseline and restored runs, with unchanged selected cases,
no skips, original/mutant bytes, exact patch, command, exits and restored checksum.
The receipt contract is implemented in `tools/make/base-api-required-mutations.mjs`.
The full packet mutation runners remain pending; setup errors do not qualify.
The fixed B4 target is already wired through the dispatcher and bounded to 600
seconds in the container. With the two B4 integration suites still absent it
rejects before creating a campaign, rather than reporting a mutation pass.

Standalone CT-8 fresh/upgrade/rerun and frozen 0022/0023 bytes remain required.
Synthetic databases cannot establish deployment migration state. If ARTEFACTS is
joined, qualify the actual combined frozen order and exact SHA/image under CT-8/CT-9.
Final B4 delivery requires both activation suites, real Make activation/resume,
all retained regressions, qualified B3 reception and a bundle reconstructed from
the full B12 prerequisite. No final B4 bundle is issued for slices 1–8. The
slice-8 rehearsal qualifies operator transport and seeded activation/resume only;
shared retirement/restart wiring, final integrations, mutations and qualified B3
history remain open. After scoped epoch change, use forward resume only.

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
rtk make -f tools/make/base-api.mk base-api-activate-personal BASE_API_WORKSPACE=0f3fb638-55cc-4d00-aa72-31bd9dfe6b6c BASE_API_ACTOR=synthetic-l6-manager BASE_API_REASON='synthetic L6 $(shell touch injected) `touch injected`' BASE_API_MAINTENANCE_ATTEMPT=22222222-2222-4222-8222-222222222222 BASE_API_RELEASE=synthetic-l6-release BASE_API_INSTANCES='synthetic-old-a synthetic-old-b' BASE_API_MAINTENANCE_EVIDENCE=tmp/base-api-evidence/B4/l6/operator/maintenance.json API_PORT=18911 UI_PORT=15911 MAILDEV_UI_PORT=11911 ENV=test-base-api-b1
rtk make -f tools/make/base-api.mk base-api-resume-personal BASE_API_WORKSPACE=0f3fb638-55cc-4d00-aa72-31bd9dfe6b6c BASE_API_ACTOR=synthetic-l6-manager BASE_API_REASON='synthetic L6 $(shell touch injected) `touch injected`' BASE_API_MAINTENANCE_ATTEMPT=22222222-2222-4222-8222-222222222222 BASE_API_RELEASE=synthetic-l6-release BASE_API_INSTANCES='synthetic-old-a synthetic-old-b' BASE_API_MAINTENANCE_EVIDENCE=tmp/base-api-evidence/B4/l6/operator/maintenance.json API_PORT=18911 UI_PORT=15911 MAILDEV_UI_PORT=11911 ENV=test-base-api-b1
```

Database `radar`, PostgreSQL system identifier `7700093356303638567`, started
`2026-10-24 04:54:54.376582+00`, project `radar-test-base-api-b1`: before activation,
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
