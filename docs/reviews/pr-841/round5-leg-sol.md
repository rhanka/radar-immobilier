---
status: completed
reviewer-host: codex
reviewer-model: gpt-6.1-sol
reviewer-effort: xhigh
target-ref: ops/bascule-restore-daily@5cef739f525e83aec94393dd014b718a9e2b8ba8
round: 5
---

## Reasoning

Independent, blind round-5 review of PR #841 at `5cef739f525e83aec94393dd014b718a9e2b8ba8`, with `origin/main` at `ab7f4e70e9b05b6637cb1eb4a6769923cfb169e6`. Confirmed both refs locally. Read my own round-4 leg only; no other reviewer's leg was read. Reviewed the full target `origin/main...5cef739f525e83aec94393dd014b718a9e2b8ba8` and the two-file incremental diff `a77307a6..5cef739f525e83aec94393dd014b718a9e2b8ba8`.

Read `rules/MASTER.md`, `rules/workflow.md`, `rules/testing.md`, `rules/security.md`, RTK and harness using-harness/review guidance. The explicit command/file allowlist and independent-review assignment govern this leg. No peer was launched. No cluster, bucket, GitHub API or network query was made; no tracked file, commit or remote state was changed. Test fixtures, fake executables, copied previous source/templates and outputs were written only under `.review-tmp-sol/`, removed at the end. Only the requested leg file is retained.

**The round-4 blocking G2 finding is fixed.** A nonzero current-replica read now adds a G2 problem before any rollback/restore dispatch (`bascule.mjs:503`–`:507`). Signal and ordinary exit-1 cases with desired replicas 0/current replicas 1 both exit 1 with no Job apply. The successfully read nonzero control remains refused. G1 polling likewise accepts success JSON only after a successful child read, and retries failed observations within its existing deadline.

**No new refusal blocking a legitimate scheduled restore was demonstrated.** The readable daily sequence quiesce → restore-backup → unquiesce exits 0/0/0. A second sequence also exits 0/0/0 with a successful empty original `.spec.suspend`, successful empty `.status.replicas`, an absent optional CronJob, no previous bascule Jobs and successful empty output after deleting an active refresh Job. These are fake-interface acceptance checks, not measurements of a Kubernetes API. The code retains successful-empty handling at `bascule.mjs:505`–`:506`, `:628`, `:666`–`:668`, `:678`–`:679`; it does not turn an omitted optional field into a refusal.

The changed checks introduce **no new Kubernetes resource or verb**. Original suspend/current replica reads, Job listing, suspend patches and previous-Job deletes already existed; checking their returned status does not add a request. The drain probe adds `--ignore-not-found` to its existing named Job GET. Its expected absence contract is status 0 plus empty stdout; failures remain unknown. That contract is exercised by the fake and accepted by the code. A real named GET/DELETE against an absent object is **not covered** by the allowed offline commands.

The coordinator supplies successful 2026-10-02 bascule-SA evidence for `delete job ... --ignore-not-found`, active refresh-Job deletion and CronJob patching. Those logs and current effective RBAC are **unverified** offline. Repository preprod bascule manifests describe additive Secret/pod-read permissions; `deploy/k8s/11-ci-deployer-preprod-rbac.yaml` binds a different SA, `radar-ci-deployer-preprod`, and is not proof of the bascule SA's live grants. No demonstrated missing-verb finding is inferred from that incomplete inventory.

### Recovery after a new midway refusal

- The original-suspend refusal occurs before `quiesce-state.json` is written and before any scale/patch (`bascule.mjs:625`–`:634`). Independent signal/exit-1 cases have no state file or mutation; subsequent unquiesce is a no-op.
- For suspend-patch failure, Job-list failure and deployment-drain failure, the state file is already written at `:630`, before scaling at `:634` and patching at `:635`. The patch filter attempts all present CronJobs before refusing at `:636`.
- Six independent midway cases (three failure sites × signal/exit 1) retain the saved original replicas and false/true suspend values. Quiesce exits 1; subsequent unquiesce exits 0 and restores both deployments and both present CronJobs.
- The workflow uploads the state with `always()` even when quiesce failed (`bascule-preprod.yml:479`–`:486`), and invokes unquiesce with `always()`, its own 15-minute step budget and the same workdir (`:240`–`:241`, `:544`–`:548`). Default success gating skips destructive subsequent steps after a failed quiesce. Artifact upload and GitHub execution are **unverified** offline; the wiring is visible.
- A failed recovery patch still exits 1 after trying the remaining CronJob (`bascule.mjs:731`–`:740`); the independent fake confirms that continuation. Job-level cancellation remains the separately documented limit at `bascule-preprod.yml:156`–`:160`.

The daily **04:00 UTC** owner decision is preserved. The configured-start guard passes: backup-to-restore 97 minutes, next refresh start 60 minutes later. The workflow gate `BASCULE_SCHEDULE_ENABLED`, scheduled MODE=restore, auto-CONFIRM and latest-complete/24-hour selection are unchanged. Actual arming, observed durations, GitHub delay, IdP resource use and remote CI remain **unverified**. No new 04:00 conflict is demonstrated and no alternative hour is proposed.

Two non-blocking observations remain below: the new unconditional delete-refusal exit bypasses S1's re-suspend cleanup in manual chain mode; force-refresh's inherited successful-pending-read path still reports a start without an active/succeeded observation. Scheduled restore does not invoke either S1 dump or force-refresh.

## Previous findings status

| My round-4 finding | Status | Evidence at this head |
| --- | --- | --- |
| **SOL-841-R4-01 — G2 treats unreadable current replicas as zero** | **fixed** | `bascule.mjs:504` rejects a failed current-replica read before the zero fallback. Independent signal/exit-1 daily restore cases retain actual fake current replicas=1, exit 1 and perform zero Job applies. Repository assertion at `restore-mode.selftest.mjs:869` passes. Successful empty current status still passes in the independent daily acceptance case. |
| **SOL-841-R4-02 — G1 accepts success JSON from a failed Job-status child** | **fixed** | `bascule.mjs:893` parses only status-0 output. Signal/exit-1 reads emitting complete `{"succeeded":1}` now exit restore 1 after only rollback apply, with no G1 OK or restore apply. Two exact-source helper VM sequences reject the failed result and accept only a subsequent successful success observation (3 and 2 polls respectively). |
| **SOL-841-R4-03 — unreadable original suspend is saved as false** | **fixed** | `bascule.mjs:627` refuses before `:630` writes state or `:634`–`:635` mutate. Signal/exit-1 cases have no state file, no scale/patch and unquiesce no-op. Successful unset suspend is still saved as false and restored as false. New repository assertion at `restore-mode.selftest.mjs:875` passes. |
| **SOL-841-R4-04 — quiesce declares a deployment drained after a failed read** | **fixed** | `bascule.mjs:677`–`:680` requires status 0 for drain success; failure retries to the deadline and then refuses. Independent signal/exit-1 cases exit quiesce 1 with saved state; unquiesce restores the original replicas and CronJob states. Successful empty output is accepted separately. |
| **SOL-841-R4-05 — failed active-Job probe is reported as drained** | **fixed** | `bascule.mjs:666`–`:669` uses `--ignore-not-found`, treats nonzero reads as still unresolved, and does not enter the drained branch. Signal/exit-1 probes emitting `1`, after failed deletion, produce a deadline warning instead of a drained message; subsequent G2 exits 1 with no apply. Successful empty absent-Job output passes. The permitted warning/G2 continuation remains. |
| **SOL-841-R4-06 — failed generic deletion can reuse an old completed Job** | **fixed** | `bascule.mjs:878`–`:880` refuses nonzero deletion before apply. Independent signal/exit-1 migrate cases with an old completed Job exit 1, zero apply, no reused completion. Absent previous Jobs with successful deletion still permit rollback/restore in the readable daily control. The new S1 cleanup regression is separately R5-01. |
| **SOL-841-R4-07 — force-refresh reports success after failed status reads** | **partial** | `bascule.mjs:1132` discards failed-read success JSON; `:1142` refuses persistent unreadability at the async deadline. Signal/exit-1 success-stdout cases and an empty-output signal case exit 1 without force-refresh OK. However, successful `{}` still returns 0 and says started with `.status=pending` at `:1146`; no active/succeeded start prerequisite was added. This inherited residual is R5-02. |
| **SOL-841-R4-08 — failed quiesce suspend patch still permits quiesce success** | **fixed** | `bascule.mjs:635` collects failed patches after attempting all present targets; `:636` refuses. Independent signal/exit-1 cases attempt both CronJobs, retain state, exit 1 and recover via unquiesce. Repository assertion at `restore-mode.selftest.mjs:884` passes. |
| **SOL-841-R4-09 — failed quiesce Job-list read skips draining before success** | **fixed** | `bascule.mjs:647`–`:648` now refuses instead of warning/skipping to success. Independent signal/exit-1 cases exit 1 after saved state/mutations, omit QUIESCE OK, then restore originals via unquiesce. Repository assertion at `restore-mode.selftest.mjs:880` passes. |
| **SOL-841-R4-10 — active-Job delete failure is ignored before drain continuation** | **fixed** | `bascule.mjs:659`–`:660` now checks and names the failed deletion, then retains deadline polling and independent G2. Failed-delete/active-Job case warns by name and subsequent G2 refuses. A failed delete followed by an independently finished Job still permits restore. This allowed guarded continuation is not a new blocking refusal. |

All ten of my round-4 findings are accounted for. Nine are fixed; R4-07 is partial as bounded above. Earlier already-fixed findings are unchanged by the incremental two-file diff.

## Commands and outputs

Commands were run with `TMPDIR=$PWD/.review-tmp-sol/tmp` so temporary writes stay inside the permitted directory. Offline K8s validation also used `K8S_VALIDATE_WITH_CLUSTER=0`. ENV remains the last make argument. No native Python, network/cluster command, gh, push or commit was run.

| Command | Exit and material output |
| --- | --- |
| `git rev-parse HEAD origin/main` | 0: `5cef739f525e83aec94393dd014b718a9e2b8ba8`; `ab7f4e70e9b05b6637cb1eb4a6769923cfb169e6`. |
| `git diff --stat origin/main...5cef739f525e83aec94393dd014b718a9e2b8ba8` | 0: 12 files, 416 insertions, 35 deletions. |
| `git diff a77307a6..5cef739f525e83aec94393dd014b718a9e2b8ba8` and `git diff --name-only a77307a6..5cef739f525e83aec94393dd014b718a9e2b8ba8` | 0: only `bascule.mjs` and `restore-mode.selftest.mjs` change in this round. |
| `node deploy/ci/bascule-preprod/bascule.selftest.mjs` | 0: `bascule.selftest — 56 passés, 0 échoués`. |
| `node deploy/ci/bascule-preprod/restore-mode.selftest.mjs` | 1 initially: `restore-mode.selftest — 246 passed, 1 failed`; sole failure `node -e — main triggered, exit 1 without the SDK, verdict written (got [2,false,false])`. |
| Same unchanged restore selftest, with its intended no-SDK fixture isolated under the throwaway directory | 0: `restore-mode.selftest — 247 passed, 0 failed`. |
| `make -f deploy/k8s/refresh-cronjobs/refresh-018.mk verify-renders ENV=review-sol-841` | 0: `refresh-stagger: ok`; `bascule-window: ok — restore "0 4 * * *" UTC: 97 min after the backup start "23 2 * * *", next refresh start 60 min later`. |
| `bash deploy/k8s/refresh-cronjobs/verify-renders.test.sh` | 0: `verify-renders tests: 52 passed, 0 failed`. |
| `make k8s-validate ENV=review-sol-841` | 0: document-date-recovery preprod/prod offline render passes; `image entrypoint check: ok (25 reference(s) in 94 file(s), 18 entrypoint(s))`; `[k8s-validate] offline render ok`. |
| `node .review-tmp-sol/checks.mjs` | 0: captures all five commands above, preserving the restore child's initial exit 1. |
| `node .review-tmp-sol/isolate-restore.mjs` | 0: resolves original SDK to `/home/antoinefa/src/radar-immobilier/node_modules/@aws-sdk/client-s3/dist-cjs/index.js`, creates only a local throwing module shadow, runs the unchanged restore suite to 247/0. |
| `node .review-tmp-sol/audit.mjs` | 0: 48 actual fake CLI executions pass; daily acceptance, G2/G1 refusal, state/recovery, drain/delete and force-refresh cases. Printed `audit: 28 cases, 48 CLI executions passed`; one of those rows delegates retry evidence to the subsequent VM checks, leaving 27 CLI scenarios. |
| `node .review-tmp-sol/followup.mjs` | 0: two exact-helper VM retry checks and four old/current dump CLI checks pass. Previous dump signal/exit-1 delete: exit 0, patches [false,true], final suspend=true. Current: exit 1, patches [false], final suspend=false, zero apply. |
| `git diff --check`; `git diff --name-only` | Both 0, empty: no tracked-file modification. |
| Final `git status --short` | 0: only `?? docs/reviews/pr-841/`, matching initial status; throwaway directory removed. |

The no-SDK assertion is at `restore-mode.selftest.mjs:445`–`:447`. Placing TMPDIR under this repository makes its `node -e` child resolve the ancestor-installed SDK instead of encountering the fixture's intended absence. The isolated rerun places a module that throws MODULE_NOT_FOUND under `.review-tmp-sol/tmp/node_modules/@aws-sdk/client-s3/`; it does not edit a selftest or installed dependency. Both outcomes are retained. This is local fixture evidence; CI is **unverified**.

Two throwaway preparation commands failed before checks began: the initial shell heredoc quoting failed, and invoking the not-yet-created `checks.mjs` returned MODULE_NOT_FOUND. Corrected shell quoting created the script under the requested directory. These are preparation failures and provide no guard evidence. An initial RBAC filename-glob lookup also returned “No such file or directory”; a recursive grep located the actual manifests. No finding depends on that absent glob.

Representative completed outputs:

```text
bascule.selftest — 56 passés, 0 échoués
restore-mode.selftest — 246 passed, 1 failed
  FAIL node -e — main triggered, exit 1 without the SDK, verdict written (got [2,false,false])
# Unchanged suite with the intended fixture isolated:
restore-mode.selftest — 247 passed, 0 failed
refresh-stagger: ok — prod "0 5,11,17,23 * * *", preprod "0 0,6,12,18 * * *": closest starts 60 min apart; nominal watchdog deletion request by 1200 s
bascule-window: ok — restore "0 4 * * *" UTC: 97 min after the backup start "23 2 * * *", next refresh start 60 min later
verify-renders tests: 52 passed, 0 failed
image entrypoint check: ok (25 reference(s) in 94 file(s), 18 entrypoint(s))
[k8s-validate] offline render ok; set K8S_VALIDATE_WITH_CLUSTER=1 for a server dry-run
```

### Independent fake-interface results

Fake kubectl logs argv, models deployment/CronJob/Job state in JSON, emits stdout synchronously and returns 0/1 or SIGTERM. All CLI calls use that fake via PATH. Templates/source are unchanged; previous bascule source is read with `git show a77307a6:deploy/ci/bascule-preprod/bascule.mjs` and copied with its dependencies under the throwaway directory. No real kubeconfig is read by kubectl; the chain-dump fixture uses a dummy file only to satisfy the CLI's existence guard.

| Scenario | Demonstrated outcome |
| --- | --- |
| Readable daily sequence | Quiesce/restore/unquiesce 0/0/0; original replicas 2/1 and original false/true suspend restored. |
| Successful empty current/suspend fields, absent optional CronJob, deleted Job and absent previous Jobs | Daily sequence 0/0/0; empty original suspend saved/restored false; drain uses `--ignore-not-found`. |
| G2 current read SIGTERM/exit 1, actual current=1 | Restore 1, zero applies. |
| Original suspend SIGTERM/exit 1 | Quiesce 1, no state/mutation; unquiesce no-op 0. |
| Midway patch/list/deployment-drain SIGTERM/exit 1 | Six quiesce failures with saved state; both patches attempted; six successful unquiesce restorations. |
| Failed deletion + failed active probe emitting 1 | Quiesce deadline warning, no drained statement; later G2 refuses, zero applies. |
| Failed active-Job deletion, readable active Job | Named delete warning; later G2 refuses. |
| Failed active-Job deletion, Job independently finishes | Readable inactivity accepted; restore succeeds. |
| G1 status emits success JSON then SIGTERM/exit 1 | Only rollback apply; restore exits 1, no G1 OK or destructive restore apply. |
| Exact helper failed status → active → succeeded; failed empty status → succeeded | 3 and 2 polls; success returned only after successful final read. Sleep call is stubbed in these two VM checks. |
| Failed generic delete with old completed migration Job | Migrate 1, no apply/reuse. |
| Failed force status with success JSON; empty signal output | Force-refresh 1, no force-refresh OK. |
| Successful force status `{}`, active=1, succeeded=1 | All exit 0; the `{}` case reports started with pending status. |
| Recovery patch SIGTERM | Unquiesce 1; remaining CronJob still attempted. |
| Manual chain dump, freshness-Job delete SIGTERM/exit 1 | Old source re-suspends; current exits before re-suspend. No current freshness Job apply or restore dispatch. |

These tests demonstrate caller control flow and recorded restoration, not actual Job-controller behavior, Kubernetes output/exit codes, resource contention or live data effects.

## Findings

### SOL-841-R5-01 — new delete refusal bypasses S1 re-suspend cleanup

- **Severity:** non-blocking.
- **File:line:** `deploy/ci/bascule-preprod/bascule.mjs:879`; caller passes `failClosed:false` at `:468`, with re-suspend after dispatch at `:478`.
- **Evidence:** `node .review-tmp-sol/followup.mjs` executes the previous and current actual CLI sources with a fake prod CronJob initially suspended. Both successfully patch it to false. The preprod `delete job radar-bascule-freshness --ignore-not-found` then returns exit 1 or SIGTERM. Previous source applies/observes the freshness Job, patches prod suspend=true and exits 0. Current source exits 1 at the new unconditional `die()`, performs zero apply, never sends the true patch and leaves fake prod suspend=false. Output is `{"tag":"current","kind":"signal","exit":1,"patches":[false],"finalSuspend":false,"applies":0}`, with the same result for ordinary exit 1.
- **Finding/limits:** The requested refusal before reuse is correct, but it now also terminates callers that requested a failed verdict so they can perform cleanup. A failure while dispatching the freshness check leaves the manually triggered prod backup CronJob armed. This is a new demonstrated failure branch; other inherited strict dispatch failures could already bypass this cleanup. Scheduled MODE=restore never runs S1 (`bascule-preprod.yml:488`–`:491`), and this failing chain step prevents subsequent destructive restore. No weakened final restore guard or blocked legitimate daily run is demonstrated. Live prod scheduling/data effects are **unverified**.
- **Fix:** Keep refusing any apply/reuse after a failed deletion. For `failClosed:false`, return a failed verdict (for example, delete-failed with no UID) so S1 performs its re-suspend before reporting failure; retain hard refusal for strict callers. Alternatively provide a cleanup mechanism that runs despite this failure. A plain `finally` around the current helper is insufficient while `die()` calls `process.exit()`. Verify failed delete ⇒ no apply, prod patches [false,true], final suspend=true, CLI failure.

### SOL-841-R5-02 — force-refresh still claims a start from successful pending status

- **Severity:** non-blocking.
- **File:line:** `deploy/ci/bascule-preprod/bascule.mjs:1142`–`:1147`, especially `:1146`.
- **Evidence:** `node .review-tmp-sol/audit.mjs` invokes the actual force-refresh CLI with `FORCE_REFRESH_START_CONFIRM_SEC=0`. Create succeeds; a status-0 GET returns `{}`. The CLI exits 0 and logs `force-refresh OK (async)` / `démarré (.status=pending)`. Active=1 and succeeded=1 controls also exit 0. Failed status reads, including success JSON followed by SIGTERM, now exit 1; those parts of R4-07 are fixed. The unchanged pending fallback is visible in the incremental diff.
- **Finding/limits:** This is the inherited residual of **SOL-841-R4-07**, not a newly introduced failed-read bypass. A successful GET confirms that the Job object exists, but `{}` contains no active/succeeded observation confirming the claimed start. A real pending Job is not demonstrated to be broken; its start is **unverified**. Force-refresh is outside the bascule workflow (`bascule-preprod.yml:550`–`:551`), so the daily restore is unaffected.
- **Fix:** Require a successful active/succeeded observation before reporting confirmed start/completion, or preserve asynchronous return while saying that the Job was created and start remains unknown/pending. Verify that a successful empty status cannot produce the “started” claim and that active/succeeded controls retain their intended result.

## Verdict

**GO-with-nits.** The round-4 blocking G2 defect is fixed; no blocking new refusal or loss of midway-quiesce recovery was demonstrated. Nine round-4 findings are fixed and R4-07 is partial. R5-01 is a manual-chain cleanup regression; R5-02 is an inherited force-refresh status-reporting residual. Both are non-blocking under the supplied severity rule and neither blocks scheduled MODE=restore.

All five requested commands ran. Four pass directly; restore selftests initially fail the local no-SDK fixture assumption and pass 247/0 after isolating that intended fixture without changing the suite. Remote CI, live RBAC/arming and actual schedules/durations remain **unverified**. The owner-selected daily **04:00 UTC** remains unchanged. Temporary files were removed; no tracked file was modified.
