# BASE activation and protected recovery

Status: B4 slices 1–6 and standalone tooling preparation only. The activation
entry has scoped PostgreSQL coverage; durable resume, dispatcher integration,
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
| `BASE_API_MAINTENANCE_EVIDENCE` | `--maintenance-evidence` (required JSON file) |

Evidence must be a regular, nonempty file below `tmp/base-api-evidence/`, with
no traversal, environment-file component or symlink ancestor. It is mounted
read-only as `/maintenance-evidence.json`; its contents are never shell arguments.
The dispatcher invokes `api/src/scripts/base-api-personal-activation.ts` with
positional action `activate` or `resume` in the API container on the same campaign.
It never starts a replacement database or silently chooses an operational target.

The received slice-6 script currently accepts flat `--workspace`, `--actor`,
`--reason`, `--maintenance-attempt`, `--release`, repeated `--instance` and
`--evidence-json` flags. It does not implement the dispatcher's evidence-file
interface or durable `resume` yet. Slice 8 must reconcile these interfaces after
slice 7; the reserved Make calls below remain unqualified.

These exact **synthetic examples have not executed a functional activation**:

```sh
rtk make -f tools/make/base-api.mk base-api-activate-personal BASE_API_WORKSPACE=11111111-1111-4111-8111-111111111111 BASE_API_ACTOR=synthetic-actor-1 BASE_API_REASON="synthetic maintenance window" BASE_API_MAINTENANCE_EVIDENCE=tmp/base-api-evidence/B4/maintenance.json API_PORT=18911 UI_PORT=15911 MAILDEV_UI_PORT=11911 ENV=test-base-api-b1
rtk make -f tools/make/base-api.mk base-api-resume-personal BASE_API_WORKSPACE=11111111-1111-4111-8111-111111111111 BASE_API_ACTOR=synthetic-actor-1 BASE_API_REASON="synthetic maintenance window" BASE_API_MAINTENANCE_EVIDENCE=tmp/base-api-evidence/B4/maintenance.json API_PORT=18911 UI_PORT=15911 MAILDEV_UI_PORT=11911 ENV=test-base-api-b1
```

The shell command-double proof tests literal argument transport and rejection of
missing inputs. It is not a database rehearsal. Record exact real commands,
database identity, durable before/after state and exit status once slices 6–8 land.

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

## Durable recovery contract still to qualify

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
low-level guard does not implement already-open operator resume: that later path
must reauthorize and return status with byte-equivalent SQL state.
Seeded mismatches must prevent opening. Recheck rights after readback and before
opening. Public inputs must never enable internal readback. 6H releases its
maintenance barrier; 6K retains legacy closure and opens `destinationOpen`.
Restart tests must prove durable 503/410 and retired publication behavior.
After the scoped epoch commits, recovery is forward resume only.

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

Standalone CT-8 fresh/upgrade/rerun and frozen 0022/0023 bytes remain required.
Synthetic databases cannot establish deployment migration state. If ARTEFACTS is
joined, qualify the actual combined frozen order and exact SHA/image under CT-8/CT-9.
Final B4 delivery requires both activation suites, real Make activation/resume,
all retained regressions, qualified B3 reception and a bundle reconstructed from
the full B12 prerequisite. No final B4 bundle is issued for slices 1–6.
