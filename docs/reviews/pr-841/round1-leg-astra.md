---
status: completed
reviewer-host: codex
reviewer-model: gpt-6-astra
reviewer-effort: xhigh
target-ref: ops/bascule-restore-daily@c16289ad83f4519f4b54c53ba55080a589145a21
round: 1
---

## Reasoning

Reviewed `git diff origin/main...c16289ad83f4519f4b54c53ba55080a589145a21`.
HEAD is `c16289ad83f4519f4b54c53ba55080a589145a21`; origin/main is
`ab7f4e70e9b05b6637cb1eb4a6769923cfb169e6`. The diff changes five files:
the schedule, its selftest, and three documentation files. The restore runtime
and concurrency/arming settings are unchanged. This is one independent review
leg, blind to other reviewers; it does not assert consensus.

The owner's daily **04:00 UTC** decision is accepted. No alternative hour is
proposed. Repository configuration and offline executions are the evidence here.
Live CronJob state, available node capacity, GitHub variables/environment
settings, backup contents, actual schedule delays, and the supplied duration
measurements are **unverified**. The coordinator's stated durations and IdP
schedule are used as supplied context, not represented as measurements made by
this reviewer. No cluster, bucket, or GitHub API was contacted.

### 1. Active preprod workloads and recovery

The workflow explicitly sets `QUIESCE_CRONJOBS` to refresh, pending watchdog,
consistency snapshot, and populate-geo
(`.github/workflows/bascule-preprod.yml:230`). The watchdog is therefore included
even though the standalone CLI's default list omits it.

`cmdQuiesce` records the original CronJob suspend booleans before mutation,
scales the two consumer Deployments down, and suspends each present target
(`deploy/ci/bascule-preprod/bascule.mjs:595`, especially lines 618–627).
It then **requests deletion** of active Jobs whose `ownerReferences` identify
one of those CronJobs, and waits for those Jobs to disappear or become inactive
within the shared 300-second quiesce deadline (lines 629–660). Consequently:

- An active controller-created midnight `radar-refresh-pv-*` Job is deleted;
  the restore does not wait for its natural 1.5–4-hour completion.
- An active controller-created watchdog Job is treated the same way. The new
  README's parenthesis “an active watchdog Job would trip G2” applies if it
  survives the drain, not merely because it was active when quiesce began.
- This wait observes Job status/existence, not a separate check that all
  garbage-collected Job Pods have terminated. Real Pod termination timing is
  **unverified**; the offline probe models Job deletion only.

G2 checks Deployment replicas, target CronJob suspension, and **all** remaining
preprod Jobs (`bascule.mjs:493`). Any Job with `status.active > 0` and no
`sentropic.io/bascule` label refuses restore (lines 522–558). It does not wait
for arbitrary Jobs or delete them. Bascule-labelled Jobs are excluded by label,
not by a check that their run ID equals the current run.

There is an omitted operational case in the new schedule table: a manually
forced refresh, `radar-refresh-pv-forced-*`. `bascule-refresh.yml:35` uses its own
concurrency group, and `bascule.mjs:1105` creates a one-off Job with
`--from=cronjob`, which bypasses suspension and is not the CronJob controller's
owned scheduled Job. An already-active such Job survives this drain and trips
G2. The offline probe reproduces that distinction. The other documented G2
examples at `bascule.mjs:511` include scrape, graph projection/graphify, graph
export, populate-geo, geo-mapper, consistency-snapshot-once, and migration Jobs.
Their actual presence at 04:00 is **unknown**. The repository has no additional
scheduled preprod Job type demonstrated to escape the configured quiesce list.
An independently dispatched one-off after G2 is also not prevented by a
CronJob's suspend flag; cross-workflow exclusion for those callers is **not
covered** by `bascule-preprod` concurrency.

`cmdUnquiesce` restores the recorded CronJob booleans, including an originally
true value (`bascule.mjs:618`, `:720`). The probe exercised both true and false
original values. Ordinary earlier step failure still schedules un-quiesce via
`always()`, with its own 15-minute step budget
(`.github/workflows/bascule-preprod.yml:541`). An R0 refusal leaves no quiesce
state, so un-quiesce is a no-op (`bascule.mjs:692`). However:

- Successful restoration of every CronJob is **not checked**: patch failures
  are ignored and still logged as restored (`bascule.mjs:720`); ASTRA-841-04.
- CronJobs are patched **after** two sequential Deployment rollout waits of up
  to 300 seconds each (`bascule.mjs:710`). Job-level cancellation at 330 minutes
  does not guarantee this cleanup completes. The existing workflow comments
  at lines 149–157 and README at lines 98–110 already disclose that limitation.
  The quiesce-state artifact is uploaded immediately after quiesce
  (`bascule-preprod.yml:473`) for recovery. Job-timeout recovery is **not covered**
  by a live execution in this review.

### 2. Backup selected at 04:00

`chooseDate` reads `manifests/latest.json.latestComplete`, not the newest
partial manifest (`deploy/ci/bascule-preprod/backup-restore.cjs:119`). The backup
writer retains the last complete pointer when the current backup is incomplete
(`deploy/ci/backup/backup-daily.cjs:484`). R0 checks that the selected manifest is
complete and passes freshness before the dump-sidecar/size/inventory checks
(`backup-restore.cjs:500`). The workflow runs R0 at line 427 and quiesce at line
468: an R0 refusal occurs before consumer quiesce or database restore. “Preprod
untouched” is shorthand for those consumers/data: backup Secret replacement and
the read Job itself have already occurred at workflow lines 399–430.

The age reference order is `pg.dumpStartedAt`, `startedAt`, `completedAt`, then
the manifest date at UTC midnight (`backup-restore.cjs:150`). `staleGuard`
rounds the age to tenths of an hour, and compares it with the configured maximum
(default 24); it does not require the selected calendar date to equal today
(`backup-restore.cjs:166`). Scheduled runs force `ALLOW_STALE_BACKUP=false`.

For an actual dump start at 02:23, the README's numbers are correct:
97/60 = 1.6167 hours, reported as **1.6**; the previous day's equivalent is
25.6167, reported as **25.6** and refused. If today's backup is incomplete or
missing, R0 examines the last complete backup, which can be yesterday's or
older; it does not wait for today's backup to finish or automatically retry
R0 when it finishes. A recent previous-day dump can nevertheless pass the age
guard; the probe accepts a previous-day 04:30 dump at age 23.5 hours.

The daily backup is `23 2 * * *`, `Forbid`, with
`startingDeadlineSeconds: 3600` and `activeDeadlineSeconds: 10800`
(`deploy/ci/backup/cronjob-backup-daily.yaml:46`). Thus 7–45 minutes is an
observed duration, not a configured completion guarantee. A controller-created
Job can start up to 03:23, and Pending time/retry can defer its actual dump
start; `STARTED_AT` is captured inside the dump container at line 134. The
three-hour Job deadline permits activity after 04:00. The manual backup window
guard at lines 116–129 does not block that scheduled Job. Freshness and
completeness, rather than cron spacing alone, decide whether restore proceeds.
ASTRA-841-03 corrects the new documentation's stronger claim.

### 3. Duration, suspension, and the 06:00 refresh

The scheduled job receives 330 minutes; the stated sum of runner-side Job waits
is approximately 260 minutes (`bascule-preprod.yml:145`). These are budgets,
not a guarantee to finish before 05:00 or 06:00. From a 04:00 job start, the
outer budget reaches 09:30. Queue/setup delay shifts this interval later.

Both refresh overlays inherit `concurrencyPolicy: Forbid`,
`startingDeadlineSeconds: 600`, and `activeDeadlineSeconds: 19800`
(`deploy/k8s/34-refresh-cronjob.yaml:94`). Preprod changes its hours to
`0,6,12,18` (`deploy/k8s/refresh-cronjobs/kustomization.yaml:67`). Kubernetes
counts schedules missed during suspension; un-suspending allows a missed
schedule still inside its starting deadline to run. `Forbid` restricts overlap
with another Job from the same CronJob, not with the bascule workflow.

Therefore an un-suspension observed at **06:05** can launch the missed 06:00
refresh. It is not automatically lost when restore crosses 06:00. If the
controller only observes un-suspension after the 600-second eligibility window,
that occurrence is skipped and the next scheduled occurrence is 12:00,
provided the CronJob remains active. The exact boundary depends on controller
reconciliation; 06:10 is not a guaranteed launch. Leaving the CronJob suspended
after a failed/cancelled cleanup also invalidates a promise that 12:00 will run.
This is the Kubernetes CronJob suspension/deadline behavior applied to the
checked-in fields; controller execution is **not covered** by the offline tests.
ASTRA-841-02 corrects the new README.

The new relational selftest checks literal schedule shape and **start-time
gaps**, not workload intervals, queue latency, or node capacity. It reports
97 minutes from backup start and 60 minutes until prod refresh. With the supplied
50-minute restore duration, only 10 minutes of additional delay fit before
05:00. A one-hour delay puts even an 18-minute restore across the 05:00 prod
start. ASTRA-841-01 corrects the claim that the margins absorb an hour.

### 4. Complete repository schedule inventory and shared-node interaction

The search covered all of `deploy/**` and `.github/workflows/**`. It found seven
CronJob definitions (some rendered into both namespaces) and two GitHub
`schedule` entries. Declared suspension below is repository state; live
suspension is **unverified**. UTC applies unless stated otherwise.

| Workload and evidence | Declared schedule/state | Interaction with daily restore |
| --- | --- | --- |
| `radar-refresh-pv`, `deploy/k8s/34-refresh-cronjob.yaml:80`, preprod overlay `:67`, prod overlay `:82` | Prod 05/11/17/23:00; preprod 00/06/12/18:00. Base suspended; both dedicated overlays activate it. `Forbid`, start deadline 600 s, Job deadline 19,800 s. | Active preprod scheduled Jobs are drained. Prod is not quiesced. The previous 23:00 prod pass is allowed to extend to 04:30 (04:40 with a ten-minute late Job start); its actual duration is unknown. A delayed/long restore can also overlap the 05:00 prod pass. |
| `radar-refresh-pending-watchdog`, `deploy/k8s/34-refresh-pending-watchdog.yaml:50` | Every 5 min, UTC; base suspended, both refresh overlays activate it. `Forbid`, start deadline 120 s, Job deadline 180 s. | Preprod watchdog suspended and its active owned Job deleted. Prod watchdog remains independent; 10m CPU request / 100m limit (`:95`). |
| `radar-consistency-snapshot`, `deploy/k8s/35-consistency-snapshot-cronjob.yaml:29` | 04:45 UTC, **suspend: true**; inherited into preprod by its base overlay. `Forbid`, start deadline 600 s, Job deadline 900 s. | No active scheduled conflict is demonstrated by the manifests. If independently armed in prod, a 50-minute restore overlaps it for five minutes; 5m CPU request / 150m limit (`:88`). If present in preprod, it is in the quiesce list and an original true suspend is retained. |
| `radar-populate-geo-daily`, `deploy/k8s/35b-populate-geo-cronjob.yaml:17` | 04:17 **America/Toronto**, hence **08:17 UTC in October/daylight time**, 09:17 in standard time. `Forbid`, no explicit suspend or starting deadline; Job deadline 3,600 s. Standalone manifest, not listed in the base Kustomization. | Not a 04:17 UTC collision. It can overlap the tail of a restore approaching its 330-minute budget; 100m CPU request / 500m limit (`:73`). If separately installed in preprod it is in the quiesce list; with no starting deadline, missed-run catch-up differs from refresh. Live installation unknown. |
| `radar-backup-daily`, `deploy/ci/backup/cronjob-backup-daily.yaml:46` | 02:23 UTC, unsuspended; `Forbid`, start deadline 3,600 s, Job deadline 10,800 s. | Normally supplies R0's source. A late/incomplete run does not advance latestComplete; see freshness reasoning. Dump request/limit 100m/1 CPU, copy 50m/500m, purge 10m/200m (`:187`, `:245`, `:276`), sequential containers. A completed manifest can coexist with remaining purge work. |
| `radar-backup-freshness`, `deploy/ci/backup/cronjob-backup-freshness.yaml:30` | 06:53 UTC, unsuspended; `Forbid`, start deadline 3,600 s, Job deadline 300 s. | Independent reader of backup state, not of the restored preprod DB; 10m/200m CPU (`:84`). Its calendar-day freshness checks (`:6`, `:80`) are not R0's 24-hour check and do not detect a refused restore. No destructive conflict demonstrated. |
| `radar-db-backup-prod`, `deploy/ci/bascule-preprod/cronjob-db-backup-prod.yaml:19` | Every 5 min, **suspend: true**, no explicit timeZone; `Forbid`, start deadline 600 s, Job deadline 3,600 s. | Manual chain-mode trigger. A scheduled restore neither configures the prod dump kubeconfig nor calls S1 (`bascule-preprod.yml:331`, `:487`). No routine 04:00 activation introduced. |
| `bascule-preprod`, `.github/workflows/bascule-preprod.yml:74` | Daily 04:00 UTC; job arming gate at `:134`. | Subject of this review; workflow concurrency group `bascule-preprod`. |
| `2b-proof-liveness-sweep`, `.github/workflows/2b-proof-liveness-sweep.yml:22` | Monday 07:00 UTC; group `2b-proof-liveness-sweep` (`:29`). | GitHub-hosted runner fetches the versioned manifest's public `sourceUrl` values (`scripts/2b-proof-liveness/sweep.mjs:135`, `:143`). It is not a cluster restore or preprod health check. No shared restore lock or destructive dependency demonstrated. |

`bascule-e2e`, `bascule-refresh`, `bascule-bundle-cd`, CI, deployment, rollback,
and run-job workflows have **no schedule entry** at this commit. They remain
possible event/manual callers, discussed below; they are not additional nightly
crons. The 04:40 sentropic IdP sync is external to this repository, so its
schedule, resources, and independence are **unverified** here. Accepting the
coordinator's independence statement, its start overlaps a 40–50-minute restore;
there is no evidence here of a data conflict or of node exhaustion from it.

All nine bascule Job templates were inspected. CPU values are per container;
these are not nine concurrent Pods in the successful sequential restore path.

| Template (`deploy/ci/bascule-preprod/`) | CPU request / limit | Scope/evidence |
| --- | --- | --- |
| `backup-read-job.tmpl.yaml` | 25m / 250m | R0/list, `:92`; memory 96Mi/256Mi. |
| `db-rollback-job.tmpl.yaml` | 50m / 250m | G1 rollback snapshot, `:137`; memory 96Mi/512Mi. |
| `db-restore-backup-job.tmpl.yaml` | Fetch init 50m / 500m; restore 100m / 1 CPU | `:97`, `:146`; memory 128Mi/512Mi and 256Mi/1Gi. Init and restore run sequentially. |
| `db-migrate-job.tmpl.yaml` | **Not specified** | Container at `:48` through end of file has no resources block. Effective admission defaults are unknown; namespace LimitRange is operator-owned (`deploy/k8s/00-namespace.yaml:18`). |
| `docs-restore-backup-job.tmpl.yaml` | 25m / 500m | Docs restore and recon, `:112`; memory 256Mi/1Gi, Job deadline 7,200 s. |
| `db-restore-job.tmpl.yaml` | 100m / 1 CPU | Chain-mode restore, `:195`; memory 256Mi/1Gi. |
| `docs-sync-job.tmpl.yaml` | 25m / 500m | Chain docs, `:154`; memory 192Mi/512Mi. |
| `s3-check-job.tmpl.yaml` | 25m / 250m | Chain checks, `:174`; memory 64Mi/256Mi. |
| `served-refs-job.tmpl.yaml` | Extract init 25m / 250m; publish 25m / 250m | `:114`, `:144`; only exercised when CYCLE_ID is supplied, not by the daily schedule (`bascule-preprod.yml:563`). |

The prod refresh requests 50m and is capped at 150m CPU
(`deploy/k8s/34-refresh-cronjob.yaml:257`; prod changes memory, not CPU).
Database work also consumes the preprod Postgres container, whose base CPU
request/limit is 150m/600m (`deploy/k8s/20-postgres-postgis.yaml:83`). Scaling
down preprod API/MCP does not quiesce prod or Postgres. Requests and limits alone
cannot demonstrate sufficient spare capacity or an overload on the shared
node. Static start-time separation is therefore **partial** evidence of an
operating window, not a resource-capacity proof. No measured CPU conflict is
claimed, and none justifies changing the owner-selected hour.

### 5. Workflow event and concurrency semantics

At `.github/workflows/bascule-preprod.yml:134`, only schedule events require
`vars.BASCULE_SCHEDULE_ENABLED == 'true'`. An absent/false variable skips the
job; manual dispatch bypasses this arming gate and retains G3/input checks.
The supplied current value false is **unverified** offline and is not modified
by this diff.

Schedule events have no dispatch inputs: run-name and MODE become `restore`
(`:52`, `:185`), BACKUP_ID becomes `latest` (`:186`), stale override is false
(`:187`), and CYCLE_ID is empty. `!inputs.DRY_RUN` evaluates true; schedule is a
real restore, with automatic current-UTC-date CONFIRM (`:243`). The 24-hour
maximum can still be configured via the existing repository variable (`:197`).
Dispatch defaults remain chain/dry, and the schedule does not introduce a
refresh step.

The workflow-level concurrency group is the constant `bascule-preprod`, with
`cancel-in-progress: false` (`:118`). Scheduled, manual, and e2e-dispatched immo
legs serialize in that same group; an incoming schedule does not cancel the
running manual leg. GitHub's default concurrency queue retains at most one
pending run, so another arriving run can replace a pending one even with
`cancel-in-progress: false`. A FIFO daily-delivery guarantee is **not covered**.
No other workflow declares the exact group, and no second scheduled workflow
competes for it directly.

`bascule-e2e.yml:35` is dispatch-only, with its own `bascule-e2e` group at line
60. Its immo list/restore calls dispatch the same bascule-preprod workflow
(`deploy/ci/bascule-2tenants/orchestrator.mjs:165`, `:208`), so those child legs
can queue behind the daily run. The orchestrator's list wait is only 1,800
seconds (`:172`), including queueing. A list dispatched behind a restore with
more than 30 minutes remaining can time out before its child runs. This is a
concrete conditional manual-operation conflict; no scheduled e2e collision or
actual failed run is demonstrated. Its restore wait is 18,000 seconds (`:230`),
also not additional allowance for an arbitrarily long queue. The scheduled
run's empty CYCLE_ID does not impersonate an e2e child, because correlation
requires MODE plus the exact cycle ID (`:103`). Operators should avoid
dispatching e2e during the daily restore or account for queueing; moving 04:00
is not required.

## Commands and outputs

Commands used the explicit review allowance for direct read-only tools and
offline selftests. Test temporary directories and logs were redirected under
`./.review-tmp-astra/`. The two throwaway `.mjs` probes and all those temporary
files are removed after this review is written. The output excerpts below
preserve failures and their diagnosis; no CI result is inferred.

### Target and inventory

```text
$ git branch --show-current
[empty: detached HEAD]
$ git rev-parse HEAD origin/main
c16289ad83f4519f4b54c53ba55080a589145a21
ab7f4e70e9b05b6637cb1eb4a6769923cfb169e6
$ git diff --stat origin/main...c16289ad83f4519f4b54c53ba55080a589145a21
 .github/workflows/bascule-preprod.yml            | 16 ++++++++---
 deploy/ci/bascule-preprod/CD_NATIVE_MIGRATION.md | 10 +++----
 deploy/ci/bascule-preprod/README.md              | 31 ++++++++++++++++++---
 deploy/ci/bascule-preprod/bascule.selftest.mjs   | 34 ++++++++++++++++++++++--
 deploy/k8s/README.md                             |  1 +
 5 files changed, 78 insertions(+), 14 deletions(-)
$ git diff --check origin/main...c16289ad83f4519f4b54c53ba55080a589145a21
[no output, exit 0]
```

Inventory commands, with results enumerated in the tables above:

```bash
grep -RInE 'kind: CronJob|^[[:space:]]+schedule:|^[[:space:]]*(- )?cron:|^[[:space:]]+timeZone:|^[[:space:]]+group:' deploy .github/workflows
git ls-files 'deploy/ci/bascule-preprod/*.tmpl.yaml'
grep -nE 'resources:|requests:|limits:|cpu:|memory:|activeDeadlineSeconds:' deploy/ci/bascule-preprod/*.tmpl.yaml
```

Relevant source was read with `sed` and line-numbered `awk`; no other review
leg was read.

### Offline checks

Every command below ran with `TMPDIR="$PWD/.review-tmp-astra"`; logs were also
written there. Outputs are excerpts/summaries of the actual executions.

| Command | Exit | Output |
| --- | --- | --- |
| `node deploy/ci/bascule-preprod/bascule.selftest.mjs` | 0 | `bascule.selftest — 61 passés, 0 échoués`; window guards report backup gap 97 min and next-refresh gap 60 min. |
| `node deploy/ci/bascule-preprod/restore-mode.selftest.mjs` | 1 | `restore-mode.selftest — 236 passed, 1 failed`; the failure is diagnosed below. |
| `node deploy/ci/backup/backup-daily.selftest.mjs` | 0 | `261 passed, 0 failed`. |
| `make k8s-validate ENV=review-astra-841` | 0 | Offline render and document-date-recovery render completed; `image entrypoint check: ok (25 reference(s) in 94 file(s), 18 entrypoint(s))`. |
| `make -f deploy/k8s/refresh-cronjobs/refresh-018.mk verify-renders ENV=review-astra-841` | 0 | `refresh-stagger: ok — prod "0 5,11,17,23 * * *", preprod "0 0,6,12,18 * * *": closest starts 60 min apart; nominal watchdog deletion request by 1200 s`. |
| `bash deploy/k8s/refresh-cronjobs/verify-renders.test.sh` | 0 | `verify-renders tests: 28 passed, 0 failed`. |

The restore-suite failure is the assertion at
`deploy/ci/bascule-preprod/restore-mode.selftest.mjs:447` that intentionally
executes the embedded script **without** an installed AWS SDK:

```text
FAIL node -e — main triggered, exit 1 without the SDK, verdict written (got [2,false,false])
restore-mode.selftest — 236 passed, 1 failed
```

Diagnosis command: `node .review-tmp-astra/diagnose-fixture.mjs` (exit 0).
The probe used `createRequire` from the selftest's temporary directory and ran
the unchanged embedded script twice, changing only the child working
directory. All termination files remained under the review temporary directory;
the external `/tmp` working directory was not written.

```text
Fixture SDK resolution: /home/antoinefa/src/radar-immobilier/node_modules/@aws-sdk/client-s3/dist-cjs/index.js
repo-scratch exit=2 [backup-restore:resolve] VERDICT FAIL exit=2 missing S3_ENDPOINT
repo-scratch termination={"ok":false,"step":"resolve","exit":2,"reason":"missing S3_ENDPOINT"}
external-cwd exit=1 [backup-restore:resolve] VERDICT FAIL exit=1 @aws-sdk/client-s3 not resolvable (radar-api image expected)
external-cwd termination={"ok":false,"step":"resolve","exit":1,"reason":"@aws-sdk/client-s3 not resolvable (radar-api image expected)"}
```

This demonstrates an environment-dependent fixture assumption when TMPDIR is
required to live inside this repository tree. The full suite result remains
**partial**; it was not rewritten, counted as all-passing, or rerun with a
weakened assertion. The isolated expected no-SDK path was reproduced. Remote CI
status is **unverified**.

### Runtime-function probes

Command: `node .review-tmp-astra/probe.mjs` (Node v22.22.1, exit 0).
It imported the actual `chooseDate`/`staleGuard` exports, and evaluated the
unchanged source bodies of `quiesceTargets`, `presentCronjobs`, `cmdQuiesce`,
`cmdUnquiesce`, and `assertQuiesced` in a VM with fake kubectl responses and
in-memory state. No real kubectl invocation was made by this probe.

Inputs: latest pointer with today's partial backup and yesterday's
latestComplete; now `2026-10-10T04:00:00Z`; dump starts below. Quiesce inputs:
active controller-owned refresh and watchdog Jobs, plus an active unowned
forced refresh; snapshot originally suspended and other CronJobs active.

```text
Latest pointer: {"date":"2026-10-09","source":"latestComplete","pointerSha256":null}
2026-10-10T02:23:00Z {"ageHours":1.6,"stale":false,"reference":"pg.dumpStartedAt","referenceAt":"2026-10-10T02:23:00.000Z","overridden":false,"blocking":true}
2026-10-09T02:23:00Z exit=2 latest complete backup 2026-10-09 is 25.6 h old (> 24 h, reference pg.dumpStartedAt); set ALLOW_STALE_BACKUP=true or pass BACKUP_ID=2026-10-09 explicitly
2026-10-09T04:30:00Z {"ageHours":23.5,"stale":false,"reference":"pg.dumpStartedAt","referenceAt":"2026-10-09T04:30:00.000Z","overridden":false,"blocking":true}
Toronto 2026-10-10T08:17:00Z 2026-10-10, 4:17 a.m.
Toronto 2026-12-10T09:17:00Z 2026-12-10, 4:17 a.m.
Nominal gaps: backup->restore=97 min; restore->prod refresh=60 min; 50-min restore start-delay margin=10 min; 60-min delay + 18..50 min duration ends 05:18..05:50 UTC.
Quiesce deletions: -n radar-immobilier-preprod delete job radar-refresh-pv-123 --wait=false; -n radar-immobilier-preprod delete job radar-refresh-pending-watchdog-123 --wait=false
Remaining Jobs: radar-refresh-pv-forced-456
G2: GARDE G2 — consommateurs préprod NON quiesce (restore refusé) :   - Job(s) batch ACTIF(s) en préprod (connexion radar-postgres possible) : radar-refresh-pv-forced-456 (active=1) — attendre leur fin (ou les supprimer) avant le restore destructif.   → lancer 'quiesce' (ou scale 0 + suspend à la main), puis relancer.
Unquiesce original suspend restored: {"radar-refresh-pv":false,"radar-refresh-pending-watchdog":false,"radar-consistency-snapshot":true,"radar-populate-geo-daily":false} true
Injected failed CronJob patches: unquiesce returned normally; suspend={"radar-refresh-pv":true,"radar-refresh-pending-watchdog":true,"radar-consistency-snapshot":true,"radar-populate-geo-daily":true}
```

## Findings

### ASTRA-841-01

- **Severity:** non-blocking.
- **File:line:** `deploy/ci/bascule-preprod/README.md:323`; related new workflow
  rationale `.github/workflows/bascule-preprod.yml:65`.
- **Evidence:** The README says the margins absorb “a delay of the order of an
  hour.” Prod refresh is 05:00 (`deploy/k8s/34-refresh-cronjob.yaml:92`), only
  60 minutes after the chosen slot. Using the supplied 50-minute duration
  leaves 10 minutes, not an hour. A 05:00 actual restore start ends at
  05:18–05:50 for the supplied duration range and overlaps prod refresh. The
  relational selftest verifies start gaps only (`bascule.selftest.mjs:225`).
  This disproves the documented no-overlap margin; actual CPU degradation is
  unverified.
- **Fix:** Keep 04:00. Document the nominal 10-minute margin at the observed
  upper duration and the possible prod overlap from delay/long runtime. Describe
  the test as checking configured start gaps, not absorbing runtime delay.

### ASTRA-841-02

- **Severity:** non-blocking.
- **File:line:** `deploy/ci/bascule-preprod/README.md:320`.
- **Evidence:** Crossing 06:00 alone does not skip the occurrence.
  `startingDeadlineSeconds: 600` and `Forbid` are inherited from
  `deploy/k8s/34-refresh-cronjob.yaml:94`; un-quiesce restores suspend=false
  at `bascule.mjs:721`. The missed 06:00 occurrence remains eligible when
  un-suspension is reconciled at, for example, 06:05. A 12:00 next-run claim
  also assumes un-quiesce actually completed. Live controller timing is not
  covered; the documented unconditional behavior conflicts with these fields'
  CronJob semantics.
- **Fix:** Say that un-suspending within the ten-minute deadline can trigger
  the missed 06:00 run immediately; after the deadline it is skipped. State
  that the 12:00 occurrence requires successful restoration of suspension.

### ASTRA-841-03

- **Severity:** non-blocking.
- **File:line:** `deploy/ci/bascule-preprod/README.md:315`; related
  `.github/workflows/bascule-preprod.yml:59` and `deploy/k8s/README.md:307`.
- **Evidence:** “latest = the backup of the day” and unconditional refusal
  when today's backup is missing overstate the contract. The code selects
  latestComplete (`backup-restore.cjs:119`) and applies an age check, not a
  same-day check (`:166`). The actual exported function accepts yesterday's
  04:30 dump at 23.5 hours when evaluated today at 04:00. Delayed scheduled
  dump starts are allowed by the backup's 3,600-second start deadline,
  10,800-second Job deadline, and in-container STARTED_AT capture
  (`cronjob-backup-daily.yaml:50`, `:60`, `:134`). The 1.6/25.6 figures are
  correct only for the stated 02:23 actual dump-start example.
- **Fix:** Describe “latest complete backup within the configured age limit,
  normally today's backup.” Qualify the missing/late-backup refusal by the
  actual age of latestComplete and present 1.6/25.6 as the on-time example.
  No stricter backup-selection policy or hour change is requested.

### ASTRA-841-04

- **Severity:** non-blocking; demonstrated inherited runtime limitation, not
  introduced by this schedule diff.
- **File:line:** `deploy/ci/bascule-preprod/bascule.mjs:721`; newly unconditional
  documentation at `deploy/ci/bascule-preprod/README.md:313` and
  `deploy/k8s/README.md:307`.
- **Evidence:** The original suspend booleans are stored correctly, but every
  restore patch uses `allowFail: true`, its result is discarded, and the next
  line logs success. Only Deployment errors populate `errs`. Injecting failed
  CronJob patches into the unchanged function made it return normally with all
  four CronJobs still suspended. Thus successful `always()` step completion
  is not proof that refresh/watchdog scheduling resumed. No live patch failure
  is claimed. Job-level timeout is separately documented already.
- **Fix:** Qualify the new documentation as attempted restoration subject to
  successful patches/cleanup. For a bounded runtime hardening follow-up, collect
  CronJob patch failures in `errs` and return failure while continuing to
  attempt the remaining CronJobs; verify this with an injected patch-failure
  case. Owner: to be assigned. This limitation does not justify changing 04:00.

## Verdict

**GO-with-nits.** Four non-blocking findings above; no blocking conflict was
demonstrated for the owner-selected daily 04:00 UTC schedule. The cadence
change preserves arming, restore mode, the pre-quiesce freshness gate, and
workflow serialization. Correct the operating-window and recovery claims;
their current wording promises more than the code/configuration establishes.
Offline validation is partial because of the diagnosed restore-selftest
fixture environment; live capacity, cancellation recovery, actual backup
selection, and remote CI remain unverified.
