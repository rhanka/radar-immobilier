---
status: completed
reviewer-host: codex
reviewer-model: gpt-6.1-sol
reviewer-effort: xhigh
target-ref: ops/bascule-restore-daily@8f97478cd11893e1f6718501d0e988da0c0da2aa
round: 2
---

## Reasoning

Independent round-2 leg for PR #841, retaining the round-1 lens: **test guard soundness, references and documentation accuracy**. Reviewed the full delta `git diff c16289ad..8f97478cd11893e1f6718501d0e988da0c0da2aa` and the resulting changes against `origin/main`. Verified HEAD = `8f97478cd11893e1f6718501d0e988da0c0da2aa` and `origin/main` = `ab7f4e70e9b05b6637cb1eb4a6769923cfb169e6`. Read only my own round-1 leg; no other review leg was read.

Read `rules/MASTER.md`, `rules/workflow.md`, `rules/testing.md`, RTK and the harness using-harness/review instructions. The explicit independent-leg scope and command allowlist govern this review. No additional agents, remote queries, cluster/bucket access, commits, pushes or tracked-file edits were performed. All temporary writes, including selftest artifacts, used the repository-local `.review-tmp-sol/` directory; only this leg was retained.

The requested daily **04:00 UTC** schedule remains the owner's decision. Parsing the base and current workflow as YAML, deleting only `on.schedule`, and comparing the remaining objects returned `workflowOnlyScheduleChanged: true`. The scheduled MODE, latest-complete selection, stale-backup setting, auto-CONFIRM, timeouts and arming expression are unchanged. Current offline render verification reports a 97-minute backup-to-restore start gap and a 60-minute restore-to-next-refresh start gap. No conflict in the current configured start times was demonstrated. Actual durations, GitHub launch delay, IdP resource usage, repository-variable state and remote CI are unverified offline.

The round-2 guard correctly reads the final refresh renders: the earlier paired prod/preprod overlay mutation, prod-only patch and later preprod patch now fail. It also rejects the normal-form late backup and wrong-timezone mutations, counts mixed-quote workflow crons, and accepts the earlier valid schedule quotes and patch comments. The repository mutation suite now passes 47 cases.

Backup validation remains **partial**. `refresh-018.mk:250` passes the raw backup manifest as the third input. The new AWK splits documents only at the exact bytes `\n---\n`, then chooses the first schedule/timeZone anywhere in a record containing the requested name. A valid `--- # comment` or `---   ` separator merges two YAML documents for this parser. An unrelated 01:00 backup can then stand in for the named daily backup at 03:23, or for a daily backup using `America/Toronto`. All three conflicting mutations pass the complete `verify-renders` target. Offline Kustomize accepts each and emits the actual named objects. This is SOL-841-R2-01; it concerns regression protection, not a demonstrated current live collision.

Passing a canonical backup render to the **unchanged** AWK rejects both the 03:23 and wrong-timezone mutants. It also accepts a quoted backup resource name that the raw-input guard incorrectly rejects. This supports a bounded fix: normalize the backup input before applying the same resource selection and arithmetic, and add the demonstrated mutations.

The documentation now accurately distinguishes age from same-day selection, nominal margins from observed durations, and the possible delayed-start overlap with prod. The 06:00 explanation identifies suspension, the 600-second catch-up allowance, `Forbid`, and the later 12:00 pass. Controller timing is unverified. The IdP 04:40 row is retained context supplied by the coordinator; CPU-only behavior is unverified offline.

The new un-quiesce check correctly handles a kubectl **exit-code** failure: it returns exit 1, names the failed CronJob, continues patching the remaining CronJobs and suppresses the failed object's success log. An independent fake-kubectl test also verified restoration of a recorded `suspend: true`. A signal failure remains **not covered**: the unchanged `run()` helper maps `status: null` to 0, so a SIGTERM during the patch still produces a success log and exit 0. The helper is byte-identical to `origin/main`; this limits attribution and is recorded as non-blocking SOL-841-R2-03, a remaining gap in the newly added failure check.

## Round-1 findings status

| Finding | Status | Evidence |
| --- | --- | --- |
| **SOL-841-01 — source extraction misses final workloads** | **partial** | Relational block removed from `bascule.selftest.mjs:203`; `refresh-018.mk:250` now checks final preprod/prod renders with `bascule-window.awk:57`. The paired mutation renders prod `0 4,10,16,22 * * *`, preprod `0 5,11,17,23 * * *` and now exits 2 with `starts together with a refresh: prod@4:00`. Prod-only and later preprod patches also exit 2. A normal-separated first backup decoy, direct wrong timezone and direct late backup are rejected. Single-quoted backup/preprod schedules and a comment between patch path/value pass. Raw backup document separation still permits a named-workload substitution; see SOL-841-R2-01. |
| **SOL-841-02 — single-cron assertion counts only single quotes** | **fixed** | `bascule.selftest.mjs:200` counts active `- cron:` entries independently of value quoting. Extra double-quoted and unquoted 05:00 crons each produce `55 passés, 1 échoués`, exit 1; complete render verification exits 2 with `exactly one active on.schedule cron`. Single valid double-quoted/unquoted 04:00 entries and a commented extra each produce `56 passés, 0 échoués`, exit 0. An unreadable schedule entry is rejected by the render target. The separate workflow-key-comment false failure is SOL-841-R2-02. |
| **SOL-841-03 — freshness described as a same-day requirement** | **fixed** | `deploy/ci/bascule-preprod/README.md:315` explicitly says `latestComplete`, dump-start age, no same-day check, and that a later previous-day backup can qualify. Workflow `:59` and `deploy/k8s/README.md:307` were corrected consistently. This matches unchanged `backup-restore.cjs:119` and `:166`; the round-1 executed previous-day counterexample is no longer contradicted. |
| **SOL-841-04 — unsupported one-hour launch-delay assurance** | **fixed** | README `:316` states the nominal 60-minute gap and 10-minute remainder with the 50-minute upper observed restore; `:325` says launch delay is neither measured nor bounded. Workflow `:67` says a late start/long restore can overlap prod. The guard's configured-start-only limitation is explicit at `bascule-window.awk:23` and README `:328`. No change to the owner-selected hour is proposed. |

## Commands and outputs

Commands were offline. `TMPDIR` was set to the absolute `.review-tmp-sol/` path for existing selftests and Make/shell render suites. `K8S_VALIDATE_WITH_CLUSTER=0` was set for K8s validation. Existing source files were not edited.

| Command | Exit and relevant output |
| --- | --- |
| `git rev-parse HEAD origin/main` | 0: `8f97478cd11893e1f6718501d0e988da0c0da2aa`; `ab7f4e70e9b05b6637cb1eb4a6769923cfb169e6` |
| `git diff --stat c16289ad..8f97478cd11893e1f6718501d0e988da0c0da2aa` | 0: 10 files changed, 273 insertions, 56 deletions |
| `git diff --stat origin/main...8f97478cd11893e1f6718501d0e988da0c0da2aa` | 0: 11 files changed, 301 insertions, 20 deletions |
| `git diff c16289ad..8f97478cd11893e1f6718501d0e988da0c0da2aa` | 0: full ten-file delta inspected |
| `node deploy/ci/bascule-preprod/bascule.selftest.mjs` | 0: `bascule.selftest — 56 passés, 0 échoués` |
| `node deploy/ci/bascule-preprod/restore-mode.selftest.mjs`, initial local-TMPDIR run | 1: `restore-mode.selftest — 237 passed, 1 failed`; sole failure: `node -e — main triggered, exit 1 without the SDK, verdict written (got [2,false,false])`. The new CronJob-patch failure assertion passed. |
| Same restore command with the intended no-SDK fixture isolated | 0: `restore-mode.selftest — 238 passed, 0 failed`; `node -e` fixture got `[1,false,true]`; new failed-patch assertion passed |
| `make -f deploy/k8s/refresh-cronjobs/refresh-018.mk verify-renders ENV=review-sol-841` | 0: watchdog 900 + 300 = 1200 s; refresh window 18900 < 19800 < 21600 s; prod/preprod closest starts 60 min apart; bascule 97 min after backup, next refresh 60 min later |
| `bash deploy/k8s/refresh-cronjobs/verify-renders.test.sh` | 0: `verify-renders tests: 47 passed, 0 failed` |
| `make k8s-validate ENV=review-sol-841` | 0: document-date-recovery offline renders pass; `image entrypoint check: ok (25 reference(s) in 94 file(s), 18 entrypoint(s))`; `[k8s-validate] offline render ok` |
| `node .review-tmp-sol/checks.mjs` | 0: invoked and captured the five requested commands above; each child exit is recorded separately |
| `node .review-tmp-sol/isolate-restore.mjs` | 0: created only a throwaway no-SDK fixture and reran the unchanged restore suite, child exit 0 |
| `node .review-tmp-sol/mutations.mjs` | 0: 32 isolated copies; individual full render-target results below; every backup copy accepted by offline Kustomize |
| `node .review-tmp-sol/recheck-selftests.mjs` | 0: reran the 12 workflow/selftest cases after correcting the copied fixture's missing `bascule-refresh.yml`; final complete-selftest results below |
| `kubectl kustomize --load-restrictor LoadRestrictionsNone <copied-backup-wrapper>` | 0 in all 32 cases; emits the named backup objects from the copied manifest |
| `node .review-tmp-sol/unquiesce.mjs` | 0: three fake-kubectl cases; CLI child exits 0 / 1 / 0 for success / exit 1 / SIGTERM respectively; remaining patches attempted in every case |
| `node .review-tmp-sol/evidence.mjs` | 0: workflow except schedule unchanged = true; 32 cases, three unexpected passes, three unexpected failures; backup documents retain identical complete jobTemplates |
| `node .review-tmp-sol/normalize-evidence.mjs` | 0: normalized backup changes the late/timezone guard results from 0 to 1 and the quoted-name result from 1 to 0; paired refresh collision rejected; `runHelperUnchangedFromMain: true` |
| `git diff --check`; `git diff --name-only` | Both 0, empty output: no tracked-file modification |

Baseline render output:

```text
refresh-stagger: ok — prod "0 5,11,17,23 * * *", preprod "0 0,6,12,18 * * *": closest starts 60 min apart; nominal watchdog deletion request by 1200 s
bascule-window: ok — restore "0 4 * * *" UTC: 97 min after the backup start "23 2 * * *", next refresh start 60 min later
verify-renders tests: 47 passed, 0 failed
```

**Restore fixture result.** This reproduces the round-1 local-environment issue: the embedded `node -e` script runs in a temporary cwd under this repository and resolves the ancestor SDK at `/home/antoinefa/src/radar-immobilier/node_modules/@aws-sdk/client-s3/dist-cjs/index.js`. The assertion expects an absent SDK. A throwaway `.review-tmp-sol/node_modules/@aws-sdk/client-s3/index.js` threw `MODULE_NOT_FOUND` on require, restoring that intended fixture condition. No runtime file, selftest or tracked dependency was changed. The first failed run remains recorded; the isolated run does not establish remote CI status.

**Copied-fixture correction.** The first mutation driver omitted `.github/workflows/bascule-refresh.yml`, required near the end of the copied bascule selftest, causing ENOENT before its final summary. Those incomplete selftest executions were not used as guard evidence. Added the missing file to the throwaway copies and reran all 12 affected selftest cases to completion. The independent render-target results did not depend on that file.

### Independent mutation results

The driver copied the same refresh base/PVC/watchdog files and overlays as `verify-renders.test.sh`, plus the backup manifest, workflows and bascule implementation/templates. It mutated only copies and invoked the complete copied `refresh-018.mk verify-renders` target with `ENV=review-sol-841`. YAML parsing and offline Kustomize provided the actual named-object evidence. Expected failure means violation of the declared guard contract, not a live incident. Make exits 2 when the failing guard exits 1.

| Mutation | Expected | Render target | Evidence/result |
| --- | --- | --- | --- |
| Baseline | pass | 0 | 97-minute backup gap, 60-minute next-refresh gap; complete bascule selftest 56/0 |
| Round-1 paired overlay collision | fail | 2 | Actual prod 04:00, preprod 05:00; `starts together with a refresh: prod@4:00` |
| Round-1 prod-only overlay collision | fail | 2 | Named rendered prod 04:00 rejected |
| Round-1 later preprod schedule patch | fail | 2 | `starts together with a refresh: preprod@4:00` |
| First backup decoy, ordinary `---` separator, actual daily 03:23 | fail | 2 | Correct named backup selected; 37-minute gap rejected |
| Same documents, `--- # next YAML document` separator | fail | **0** | Actual daily 03:23; guard instead reports unrelated 01:00 and 180-minute gap |
| Same documents, `---   ` separator | fail | **0** | Same substitution and false pass |
| Backup decoy separated by `...` then ordinary `---` | fail | 2 | Correct 03:23 schedule rejected |
| Commented separator, actual daily unchanged at 02:23 | pass | 0 | Outcome passes, but reported gap is incorrectly 180 instead of 97 min |
| Commented separator, actual daily timezone `America/Toronto` | fail | **0** | Guard reads decoy's `Etc/UTC`; named actual timezone accepted |
| Ordinary separator, late named daily schedule single-quoted | fail | 2 | Correct 37-minute gap rejected |
| Valid single-quoted backup schedule | pass | 0 | Earlier round-1 false failure fixed |
| Valid unquoted backup schedule with trailing comment | pass | 0 | 97-minute gap |
| Direct backup timezone `America/Toronto` | fail | 2 | `radar-backup-daily must run in Etc/UTC` |
| Direct backup 03:23 | fail | 2 | 37-minute gap rejected |
| Backup weekdays only | fail | 2 | Daily schedule parser rejects |
| Backup minute 60 | fail | 2 | Schedule parser rejects |
| Backup hour 24 | fail | 2 | Schedule parser rejects |
| Backup name `"radar-backup-daily"` | pass | **2** | Kustomize emits the unchanged actual name; raw parser says `got 0` named backups |
| Valid single-quoted preprod schedule patch | pass | 0 | Earlier round-1 false failure fixed |
| Comment between preprod schedule patch path and value | pass | 0 | Earlier round-1 false failure fixed |
| Extra double-quoted active workflow cron | fail | 2 | Two parsed crons; complete bascule selftest exit 1, 55/1 |
| Extra unquoted active workflow cron | fail | 2 | Two parsed crons; complete bascule selftest exit 1, 55/1 |
| Sole valid double-quoted workflow cron | pass | 0 | Complete bascule selftest exit 0, 56/0 |
| Sole valid unquoted workflow cron with trailing comment | pass | 0 | Complete bascule selftest exit 0, 56/0 |
| Commented-out extra workflow cron | pass | 0 | Complete bascule selftest exit 0, 56/0 |
| Unreadable schedule entry `- kron:` | fail | 2 | `unreadable on.schedule line`; bascule selftest alone passes, 56/0; overall render gate rejects |
| Valid `schedule: # daily restore` key comment | pass | **2** | YAML still has sole 04:00 cron; bascule selftest 56/0; new extractor returns zero crons |
| Valid `on: # triggers` key comment | pass | **2** | Same unchanged YAML schedule and false failure |
| Only workflow cron commented out | fail | 2 | Zero crons rejected; complete bascule selftest 55/1 |
| Workflow weekdays only | fail | 2 | Daily guard rejects; complete bascule selftest 55/1 |
| Workflow off-hour at 04:30 | fail | 2 | Minute and 30-minute next-refresh gap rejected; complete bascule selftest 55/1 |

### Decisive backup evidence

The conflicting fixture contains two **complete** CronJobs, cloned from the repository backup manifest with identical jobTemplates; only the first resource name/schedule and the real daily schedule differ. Relevant excerpt (jobTemplates omitted here):

```yaml
apiVersion: batch/v1
kind: CronJob
metadata:
  name: radar-backup-early
spec:
  schedule: "0 1 * * *"
  timeZone: "Etc/UTC"
# ... complete copied jobTemplate ...
--- # next YAML document
apiVersion: batch/v1
kind: CronJob
metadata:
  name: radar-backup-daily
spec:
  schedule: "23 3 * * *"
  timeZone: "Etc/UTC"
# ... complete copied jobTemplate ...
```

The copied wrapper's Kustomization lists this manifest as a resource. `kubectl kustomize --load-restrictor LoadRestrictionsNone <wrapper>` exits 0 and emits:

```text
radar-backup-daily: schedule=23 3 * * *, timeZone=Etc/UTC
radar-backup-early: schedule=0 1 * * *, timeZone=Etc/UTC
```

Running `make -f deploy/k8s/refresh-cronjobs/refresh-018.mk verify-renders ENV=review-sol-841` from the copied fixture exits **0**:

```text
bascule-window: ok — restore "0 4 * * *" UTC: 180 min after the backup start "0 1 * * *", next refresh start 60 min later
```

With the same preprod/prod inputs and a canonical backup render as the third input, the unchanged AWK exits **1**, detecting the actual 37-minute gap. The wrong-timezone variant similarly passes the complete target with raw input and fails the same AWK with canonical input. Both renders preserve the owner-selected 04:00 restore.

### Independent un-quiesce evidence

The fake kubectl logs attempts separately from successfully applied fake patches. Recorded state includes refresh/watchdog `false` and an already-suspended CronJob `true`.

| Fake patch behavior for `radar-refresh-pv` | Direct child result | Un-quiesce result |
| --- | --- | --- |
| Success | status 0 | Exit 0; all three original suspend values patched |
| Exit 1 | status 1 | Exit 1; named failure; remaining two patched; no refresh success log |
| `kill -TERM "$$"` before applying the patch | status null, signal SIGTERM | **Exit 0**; remaining two patched; failed refresh patch absent from applied log, but success reported |

Signal-case CLI output:

```text
[bascule] cronjob/radar-refresh-pv suspend restauré à false.
[bascule] cronjob/radar-refresh-pending-watchdog suspend restauré à false.
[bascule] cronjob/already-suspended suspend restauré à true.
[bascule] UN-QUIESCE OK — préprod restaurée à son état d'origine.
```

These are fake-interface observations, not live cluster results.

## Findings

### SOL-841-R2-01

- **Severity:** blocking.
- **File:line:** `deploy/k8s/refresh-cronjobs/bascule-window.awk:50`; related selection at `:63` and raw-input wiring at `deploy/k8s/refresh-cronjobs/refresh-018.mk:250`.
- **Finding:** Backup validation can substitute an unrelated CronJob's schedule/timeZone for `radar-backup-daily`. The new guard consumes raw YAML but recognizes only the exact uncommented, unspaced document separator. It can silently accept a valid named-backup contract violation.
- **Evidence:** Full fixture-copy `verify-renders` exits **0** for two valid documents separated by `--- # next YAML document`: unrelated backup 01:00, named daily backup 03:23. It reports a 180-minute gap from 01:00; the actual named gap is 37 minutes. `---   ` also bypasses it. A commented separator also hides the real daily backup's `America/Toronto` timezone. All mutants render successfully with offline Kustomize. Ordinary separators reject the same changes. Additionally, simply quoting the unchanged backup metadata name causes a false failure (`got 0`).
- **Cause:** A combined AWK record satisfies the real backup-name predicate, but `field()` returns the first schedule/timeZone, from the preceding resource. `nbackup` counts matching records rather than YAML objects.
- **Fix:** Canonicalize the backup manifest with the existing offline rendering path before passing it to this guard, or parse YAML documents and fields structurally. Preserve kind/name selection and require one actual named CronJob. Add mutation cases for commented/spaced separators, the hidden real timezone, and a quoted metadata name. Passing the canonical backup render to the unchanged guard already rejects both demonstrated bypasses and accepts the quoted-name case. Keep 04:00 UTC.
- **Gate rationale:** SOL-841-01 is only partially resolved: final refresh schedules are covered, but the replacement guard still admits an actual named-workload violation through valid YAML. The merge gate's regression protection remains partial; no current live schedule conflict is claimed.

### SOL-841-R2-02

- **Severity:** non-blocking.
- **File:line:** `deploy/k8s/refresh-cronjobs/bascule-crons.awk:12` and `:15`.
- **Finding:** A trailing YAML comment on either the `on:` or `schedule:` key makes the new extractor lose the entire schedule section and reject an unchanged valid workflow.
- **Evidence:** Mutating only `schedule:` to `schedule: # daily restore`, or `on:` to `on: # triggers`, leaves YAML `on.schedule = [{"cron":"0 4 * * *"}]`. The complete bascule selftest still reports **56 passed, 0 failed**. Full `verify-renders` exits **2** with `must carry exactly one active on.schedule cron (got: )`.
- **Fix:** Recognize trailing comments on section-key lines while retaining failure for unreadable active schedule entries; add both unchanged-schedule comment mutations. Alternatively extract `on.schedule` structurally. No schedule-hour change is needed.

### SOL-841-R2-03

- **Severity:** non-blocking.
- **File:line:** `deploy/ci/bascule-preprod/bascule.mjs:724`; related unchanged helper at `:116`.
- **Finding:** The new patch-result check covers nonzero exits but still reports success if kubectl dies by signal before applying a CronJob patch.
- **Evidence:** Fake kubectl executes `kill -TERM "$$"` before its applied-patch log. A direct spawn records `status: null`, `signal: "SIGTERM"`. Running the unchanged bascule CLI against that fake returns **0**, prints `cronjob/radar-refresh-pv suspend restauré à false` and `UN-QUIESCE OK`, and continues the remaining patches. The corresponding exit-1 fake correctly returns 1. `run()` is byte-identical to `origin/main` and returns `res.status ?? 0`, so this is a remaining inherited-helper gap exposed by the new check, not a newly introduced signal regression.
- **Fix:** Treat a null/signal subprocess result as failure in `run()` (for example preserve the signal and return a nonzero status), and add a fake-kubectl signal case alongside the new exit-1 case. Acceptance: un-quiesce exits 1, names the failed refresh patch, attempts the remaining patches, and emits no success log for the interrupted patch.

## Verdict

**NO-GO** for the replacement backup guard's demonstrated false passes (SOL-841-R2-01). Round-1 SOL-841-01 is partial; SOL-841-02, SOL-841-03 and SOL-841-04 are fixed. Two additional non-blocking gaps are recorded above. The requested daily 04:00 UTC cadence matches the owner's decision, and no current configured-start conflict was demonstrated.

All requested offline render checks pass. The bascule selftest passes; the restore suite initially fails its inherited local no-SDK assumption and passes all 238 assertions after isolating that fixture. Remote CI and live operational behavior remain unverified. Temporary fixtures and scripts were deleted after their evidence was incorporated; no tracked file was modified.
