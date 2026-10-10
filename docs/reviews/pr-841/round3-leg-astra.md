---
status: completed
reviewer-host: codex
reviewer-model: gpt-6-astra
reviewer-effort: xhigh
target-ref: ops/bascule-restore-daily@e88a2f35bc63ea850d936ecfeb74a1ba5d90f951
round: 3
---

## Reasoning

Reviewed the full target `origin/main...e88a2f35bc63ea850d936ecfeb74a1ba5d90f951`
and all seven files in `8f97478c..e88a2f35bc63ea850d936ecfeb74a1ba5d90f951`.
HEAD and origin/main match the requested commits. I read only my own round-1
and round-2 review legs. This is an independent leg, not a consensus verdict.

The two round-2 findings are **fixed** as originally reproduced. Normalizing
the backup manifest before inspection closes the YAML document-boundary issue;
signal-terminated un-quiesce patches now fail the step while later recovery
patches still run. However, changing the shared helper also changes other
callers. Two demonstrated caller regressions are reported below, including a
blocking G2 bypass.

The owner-selected **daily 04:00 UTC** hour is unchanged and accepted. The
rendered window remains 97 minutes after the backup start and 60 minutes before
the next refresh start. These are configured starts, not completion or capacity
guarantees. The current arming value, live backup state, actual schedules and
delays, supplied duration measurements, external IdP sync, and shared-node
capacity remain **unverified** offline. No alternative hour is proposed and no
new conflict with the 04:00 hour is demonstrated.

### Shared run() caller audit

`deploy/ci/bascule-preprod/bascule.mjs:108` still handles spawn errors first.
Ordinary exit codes are unchanged. With `allowFail: false`, a signalled child
still reaches the existing fatal branch at line 112; the new warning below
that branch is not reached. With `allowFail: true`, a signalled child now
returns status 1 with the captured output retained, instead of status 0.

I inspected every `run()` call in `bascule.mjs` and its injected consumers
`restore-mode.mjs`, `ci-secrets.mjs`, and `e2e-refs.mjs`:

- Recovery scale, rollout, and CronJob patch checks now recognize a signal as
  failure and continue the remaining recovery operations. Fake-child probes
  exercise all three recovery operations.
- Binary checks, G2's checked Deployment/suspension/Job-list reads, smoke,
  force-refresh existence checks, backup pod-verdict reads, and Secret
  label/replace checks enter their existing failure paths on status 1.
  The Job UID read now yields an unreadable UID on a signalled lookup.
- Calls that discard status and use only stdout retain that behavior:
  recording suspension state, some Deployment drain reads, and Job-status
  polling. Best-effort deletion and suspension calls that discard the entire
  result gain a warning but retain their control flow. These inherited
  behaviors are not presented as fixed by this PR.
- The active-Job drain can stop polling on a failed lookup; the subsequent G2
  Job-list check remains present. A signalled G2 Job-list read is refused by
  the probe. Served-refs reads can stop early, but `assembleRefs` checks
  required part count and hashes (`e2e-refs.mjs:39`).
- Two callers treat a failure as usable absence: CronJob discovery
  (`bascule.mjs:584`) and Secret annotation reading
  (`ci-secrets.mjs:168`). Both have observable changed behavior under the
  same signalled-child input; see the findings.

This is a source audit plus the specific probes below; signal injection into
every individual caller is **not covered**.

## Previous findings status

| Finding | Status | Evidence at this head |
| --- | --- | --- |
| **ASTRA-841-R2-01 — signal-terminated patches report success** | **fixed** | `bascule.mjs:117` warns with the signal and line 118 returns 1. The new test at `restore-mode.selftest.mjs:827` passes. My SIGTERM and SIGKILL patch probes both exit 1, name the failed refresh patch, omit its restoration-success log and `UN-QUIESCE OK`, and still patch the watchdog and the originally suspended consistency CronJob. |
| **ASTRA-841-R2-02 — backup selection crosses legal YAML separators** | **fixed** | `refresh-018.mk:250` copies the source into a temporary Kustomization; line 252 renders it and line 254 supplies the render to the guard. Both original failing mutations now reject the named 04:00 backup with a zero-minute gap. Commented/spaced/CRLF separators, explicit YAML end markers, and quoted names are covered by the additional mutations below. |
| **ASTRA-841-04 — ignored CronJob patch failures; partial in round 2** | **fixed** | The ordinary exit-7, SIGTERM, and SIGKILL cases all reach the recovery error collection at `bascule.mjs:726` and exit 1 at line 731 while continuing other CronJobs. Recorded true and false suspension values are retained. The new G2 regression is a separate finding, not a claim that this recovery fix failed its acceptance criteria. |
| **ASTRA-841-01 — overstated delay margin** | **fixed** | The prior correction remains at `deploy/ci/bascule-preprod/README.md:316` and line 325: 60-minute configured gap, 10-minute margin for the supplied 50-minute duration, unbounded GitHub delay. |
| **ASTRA-841-02 — unconditional loss of the 06:00 refresh** | **fixed** | The prior correction remains at `README.md:321`: catch-up within the 600-second deadline is distinguished from skipping the pass; later recovery is conditioned on restoring `suspend: false`. Actual controller timing remains **unverified**. |
| **ASTRA-841-03 — latest equated with today's backup** | **fixed** | `README.md:315` still states latestComplete, the age check rather than a same-day check, and the possibility of accepting a sufficiently recent previous-day backup. |

Paths shortened in this table resolve under `deploy/ci/bascule-preprod/`,
except `refresh-018.mk` under `deploy/k8s/refresh-cronjobs/`.

## Commands and outputs

The explicit review command allowance was used. Test temporary directories,
copied fixtures, probe logs, and synthetic manifests were kept under
`./.review-tmp-astra/`. Required checks used `TMPDIR`/`TMP`/`TEMP` there
and `K8S_VALIDATE_WITH_CLUSTER=0`. All kubectl calls in behavioral probes
resolved to a temporary fake; real kubectl was used only for offline kustomize.
No real Secret, cluster, bucket, or GitHub API was accessed.

### Target and diff checks

```text
$ git rev-parse HEAD origin/main
e88a2f35bc63ea850d936ecfeb74a1ba5d90f951
ab7f4e70e9b05b6637cb1eb4a6769923cfb169e6

$ git diff --stat 8f97478c..e88a2f35bc63ea850d936ecfeb74a1ba5d90f951
7 files changed, 44 insertions(+), 8 deletions(-)

$ git diff --stat origin/main...e88a2f35bc63ea850d936ecfeb74a1ba5d90f951
11 files changed, 338 insertions(+), 21 deletions(-)

$ git diff --check origin/main...e88a2f35bc63ea850d936ecfeb74a1ba5d90f951
[no output; exit 0]

$ git diff --check 8f97478c..e88a2f35bc63ea850d936ecfeb74a1ba5d90f951
[no output; exit 0]
```

### Required checks

Each exact command below was executed by
`node .review-tmp-astra/run-checks.mjs <case>`, preserving its exit status.

| Command | Exit | Output |
| --- | --- | --- |
| `node deploy/ci/bascule-preprod/bascule.selftest.mjs` | 0 | `bascule.selftest — 56 passés, 0 échoués` |
| `node deploy/ci/bascule-preprod/restore-mode.selftest.mjs` | 1 | `restore-mode.selftest — 238 passed, 1 failed` |
| `make -f deploy/k8s/refresh-cronjobs/refresh-018.mk verify-renders ENV=review-astra-841` | 0 | `refresh-stagger: ok — prod "0 5,11,17,23 * * *", preprod "0 0,6,12,18 * * *": closest starts 60 min apart; nominal watchdog deletion request by 1200 s`; `bascule-window: ok — restore "0 4 * * *" UTC: 97 min after the backup start "23 2 * * *", next refresh start 60 min later` |
| `bash deploy/k8s/refresh-cronjobs/verify-renders.test.sh` | 0 | `verify-renders tests: 52 passed, 0 failed` |
| `make k8s-validate ENV=review-astra-841` | 0 | `[document-date-recovery] offline render ok (preprod + prod)`; `image entrypoint check: ok (25 reference(s) in 94 file(s), 18 entrypoint(s))`; `[k8s-validate] offline render ok; set K8S_VALIDATE_WITH_CLUSTER=1 for a server dry-run` |

The restore suite has the same diagnosed fixture failure as in my prior legs,
at `restore-mode.selftest.mjs:447`. Its temporary cwd resolves an ancestor AWS
SDK installation, so the embedded script reaches its missing-configuration
guard instead of the expected missing-SDK guard. A fresh diagnostic in
`node .review-tmp-astra/callers-probe.mjs` confirms this without an S3 request:

```text
FAIL node -e — main triggered, exit 1 without the SDK, verdict written (got [2,false,false])
ok   CLI unquiesce — failed CronJob patch ⇒ exit 1, named, remaining CronJobs still patched
ok   CLI unquiesce — CronJob patch killed by a signal ⇒ exit 1, named, remaining CronJobs still patched
restore-mode.selftest — 238 passed, 1 failed

Fixture SDK resolution: /home/antoinefa/src/radar-immobilier/node_modules/@aws-sdk/client-s3/dist-cjs/index.js
Fixture diagnostic: status=2 termination={"ok":false,"step":"resolve","exit":2,"reason":"missing S3_ENDPOINT"}
```

The assertion was not changed or counted as passing. Local restore-suite
validation is **partial**; remote CI is **unverified**.

### Additional render mutations

Command: `node .review-tmp-astra/mutations.mjs`, exit 0:
`Additional render mutations: 17 passed, 0 failed`.

Each case copied the same three base manifests, two refresh overlay directories,
workflow, and backup manifest as `verify-renders.test.sh:21`. The guard
implementation was unchanged. The command per copy was:

```text
make -f <case>/deploy/k8s/refresh-cronjobs/refresh-018.mk verify-renders ENV=review-astra-841
```

| Input mutation/control | Make exit | Evidence |
| --- | --- | --- |
| Unchanged inputs | 0 | Expected 97/60-minute gaps. |
| Unrelated 01:00 backup before named 04:00 backup; separator `--- # next document` | 2 | `starts 0 min after the backup start` |
| Same documents; separator `---` followed by spaces | 2 | Same zero-minute rejection. |
| Same commented separator and documents with CRLF | 2 | Same zero-minute rejection. |
| Explicit `...` end marker followed by `---` | 2 | Same zero-minute rejection. |
| Commented separator; named backup retains 02:23 | 0 | Expected 97/60-minute gaps; valid multiple documents remain accepted. |
| Single-quoted backup metadata name, 02:23 | 0 | Expected 97/60-minute gaps. |
| Double-quoted backup metadata name, 04:00 | 2 | Zero-minute rejection. |
| Spaced separator; unrelated backup UTC, named backup America/Toronto | 2 | `radar-backup-daily must run in Etc/UTC, got « America/Toronto »` |
| Duplicate named backup object | 2 | `cannot render ... (canonical YAML documents are required)` |
| Only the unrelated backup remains | 2 | `expected one radar-backup-daily CronJob in the backup manifest, got 0` |
| Malformed backup YAML | 2 | `cannot render ...` |
| Comments on both `on:` and `schedule:` keys | 0 | Expected 97/60-minute gaps. |
| Both key comments; mutated restore cron 05:00 | 2 | `starts together with a refresh: prod@5:00` |
| Both key comments; second active cron | 2 | `must carry exactly one active on.schedule cron` |
| Backup 03:00, exactly 60 minutes before restore | 0 | `60 min after the backup start` |
| Backup 03:01, 59 minutes before restore | 2 | `starts 59 min after the backup start ... below 60 min` |

The 05:00 mutation is a rejection test, not a proposed replacement hour.
The tightened `W_FAIL` also correctly distinguishes the window rejection
from rendering and schedule-extraction failures.

### Recovery and G2 differential probes

Command: `node .review-tmp-astra/callers-probe.mjs`, exit 0. It reports child
statuses, rather than converting an expected child failure into a suite failure.

The recovery fixture records API/MCP replicas and CronJob values:
`radar-refresh-pv=false`, `radar-refresh-pending-watchdog=false`,
`radar-consistency-snapshot=true`. The fake kubectl logs each call and fails
only the selected operation; SIGTERM/SIGKILL target only that fake child.

| Selected recovery operation/result | CLI exit | Signal warning | Refresh restoration-success log | UN-QUIESCE OK | Both later CronJobs patched, including recorded true |
| --- | --- | --- | --- | --- | --- |
| Refresh patch exits 0 | 0 | no | yes | yes | yes |
| Refresh patch exits 7 | 1 | no | no | no | yes |
| Refresh patch SIGTERM | 1 | yes | no | no | yes |
| Refresh patch SIGKILL | 1 | yes | no | no | yes |
| API scale SIGTERM | 1 | yes | yes | no | yes |
| API rollout SIGTERM | 1 | yes | yes | no | yes |

For the differential G2 probe, I copied the runtime directory under scratch
and replaced only its `bascule.mjs` with
`git show 8f97478c:deploy/ci/bascule-preprod/bascule.mjs`. The other imported
runtime modules/templates are unchanged across the delta.

Both versions receive identical inputs: a valid synthetic backup PIN, zero
Deployment replicas, an existing refresh CronJob with `spec.suspend=false`,
and no active Jobs. Only `get cronjob radar-refresh-pv -o name` is varied.
The fake answers a suspension read with false and successful Job polling with
`{"succeeded":1}`. No real Job is created.

| Existence lookup result | Round-2 CLI exit | Head CLI exit | Suspension inspected at round 2 / head | Restore apply at round 2 / head |
| --- | --- | --- | --- | --- |
| exit 0 | 1 | 1 | yes / yes | no / no |
| exit 7 | 0 | 0 | no / no | yes / yes |
| SIGTERM | 1 | **0** | yes / **no** | no / **yes** |
| SIGKILL | 1 | **0** | yes / **no** | no / **yes** |

The exit-7 control distinguishes the inherited ordinary-error problem from the
new signal behavior. With SIGTERM, head produces:

```text
::warning title=bascule::kubectl interrompu par le signal SIGTERM.
[bascule] quiesce — cronjob/radar-refresh-pv absent en préprod → ignoré (rien à quiescer).
[bascule] GARDE G2 OK — quiesce vérifié (deploys=radar-api,radar-immo-mcp ; crons=)
[bascule] $ kubectl -n radar-immobilier-preprod apply -f <case>/radar-db-restore-backup.rendered.yaml
[bascule] S2 OK — backup 2026-10-10 restored into preprod ...
```

Round 2 instead reads the suspension and exits 1:

```text
::error title=bascule failed::GARDE G2 — consommateurs préprod NON quiesce (restore refusé) :
  - cronjob/radar-refresh-pv non suspendu (spec.suspend=false)
```

Additional head controls: SIGTERM during the G2 Job-list read or the suspension
read exits 1 before restore apply. SIGTERM during the mandatory G1 apply also
exits 1, before restore apply.

### Stateful sequence and Secret metadata probes

Command: `node .review-tmp-astra/stateful-probes.mjs`, exit 0. A second fake
kubectl maintains replicas/suspension in a local JSON file and logs commands.
The initial modeled refresh CronJob is unsuspended. Its existence lookups are
terminated with SIGTERM during both `quiesce` and `restore-backup`.

| Version | Quiesce exit | Recorded CronJobs | Modeled suspension after quiesce/restore | Restore exit / applied |
| --- | --- | --- | --- | --- |
| Round 2 | 0 | `{"radar-refresh-pv":false}` | true | 0 / yes |
| Head | 0 | `{}` | **false** | **0 / yes** |

Thus the G2-only reproduction is also reachable through the actual
quiesce-then-restore command sequence in the model. The state file and fake
patch handling, not a real controller, establish suspension here.

The same probe uses only synthetic credential strings for `docs-secret-fill`.
The fake annotation read synchronously writes
`{"review.example/owner":"infra"}` to stdout, then terminates with SIGTERM.
It captures **only metadata** from each replacement manifest.

| Version | CLI exit | Annotations in server-dry-run replacement | Annotations in subsequent replacement |
| --- | --- | --- | --- |
| Round 2 | 0 | `{"review.example/owner":"infra"}` | `{"review.example/owner":"infra"}` |
| Head | **0** | **omitted** | **omitted** |

Head still logs:

```text
::warning title=bascule::kubectl interrompu par le signal SIGTERM.
[bascule] $ kubectl -n radar-immobilier-preprod replace --dry-run=server -f <temporary>/secret.json -o name
[bascule] $ kubectl -n radar-immobilier-preprod replace -f <temporary>/secret.json -o name
[bascule] docs-sync OK — Secret radar-immobilier-preprod/radar-docs-src-preprod rewritten ...
```

Actual Secret annotations and API-server mutation are **unverified**; the
demonstrated effect is the changed outgoing replacement manifest and successful
CLI result. The synthetic annotation is not the intentionally dropped
`kubectl.kubernetes.io/last-applied-configuration` annotation.

## Findings

### ASTRA-841-R3-01 — signal failure becomes “CronJob absent,” bypassing quiesce and G2

- **Severity:** blocking.
- **File:line:** changed return at `deploy/ci/bascule-preprod/bascule.mjs:118`;
  affected caller at `deploy/ci/bascule-preprod/bascule.mjs:584` and line 586.
  G2 filters through that caller at line 498; quiesce does so at line 601.
- **Evidence:** The differential SIGTERM/SIGKILL tests above return exit 1
  before restore at round 2 and exit 0 with restore apply at head.
  `presentCronjobs` equates every nonzero result with absence. The new status
  1 therefore removes the CronJob from the list whose suspension G2 checks.
  In the stateful quiesce/restore sequence, head records no CronJob, issues no
  suspension patch, leaves the modeled CronJob unsuspended, and applies the
  restore with both CLI commands returning 0.
- **Impact:** A signalled existence lookup can defeat the consumer-suspension
  prerequisite to a destructive database restore. No active Job at the instant
  of G2 does not prevent an unsuspended CronJob from starting subsequently.
  Actual concurrent writes and a live occurrence are **unverified**. Ordinary
  nonzero lookup errors already had this problem; this change demonstrably
  extends it to signal termination. The shared helper's new failure value is
  correct, but this caller must not interpret an unknown result as absence.
- **Fix:** Owner: PR author. Make discovery distinguish confirmed absence from
  lookup failure; abort quiesce/G2 on a failed lookup. For example, use
  `get ... --ignore-not-found -o name`, skip only an empty **successful**
  response, and refuse every nonzero result. Preserve the helper's signal
  failure behavior and the continued attempts during un-quiesce. Acceptance:
  the current SIGTERM/SIGKILL fixtures refuse before rollback/restore apply;
  a genuinely absent optional CronJob remains skippable; successful recovery
  and failed-patch continuation tests still pass.

### ASTRA-841-R3-02 — signalled annotation read now drops metadata from Secret replacement

- **Severity:** non-blocking.
- **File:line:** changed status normalization at
  `deploy/ci/bascule-preprod/bascule.mjs:118`; affected fallback at
  `deploy/ci/bascule-preprod/ci-secrets.mjs:168`.
- **Evidence:** With the same complete annotation JSON followed by SIGTERM,
  the round-2 helper returns 0 and both replacement manifests preserve the
  synthetic annotation. Head returns 1; the annotation caller substitutes
  `{}`, and both dry-run and write replacement manifests omit annotations,
  while `docs-secret-fill` still exits 0. The stateful probe captures the
  actual manifests presented to the fake kubectl.
- **Impact:** Metadata preservation is lost on this failure path. A full
  replacement is sent without the existing annotations. Whether live Secrets
  carry consequential annotations or a controller depends on them is
  **unknown**; actual server-side loss is **unverified**. This expands an
  inherited fallback for ordinary command failures, rather than changing the
  successful-read path.
- **Fix:** Owner: PR author. Refuse the Secret rewrite when the annotation
  lookup fails, or retrieve metadata together and require that read to
  succeed. Do not restore signal-as-success in `run()`. Acceptance:
  a signalled annotation read produces a failed CLI result and no replacement
  call; a successful read preserves permitted annotations.

## Verdict

**NO-GO.** Both round-2 findings and the remaining partial round-1 recovery
finding are fixed. A new blocking caller regression lets quiesce/G2 omit an
unsuspended CronJob after a signalled lookup; a second non-blocking regression
affects Secret metadata preservation. The 04:00 UTC schedule itself passes
the configured-window checks and requires no hour change.

Four requested checks pass; the restore suite is **partial** with 238 passes
and one diagnosed fixture failure. Remote CI and live operation remain
**unverified**. This verdict applies to the reviewed commit, not to arming
approval or a consensus result.

Only this untracked review leg was written outside the temporary directory.
Temporary scripts, copies, logs, and fixtures were removed at completion; no
tracked file was modified.

