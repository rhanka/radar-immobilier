---
status: completed
reviewer-host: codex
reviewer-model: gpt-6-astra
reviewer-effort: xhigh
target-ref: ops/bascule-restore-daily@a77307a68d660d506d3f3bbe7ec6a3c001b25321
round: 4
---

## Reasoning

Reviewed `origin/main...a77307a68d660d506d3f3bbe7ec6a3c001b25321`, with focused
review of all three files changed in `e88a2f35..a77307a68d660d506d3f3bbe7ec6a3c001b25321`.
HEAD and origin/main match the requested commits. Only my own previous leg was
read; this is an independent review, not a consensus verdict.

Both round-3 findings are **fixed**. The new commit rejects failed CronJob
presence reads in both quiesce and G2, and rejects failed annotation reads
before either Secret replacement pass. Successful absence and successful
metadata preservation remain supported. The four new selftest assertions pass;
additional fake-process tests below cover G2 directly and SIGKILL as well.

The exhaustive caller audit found two additional failure branches reached by
the signal-status change: Job-list failure skips draining, and individual Job
read failure reports a false drain. Both are **non-blocking** because G2 still
refuses an active Job. Separately, the audit demonstrated an **inherited blocking
G2 defect**: failed Deployment current-replica reads are treated as zero, even
when a replica remains in the model. There is also an inherited recovery-state
defect. These inherited behaviors reproduce before the helper change; they are
not attributed to the new commit. They are included because the task explicitly
requests an audit of every permissive caller around destructive steps.

This corrects the overbroad sentence in my round-3 audit about G2's "checked
Deployment" reads: only the desired-replica read checks its status; the
current-replica read does not. I do not classify that caller as safe.

The owner's daily **04:00 UTC** decision is retained. The configured-window
check passes: 97 minutes after the backup start, 60 minutes before the next
refresh start. No new conflict at 04:00 is demonstrated and no alternative hour
is proposed. Live arming, actual backup freshness, supplied duration
measurements, external IdP activity, launch delays, shared-node capacity and
remote CI remain **unverified** offline. Configured starts do not prove that
workloads finish within those gaps.

## Previous findings status

| Finding | Status | Evidence at this head |
| --- | --- | --- |
| **ASTRA-841-R3-01 — failed CronJob discovery bypasses quiesce/G2** | **fixed** | `deploy/ci/bascule-preprod/bascule.mjs:587` uses `--ignore-not-found`; line 588 rejects every nonzero status; line 589 accepts presence only from nonempty successful output. Quiesce calls it at line 605, G2 at line 498. SIGTERM/SIGKILL probes of both commands return 1 before rollback/restore apply; exit-1/exit-7 discovery probes also refuse. Successful empty discovery is accepted. New selftests at `restore-mode.selftest.mjs:846`, `:849`, `:854` pass. |
| **ASTRA-841-R3-02 — failed annotation read drops Secret metadata** | **fixed** | `deploy/ci/bascule-preprod/ci-secrets.mjs:168` refuses before manifest creation and either replacement pass. SIGTERM/SIGKILL after complete synthetic annotation output, and ordinary exit 1/7, all return 1 with zero replacement calls. A successful read preserves the annotation in both captured replacement manifests. The new selftest at `restore-mode.selftest.mjs:859` passes. |

Short selftest paths in this table are under `deploy/ci/bascule-preprod/`.
The latest delta adds 33 lines and removes 3 across `bascule.mjs`,
`ci-secrets.mjs` and `restore-mode.selftest.mjs`; no additional defect in these
new presence/annotation checks was demonstrated.

## run() caller audit

Inventory command:

```text
$ grep -n 'allowFail: true' deploy/ci/bascule-preprod/*.mjs
[29 call sites: 23 bascule.mjs, 3 ci-secrets.mjs, 2 restore-mode.mjs, 1 e2e-refs.mjs]
$ awk '/allowFail: true/{n++} END{print "allowFail call sites:",n}' deploy/ci/bascule-preprod/*.mjs
allowFail call sites: 29
```

I also inspected the surrounding `run()` calls and injected helper consumers;
there is no additional indirect `allowFail` option in these modules. At
`bascule.mjs:108`, spawn errors already return 1. At line 118, signals now
return 1 with captured output retained, instead of 0. Ordinary exit codes are
unchanged. Without `allowFail`, the fatal branch at line 112 still applies.

All paths below are under `deploy/ci/bascule-preprod/`. "Safe" is scoped to this
status-transition audit: a signal becoming status 1 does not make that caller
authorize a destructive prerequisite. It is not a claim about every possible
failure mode. Runtime injection into every individual call site is **not
covered**; the audit is source-complete with targeted behavioral probes.

### Callers checked as safe for the status transition

| Caller(s) | Reason and evidence |
| --- | --- |
| `bascule.mjs:373`; `restore-mode.mjs:311` — binary probes | Nonzero enters the missing-binary list and aborts preflight. |
| `bascule.mjs:478` — chain-mode prod re-suspension | Status 1 produces a named warning instead of a success log. Continuation was already explicit best effort; the freshness verdict is still required at line 482. This is outside the daily `MODE=restore` path. |
| `bascule.mjs:501` — G2 desired replicas | Nonzero records a problem and G2 refuses. SIGTERM probe returns 1 before either apply. |
| `bascule.mjs:509` — G2 CronJob suspension | Same refusal, tested with SIGTERM. |
| `bascule.mjs:524` — G2 Job list | Nonzero records a problem; cannot become an empty accepted list. SIGTERM probe refuses. Successful list with an active Job also refuses. |
| `bascule.mjs:587` — CronJob presence | Fixed R3-01, with successful-empty control and failed-read probes above. |
| `bascule.mjs:720`, `:722`, `:729` — recovery scale, rollout, suspension patch | Each nonzero contributes to `errs`, remaining recovery work is attempted, and line 735 exits 1. The repository's ordinary-error and signal patch tests pass. |
| `bascule.mjs:1050` — smoke | Status 1 aborts before parsing health. No destructive dispatch follows a false health result here. |
| `bascule.mjs:1104` — force-refresh presence | Nonzero aborts before deletion/creation. |
| `ci-secrets.mjs:162`, `:166` — labels/annotations | Nonzero aborts before replacement; label SIGTERM and annotation signal/exit-code probes confirm it. |
| `ci-secrets.mjs:175` — both replacement passes | Nonzero aborts. A signalled server dry-run produces one replacement invocation and no write invocation; a signalled write produces two invocations and CLI exit 1. Whether a real server completed a write before interruption is **unknown**. |
| `restore-mode.mjs:274` — pod verdict | Failure becomes `readable: false`, not a successful verdict. Resolve/list require a verdict at lines 357/396; error reporting still dies at line 287. For docs/recon, Job success is independently required at lines 471/480; the termination message only adds diagnostic counts, even on the previous helper. |
| `e2e-refs.mjs:91` — ConfigMap parts | First-part failure dies; later failure stops reading. `assembleRefs` then checks required part count, cycle, indexes, hashes and row count at lines 33–54. Omitting a required part fails; ignoring an unreadable surplus part does not make incomplete output acceptable. No destructive step follows this read. |

### Callers with demonstrated permissive behavior

| Caller | Audit result |
| --- | --- |
| `bascule.mjs:503` — G2 current replicas | Status ignored, empty output defaults to zero. **ASTRA-841-R4-01**, blocking, inherited. |
| `bascule.mjs:673` — Deployment drain | Status discarded immediately, empty output logged as drained. Same root cause and sequence as **R4-01**; G2 repeats the error instead of providing a barrier. |
| `bascule.mjs:643` — initial drain Job list | New signal status reaches warning-and-skip branch, quiesce still succeeds. **ASTRA-841-R4-02**, non-blocking; G2 remains a barrier. |
| `bascule.mjs:662` — individual active-Job read | New signal status makes `stillActive` false and logs drained. **ASTRA-841-R4-03**, non-blocking; G2 remains a barrier. |
| `bascule.mjs:625` — original suspension snapshot | Status ignored; failed empty read records false and later un-quiesce enables an originally suspended CronJob. **ASTRA-841-R4-04**, non-blocking, inherited. |

### Remaining callers: unchanged control flow, with explicit limits

These seven sites are covered by the audit, but are not given a blanket
fail-closed label merely because the status normalization leaves them unchanged.

| Caller | Result and downstream protection/limit |
| --- | --- |
| `bascule.mjs:633` — suspend CronJobs | Entire result discarded; signal now adds a warning. G2 re-discovers and reads suspension, refusing unreadable/unsuspended CronJobs. No new status-dependent permission. |
| `bascule.mjs:656` — delete active Job | Entire result discarded. Drain polling and the independent G2 active-Job check follow. Failed deletion is not proof of disappearance; see R4-03 for the poll's separate issue. |
| `bascule.mjs:873` — delete previous template Job | Entire result discarded both before/after. Mandatory apply follows at line 874. This audit does not prove freshness of an identically named Job if deletion fails; Kubernetes controller behavior for that scenario is **not covered**. No status-transition regression is claimed. |
| `bascule.mjs:877` — Job UID | Nonzero discards even syntactically valid UID output and warns. Resolve/list then cannot obtain a mandatory PIN/list verdict. Other commands already use Job success as their acceptance condition; losing diagnostic pod output does not change that condition. |
| `bascule.mjs:884` — template Job status | Status is ignored; empty/invalid output becomes pending and times out. Complete `succeeded` JSON is accepted even if the lookup then signals, on both versions. The paired G1 probes demonstrate this unchanged limitation. No new status-dependent bypass is claimed. |
| `bascule.mjs:1115` — delete previous forced-refresh Job | Entire result discarded; mandatory `create` at line 1116 must succeed. An unchanged existing object cannot satisfy a failed create. |
| `bascule.mjs:1121` — forced-refresh status | Status ignored on both versions. Empty output becomes pending; complete-wait mode times out as failure, while async mode can report success at its deadline even while pending (lines 1129–1137). This inherited reporting limit is outside the restore workflow; no new status-transition finding. |

## Commands and outputs

No cluster, bucket, GitHub API, push or commit operation was performed. Required
checks used `TMPDIR`, `TMP` and `TEMP` under `./.review-tmp-astra/` and
`K8S_VALIDATE_WITH_CLUSTER=0`. Runtime probes resolved kubectl to a local fake
that updates JSON state and records arguments; no real Job or Secret was
created. Actual data-plane effects remain **unverified**.

### Target and diff

```text
$ git rev-parse HEAD origin/main
a77307a68d660d506d3f3bbe7ec6a3c001b25321
ab7f4e70e9b05b6637cb1eb4a6769923cfb169e6

$ git diff --stat e88a2f35..a77307a68d660d506d3f3bbe7ec6a3c001b25321
3 files changed, 33 insertions(+), 3 deletions(-)

$ git diff --stat origin/main...a77307a68d660d506d3f3bbe7ec6a3c001b25321
12 files changed, 371 insertions(+), 24 deletions(-)

$ git diff --check e88a2f35..a77307a68d660d506d3f3bbe7ec6a3c001b25321
[no output; exit 0]
$ git diff --check origin/main...a77307a68d660d506d3f3bbe7ec6a3c001b25321
[no output; exit 0]
```

### Five requested checks

Each exact command was executed by the throwaway wrapper
`node .review-tmp-astra/run-checks.mjs <case>`, which sets the temporary-directory
variables, records output, and preserves the child exit status.

| Command | Exit | Output |
| --- | --- | --- |
| `node deploy/ci/bascule-preprod/bascule.selftest.mjs` | 0 | `bascule.selftest — 56 passés, 0 échoués` |
| `node deploy/ci/bascule-preprod/restore-mode.selftest.mjs` | 1 | `restore-mode.selftest — 242 passed, 1 failed` |
| `make -f deploy/k8s/refresh-cronjobs/refresh-018.mk verify-renders ENV=review-astra-841` | 0 | `refresh-stagger: ok — prod "0 5,11,17,23 * * *", preprod "0 0,6,12,18 * * *": closest starts 60 min apart; nominal watchdog deletion request by 1200 s`; `bascule-window: ok — restore "0 4 * * *" UTC: 97 min after the backup start "23 2 * * *", next refresh start 60 min later` |
| `bash deploy/k8s/refresh-cronjobs/verify-renders.test.sh` | 0 | `verify-renders tests: 52 passed, 0 failed` |
| `make k8s-validate ENV=review-astra-841` | 0 | `[document-date-recovery] offline render ok (preprod + prod)`; `image entrypoint check: ok (25 reference(s) in 94 file(s), 18 entrypoint(s))`; `[k8s-validate] offline render ok; set K8S_VALIDATE_WITH_CLUSTER=1 for a server dry-run` |

The restore-suite failure is at `restore-mode.selftest.mjs:447`. The fixture
expects an unavailable AWS SDK, but Node resolves the ancestor repository's
installation when its temporary cwd is inside this worktree. A fresh diagnostic
executes the same embedded script with only PATH, BR_STEP and TERMINATION_LOG
set; it exits at missing configuration before an S3 operation:

```text
FAIL node -e — main triggered, exit 1 without the SDK, verdict written (got [2,false,false])
Fixture SDK: /home/antoinefa/src/radar-immobilier/node_modules/@aws-sdk/client-s3/dist-cjs/index.js
Fixture diagnostic: status=2
termination={"ok":false,"step":"resolve","exit":2,"reason":"missing S3_ENDPOINT"}
```

The assertion was not changed or counted as passing. Local restore-suite
validation is **partial**. The failure is not evidence that the new four
assertions failed, and it is not a claim that remote CI passed.

### Behavioral caller probes

Commands:

```text
node .review-tmp-astra/callers-probe.mjs > .review-tmp-astra/callers-probe.log
Probe controls: 8 passed; 34 cases recorded
[exit 0]
node .review-tmp-astra/summarize.mjs
[exit 0; observations summarized below]
```

The probe compares head with a scratch runtime whose `bascule.mjs` and
`ci-secrets.mjs` come from `git show 8f97478c:<path>` (before signal-status
normalization). Other modules are the head copies. All values, PINs and
credentials are synthetic. The fake uses synchronous stdout writes before
signalling itself, so the retained-output cases are deterministic. Initial
throwaway harness setup errors were corrected before the control-checked run;
those earlier attempts are not evidence for the findings.

| Injected result/control | Version | Observed result |
| --- | --- | --- |
| Presence SIGTERM / SIGKILL in quiesce and restore-backup | head | All exit 1; no rollback/restore apply; quiesce writes no state and performs no scale/patch. |
| Presence exit 1 / exit 7 | head | Restore-backup exits 1; no apply. |
| Presence successful empty output | head | Restore-backup exits 0; absence is skipped and both modeled Jobs are applied. |
| Annotation complete JSON then SIGTERM / SIGKILL; exit 1 / 7 | head | All exit 1; zero replacement invocations. |
| Annotation successful JSON | head | Exit 0; two replacement invocations both preserve `review.example/owner=infra`. |
| Current replicas SIGTERM with empty output, modeled replica remains 1; quiesce then restore-backup | old and head | Both commands exit 0; both Jobs applied; final modeled `spec=0`, `cur=1`. |
| Current replicas exit 7 with empty output, modeled `spec=0`, `cur=1` | head | Restore-backup exits 0; both Jobs applied. |
| Current replicas successful output `1` / `0` | head | `1`: exit 1 and neither apply; `0`: exit 0 and both applies. |
| Drain Job list emits active-owned-Job JSON, then SIGTERM; later G2 list succeeds | old | Active Job deleted, then quiesce and restore-backup both exit 0. |
| Same drain-list signal | head | Drain skipped; quiesce exits 0; active Job remains; G2 refuses restore-backup. |
| After deletion request, active-Job read emits `1`, then SIGTERM; Job remains active | old | Quiesce reaches its injected zero-second deadline and warns it is not drained; G2 refuses restore-backup. |
| Same active-Job signal | head | Quiesce immediately reports drained and exits 0; G2 still refuses restore-backup. |
| Original `suspend=true`; snapshot read SIGTERM without output; quiesce then unquiesce | old and head | Both commands exit 0; recorded suspension is false; final modeled suspension is false. |
| G2 desired-replica / suspension / Job-list reads SIGTERM | head | Each exits 1 before rollback/restore apply. |
| Successful G2 list containing an active Job | head | Exit 1 before either apply. |
| Secret label read SIGTERM | head | Exit 1, zero replacement calls. |
| Secret server dry-run SIGTERM | head | Exit 1, one dry-run call, zero write calls. |
| Secret write SIGTERM | head | Exit 1 after the dry-run and write invocations. |
| G1 Job-status read SIGTERM, empty stdout | old and head | Rollback applied; timeout refusal; no restore apply. |
| G1 Job-status read emits complete `{"succeeded":1}`, then SIGTERM | old and head | Both Jobs applied; restore-backup exits 0. The status-discard behavior is unchanged. |

The Deployment probe does not simulate a Kubernetes controller finishing
termination: it deliberately retains one current replica after scale-to-zero.
That establishes the runner's decision on an unknown read; an actual concurrent
database write or live occurrence is **unverified**. The Job-drain probes retain
G2; neither changed drain caller is presented as a destructive-guard bypass.

## Findings

### ASTRA-841-R4-01 — failed current-replica reads pass G2 and allow restore dispatch

- **Severity:** blocking.
- **File:line:** `deploy/ci/bascule-preprod/bascule.mjs:503` and `:505`;
  matching drain caller at `:673`–`:674`. Destructive dispatch follows G2 at
  `deploy/ci/bascule-preprod/restore-mode.mjs:414`–`:417`.
- **Evidence:** A stateful fake starts with one replica and keeps current
  replicas at 1 after scale-to-zero. Only current-replica queries fail with
  SIGTERM and empty stdout. Quiesce exits 0, logs
  `deploy/radar-api drainé (status.replicas=0)`, and restore-backup logs
  `GARDE G2 OK`, applies rollback and `radar-db-restore-backup`, then exits 0.
  A direct G2 exit-7 query has the same result. The successful-output-`1`
  control refuses before both applies, demonstrating that the failed read
  removes the actual guard condition.
- **Provenance:** Inherited and still present, not introduced by a77307a6 or
  the signal normalization. The paired 8f97478c run behaves identically.
  It is a newly demonstrated finding in the requested full caller audit.
- **Impact:** G2 authorizes a destructive restore without establishing that
  Deployment consumers have drained. Unlike the Job-drain callers below,
  there is no later independent Deployment-read barrier.
- **Fix:** Owner: PR author. Check current-replica read status before
  interpreting stdout in both G2 and quiesce. G2 must refuse an unknown read;
  quiesce may retry within its existing deadline or fail. Preserve the valid
  successful-empty case if Kubernetes omits a zero replica field. Acceptance:
  SIGTERM, SIGKILL and ordinary nonzero reads never reach rollback/restore
  apply; successful zero and nonzero controls remain correct.

### ASTRA-841-R4-02 — failed drain Job-list lookup permits quiesce to succeed without draining

- **Severity:** non-blocking.
- **File:line:** `deploy/ci/bascule-preprod/bascule.mjs:643`–`:645`;
  unconditional quiesce-success log at `:679`.
- **Evidence:** With active-owned-Job JSON followed by SIGTERM, the old helper
  causes deletion/polling; head enters the failed-read branch, skips draining,
  logs `QUIESCE OK` and exits 0 while the modeled Job remains active. A later
  successful G2 list refuses restore-backup. This differential exercises the
  changed signal status, not a newly invented ordinary-error path.
- **Impact:** A failed read becomes permission to advance with incomplete
  quiesce. It can prevent that daily restore from proceeding, but does not
  bypass the destructive G2 barrier at `:524`–`:556`.
- **Fix:** Owner: PR author. Retry or fail the quiesce when the Job list cannot
  be read, rather than reporting completed quiesce. Do not restore the old
  behavior of trusting stdout from a failed command. Acceptance: a failed
  list cannot produce `QUIESCE OK`; a successful active-owned-Job list still
  drives deletion, and G2 remains independently enforced.

### ASTRA-841-R4-03 — failed active-Job lookup is reported as a completed drain

- **Severity:** non-blocking.
- **File:line:** `deploy/ci/bascule-preprod/bascule.mjs:662`–`:664`.
- **Evidence:** After a modeled deletion request, the Job stays active. Its
  lookup writes `1` then receives SIGTERM. Head computes `stillActive=false`,
  prints `Job en vol refresh-inflight drainé (supprimé/inactif)` and exits
  quiesce 0. With identical output, the old helper enters the active branch
  and, at the injected deadline, warns the Job has not disappeared. G2 refuses
  the later restore in both runs.
- **Impact:** Failure becomes confirmed disappearance/inactivity in the log
  and stops polling. The destructive active-Job check is retained, so this
  finding is non-blocking.
- **Fix:** Owner: PR author. Distinguish a successful absent/inactive read from
  a failed read, e.g. `--ignore-not-found` with a required zero exit status.
  Retry or report an unknown drain on failure. Acceptance: signal/nonzero
  lookups never log confirmed drain; successful absence and inactive zero do.

### ASTRA-841-R4-04 — unreadable original suspension state can enable a suspended CronJob on recovery

- **Severity:** non-blocking.
- **File:line:** `deploy/ci/bascule-preprod/bascule.mjs:625`–`:626`;
  recovery uses the recorded value at `:729`.
- **Evidence:** The modeled CronJob starts with `suspend=true`. Its snapshot
  read signals with no output. Quiesce records
  `{"radar-refresh-pv":false}` and succeeds. Un-quiesce then patches false and
  exits 0; the final modeled CronJob is unsuspended. The paired old runtime
  does the same, proving this is inherited rather than a new status regression.
- **Impact:** Recovery cannot preserve the original suspension setting after
  an unknown read. It does not weaken a pre-restore G2 guard: quiesce still
  patches true and G2 separately checks suspension.
- **Fix:** Owner: PR author. Require a successful suspension snapshot before
  persisting state or mutating consumers; a successful empty optional field
  may still mean false. Acceptance: signal/nonzero reads refuse before scale
  or patch and do not persist guessed false; genuine true and false values
  survive quiesce/un-quiesce.

## Verdict

**NO-GO.** Both round-3 findings are fixed, and no new blocking regression in
the three-file latest delta was demonstrated. However, the requested exhaustive
audit demonstrates a remaining blocking G2 caller defect (R4-01), plus three
non-blocking caller findings. The blocking finding is explicitly inherited;
the verdict does not attribute it to the owner's schedule choice or to the
new presence/annotation checks.

Four requested checks pass; restore-suite validation is **partial** with
242 passes and one diagnosed fixture failure. Remote CI and live operation
remain **unverified**. This is the independent leg's verdict for the reviewed
head, not arming approval or a consensus result.

Final verification: `git diff --exit-code` and `git diff --cached --exit-code`
both returned 0 with no output; HEAD is unchanged. `./.review-tmp-astra/` was
removed. The completed review leg is the only retained file written by this
review; no tracked file was modified.
