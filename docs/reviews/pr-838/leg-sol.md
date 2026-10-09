---
status: completed
reviewer-host: codex
reviewer-model: gpt-6.1-sol
reviewer-effort: xhigh
target-ref: fix/refresh-hours@a963502d723586e85e358d9ca054f10b949d8439
round: 2
lens: round1-fix-verification-and-watchdog-runtime-semantics-and-rbac
---

## Reasoning

**GO-with-nits.** The round-1 blocking race is fixed in the built client: DELETE carries both the observed UID and resourceVersion, and an intervening Pending-to-Running update is rejected and reported as skipped. Two non-blocking findings remain: imprecise terminal-condition wording and the render guard accepting equality with the start gap.

Reviewed detached HEAD `a963502d723586e85e358d9ca054f10b949d8439`, the changes from `dd8df2ebc8f13775a16521f7409208a382fbc803`, and the watchdog's surrounding runtime contract. `origin/main` remains `641f48c31a89c9d7bc4f1bc06532728c29018cc8`. Read this lens's round-1 prompt and report; did not read another review leg or delegate. No cluster or bucket was contacted. No Python, native Node execution, commit, push, or GitHub write was used. Only this review leg was authored outside `.review-tmp-sol/`. Live Kubernetes version, feature gates, admission rules, applied RBAC, quota usage, and node headroom are **unknown**; deployment and observed cluster timing are **unverified**.

### Race, selection, outcomes, and client

The script preserves `metadata.resourceVersion` as a string (`api/src/scripts/refresh-pending-watchdog.ts:106`), requires a nonempty version before selection (line 121), passes it through the typed `KubePodApi` interface (line 64), and serializes it with UID in the actual DeleteOptions body (line 199). The built-client mock returned an overdue Pending snapshot with UID `same-pod-uid`, resourceVersion `7`, then changed the live object to Running/version `8` before processing DELETE. Its precondition check compared both submitted fields against that live object. The response was 409, deletion was not accepted, the report had no deletion request, and the process exited 0. A version-only update while still Pending and replacement of the object with another UID were also rejected. This is an offline mocked interleaving, not an API-server integration test.

The atomic precondition mechanism is supported by [Kubernetes v1.34 storage `Preconditions.Check`, lines 137–163](https://github.com/kubernetes/kubernetes/blob/v1.34.0/staging/src/k8s.io/apiserver/pkg/storage/interfaces.go#L137):

```go
if p.UID != nil && *p.UID != objMeta.GetUID() { ... }
if p.ResourceVersion != nil && *p.ResourceVersion != objMeta.GetResourceVersion() { ... }
```

The default namespace-scoped label LIST and Job-name prefix remain unchanged. The selector operates on Pod phase, not container state: an overdue Pending pod with a running init container, ImagePullBackOff, or Unschedulable condition is eligible. Running snapshots, existing deletion timestamps, missing UID/version, future creation timestamps, and other Job prefixes were excluded in built-client runs. The unit suite also covers the exact 900-second age boundary and unreadable creation timestamps. This bounds startup while phase remains Pending; it does not establish that no init container ever ran. A newly created manual Job matching `radar-refresh-pv-*` and carrying the template label is covered; older pods without the new label and differently named manual Jobs remain **not covered**.

The `DeleteOutcome` union and report types match the implementation. HTTP 200/202/204 DELETE responses are counted as `deletionRequested`, not completed removal. HTTP 404 and 409 return `gone` and `changed`, populate `skipped`, and produce explanatory logs without failing the run. The pre-request “deleting pod” line is followed by the explicit outcome; the summary no longer reports a refused request as removal. Missing version is an ineligible snapshot, so it appears in neither outcome array. `pending` counts Pending snapshots, including ineligible ones; it is not a live post-delete count. API/configuration failures still exit 1. LIST 403, DELETE 403, malformed lists, invalid JSON, and a simulated request timeout reproduced that behavior. No runtime regression was demonstrated in these cases.

The runtime shim asserted the built client's host, default port 443, supplied CA, Bearer header, encoded equality selector, named DELETE path, JSON content type, and byte-accurate Content-Length. It also checked that TLS verification was not disabled. The shim intercepted only projected ServiceAccount file reads and `node:https.request`, then synchronized built-in ESM exports. Real TLS, explicit non-default ports, IPv6, token rotation, and response truncation are **unverified**. The unchanged 30-second socket timeout is not an overall operation deadline; the Job separately has a 180-second active deadline. All built-client mocks ran with no network, a read-only root, dropped capabilities, no privilege escalation, and the manifest's 64 MiB Node heap setting.

### Kubernetes semantics and documentation

Re-read tagged upstream v1.34.0 source, downloaded under the review-only temporary directory. The zero-retry mechanism remains supported under the manifest's defaults:

- [Job defaulting, lines 62–68](https://github.com/kubernetes/kubernetes/blob/v1.34.0/pkg/apis/batch/v1/defaults.go#L62) chooses `TerminatingOrFailed` when `podFailurePolicy` is absent.
- [`isPodFailed`, lines 2003–2013](https://github.com/kubernetes/kubernetes/blob/v1.34.0/pkg/controller/job/job_controller.go#L2003) counts a deleting non-Succeeded pod as failed under those defaults: `return p.DeletionTimestamp != nil && p.Status.Phase != v1.PodSucceeded`. Its comment explicitly says: “Count deleted Pods as failures to account for orphan Pods that never have a chance to reach the Failed phase.”
- [Controller evaluation, lines 917–960](https://github.com/kubernetes/kubernetes/blob/v1.34.0/pkg/controller/job/job_controller.go#L917) computes the new failure count and checks `jobCtx.failed > *job.Spec.BackoffLimit`, giving `1 > 0` here.
- [Lines 993–1011](https://github.com/kubernetes/kubernetes/blob/v1.34.0/pkg/controller/job/job_controller.go#L993) take the failure branch instead of `manageJob` replacement creation. The generic replacement-policy description does not refute this specific zero-retry case.

Failure recognition, terminal `Failed`, and scheduler reservation release are separate events. Under modern default gates, [lines 1081–1104](https://github.com/kubernetes/kubernetes/blob/v1.34.0/pkg/controller/job/job_controller.go#L1081) initially use `FailureTarget`; [lines 1500–1519](https://github.com/kubernetes/kubernetes/blob/v1.34.0/pkg/controller/job/job_controller.go#L1500) defer final completion while terminating pods remain. The [official Job documentation](https://kubernetes.io/docs/concepts/workloads/controllers/job/#terminal-job-conditions), fetched again during this review, says: “In Kubernetes v1.31 and later the Job controller delays the addition of the terminal conditions, `Failed` or `Complete`, until all of the Job Pods are terminated.” The revised header and manifest remove “at once”, but still attribute final `Failed` to processing a terminating pod without explaining this deferred terminal condition; see SOL-838-R2-01.

The [scheduler's informer, lines 635–642](https://github.com/kubernetes/kubernetes/blob/v1.34.0/pkg/scheduler/scheduler.go#L635) selects `status.phase!=Succeeded,status.phase!=Failed`. Its [delete handler, lines 334–360](https://github.com/kubernetes/kubernetes/blob/v1.34.0/pkg/scheduler/eventhandlers.go#L334) removes a scheduled pod from the cache. Thus requests cease to be accounted when the scheduler observes removal from its non-terminal set, either by object deletion or transition to a terminal phase. Acceptance of DELETE or a deletion timestamp alone does not release a still-Pending reservation. The comments' object-disappearance description gives a valid eventual trigger but omits the terminal-phase alternative and informer progress. The refresh retains its 60-second grace period at `deploy/k8s/34-refresh-cronjob.yaml:127`; [Pod deletion strategy, lines 164–193](https://github.com/kubernetes/kubernetes/blob/v1.34.0/pkg/registry/core/pod/strategy.go#L164) uses it for a non-terminal scheduled pod and sets zero grace for an unscheduled pod. An unscheduled pod did not reserve a node's CPU; namespace quota is separate.

No Pending-only timeout was found in the inspected v1.34 PodSpec, JobSpec, or CronJobSpec. [JobSpec active deadline](https://github.com/kubernetes/kubernetes/blob/v1.34.0/staging/src/k8s.io/api/batch/v1/types.go#L321) measures duration relative to StartTime; the [Job controller's deadline predicate](https://github.com/kubernetes/kubernetes/blob/v1.34.0/pkg/controller/job/job_controller.go#L1585) has no Pending-only condition. [PodSpec active deadline](https://github.com/kubernetes/kubernetes/blob/v1.34.0/staging/src/k8s.io/api/core/v1/types.go#L4150) and the [kubelet predicate](https://github.com/kubernetes/kubernetes/blob/v1.34.0/pkg/kubelet/active_deadline.go#L79) likewise continue through Running. CronJob start deadlines govern missed schedule creation; TTL governs finished Jobs. The [kubelet volume wait](https://github.com/kubernetes/kubernetes/blob/v1.34.0/pkg/kubelet/kubelet.go#L2065) precedes runtime `SyncPod` and returns on a mount failure, supporting the incident-specific reason an init container cannot solve an unattached-volume stall. Other versions or operator-supplied controllers are **unverified**.

`deploy/ci/README.md:319` accurately describes conditional requests, uid/version protection, nominal 15–20-minute timing, and lack of reserved capacity. Its watchdog prerequisite at line 355 states the required identity and additional quota demand. A missing ServiceAccount causes pod admission/FailedCreate rather than an executing script's error; an existing identity without the needed grants produces a LIST 403, reproduced offline. `deploy/k8s/README.md:305` is a shorter eventual-behavior description and does not give a measured cleanup bound. The manifest and script likewise qualify timing as nominal, and both render guards now report configured request timing. Actual termination latency and resource release remain **unverified**, including during CSI or node failure.

### RBAC, manifest, bascule, and schedule relation

Both watchdog Roles now grant exactly `list` and `delete` on core `pods` in their own namespaces (`deploy/k8s/10-rbac.yaml:105`, `deploy/k8s/11-ci-deployer-preprod-rbac.yaml:188`). Collection GET maps to RBAC `list`; named DELETE maps to `delete`. There is no named GET, watch, Job call, log/exec call, or Secret API call in the client. Supplying resourceVersion in DeleteOptions needs no additional permission. Projected token/CA/namespace reads are filesystem reads. The bindings use the matching namespaced `radar-refresh-watchdog` ServiceAccount. Its false automount setting is overridden by the pod's explicit true setting. RBAC does not enforce the label/prefix/phase constraint: the grant still permits deleting any pod in that namespace. Applied cluster permissions are **unverified**.

The manifest retains a five-minute UTC schedule, Forbid concurrency, 120-second starting deadline, 180-second Job deadline, zero retries, one successful/three failed retained Jobs, and a one-hour TTL. It needs no refresh PVC or database/bucket credentials. The non-root, read-only-root, dropped-capability runtime was exercised in the built-client checks. The 10m CPU / 64Mi requests and 100m / 128Mi limits require quota and schedulable capacity; there is no reservation or priority guarantee. A watchdog that cannot create/start its own pod cannot enforce the refresh startup timeout. This is disclosed rather than evidence of a reproduced cluster failure.

The new workflow value at `.github/workflows/bascule-preprod.yml:220` contains the existing three default CronJobs plus the watchdog. It is job-level environment, so the same list reaches quiesce, G2, and un-quiesce. `bascule.mjs:565` consumes that list. Quiesce records each present CronJob's original suspend state before patching it, drains active Jobs whose CronJob owner belongs to the list (line 645), and preserves the original record on replay. G2 checks the listed present CronJobs and active batch Jobs; un-quiesce restores the recorded suspend value (line 723).

An offline mock evaluated the exact `assertQuiesced`/quiesce/un-quiesce functions from the current source in a Node VM, using the workflow's actual list and mocked kubectl/filesystem boundaries. An active watchdog Job was deleted and observed inactive; G2 passed. Both initially-active (`suspend: false`) and initially-suspended (`true`) watchdogs returned to their original values. Replaying quiesce did not overwrite the original record. An absent watchdog was ignored without being created. These checks establish the successful mocked paths. Actual cluster RBAC, failed kubectl patches/deletions, manual SKIP_QUIESCE recovery, controller races, and real drain timing are **unverified**. Merely suspending a CronJob does not stop its existing Job; the explicit drain is material here.

Both current renders use the owner schedules, prod `0 5,11,17,23 * * *` and preprod `0 0,6,12,18 * * *`. The nearest daily starts, including 23:00→00:00, are 60 minutes apart. The configured Pending deadline plus watchdog period is `900 + 300 = 1200 s`, below `3600 s`. The 24 mutation tests pass, including repeated-hour and off-hour rejection, excessive watchdog timing, and omission of the watchdog from the bascule list. However, a separate full-render mutation setting only the watchdog deadline to 3300 seconds passed even though `3300 + 300 == 3600`. The guard uses `>` rather than `>=`; see SOL-838-R2-02. This affects the promised relation for future configuration, not the present 900-second setting. These are configuration checks, not proof that Kubernetes will clean up before the next environment starts.

## Commands and outputs

All commands were run in this worktree with RTK. Routine apt/npm progress is omitted. Temporary Make recipes were used for the offline mocks and mutation; all throwaways were under `.review-tmp-sol/` and deleted afterward. The direct offline Docker smoke and explicit Compose teardown follow the user-requested exceptions.

1. Identity and diff:

   ```text
   rtk git rev-parse HEAD
   a963502d723586e85e358d9ca054f10b949d8439
   rtk git status --short --branch
   * HEAD (no branch)
   ?? docs/reviews/pr-838/
   rtk git log --oneline dd8df2eb..HEAD
   a963502d fix(refresh): quiesce the pending watchdog in the preprod bascule; ...
   d1bc29bf docs(refresh): preprod refresh windows at 00:00/06:00/12:00/18:00 UTC
   bb786799 fix(refresh): preprod on the hour, one hour after prod ...
   8526387e fix(refresh): watchdog deletes with uid+resourceVersion preconditions ...
   rtk proxy git diff dd8df2eb..HEAD -- api/src/scripts/refresh-pending-watchdog.ts api/src/scripts/refresh-pending-watchdog.test.ts .github/workflows/bascule-preprod.yml
   [reviewed the actual implementation, test, and workflow changes]
   ```

2. Requested test:

   ```text
   rtk make test-api SCOPE="src/scripts/refresh-pending-watchdog.test.ts" ENV=test-review-sol-838
   ✓ src/scripts/refresh-pending-watchdog.test.ts (17 tests) 4ms
   Test Files  1 passed (1)
   Tests  17 passed (17)
   Exit: 0
   ```

3. Requested workspace install and direct quality commands:

   ```text
   rtk make install COMPOSE_FILES_DEV='-f docker-compose.yml -f docker-compose.dev.yml -f .review-tmp-sol/no-lock-write.yml' ENV=review-sol-838
   npm error code ETIMEDOUT
   npm error network Invalid response body while trying to fetch https://registry.npmjs.org/playwright-core: read ETIMEDOUT
   make: *** [Makefile:305: install] Error 1
   Make exit: 2

   rtk make typecheck ENV=review-sol-838
   sh: 1: tsc: not found
   sh: 1: svelte-check: not found
   make: *** [Makefile:119: typecheck] Error 127
   Make exit: 2

   rtk make lint ENV=review-sol-838
   npm warn exec The following package was not found and will be installed: eslint@10.12.0
   Error [ERR_MODULE_NOT_FOUND]: Cannot find package '@eslint/js' imported from /workspace/eslint.config.js
   Make exit: 2
   ```

   The install override sets only `npm_config_save: "false"` to prevent tracked lockfile writes, retaining lockfile reads. The install failed on npm network access; the direct quality attempts consequently lacked installed workspace tools. These runs do not establish a TypeScript or lint defect in the PR. CI's `Quality gates` job explicitly runs both checks at `.github/workflows/ci.yml:59` and line 62; the actual CI result for this commit is **unverified**.

   Supplementary quality checks reused the successful test's dependency volumes, without changing source or installing another dependency set:

   ```text
   rtk make typecheck COMPOSE_FILES_DEV='-f docker-compose.yml -f docker-compose.dev.yml -f .review-tmp-sol/quality-from-test.yml' ENV=review-sol-838
   [all workspace typecheck commands completed]
   svelte-check found 0 errors and 7 warnings in 1 file
   Exit: 0

   rtk make lint COMPOSE_FILES_DEV='-f docker-compose.yml -f docker-compose.dev.yml -f .review-tmp-sol/quality-from-test.yml' ENV=review-sol-838
   [no ESLint diagnostics]
   Exit: 0
   ```

   That temporary Compose override mounts external volumes `radar-test-review-sol-838_radar-test-root-node-modules` and `radar-test-review-sol-838_radar-test-api-node-modules` at the same dependency paths, sets `npm_config_offline: "true"`, and disables the container's apt bootstrap entrypoint for these static commands. The source bind mount and Make quality recipes are unchanged. Temporary JavaScript fixtures and the copied mutation tree were removed before lint. The seven Svelte warnings concern `ui/src/lib/components/maps/SignauxSelPanel.svelte`, outside this lens.

4. Production bundle and requested offline smoke:

   ```text
   rtk make build-api-image API_VERSION=review-sol-838-r2 ENV=e2e-review-sol-838
   [API and immo-mcp build-stage TypeScript checks completed]
   api/dist/scripts/refresh-pending-watchdog.js  5.7kb
   Successfully built c6e6326f3cb1
   Successfully tagged radar-immobilier-api:review-sol-838-r2
   Exit: 0

   rtk docker run --rm --network none --read-only -w /workspace/api radar-immobilier-api:review-sol-838-r2 node dist/scripts/refresh-pending-watchdog.js
   refresh-pending-watchdog: FAIL REFRESH_PENDING_DEADLINE_SECONDS must be an integer number of seconds >= 60
   Exit: 1 [expected configuration error]
   ```

   The build reported the missing buildx plugin and an unrelated configured registry's read-only gcloud credential-helper warning, then completed successfully. The smoke proves that the bundle exists and executes; it makes no API request.

5. Built-client race and outcome reproductions:

   ```text
   rtk make -f .review-tmp-sol/review.mk mock-runtime SCENARIO=race ENV=review-sol-838
   refresh-pending-watchdog: deleting pod radar-refresh-pv-manual-abcde (Job radar-refresh-pv-manual): pending 1200 s >= 900 s
   mock-api: scenario=race livePhase=Running liveResourceVersion=8 DELETE={"apiVersion":"v1","kind":"DeleteOptions","preconditions":{"uid":"same-pod-uid","resourceVersion":"7"}} HTTP=409 accepted=false
   refresh-pending-watchdog: pod radar-refresh-pv-manual-abcde not deleted (changed since the list)
   refresh-pending-watchdog: {"checked":1,"pending":1,"deletionRequested":[],"skipped":["radar-refresh-pv-manual-abcde"]}
   mock-api: assertions passed scenario=race exit=0
   Exit: 0
   ```

   The recipe runs the new image with `--network none --read-only --cap-drop ALL --security-opt no-new-privileges`, the manifest's configuration variables, and a read-only `--import` mock. Each successful mock asserts request options, serialized preconditions, delete count, outcome arrays, and process exit. The same command was run with all scenarios below:

   | SCENARIO | Result | Process / Make exit |
   | --- | --- | --- |
   | `conflict` | 409; `deletionRequested:[]`, `skipped:[pod]`; “changed since the list” | 0 / 0 |
   | `gone` | 404; `deletionRequested:[]`, `skipped:[pod]`; “already gone” | 0 / 0 |
   | `status-update`, `recreated` | Both preconditions checked; 409; skipped | 0 / 0 |
   | `accepted-200`, `accepted-204` | `deletionRequested:[pod]`, `skipped:[]` | 0 / 0 |
   | `init-running`, `image-pull`, `unschedulable` | 202; `deletionRequested:[pod]`, `skipped:[]` | 0 / 0 |
   | `running` | No DELETE; `pending:0`, empty outcome arrays | 0 / 0 |
   | `deleting`, `missing-rv`, `missing-uid`, `future`, `other-owner` | No DELETE; empty outcome arrays | 0 / 0 |
   | `list-403` | `FAIL list pods: HTTP 403 Forbidden` | 1 / 2 |
   | `delete-403` | `FAIL delete pod ...: HTTP 403 {"kind":"Status","code":403}` | 1 / 2 |
   | `bad-list` | `FAIL Kubernetes API did not return a PodList` | 1 / 2 |
   | `bad-json` | `FAIL Expected property name or '}' in JSON at position 1 ...` | 1 / 2 |
   | `timeout` | `FAIL GET ...: timeout` from the simulated request timeout | 1 / 2 |

6. Bascule runtime reproduction:

   ```text
   rtk make -f .review-tmp-sol/review.mk bascule-runtime ENV=review-sol-838
   bascule-mock: initialSuspend=false captured=false drainedWatchdogJob=true G2=passed replayPreserved=true restored=false
   bascule-mock: initialSuspend=true captured=true drainedWatchdogJob=true G2=passed replayPreserved=true restored=true
   bascule-mock: initialSuspend=absent captured=undefined drainedWatchdogJob=false G2=passed replayPreserved=true restored=undefined
   Exit: 0
   ```

   This also used an offline read-only container. It extracted the actual functions from `bascule.mjs`, read `QUIESCE_CRONJOBS` from the current workflow, and intercepted every kubectl call; no kubectl process or cluster connection was made.

7. Render checks and equality counterexample:

   ```text
   rtk make -f deploy/k8s/refresh-cronjobs/refresh-018.mk verify-renders TMPDIR="$PWD/.review-tmp-sol" ENV=review-sol-838
   refresh-watchdog: ok — configured: pending deadline 900 s + watchdog period 300 s = nominal deletion request by 1200 s (not a measured bound); refresh Job deadline 19800 s
   [same check passed for both renders]
   refresh-stagger: ok — prod "0 5,11,17,23 * * *", preprod "0 0,6,12,18 * * *": closest starts 60 min apart; nominal watchdog deletion request by 1200 s
   Exit: 0

   rtk make -f .review-tmp-sol/review.mk render-tests ENV=review-sol-838
   verify-renders tests: 24 passed, 0 failed
   Exit: 0

   rtk make -f .review-tmp-sol/review.mk boundary-mutation ENV=review-sol-838
   refresh-watchdog: ok — configured: pending deadline 3300 s + watchdog period 300 s = nominal deletion request by 3600 s (not a measured bound); refresh Job deadline 19800 s
   [same check passed for both copied renders]
   refresh-stagger: ok — prod "0 5,11,17,23 * * *", preprod "0 0,6,12,18 * * *": closest starts 60 min apart; nominal watchdog deletion request by 3600 s
   Exit: 0 [counterexample: equality was accepted]
   ```

   `render-tests` invokes the committed shell suite with TMPDIR inside the review directory. `boundary-mutation` copies the three base resources, both overlay trees, and bascule workflow under `.review-tmp-sol/boundary/`, then changes only `REFRESH_PENDING_DEADLINE_SECONDS` from `900` to `3300` in the copy and runs its full `verify-renders`. The real manifests were unchanged.

8. Upstream evidence and teardown:

   Upstream sources quoted above were fetched with `rtk curl --fail --silent --show-error --max-time 30 -o .review-tmp-sol/<file> <raw.githubusercontent.com URL>`, all exit 0. Tagged v1.34 files: Job controller/defaults, storage interfaces, scheduler informer/events, Pod deletion strategy, core/batch API types, kubelet, and active-deadline handler. The official Job documentation Markdown was also fetched from `kubernetes/website` main. No cluster URL was requested.

   ```text
   rtk make clean ENV=test-review-sol-838
   rtk docker compose -p radar-test-review-sol-838 -f docker-compose.yml -f docker-compose.test.yml down -v
   rtk make clean ENV=review-sol-838
   rtk make clean ENV=e2e-review-sol-838
   rtk docker compose -p radar-e2e-review-sol-838 -f docker-compose.yml -f docker-compose.e2e.yml down -v
   All exit: 0
   ```

   Project-label-filtered `docker ps -a` and `docker volume ls` returned no entries for all three review projects. The external test dependency volumes used by the supplementary checks were removed by the explicit test teardown. `rtk proxy git diff --exit-code --no-ext-diff` returned exit 0 before writing this initially untracked leg. Temporary files were deleted; no tracked implementation file was changed.

## Round-1 findings status

| Finding | Status | Round-2 evidence |
| --- | --- | --- |
| SOL-838-01 — UID-only LIST/DELETE race | **Fixed for API-observable changes.** | Built-client race sent UID + version `7`; live Running/version `8` produced 409 and no deletion. Missing-version snapshots were excluded. Asynchronous kubelet status publication remains a stated limit. |
| SOL-838-02 — 404/409 reported as removed | **Fixed.** | Real built-client response handling produced empty `deletionRequested` and populated `skipped` for both responses, with exit 0. Accepted 200/202/204 requests used the new request-specific field. |
| SOL-838-03 — immediate final failure and hard cleanup bound | **Partial.** | “At once” and the hard bound were removed; current render output and capacity qualifications are accurate. Final `FailureTarget` versus deferred `Failed` remains compressed in the header/manifest; SOL-838-R2-01. No cluster latency was measured. |
| SOL-838-04 — unused `get` grant | **Fixed.** | Both Roles now list only `list`/`delete`, sufficient for the two actual request shapes verified in the built-client mocks. |

## Findings

### SOL-838-R2-01 — Final Failed wording still omits the terminal-condition delay

- **Severity:** non-blocking.
- **File:line:** `api/src/scripts/refresh-pending-watchdog.ts:28`; same wording at `deploy/k8s/34-refresh-pending-watchdog.yaml:23`.
- **Evidence:** Both say the Job is marked `Failed` once the controller has processed the terminating pod. Upstream v1.34's `newFailureCondition` initially selects `FailureTarget` under modern default gates; `enactJobFinished` explicitly returns without marking the Job finished while `*jobCtx.terminating > 0`. Its log says: “Delaying marking the Job as finished, because there are still terminating pod(s).” The official documentation says the terminal `Failed` condition waits until all Job pods terminate. Processing the deletion and deciding failure does not itself establish final `Failed`. The same paragraph describes release only through object disappearance; the scheduler can also remove a pod from its non-terminal informer after a terminal phase update. The revised nominal timing removes the principal round-1 overpromise, so this is a documentation precision issue, not a demonstrated implementation failure.
- **Fix:** Say deletion counts toward failure and prevents replacement under the stated defaults; distinguish `FailureTarget` from final `Failed` after termination/accounting. Describe reservation release when the scheduler observes object deletion or a terminal phase, without equating DELETE acceptance with that observation. Keep the current nominal-timing and capacity qualifications.

### SOL-838-R2-02 — The timing guard accepts the exact start gap

- **Severity:** non-blocking.
- **File:line:** `deploy/k8s/refresh-cronjobs/refresh-stagger.awk:83`.
- **Evidence:** The check rejects only `deadline + period > gap * 60`. The full-render mutation above changed the deadline to `3300` with period `300` and the current closest gap `3600`; `verify-renders` exited 0 and printed nominal request by `3600 s`. Equality is not below the gap or before the other environment's start, as required by the round-2 prompt and guard comment at line 19. The current `900 + 300` setting has 2400 seconds of nominal margin, so this counterexample does not demonstrate a failure of the deployed values.
- **Fix:** Reject `deadline + period >= gap * 60`. Add an exact-equality mutation and a just-below-gap case to the guard suite, retaining wording that this checks configured nominal request timing rather than measured resource release.

## Verdict

**GO-with-nits.** No blocking watchdog runtime or RBAC defect was demonstrated at `a963502d723586e85e358d9ca054f10b949d8439`. The blocking round-1 race and misleading outcome reporting are fixed; the two findings above are non-blocking. The 17 watchdog tests, 24 render mutation tests, built bundle, response/race mocks, bascule successful-path mocks, and supplementary workspace typecheck/lint passed. The direct install/quality sequence failed after npm `ETIMEDOUT`; those exact direct gates and actual CI status remain **unverified** despite successful supplementary checks. Live identity/capacity, controller/kubelet progress, and resource-release timing are **unverified**. All three review projects were torn down with volumes and the temporary directory removed.
