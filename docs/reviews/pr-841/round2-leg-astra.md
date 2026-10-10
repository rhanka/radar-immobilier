---
status: completed
reviewer-host: codex
reviewer-model: gpt-6-astra
reviewer-effort: xhigh
target-ref: ops/bascule-restore-daily@8f97478cd11893e1f6718501d0e988da0c0da2aa
round: 2
---

## Reasoning

Reviewed the full PR against `origin/main...8f97478cd11893e1f6718501d0e988da0c0da2aa`
and every changed file in the round-2 delta
`c16289ad..8f97478cd11893e1f6718501d0e988da0c0da2aa`. HEAD is the requested
detached commit; origin/main is `ab7f4e70e9b05b6637cb1eb4a6769923cfb169e6`.
Only my own `round1-leg-astra.md` was read. This is an independent leg, not a
consensus verdict.

The owner's daily **04:00 UTC** decision is unchanged. No different hour is
proposed. Arming, workflow serialization, scheduled MODE=restore, latest backup
selection, and the stale-backup override remain unchanged by the delta
(`.github/workflows/bascule-preprod.yml:123`, `:137`, `:188`). The age limit is
still configurable with a default of 24 hours (`:200`). The current arming
variable, live schedules, actual backup state, shared-node capacity, GitHub
launch delay, external IdP sync, and supplied operational durations are
**unverified** offline. No cluster, bucket, or GitHub API was contacted.

The new guard improves the evidence for configured start times: it consumes
both actual refresh overlay renders, requires the named refresh CronJobs and
Etc/UTC, and is wired into the existing CI invocation
(`deploy/k8s/refresh-cronjobs/refresh-018.mk:246`, `.github/workflows/ci.yml:37`).
The backup is supplied as its source manifest, not normalized YAML
(`refresh-018.mk:250`). At this commit the reported intervals are 97 minutes
after the backup start and 60 minutes before the next refresh start. These are
start-time checks; duration, queueing, and resource availability are **not
covered**. The revised documentation now states that limitation.

I tried 13 additional copied-fixture mutations and four fake-kubectl recovery
cases. Ordinary patch failures now return a failed un-quiesce step while
attempting the remaining CronJobs, and both recorded true and false suspension
values are retained. Two narrower defects remain demonstrable: a child killed
by a signal is still converted into success by the shared command helper; and
legal YAML document separators with comments or trailing spaces defeat backup
selection by name. The first is a remaining part of ASTRA-841-04; the second is
in the newly added guard. Neither establishes a conflict in the checked-in
04:00 schedule.

## Round-1 findings status

| Finding | Status | Evidence at the reviewed head |
| --- | --- | --- |
| **ASTRA-841-01 — overstated delay margin** | **fixed** | `deploy/ci/bascule-preprod/README.md:316` explicitly gives the 60-minute start gap and the 10-minute margin at the supplied 50-minute duration. Lines 325–332 describe unbounded GitHub delay and configured starts only. `.github/workflows/bascule-preprod.yml:62` also discloses possible prod overlap. The rendered check reports the expected 60-minute next-start gap. |
| **ASTRA-841-02 — unconditional loss of the 06:00 refresh** | **fixed** | `deploy/ci/bascule-preprod/README.md:321` distinguishes a pass missed during suspension from eligibility after un-suspension within the 600-second deadline, and conditions the 12:00 pass on restored `suspend: false`. The inherited fields remain `startingDeadlineSeconds: 600` and `concurrencyPolicy: Forbid` in `deploy/k8s/34-refresh-cronjob.yaml:94`. Actual controller reconciliation timing is **unverified**. |
| **ASTRA-841-03 — latest equated with today's backup** | **fixed** | `deploy/ci/bascule-preprod/README.md:315` now says latestComplete, no same-day check, and allows a sufficiently recent previous-day dump. It qualifies 1.6/25.6 hours as the on-time example. `.github/workflows/bascule-preprod.yml:59` and `deploy/k8s/README.md:307` are aligned. This matches unchanged `chooseDate` / `staleGuard` in `deploy/ci/bascule-preprod/backup-restore.cjs:119` and `:166`. |
| **ASTRA-841-04 — ignored CronJob patch failures** | **partial** | `deploy/ci/bascule-preprod/bascule.mjs:723` now collects nonzero results, continues other patches, and exits 1 at line 729. The supplied new test at `restore-mode.selftest.mjs:824` passes; my exit-7 case also passes that contract and preserves a recorded true value. However, the unchanged helper at `bascule.mjs:116` maps a signal-terminated child's null status to 0. SIGTERM and SIGKILL probes still return CLI exit 0 and log restoration success. See ASTRA-841-R2-01. |

## Commands and outputs

The explicit review command allowance was used. Test temporary directories and
logs were directed to `./.review-tmp-astra/`; `K8S_VALIDATE_WITH_CLUSTER=0` was
set for the checks. Temporary scripts and fixtures were removed after their
results were recorded here. No tracked file was changed.

### Target and whitespace checks

```text
$ git status --short --branch
## HEAD (no branch)
?? docs/reviews/pr-841/
$ git rev-parse HEAD origin/main
8f97478cd11893e1f6718501d0e988da0c0da2aa
ab7f4e70e9b05b6637cb1eb4a6769923cfb169e6
$ git diff --stat c16289ad..8f97478cd11893e1f6718501d0e988da0c0da2aa
10 files changed, 273 insertions(+), 56 deletions(-)
$ git diff --stat origin/main...8f97478cd11893e1f6718501d0e988da0c0da2aa
11 files changed, 301 insertions(+), 20 deletions(-)
$ git diff --check origin/main...8f97478cd11893e1f6718501d0e988da0c0da2aa
[no output; exit 0]
$ git diff --check c16289ad..8f97478cd11893e1f6718501d0e988da0c0da2aa
[no output; exit 0]
```

### Required checks

Each exact command below was executed by
`node .review-tmp-astra/run-checks.mjs <case>`, which preserved the command's
exit status and captured its output.

| Command | Exit | Output |
| --- | --- | --- |
| `node deploy/ci/bascule-preprod/bascule.selftest.mjs` | 0 | `bascule.selftest — 56 passés, 0 échoués` |
| `node deploy/ci/bascule-preprod/restore-mode.selftest.mjs` | 1 | `restore-mode.selftest — 237 passed, 1 failed`; fixture diagnosis below. The new failed-CronJob-patch case passes. |
| `make -f deploy/k8s/refresh-cronjobs/refresh-018.mk verify-renders ENV=review-astra-841` | 0 | `refresh-stagger: ok — prod "0 5,11,17,23 * * *", preprod "0 0,6,12,18 * * *": closest starts 60 min apart; nominal watchdog deletion request by 1200 s`; `bascule-window: ok — restore "0 4 * * *" UTC: 97 min after the backup start "23 2 * * *", next refresh start 60 min later` |
| `bash deploy/k8s/refresh-cronjobs/verify-renders.test.sh` | 0 | `verify-renders tests: 47 passed, 0 failed` |
| `make k8s-validate ENV=review-astra-841` | 0 | `[document-date-recovery] offline render ok (preprod + prod)`; `image entrypoint check: ok (25 reference(s) in 94 file(s), 18 entrypoint(s))`; `[k8s-validate] offline render ok; set K8S_VALIDATE_WITH_CLUSTER=1 for a server dry-run` |

The restore suite still assumes that its temporary working directory cannot
resolve the AWS SDK (`restore-mode.selftest.mjs:445`). This repository-local
scratch directory resolves an ancestor installation. The actual failure and
the fresh diagnostic probe are:

```text
FAIL node -e — main triggered, exit 1 without the SDK, verdict written (got [2,false,false])
ok   CLI unquiesce — failed CronJob patch ⇒ exit 1, named, remaining CronJobs still patched
restore-mode.selftest — 237 passed, 1 failed

$ node .review-tmp-astra/recovery-probe.mjs
Fixture SDK resolution: /home/antoinefa/src/radar-immobilier/node_modules/@aws-sdk/client-s3/dist-cjs/index.js
Fixture probe: {"status":2,"termination":{"ok":false,"step":"resolve","exit":2,"reason":"missing S3_ENDPOINT"}}
```

The diagnostic executes the unchanged embedded `backup-restore.cjs` with the
fixture's minimal environment and local scratch as cwd. It reaches the missing
configuration refusal instead of the expected missing-SDK refusal; it makes no
S3 request. The assertion was not weakened or counted as passing. Local suite
validation is therefore **partial**; remote CI is **unverified**. This is the
same demonstrated fixture issue as round 1, not a new finding from this delta.

### Additional render mutations

Command: `node .review-tmp-astra/mutations.mjs` (exit 0; reports each child
command's actual status). Each case copies the same three base manifests, two
refresh overlay directories, workflow, and backup manifest as
`verify-renders.test.sh:21`, then runs:

```text
make -f <copied-case>/deploy/k8s/refresh-cronjobs/refresh-018.mk verify-renders ENV=review-astra-841
```

No production source, guard implementation, or expected-failure assertion was
changed in these copies. The inputs alone were mutated.

| Mutation | Make exit | Observed result |
| --- | --- | --- |
| Backup at 03:00, exactly 60 minutes before restore | 0 | Guard reports a 60-minute backup gap. |
| Backup at 03:01, 59 minutes before restore | 2 | `starts 59 min after the backup start ... below 60 min` |
| Both refresh time zones changed in the shared base to America/Toronto | 2 | New guard rejects both non-UTC renders; changing both avoids a mere parity failure. |
| Backup timeZone removed | 2 | `radar-backup-daily must run in Etc/UTC, got «  »` |
| Backup minute set to 60 | 2 | `radar-backup-daily schedule must be ... got « 60 2 * * * »` |
| Duplicate named backup document, ordinary separator | 2 | `expected one radar-backup-daily CronJob in the backup manifest, got 2` |
| Extra active workflow entry `- {cron: '0 5 * * *'}` | 2 | `bascule-crons: unreadable on.schedule line` |
| Only workflow cron commented out | 2 | `must carry exactly one active on.schedule cron (got: )` |
| Tab after `cron:`, double-quoted value and trailing comment | 0 | Correct `0 4 * * *` cron and 97/60-minute gaps. |
| Single-quoted backup schedule with trailing comment | 0 | Correct backup schedule and 97/60-minute gaps. |
| Unrelated 01:00 backup document preceding named 04:00 backup, `---` separator | 2 | Correctly rejects the named backup's zero-minute gap. |
| Same two documents, `--- # daily prod backup` separator | **0** | Incorrectly reports the unrelated 01:00 backup, 180-minute gap. ASTRA-841-R2-02. |
| Same two documents, separator `---` followed by two spaces | **0** | Same incorrect 180-minute result. ASTRA-841-R2-02. |

For the last three cases the two documents are full copies of the real backup
manifest, with only their name/schedule changed. The mutation is equivalent to:

```js
const early = original
  .replace('name: radar-backup-daily', 'name: radar-backup-early')
  .replace('schedule: "23 2 * * *"', 'schedule: "0 1 * * *"');
const daily = original
  .replace('schedule: "23 2 * * *"', 'schedule: "0 4 * * *"');
writeFileSync(copiedBackup, early + '\n--- # daily prod backup\n' + daily);
```

A temporary Kustomization listing that copied backup file let the allowed
offline `kubectl kustomize <copied-case>/deploy/ci/backup` independently parse
the exact bytes. All three separator variants render successfully (exit 0),
with the same extracted fields:

```text
kind: CronJob
  name: radar-backup-daily
  schedule: 0 4 * * *
  timeZone: Etc/UTC
kind: CronJob
  name: radar-backup-early
  schedule: 0 1 * * *
  timeZone: Etc/UTC
```

Yet the commented/spaced-separator `verify-renders` commands return:

```text
bascule-window: ok — restore "0 4 * * *" UTC: 180 min after the backup start "0 1 * * *", next refresh start 60 min later
```

### Additional un-quiesce probes

Command: `node .review-tmp-astra/recovery-probe.mjs` (exit 0; reports each child
status). The unchanged `bascule.mjs unquiesce` runs with a temporary fake
kubectl first in PATH, a recorded API Deployment, and recorded CronJob values
`radar-refresh-pv=false`, `radar-refresh-pending-watchdog=false`, and
`radar-consistency-snapshot=true`. The fake logs each call and returns 0 except
on the refresh patch, where the individual cases use `exit 7`, `kill -TERM $$`,
or `kill -KILL $$`. These signals target only the fake child process.

| Refresh patch behavior | Raw spawn status / signal | CLI exit | Refresh success logged | `UN-QUIESCE OK` logged | Remaining patches attempted, including recorded true |
| --- | --- | --- | --- | --- | --- |
| exit 0 | 0 / none | 0 | yes | yes | yes |
| exit 7 | 7 / none | 1 | no | no | yes |
| SIGTERM | null / SIGTERM | **0** | **yes** | **yes** | yes |
| SIGKILL | null / SIGKILL | **0** | **yes** | **yes** | yes |

The nonzero-exit case reports:

```text
::warning title=bascule::UN-QUIESCE partiel — à vérifier côté cluster :
  - patch cronjob/radar-refresh-pv suspend=false a échoué
```

Both signalled cases incorrectly report:

```text
[bascule] cronjob/radar-refresh-pv suspend restauré à false.
[bascule] UN-QUIESCE OK — préprod restaurée à son état d'origine.
```

## Findings

### ASTRA-841-R2-01 — signal-terminated CronJob patches still report success

- **Severity:** non-blocking; remaining inherited helper limitation in the
  ASTRA-841-04 fix, not a new regression in the daily schedule.
- **File:line:** `deploy/ci/bascule-preprod/bascule.mjs:724`; underlying status
  conversion at `deploy/ci/bascule-preprod/bascule.mjs:116`.
- **Evidence:** With `allowFail: true`, `run()` returns
  `status: res.status ?? 0`. A child terminated by SIGTERM or SIGKILL has
  `status: null`, a non-null `signal`, and no spawn error. The new `pc.status`
  check therefore sees 0. The unchanged CLI with the fake signal-killed patch
  exits 0 and logs both the refresh's restored suspension and `UN-QUIESCE OK`.
  Controls with exit 0 and exit 7 distinguish this from the now-fixed ordinary
  nonzero exit. The new supplied test only uses exit 1
  (`restore-mode.selftest.mjs:816`). A live occurrence is **unverified**.
- **Impact:** A patch killed before completion can leave the refresh suspended
  while the recovery step reports success. Failure visibility remains partial.
- **Fix:** Treat a null exit status / signal termination as failure in `run()`
  (or preserve that failure for the caller), while retaining attempts on later
  CronJobs. Add the fake signal-termination case alongside the ordinary failure
  case. Acceptance: exit 1, failed CronJob named, no restoration-success log for
  that CronJob, and the remaining patches still attempted. Owner: PR author.

### ASTRA-841-R2-02 — backup name selection crosses legal YAML document boundaries

- **Severity:** non-blocking; demonstrated regression-guard gap under a valid
  multi-document mutation, not a collision in the current single backup file.
- **File:line:** `deploy/k8s/refresh-cronjobs/bascule-window.awk:50`; affected
  name/field selection at `:63` and `:65`; raw backup input at
  `deploy/k8s/refresh-cronjobs/refresh-018.mk:250`.
- **Evidence:** `RS = "\n---\n"` recognizes only an exact separator line.
  `--- # daily prod backup` and `---  ` are both accepted as document separators
  by offline kubectl kustomize. The guard combines their documents into one
  record, finds `name: radar-backup-daily` in the second document, but takes the
  first `schedule:` and `timeZone:` from the unrelated first document. A named
  backup at **04:00**, behind an unrelated 01:00 backup, passes the full
  `verify-renders` command with a reported 180-minute gap. With an ordinary
  separator the identical resources are correctly rejected with a zero-minute
  gap. This extends the existing unrelated-first-CronJob case in
  `verify-renders.test.sh:186` with valid separator syntax.
- **Impact:** A future backup-manifest edit can defeat the newly claimed
  selection-by-name contract and let a backup/restore start collision pass CI.
  No actual backup schedule change or live collision is demonstrated here.
- **Fix:** Normalize the backup YAML before record-based inspection, or split
  documents using YAML separator semantics, so fields cannot be taken from a
  different object. Add commented and trailing-space separator mutations.
  Acceptance: both demonstrated valid inputs must reject the named 04:00
  backup; the current manifest and valid non-conflicting cases still pass.
  Owner: PR author.

## Verdict

**GO-with-nits.** ASTRA-841-01, -02, and -03 are fixed; ASTRA-841-04 is partial.
Two non-blocking findings are demonstrated above. The current daily 04:00 UTC
schedule passes the configured-window checks, and no blocking conflict with
that owner-selected hour is established. Four requested commands pass; the
restore suite remains **partial** (237 passed, one diagnosed fixture failure).
Remote CI, live recovery, and shared-node capacity remain **unverified**. This
offline leg does not approve arming or assert a consensus review result.
