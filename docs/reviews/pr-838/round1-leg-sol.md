---
status: completed
reviewer-host: codex
reviewer-model: gpt-6.1-sol
reviewer-effort: xhigh
target-ref: fix/refresh-hours@dd8df2ebc8f13775a16521f7409208a382fbc803
round: 1
lens: watchdog-runtime-semantics-and-rbac
---

## Reasoning

Reviewed `git diff origin/main...dd8df2ebc8f13775a16521f7409208a382fbc803`, with HEAD at that exact commit and `origin/main` at `641f48c31a89c9d7bc4f1bc06532728c29018cc8`. This is an independent review leg; the other leg was not read. No cluster or bucket was contacted, and no commit, push, or GitHub write was made. Production behavior remains **unverified**. The live Kubernetes version, feature gates, admission configuration, available node capacity, and namespace quota usage are **unknown**.

### Kubernetes Job semantics

The core failure-counting mechanism is supported by upstream source for the stated defaults. I downloaded the tagged Kubernetes v1.31.0 and v1.34.0 sources from `raw.githubusercontent.com` using `rtk curl --fail --silent --show-error --max-time 30`, storing them only in `.review-tmp-sol/`.

In [v1.34 Job defaulting, lines 62–68](https://github.com/kubernetes/kubernetes/blob/v1.34.0/pkg/apis/batch/v1/defaults.go#L62), a Job without `podFailurePolicy` receives `TerminatingOrFailed`. In [the Job controller, lines 2003–2013](https://github.com/kubernetes/kubernetes/blob/v1.34.0/pkg/controller/job/job_controller.go#L2003), `isPodFailed` returns:

```go
return p.DeletionTimestamp != nil && p.Status.Phase != v1.PodSucceeded
```

The controller's accompanying comment says: “Count deleted Pods as failures to account for orphan Pods that never have a chance to reach the Failed phase.” `onlyReplaceFailedPods` returns false under the PR's defaults. The same predicate is present in [v1.31, lines 1908–1917](https://github.com/kubernetes/kubernetes/blob/v1.31.0/pkg/controller/job/job_controller.go#L1908).

In [v1.34, lines 917–960](https://github.com/kubernetes/kubernetes/blob/v1.34.0/pkg/controller/job/job_controller.go#L917), a newly deleting Pending pod contributes one failure, and `jobCtx.failed > *job.Spec.BackoffLimit` becomes `1 > 0`. The failure branch is evaluated before replacement creation. [Lines 993–1011](https://github.com/kubernetes/kubernetes/blob/v1.34.0/pkg/controller/job/job_controller.go#L993) choose the failure/termination branch instead of `manageJob`, which creates replacement pods. Thus the blanket documentation statement that the default replacement policy recreates terminating pods does not refute this particular `backoffLimit: 0` case.

However, “turns Failed at once” is inaccurate for modern defaults. [Lines 1081–1104](https://github.com/kubernetes/kubernetes/blob/v1.34.0/pkg/controller/job/job_controller.go#L1081) initially choose `FailureTarget`, and [lines 1500–1519](https://github.com/kubernetes/kubernetes/blob/v1.34.0/pkg/controller/job/job_controller.go#L1500) delay the final condition while pods are terminating. The [official Job documentation](https://kubernetes.io/docs/concepts/workloads/controllers/job/#terminal-job-conditions) explicitly describes this delay in v1.31 and later. There is no cluster reproduction in this leg; finalizer handling and observed timing on the incident cluster are **unverified**.

The scheduler releases a scheduled pod's reservation when its informer observes that pod leave the non-terminal set: either API-object deletion or a terminal phase update. The [scheduler informer, lines 635–642](https://github.com/kubernetes/kubernetes/blob/v1.34.0/pkg/scheduler/scheduler.go#L635) filters `status.phase!=Succeeded,status.phase!=Failed`. Its [delete handler, lines 334–360](https://github.com/kubernetes/kubernetes/blob/v1.34.0/pkg/scheduler/eventhandlers.go#L334) calls `Cache.RemovePod`; [NodeInfo.RemovePod and update, lines 386–412](https://github.com/kubernetes/kubernetes/blob/v1.34.0/pkg/scheduler/framework/types.go#L386) subtract the CPU and memory requests. A successful DELETE response or a `deletionTimestamp` alone does not release a still-Pending, node-bound pod's scheduler reservation. The refresh template has a 60-second termination grace period (`deploy/k8s/34-refresh-cronjob.yaml:126`). [Pod deletion strategy, lines 164–193](https://github.com/kubernetes/kubernetes/blob/v1.34.0/pkg/registry/core/pod/strategy.go#L164) uses that grace period and special-cases an unscheduled pod to zero. A pod that was never scheduled did not reserve a node's CPU in the first place; it can still consume namespace quota.

I found no Pending-only deadline in the reviewed upstream v1.34 PodSpec, JobSpec, and CronJobSpec. Job `activeDeadlineSeconds` measures duration relative to Job start; Pod `activeDeadlineSeconds` measures duration relative to Pod start and also continues through Running. The [kubelet deadline handler, lines 79–97](https://github.com/kubernetes/kubernetes/blob/v1.34.0/pkg/kubelet/active_deadline.go#L79) compares elapsed time with the same deadline without a Pending-only condition. CronJob `startingDeadlineSeconds` bounds missed schedule creation, and TTL applies after completion. A startup probe cannot act before its container starts. None of these reviewed mechanisms substitutes for the requested separate Pending timeout while preserving a four-hour run. Claims about other Kubernetes versions or operator-provided controllers are **unverified**.

### Selection and runtime

`api/src/scripts/refresh-pending-watchdog.ts:102` correctly applies its predicate to the LIST snapshot: Pending, not deleting, nonempty name and UID, matching Job-name prefix, readable creation timestamp, and age at least the configured threshold. Exactly 900 seconds is eligible; future timestamps and unreadable timestamps are excluded. Running/Succeeded/Failed snapshots are excluded. A Job owner is selected by `kind: Job`; the script does not verify its API group or `controller` flag. No deployed counterexample involving those two omissions was demonstrated, so they are not findings.

| Case | Demonstrated behavior / limitation |
| --- | --- |
| Init container running for more than 900 seconds | Selected while pod phase is Pending. This is a startup timeout, not proof that no container ever ran. |
| ImagePullBackOff | Selected if phase remains Pending and age is sufficient. |
| Unschedulable | Selected without requiring `spec.nodeName`. |
| Existing deletionTimestamp | Skipped; stuck termination is not covered by this watchdog. |
| Running in LIST | Skipped. |
| Pending in LIST, Running before DELETE | Deleted; UID alone does not guard the phase transition. SOL-838-01. |
| Manual Job named `radar-refresh-pv-<id>` from the current CronJob | Covered: kubectl copies the Job spec, including the template label and `backoffLimit: 0`. |
| Manual Job with a different name, or an older pod lacking the new label | Not covered by the selector/prefix contract. |

The manual-Job conclusion follows [kubectl's `createJobFromCronJob`, lines 254–281](https://github.com/kubernetes/kubernetes/blob/v1.34.0/staging/src/k8s.io/kubectl/pkg/cmd/create/create_job.go#L254): it takes the caller's Job name and copies `cronJob.Spec.JobTemplate.Spec`. The runtime mock used owner Job `radar-refresh-pv-manual` and demonstrated selection.

The HTTPS client reads the projected namespace, CA, and token; sends a Bearer token; keeps Node's default certificate verification; uses `KUBERNETES_SERVICE_HOST` and `KUBERNETES_SERVICE_PORT` with a 443 fallback; URL-encodes the namespace, selector, and name; and sends JSON DeleteOptions in the DELETE body with byte-accurate Content-Length (`api/src/scripts/refresh-pending-watchdog.ts:137`). Runtime interception of the built entrypoint verified those request options and the actual body. Real TLS negotiation, certificate/hostname matching, projected-token permissions, IPv6, token rotation, and real API-server handling are **unverified**.

The request has a 30-second socket timeout and destroys the request on timeout. It is not a whole-operation wall-clock deadline; the watchdog Job separately declares 180 seconds. The response stream has `data` and `end` listeners but no response `error`/`aborted` listener. Actual truncated-response behavior was **not covered**; no finding is asserted for it. LIST requires HTTP 200 and JSON with an items array. DELETE accepts 2xx and tolerates 404/409. The built process exited 1 for missing configuration, LIST 403, DELETE 403, and a malformed PodList; ordinary runs exited 0. The summary incorrectly calls a rejected 409 deletion `removed` (SOL-838-02).

### RBAC and manifests

Both Roles cover the actual namespaced collection LIST and named DELETE calls. They grant neither Jobs, Secrets, logs, exec, nor cross-namespace operations. A label selector is an application constraint; these Roles authorize listing and deleting any pod in their namespace. `get` is unused by this implementation and prevents the grant from being minimal for exactly these calls (SOL-838-04).

The pod's `automountServiceAccountToken: true` overrides the ServiceAccount's false setting. [Upstream admission, lines 254–264](https://github.com/kubernetes/kubernetes/blob/v1.34.0/plugin/pkg/admission/serviceaccount/admission.go#L254) states “Pod's preference wins.” [Lines 160–162](https://github.com/kubernetes/kubernetes/blob/v1.34.0/plugin/pkg/admission/serviceaccount/admission.go#L160) reject a pod if its ServiceAccount cannot be found. Consequently, before the owner applies the identity, the watchdog cannot create its pod; its Job can produce FailedCreate events and later reach its own Job deadline. If the ServiceAccount exists without its Role/Binding, the process can start but fails its LIST with 403, as reproduced. The refresh itself continues. Owner RBAC application is **unverified**. The prerequisite is documented in `deploy/ci/README.md:349`; I do not report it as an undisclosed defect.

The watchdog has a five-minute UTC schedule, `Forbid`, a 120-second start deadline, zero retries, a 180-second Job deadline, one successful/three failed retained Jobs, and a one-hour TTL (`deploy/k8s/34-refresh-pending-watchdog.yaml:44`). These are internally consistent in ordinary operation. The container needs no refresh PVC or database/bucket credentials. Non-root UID/GID 1001, RuntimeDefault seccomp, a read-only root, no privilege escalation, and dropped capabilities are declared. The built script completed the mock runs with a read-only root, all capabilities dropped, no network, and `--max-old-space-size=64`. This demonstrates that its exercised code does not require scratch writes; real API access is still **unverified**.

The 10m CPU / 64Mi memory requests and 100m / 128Mi limits are an additional admission and scheduling requirement. The manifest has no PriorityClass or capacity reservation. If stalled refresh pods exhaust namespace quota or suitable node capacity, the watchdog can itself fail admission or remain Pending and never perform its LIST. Its own deadline bounds that Job, not the refresh pod in this condition. `deploy/ci/README.md:354` already tells the owner to check quota headroom. Whether 10m and the memory/limit/pod-count headroom were available in the incident is **unknown**; no capacity failure is asserted as a finding.

The prod/preprod overlays each include the watchdog, unsuspend it, and use their shared `radar-api` image transformation. The refresh pod label is on the pod template (`deploy/k8s/34-refresh-cronjob.yaml:120`), and `backoffLimit: 0` remains at line 101. Offline render and mutation tests passed. The base watchdog is dormant and is absent from the root bundle's resource list; activation comes from the refresh overlays. The stated 15–20 minute deletion bound assumes an available watchdog and timely API/controller/kubelet progress. The guard checks configured timing relationships; it cannot establish that operational bound (SOL-838-03).

## Commands and outputs

Commands below were executed in this worktree. Routine package-install output is omitted; exit codes and material diagnostics are retained. Docker executions outside Make are the user-requested offline smoke and explicit teardown/inspection. Other runtime checks used a temporary Makefile. All temporary files were under `.review-tmp-sol/` and were removed at the end.

1. Identity and target:

   ```text
   rtk git branch --show-current
   fix/refresh-hours
   rtk git rev-parse HEAD origin/main
   dd8df2ebc8f13775a16521f7409208a382fbc803
   641f48c31a89c9d7bc4f1bc06532728c29018cc8
   rtk git diff --stat origin/main...dd8df2ebc8f13775a16521f7409208a382fbc803
   26 files changed, 1017 insertions(+), 53 deletions(-)
   ```

2. Requested API unit suite:

   ```text
   rtk make test-api SCOPE="src/scripts/refresh-pending-watchdog.test.ts" ENV=test-review-sol-838
   ✓ src/scripts/refresh-pending-watchdog.test.ts (14 tests) 4ms
   Test Files  1 passed (1)
   Tests  14 passed (14)
   Exit: 0
   ```

3. Dependency installation and quality checks:

   ```text
   rtk make install COMPOSE_FILES_DEV='-f docker-compose.yml -f docker-compose.dev.yml -f .review-tmp-sol/no-lock-write.yml' ENV=review-sol-838
   added 967 packages, and audited 981 packages in 9s
   Exit: 0

   rtk make typecheck ENV=review-sol-838
   tsc --noEmit -p tsconfig.json [API and workspace packages]
   svelte-check found 0 errors and 7 warnings in 1 file
   Exit: 0

   rtk make lint ENV=review-sol-838
   docker compose -f docker-compose.yml -f docker-compose.dev.yml run --rm --no-deps -T api npx eslint .
   [no ESLint diagnostics after temporary JS fixture removal]
   Exit: 0
   ```

   The temporary Compose override set only `npm_config_save: "false"`, retaining lockfile reads while preventing tracked package/lockfile writes. [npm documents this behavior](https://docs.npmjs.com/cli/v11/using-npm/config/#save). An initial review-only override instead set `npm_config_package_lock: "false"` and failed with `Cannot destructure property 'package' of 'node.target' as it is null` (Make exit 2). That override ignores the lockfile, so its result is not used as a PR finding. I cleaned that environment, corrected the temporary setting, and ran the successful install above. An initial lint run also exited 2 because ESLint scanned the temporary mock's Node globals; its only ten diagnostics referenced `.review-tmp-sol/watchdog-api-mock.mjs`. Removing that already-used fixture before the final lint produced exit 0. Neither run altered tracked code.

4. Production image and requested offline entrypoint:

   ```text
   rtk make build-api-image API_VERSION=review-sol-838 ENV=e2e-review-sol-838
   Successfully built d9a19e2d557b
   Successfully tagged radar-immobilier-api:review-sol-838
   Exit: 0

   rtk docker run --rm --network none -w /workspace/api radar-immobilier-api:review-sol-838 node dist/scripts/refresh-pending-watchdog.js
   refresh-pending-watchdog: FAIL REFRESH_PENDING_DEADLINE_SECONDS must be an integer number of seconds >= 60
   Exit: 1 [expected configuration failure]
   ```

   The version override gave the Compose-built image a unique tag. Build layers were cached. The build printed a buildx warning and a credential-helper read-only-filesystem error for an unrelated configured registry, then still exited 0. The entrypoint smoke verifies that the watchdog bundle exists and executes.

5. Offline render checks:

   ```text
   rtk make -f deploy/k8s/refresh-cronjobs/refresh-018.mk verify-renders TMPDIR="$PWD/.review-tmp-sol" ENV=review-sol-838
   refresh-watchdog: ok — a refresh pod Pending 900 s is deleted within 1200 s (watchdog every 300 s); refresh Job deadline 19800 s
   [same watchdog check passed for both overlays]
   refresh-stagger: ok — prod minute 0, preprod minute 30, hours 5,11,17,23: closest starts 30 min apart; a stalled pod is removed within 1200 s
   Exit: 0

   rtk make -f .review-tmp-sol/review.mk render-tests ENV=review-sol-838
   verify-renders tests: 22 passed, 0 failed
   Exit: 0
   ```

   `render-tests` set TMPDIR to the review directory and ran `bash deploy/k8s/refresh-cronjobs/verify-renders.test.sh`. The quoted “within 1200 s” output is the guard's claim, not an observed Kubernetes latency.

6. Built-client runtime mock:

   ```text
   rtk make -f .review-tmp-sol/review.mk mock-runtime SCENARIO=race ENV=review-sol-838
   refresh-pending-watchdog: deleting pod radar-refresh-pv-manual-abcde (Job radar-refresh-pv-manual): pending 1200 s >= 900 s
   mock-api: scenario=race livePhase=Running liveResourceVersion=8 DELETE={"apiVersion":"v1","kind":"DeleteOptions","preconditions":{"uid":"same-pod-uid"}}
   refresh-pending-watchdog: {"checked":1,"pending":1,"removed":["radar-refresh-pv-manual-abcde"]}
   Exit: 0
   ```

   The temporary Make recipe ran the built image with `--network none --read-only --cap-drop ALL --security-opt no-new-privileges`, `NODE_OPTIONS=--max-old-space-size=64`, and a read-only mounted `--import` fixture. That fixture replaced only `node:fs` service-account reads with synthetic values and `node:https.request` with an EventEmitter response, then called `syncBuiltinESMExports`. LIST returned a 20-minute-old Pending pod, UID `same-pod-uid`, resourceVersion `7`. Before handling the actual DELETE body, the mock moved the same pod to Running/resourceVersion `8`; the UID still matched. It asserted the host, port, CA option, token header, selector, DELETE path, Content-Type, byte length, and UID-only DeleteOptions. This is a mocked interleaving, not a cluster test. Upstream precondition code cited in SOL-838-01 establishes why that body does not reject the state change.

   The same recipe was run with each scenario below:

   | SCENARIO | Output / exit |
   | --- | --- |
   | `init-running`, `image-pull`, `unschedulable` | `removed:["radar-refresh-pv-manual-abcde"]`; exit 0 |
   | `deleting` | `checked:1,pending:1,removed:[]`; exit 0 |
   | `running` | `checked:1,pending:0,removed:[]`; exit 0 |
   | `gone` (DELETE 404) | `removed:["radar-refresh-pv-manual-abcde"]`; exit 0 |
   | `conflict` (DELETE 409) | `removed:["radar-refresh-pv-manual-abcde"]`; exit 0 |
   | `list-403` | `FAIL list pods: HTTP 403 Forbidden`; process exit 1, Make exit 2 |
   | `delete-403` | `FAIL delete pod radar-refresh-pv-manual-abcde: HTTP 403 {"kind":"Status","code":403}`; process exit 1, Make exit 2 |
   | `bad-list` | `FAIL Kubernetes API did not return a PodList`; process exit 1, Make exit 2 |

7. Teardown:

   ```text
   rtk make clean ENV=test-review-sol-838
   rtk docker compose -p radar-test-review-sol-838 -f docker-compose.yml -f docker-compose.test.yml down -v
   rtk make clean ENV=review-sol-838
   rtk make clean ENV=e2e-review-sol-838
   rtk docker compose -p radar-e2e-review-sol-838 -f docker-compose.yml -f docker-compose.e2e.yml down -v
   All exit 0; test and review containers, networks, and named volumes removed.
   ```

   Filtered `docker ps -a` and `docker volume ls` inspections for the three review project labels returned no entries. `git diff --exit-code --no-ext-diff` returned exit 0 before writing this report. Only the designated review leg was authored; all review throwaways were deleted.

## Findings

### SOL-838-01 — A pod can start between LIST and DELETE and still be killed

- **Severity:** blocking.
- **File:line:** `api/src/scripts/refresh-pending-watchdog.ts:175`; selection/deletion sequence at lines 120–127.
- **Evidence:** The built-client race reproduction above issued DELETE while the same UID's live phase was Running. The script copies neither `metadata.resourceVersion` nor a phase guard into DeleteOptions. [Upstream storage Preconditions.Check, lines 137–163](https://github.com/kubernetes/kubernetes/blob/v1.34.0/staging/src/k8s.io/apiserver/pkg/storage/interfaces.go#L137) checks UID only when UID is supplied; its resourceVersion check runs only when that additional precondition is supplied. There is no phase check. A same-pod status update preserves UID, so the current precondition accepts a Pending-to-Running update. With zero retries, deleting the now-running pod also fails that real refresh pass. This directly contradicts the stated guarantee that Running pods are never touched and that a real run retains its duration.
- **Fix:** Preserve the selected pod's resourceVersion and send both UID and resourceVersion preconditions on DELETE. Treat a conflict as a skipped stale observation and re-evaluate on a later pass. A fresh GET followed by another UID-only DELETE is insufficient because it retains a race. Add a test that updates the same UID from Pending to Running between observation and deletion and proves the updated object is not deleted. This fixes the API-observable race without increasing RBAC; absolute guarantees about a container that starts before kubelet publishes its status remain subject to asynchronous status reporting.

### SOL-838-02 — A rejected deletion is logged as a removed pod

- **Severity:** non-blocking.
- **File:line:** `api/src/scripts/refresh-pending-watchdog.ts:128`, with the tolerated responses at line 178.
- **Evidence:** The `conflict` built-client mock returned DELETE 409. The process exited 0 and emitted `"removed":["radar-refresh-pv-manual-abcde"]`. `deletePod` returns the same `void` result for a successful request and a conflict, and `runWatchdog` unconditionally pushes the pod into `removed`. A conflict means this deletion was not performed. Even a 202 establishes acceptance rather than completed resource release.
- **Fix:** Return an explicit outcome from `deletePod`, count only accepted deletion requests in an accurately named field, and log stale/conflicting/already-gone observations separately. Keep benign 404/409 responses nonfatal.

### SOL-838-03 — Comments and render output promise immediate failure and a hard cleanup bound

- **Severity:** non-blocking.
- **File:line:** `api/src/scripts/refresh-pending-watchdog.ts:25`; `deploy/k8s/34-refresh-pending-watchdog.yaml:23`; `deploy/k8s/refresh-cronjobs/refresh-watchdog.awk:81`.
- **Evidence:** The source says the Job becomes Failed “at once”; the manifest and render guard promise deletion within 15–20 minutes / 1200 seconds. Upstream Job source delays the final Failed condition while terminating pods remain, as cited above. Scheduler source only drops the reservation on disappearance from its non-terminal informer. The manifest itself allows a 120-second schedule-start delay and a 180-second watchdog Job lifetime, and requests extra CPU/memory without reserving that capacity. These facts do not support an unconditional 1200-second resource-release bound. The owner prerequisite documentation already acknowledges absent RBAC and insufficient quota.
- **Fix:** State that the script requests deletion at the first successful watchdog execution observing an overdue Pending pod, nominally 15–20 minutes with timely scheduling. Distinguish `FailureTarget`, final `Failed`, deletion acceptance, and scheduler reservation release; describe the required RBAC/capacity/controller progress. Make guard output describe configured timing rather than measured or guaranteed removal. No cluster timing claim was verified in this leg.

### SOL-838-04 — The watchdog Roles grant an unused get permission

- **Severity:** non-blocking.
- **File:line:** `deploy/k8s/10-rbac.yaml:105`; `deploy/k8s/11-ci-deployer-preprod-rbac.yaml:188`.
- **Evidence:** The client implements only collection `GET .../pods?labelSelector=...` (RBAC `list`) at script line 170 and named DELETE at line 176. Neither the script nor the built-client calls perform a named pod GET. Both Roles grant `["get", "list", "delete"]`.
- **Fix:** Remove `get` from both Roles for the implementation as written. UID plus resourceVersion DELETE preconditions do not require a named GET or any additional verb.

## Verdict

**NO-GO.** SOL-838-01 is a demonstrated correctness violation of the requirement to preserve a real refresh run. The zero-retry Job failure-counting mechanism is supported under the stated defaults; it is not the reason for this verdict. Required local checks passed after the documented review-fixture corrections. Cluster deployment, RBAC application, scheduling/quota headroom, and actual termination/resource-release latency remain **unverified**.
