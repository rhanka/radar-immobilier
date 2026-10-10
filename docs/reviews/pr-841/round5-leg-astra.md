---
status: completed
reviewer-host: codex
reviewer-model: gpt-6-astra
reviewer-effort: xhigh
target-ref: ops/bascule-restore-daily@5cef739f525e83aec94393dd014b718a9e2b8ba8
round: 5
---

## Reasoning

Reviewed `origin/main...5cef739f525e83aec94393dd014b718a9e2b8ba8`, with focused
review of every hunk in `a77307a6..5cef739f525e83aec94393dd014b718a9e2b8ba8`.
HEAD is the requested detached commit; origin/main is
`ab7f4e70e9b05b6637cb1eb4a6769923cfb169e6`. The latest delta changes only
`bascule.mjs` and `restore-mode.selftest.mjs`: 45 insertions, 11 deletions.
Only my own round-4 review was read. This is an independent leg, not a
consensus verdict.

All four round-4 findings are **fixed**. The new refusals distinguish an
unsuccessful read from a successful empty optional field. The additional Job
changes also reject a failed deletion before apply/create, discard successful
status JSON emitted by a failed process, and refuse asynchronous refresh
confirmation on a failed final read. No new runtime defect meeting the supplied
blocking rule was demonstrated.

### Legitimate-run compatibility and RBAC

- **Optional fields:** `bascule.mjs:504` checks the current-replica read's
  status before `:506` maps successful empty output to zero. The quiesce drain
  does the same at `:677`–`:680`. A successful empty `.spec.suspend` still
  records false at `:628`; explicit true stays true. Controls covering empty
  current replicas, explicit zero, absent CronJobs and empty suspension all
  passed. A successful nonzero current-replica read still refuses G2.
- **Absent Jobs:** the drain lookup at `bascule.mjs:666` now uses
  `--ignore-not-found`. Successful empty output ends the drain; nonzero status
  cannot be interpreted as absence. Both previous-instance deletions retain
  their existing `--ignore-not-found` (`:878`, `:1122`); their new checks reject
  nonzero status, not empty stdout. Successful empty deletion responses permit
  the restore and forced-refresh controls. The probes model kubectl's
  successful-absence contract; actual `kubectl get/delete` exit codes and API
  defaulting are **unverified** here, because the permitted real kubectl
  operation is offline kustomize only.
- **Authorization:** the delta adds no resource operation or RBAC verb. Reading
  `.status.replicas` uses the existing `get deployments`, not a request to the
  `/status` subresource. CronJob reads/patches and Job reads/lists/deletes were
  already issued. G2 already requires a successful Job list
  (`bascule.mjs:525`–`:527`) and suspended CronJobs (`:509`–`:512`). The supplied
  October 2 evidence says the bascule identity successfully executed both
  deletion forms and CronJob patches; those logs were **unverified** offline,
  but there is no evidence here of missing permission. The bascule RBAC files
  in this repository describe additions, not a complete effective grant
  (`rbac-ci-bascule-preprod-pods-read.yaml:1`,
  `rbac-ci-bascule-preprod-docs-secret.yaml:1`). I do not infer missing Job
  permissions from those additive files.
- **Separate forced refresh:** `.github/workflows/bascule-refresh.yml:16` and
  `:68` use the deployer identity; its repository Role grants Job
  create/get/list/watch/delete at `deploy/k8s/11-ci-deployer-preprod-rbac.yaml:89`.
  The daily restore does not invoke forced refresh. Failed reads now refuse
  its asynchronous success, while successful empty status still permits the
  inherited asynchronous pending result. That result is not evidence of a
  completed refresh, and it does not weaken a restore guard.

### Recovery after a quiesce refusal

The ordering is explicit: discover CronJobs, read all original replicas and
suspension values, write `quiesce-state.json` at `bascule.mjs:630`, then scale
Deployments at `:634` and patch CronJobs at `:635`. An unreadable original
suspension value fails at `:627`, before the state write and every mutation.
With no state file, un-quiesce returns without mutation at `:703`–`:710` for a
scheduled run (`SKIP_QUIESCE=false`). The probes confirm both properties.

A failed suspend patch, Job-list read, or Deployment drain happens **after**
the complete snapshot. All present CronJob patches are attempted before the
patch-failure refusal. Stateful probes confirm that the snapshot exists before
every mutation and that un-quiesce subsequently restores original Deployment
counts 1 and 2 and original true/false CronJob suspension. A persistent recovery
patch failure returns 1 while still attempting the remaining CronJobs, as
implemented at `bascule.mjs:731`–`:740`.

The workflow uploads the state even after a failed quiesce
(`.github/workflows/bascule-preprod.yml:480`–`:485`), and its un-quiesce step
has `always()` without a quiesce-success predicate (`:546`), using the same
job-level work directory (`:241`) and a 15-minute step budget (`:547`). An
ordinary quiesce refusal therefore reaches recovery; intervening restore steps
do not override GitHub's default success condition. Actual Actions scheduling,
artifact upload and recovery against Kubernetes are **unverified** offline.
Runner loss and job cancellation remain outside the demonstrated recovery
case; the existing workflow documents that limitation at `:156`–`:160`.

The failed active-Job read retains a deadline warning and can still end quiesce
with exit 0. It no longer claims that the Job drained. The probe then presents
the still-active Job to G2, which refuses before either apply. This is the
retained best-effort behavior with its final guard, not a new blocker.

### Schedule scope

The owner-selected **daily 04:00 UTC** remains unchanged in this round
(`.github/workflows/bascule-preprod.yml:77`). The arming condition remains at
`:137`. The rendered-window check reports 97 minutes after the backup start
and 60 minutes before the next refresh start. These are configured start
separations, not completion guarantees. No new conflict at 04:00 is
demonstrated, and no alternative hour is proposed. Actual durations, GitHub
launch delay, external IdP activity, shared-node capacity, backup freshness,
effective RBAC, arming value and remote CI remain **unverified** offline.

## Previous findings status

All short source paths below are under `deploy/ci/bascule-preprod/`.

| Round-4 finding | Status | Evidence at this head |
| --- | --- | --- |
| **ASTRA-841-R4-01 — failed current-replica reads pass G2** | **fixed** | `bascule.mjs:504` refuses the unreadable G2 count; `:677`–`:680` requires a successful read for the drain. Exit 7, SIGTERM and SIGKILL probes, even with stdout `0`, return 1 before rollback/restore apply. Quiesce also fails at the injected deadline and its saved state permits recovery. Successful empty/zero controls apply both Jobs; current replicas `1` refuses. New selftest at `restore-mode.selftest.mjs:869` passes. |
| **ASTRA-841-R4-02 — failed Job-list read skips draining** | **fixed** | `bascule.mjs:647`–`:648` refuses the unsuccessful list. Exit 7, SIGTERM and SIGKILL, including complete empty-list JSON on stdout, produce exit 1 and no `QUIESCE OK`. Snapshot precedes mutations; recovery returns 0 with original settings. New selftest at `restore-mode.selftest.mjs:880` passes. |
| **ASTRA-841-R4-03 — failed individual Job read reports completed drain** | **fixed** | `bascule.mjs:666`–`:669` uses `--ignore-not-found` and treats failed reads as still active. Exit 7/SIGTERM/SIGKILL with stdout `0` produce a deadline warning, no drained message; G2 independently refuses the modeled active Job. Successful empty lookup after modeled deletion ends the drain. The remaining warning-and-G2 behavior is non-blocking under the supplied severity rule. |
| **ASTRA-841-R4-04 — unreadable original suspension becomes false on recovery** | **fixed** | `bascule.mjs:627` refuses before snapshot persistence (`:630`) or scale/patch (`:634`–`:635`). Exit 7/SIGTERM/SIGKILL leave no snapshot, perform zero mutations, and subsequent un-quiesce is a no-op. Successful empty suspension records false; true and false values survive quiesce/recovery. New selftest at `restore-mode.selftest.mjs:875` passes. |

## Commands and outputs

No cluster, bucket, GitHub API, push or commit operation was performed. The five
requested commands were launched by the throwaway
`node .review-tmp-astra/checks.mjs`, with `TMPDIR` inside
`./.review-tmp-astra/tmp` and `K8S_VALIDATE_WITH_CLUSTER=0`. Child exit codes
were recorded individually. Synthetic CLI probes used a local fake kubectl;
no real Job, Secret or Deployment was changed.

### Target

```text
$ git rev-parse HEAD origin/main
5cef739f525e83aec94393dd014b718a9e2b8ba8
ab7f4e70e9b05b6637cb1eb4a6769923cfb169e6

$ git diff --stat a77307a6..5cef739f525e83aec94393dd014b718a9e2b8ba8
 deploy/ci/bascule-preprod/bascule.mjs              | 32 ++++++++++++++--------
 .../ci/bascule-preprod/restore-mode.selftest.mjs   | 24 ++++++++++++++++
 2 files changed, 45 insertions(+), 11 deletions(-)
```

### Required checks

| Command | Exit | Output |
| --- | --- | --- |
| `node deploy/ci/bascule-preprod/bascule.selftest.mjs` | 0 | `bascule.selftest — 56 passés, 0 échoués` |
| `node deploy/ci/bascule-preprod/restore-mode.selftest.mjs` | 1 | `restore-mode.selftest — 246 passed, 1 failed` |
| `make -f deploy/k8s/refresh-cronjobs/refresh-018.mk verify-renders ENV=review-astra-841` | 0 | `refresh-stagger: ok — prod "0 5,11,17,23 * * *", preprod "0 0,6,12,18 * * *": closest starts 60 min apart; nominal watchdog deletion request by 1200 s`; `bascule-window: ok — restore "0 4 * * *" UTC: 97 min after the backup start "23 2 * * *", next refresh start 60 min later` |
| `bash deploy/k8s/refresh-cronjobs/verify-renders.test.sh` | 0 | `verify-renders tests: 52 passed, 0 failed` |
| `make k8s-validate ENV=review-astra-841` | 0 | `[document-date-recovery] offline render ok (preprod + prod)`; `image entrypoint check: ok (25 reference(s) in 94 file(s), 18 entrypoint(s))`; `[k8s-validate] offline render ok; set K8S_VALIDATE_WITH_CLUSTER=1 for a server dry-run` |

All four assertions added in this commit pass:

```text
ok   CLI restore-backup — G2 current replicas unreadable (signal) ⇒ refused, no rollback/restore apply
ok   CLI quiesce — original suspend unreadable ⇒ exit 1 before any scale/patch
ok   CLI quiesce — Job list unreadable ⇒ exit 1 (drain unknown, not QUIESCE OK)
ok   CLI quiesce — failed suspend patch ⇒ exit 1, named
```

The restore-suite failure matches the round-4 fixture observation:

```text
FAIL node -e — main triggered, exit 1 without the SDK, verdict written (got [2,false,false])
```

The fixture runs the embedded script with only PATH, BR_STEP and TERMINATION_LOG
set. A fresh reproduction resolves the ancestor SDK and refuses missing local
configuration before S3 access:

```text
SDK: /home/antoinefa/src/radar-immobilier/node_modules/@aws-sdk/client-s3/dist-cjs/index.js
exit: 2
verdict: {"ok":false,"step":"resolve","exit":2,"reason":"missing S3_ENDPOINT"}
```

The assertion was neither changed nor counted as passing. Restore-suite
validation is **partial**; remote CI is **unverified**.

### Behavioral probes

```text
$ node .review-tmp-astra/probes.mjs > .review-tmp-astra/probes.log
[exit 0]
Probe assertions: 53 passed; cases: 37
```

The stateful fake recorded each command and whether the snapshot existed before
each mutation. Original Deployments had 1 and 2 replicas; original CronJob
suspension included both true and false. Deadlines were set to zero to exercise
the final refusal without waiting. Failed reads were tested with exit 7,
SIGTERM and SIGKILL, including valid-looking stdout. This tests runner control
flow, not Kubernetes controllers or data-plane execution.

| Probe group | Observed result |
| --- | --- |
| G2 current-replica read failure, 3 cases | Exit 1, zero rollback/restore applies, including stdout `0`. |
| Quiesce current-replica failure, 3 cases | Exit 1; snapshot exists; un-quiesce exit 0 restores original settings. |
| Original suspension read failure, 3 cases | Exit 1; no snapshot; zero mutations; un-quiesce no-op. |
| Job-list failure, 3 cases | Exit 1, no `QUIESCE OK`; state exists before all mutations; recovery exit 0. |
| Active-Job read failure, 3 cases | Deadline warning, no false drained message; quiesce exit 0 followed by G2 exit 1 and zero applies. |
| G2 successful zero / empty / nonzero, 3 controls | Zero and empty each return 0 with two applies; nonzero returns 1 with zero applies. |
| Empty replica and suspension fields | Quiesce exit 0; empty suspension recorded false; original true/false and replica counts restored. |
| One suspend patch fails | All three present CronJob patches attempted; snapshot precedes every mutation; exit 1; recovery after the fault clears returns 0. |
| Suspend patch also fails during recovery | Both commands exit 1; remaining CronJob recovery patches still attempted. |
| Active Job deleted, then successful empty lookup | Quiesce exit 0; lookup includes `--ignore-not-found`; drained message emitted. |
| Previous-instance deletion fails, 6 cases across restore/force-refresh | Exit 1, zero applies/creates. |
| Job read emits `{"succeeded":1}` then fails, 6 cases across restore/force-refresh | Exit 1. Restore applies only G1, never the restore Job; forced refresh creates its Job but does not report success. |
| Forced refresh successful completed / empty pending status, 2 controls | Both return 0; empty status retains the asynchronous result. |
| Missing-SDK fixture diagnostic | Exit 2 with `missing S3_ENDPOINT`; ancestor SDK path shown above. |

## Findings

No new blocking runtime finding was demonstrated in `5cef739f`. The following
is a carried-forward validation issue already described, but not numbered, in
my round-4 leg; it is not attributed to this commit's guard changes.

### ASTRA-841-R5-01 — missing-SDK fixture depends on ancestor module installation

- **Severity:** non-blocking.
- **File:line:** `deploy/ci/bascule-preprod/restore-mode.selftest.mjs:445`
  and `:447` (temporary directory creation at `:199`).
- **Evidence:** The required unmodified selftest returns 1 with 246 passes and
  the failure quoted above. The fixture assumes the SDK cannot resolve from its
  temporary cwd. Under the required repository-local temporary directory,
  Node resolves the ancestor repository's installed `@aws-sdk/client-s3`;
  the exact child instead returns 2 with `missing S3_ENDPOINT`. The fresh
  diagnostic reproduces both the module path and verdict.
- **Impact:** This required local check is not fully passing and is not
  hermetic with respect to ancestor dependencies. It does not demonstrate a
  weakened destructive guard or a blocked legitimate scheduled restore.
  The four newly added assertions pass. Remote CI behavior is **unverified**.
- **Fix:** Owner: PR author/test maintainer. Make the missing-SDK condition
  explicit in the child fixture, for example through a narrowly targeted
  module-loader stub, rather than relying on the host not having the SDK.
  Preserve the expected missing-dependency exit/verdict. Acceptance: the
  unmodified production script's fixture is deterministic with and without
  an ancestor SDK installation, and the complete selftest passes using a
  repository-local TMPDIR without any network access.

## Verdict

**GO-with-nits.** All four round-4 findings are fixed. No new guard bypass,
demonstrated legitimate-daily-run refusal, or lost recovery state was found in
the latest delta. Four required checks pass; the restore selftest remains
**partial** because of the demonstrated fixture issue (246 passes, 1 failure).
All 53 additional probe assertions pass. Live operation and remote CI remain
**unverified**. This verdict is this independent review leg's assessment of
the specified head, not a consensus result or an arming action.

Final verification: `git diff --exit-code` and `git diff --cached --exit-code`
both returned 0 with no output; HEAD is unchanged. `./.review-tmp-astra/` was
removed. The completed review leg is the only retained file written by this
review; no tracked file was modified.
