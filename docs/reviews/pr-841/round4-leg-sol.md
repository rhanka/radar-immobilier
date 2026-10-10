---
status: completed
reviewer-host: codex
reviewer-model: gpt-6.1-sol
reviewer-effort: xhigh
target-ref: ops/bascule-restore-daily@a77307a68d660d506d3f3bbe7ec6a3c001b25321
round: 4
---

## Reasoning

Independent round-4 review of PR #841 at `a77307a68d660d506d3f3bbe7ec6a3c001b25321`, with `origin/main` at `ab7f4e70e9b05b6637cb1eb4a6769923cfb169e6`. Reviewed the full target diff `origin/main...a77307a68d660d506d3f3bbe7ec6a3c001b25321`, the three-file delta `e88a2f35..a77307a68d660d506d3f3bbe7ec6a3c001b25321`, and every production `run(..., { allowFail: true })` caller in `deploy/ci/bascule-preprod/*.mjs`. Read only my own round-3 leg, including its previous-findings table; no other reviewer's leg was read.

Read `rules/MASTER.md`, `rules/workflow.md`, `rules/testing.md`, `rules/security.md`, RTK and harness using-harness/review guidance. The explicit independent-review assignment and command/file allowlist govern this leg. No peer was launched, no cluster/bucket/network query was performed, and no tracked file, commit or remote state was changed. Executed fake binaries, copied source/templates and test artifacts were under `.review-tmp-sol/`, removed after recording the evidence. An early multi-file write also left two untracked preparation scripts (`audit.mjs`, `fake-kubectl.mjs`) at the checkout root; the final status check detected them and they were removed. Those root copies were not executed. Only this leg file is retained.

**The owner-selected daily 04:00 UTC schedule matches the request.** The executable workflow change is `17 3 * * 0` → `0 4 * * *`; scheduled MODE=restore, latest-complete selection, auto-CONFIRM and the arming expression are unchanged. Render verification gives 97 minutes from the configured backup start to the restore and 60 minutes to the next refresh start. No new configured-start conflict was demonstrated. The supplied observations of duration, the IdP's resource use, actual scheduling delay, live arming-variable value and remote CI are **unverified** offline. No alternative hour is proposed.

The round-4 commit fixes `presentCronjobs()`: only status 0 with empty output means absence; a nonzero lookup rejects both quiesce and G2, even if it emitted a name before failing. The Secret annotation read now also rejects before either replace pass. The new repository tests exercise quiesce failures/absence and an interrupted annotation read. Independent CLI tests additionally exercise G2 directly, ordinary exit 1 and partial stdout. No new defect in these two changes was demonstrated.

The remaining caller audit demonstrates a G2 bypass: the deployment's failed current-replica read is treated as zero and restore dispatch proceeds with one current replica. The shared Job poller also accepts success JSON after a failed child read at G1. Both behaviors reproduce with the old helper and remain with the corrected helper: they are **inherited caller behaviors, not newly introduced signal regressions**. They are included because this round explicitly requests the caller audit. G2 is blocking because the missing observation conceals a live consumer in the fake. The G1 observation is non-blocking: the emitted complete JSON itself says the rollback succeeded; the fake does not demonstrate a missing rollback or a violated Job-success prerequisite. Actual database corruption or absence of a durable rollback is **unverified**.

Other permissive callers are reported individually below with bounded severity. In particular, failed active-Job drain reads change behavior with the helper normalization, but the later status-checked G2 Job list rejects restore in the tested sequences. No active-Job-check bypass was demonstrated. The generic template-delete fallback can reuse an already-completed identical Job, while a changed rollback template is rejected by strict apply in the name-keyed immutable-Job fake. Force-refresh is outside the bascule workflow and does not weaken a restore guard.

## Previous findings status

| Round-3 finding | Status | Evidence at this head |
| --- | --- | --- |
| **SOL-841-R3-01 — failed CronJob presence lookup is treated as absence** | **fixed** | `bascule.mjs:587` uses `--ignore-not-found`; `:588` rejects every nonzero result; `:589` includes only successful nonempty results. The same function feeds quiesce (`:605`) and G2 (`:498`). The new suite assertions at `restore-mode.selftest.mjs:846`, `:849`, `:855` pass. Independently, signal/exit-1 × empty/name stdout, each against quiesce and daily restore, all exit 1 before scale/patch or any Job apply. Successful empty output still allows restore; readable unsuspended presence still fails G2. |

Round 3 had one new finding. The earlier fixed schedule/parser/documentation findings recorded in my round-3 table remain unchanged by the three-file delta; the current 56-case bascule selftest and 52-case render-mutation suite pass. The separate Secret annotation correction is verified here and is not attributed to an earlier SOL finding.

## run() caller audit

Inventory command: `grep -n 'allowFail: true' deploy/ci/bascule-preprod/*.mjs`. It enumerates **29 production call sites**: 23 in `bascule.mjs`, three in `ci-secrets.mjs`, two in `restore-mode.mjs`, one in `e2e-refs.mjs`. No additional allowFail caller was found by the broader `grep -n 'allowFail'` and `grep -n 'run('` searches.

The exact old/current helper source was executed in a VM matrix: status 0/1/7/null × capture false/true × allowFail false/true, for **32 executions**. Only allowFail/null changes the returned status from 0 to 1; stdout/stderr are preserved. Strict null-status calls reject in both helpers at `bascule.mjs:112`. Thus an ignored status is an inherited failure-handling problem, not evidence of a newly caused regression.

### Callers with permissive failure paths

Each row has its own finding below. G2 is blocking because its failed read conceals a remaining consumer before destructive dispatch. The other rows concern recovery/status reporting, retain a separate barrier, or do not demonstrate loss of a required guard fact.

| Caller | Observed failure handling | Finding |
| --- | --- | --- |
| `bascule.mjs:503` — G2 deployment current replicas | Ignores status; failed empty stdout becomes 0; G2 permits restore while fake current replicas remain 1. | SOL-841-R4-01, blocking |
| `bascule.mjs:884` — shared Job status poll | Ignores status; success JSON emitted before SIGTERM returns success at G1 and permits restore dispatch. Empty/truncated output does not establish success. | SOL-841-R4-02, non-blocking |
| `bascule.mjs:625` — original CronJob suspend | Ignores status; empty failed read records false, then unquiesce unsuspends an initially suspended CronJob. | SOL-841-R4-03, non-blocking |
| `bascule.mjs:673` — quiesce deployment drain | Discards status; failed empty read is logged as drained. The actual restore barrier failure is the separate G2 caller above. | SOL-841-R4-04, non-blocking |
| `bascule.mjs:662` — active-Job drain probe | Nonzero means not active, including unreadable/signal-killed probes; logs drained. G2 rejects the still-active Job. | SOL-841-R4-05, non-blocking |
| `bascule.mjs:873` — previous template Job deletion | Ignores status; strict apply can accept an identical existing completed Job, then its old success is reused. | SOL-841-R4-06, non-blocking |
| `bascule.mjs:1121` — force-refresh Job status | Ignores status; at the async deadline even empty failed output returns exit 0 with `.status=pending` described as started. | SOL-841-R4-07, non-blocking |
| `bascule.mjs:633` — quiesce suspend patch | Ignores patch failure and finishes quiesce successfully; G2's checked suspend read rejects restore. | SOL-841-R4-08, non-blocking |
| `bascule.mjs:643` — quiesce Job list | Failed read intentionally warns and skips drain, then permits quiesce success. With valid output before SIGTERM, this differs from the old helper. G2 rejects the remaining active Job. | SOL-841-R4-09, non-blocking |
| `bascule.mjs:656` — active-Job deletion | Ignores failed deletion; records the Job for polling and continues after the deadline. G2 rejects the remaining active Job. | SOL-841-R4-10, non-blocking |

### Callers checked as safe for this failure-handling audit

“Safe” here means no demonstrated acceptance of a failed observation as a required guard result, or a stated fallback that still enforces the required result. It is not a live operational assurance. Runtime cases are identified; other rows are source inspections, with a separate per-caller signal test **not covered**.

| Caller | Evidence / retained check |
| --- | --- |
| `bascule.mjs:373` — chain preflight binary checks | `.status !== 0` identifies a missing/unreadable binary; any missing entry calls die at `:374`. |
| `restore-mode.mjs:311` — restore/list preflight binary checks | Same failure check and rejection at `:312`. |
| `bascule.mjs:478` — prod re-suspend | Status 1 takes the explicit warning at `:479`, not the success log. It remains a documented best-effort action; restore authority comes from the freshness verdict, not this patch result. Signal normalization increases visibility; no new permissive decision was demonstrated. Daily MODE=restore does not call S1. |
| `bascule.mjs:501` — G2 deployment desired replicas | Nonzero adds a problem before G2 acceptance. Independent SIGTERM case exits 1 with no Job apply. |
| `bascule.mjs:509` — G2 CronJob suspend | Nonzero adds a problem; cannot establish suspended state. Independent SIGTERM case exits 1 with no Job apply. |
| `bascule.mjs:524` — G2 active-Job list | Nonzero adds a problem; does not parse even valid failed output. Independent SIGTERM case exits 1 with no Job apply; all failed drain/delete scenarios are also rejected here when their Job remains active. |
| `bascule.mjs:587` — CronJob presence | New `:588` status rejection. Eight independent failed quiesce/G2 executions reject; confirmed empty absence is accepted. Round-3 finding fixed. |
| `bascule.mjs:720` — unquiesce scale | Nonzero records an error and continues the other recovery actions; `:733`–`:735` return exit 1. |
| `bascule.mjs:722` — unquiesce rollout | Same error collection; no successful rollout log for nonzero status. |
| `bascule.mjs:729` — unquiesce CronJob patch | Nonzero records an error, omits the success log and continues other patches. Existing exit-1 and SIGTERM repository assertions both pass. |
| `bascule.mjs:877` — Job UID | Nonzero cannot supply a UID (`:878`); warns and skips that pod verdict. Independent signal case logs `uid unreadable`. Required R0 PIN/list verdicts are still rejected if unavailable; optional diagnostics do not authorize success. Shared Job-status acceptance is audited separately at `:884`. |
| `bascule.mjs:1050` — smoke curl | Nonzero rejects at `:1051` before parsing even healthy-looking stdout; successful reads must also establish DB and object-store health. |
| `bascule.mjs:1104` — force-refresh CronJob existence | Nonzero rejects before deletion/create. Independent SIGTERM case exits 1 after only the lookup. |
| `bascule.mjs:1115` — force-refresh old Job deletion | Strict **create** at `:1116` rejects AlreadyExists if failed deletion leaves the old instance; it cannot silently reuse an existing Job as apply can. Fake failed-delete/AlreadyExists case exits 1. If the old Job is absent or deletion actually completed, creating the new one remains valid. |
| `ci-secrets.mjs:162` — Secret labels | Nonzero rejects before manifest/replace at `:163`. Independent SIGTERM case exits 1, no replace. |
| `ci-secrets.mjs:166` — Secret annotations | New status rejection at `:168` before either replace pass. Independent signal, signal with valid JSON stdout, and exit-1 cases all exit 1 without replace. |
| `ci-secrets.mjs:175` — Secret replace passes | Every pass checks status at `:176`; a failed dry-run cannot reach the real write, and a failed write cannot report success. Independent interrupted first pass exits 1. |
| `restore-mode.mjs:274` — pod termination verdict | Nonzero returns `{verdict:null, readable:false}` before parsing. R0/list require a validated verdict; diagnostics do not override Job failure. Independent R0 signal case exits 1, no PIN/quiesce/restore. |
| `e2e-refs.mjs:91` — ConfigMap parts | First failed read rejects. Later failed reads end collection, but `assembleRefs()` at `:39` rejects missing required parts, then checks cycle/part identity and gzip/TSV hashes. A failed optional read beyond all declared parts cannot discard a required part or authorize a destructive step. Repository multi-part/missing-part assertions pass; separate signal CLI case not covered. |

## Commands and outputs

All five requested checks were run with `TMPDIR=<worktree>/.review-tmp-sol`; K8s validation also had `K8S_VALIDATE_WITH_CLUSTER=0`. The runner captured each child exit independently. The supplied `ENV=review-sol-841` is last in both requested make commands. The render test script uses its own `ENV=test-refresh-renders` fixtures.

| Command | Exit and relevant output |
| --- | --- |
| `git rev-parse HEAD origin/main` | 0: `a77307a68d660d506d3f3bbe7ec6a3c001b25321`; `ab7f4e70e9b05b6637cb1eb4a6769923cfb169e6`. |
| `git diff --stat origin/main...a77307a68d660d506d3f3bbe7ec6a3c001b25321` | 0: 12 files changed, 371 insertions, 24 deletions. Full diff inspected in file subsets. |
| `git diff e88a2f35..a77307a68d660d506d3f3bbe7ec6a3c001b25321` | 0: all three files inspected: presence lookup, annotation lookup, four new CLI assertions. |
| `grep -n 'allowFail: true' deploy/ci/bascule-preprod/*.mjs` | 0: 29 production call sites, all accounted for above. |
| `node deploy/ci/bascule-preprod/bascule.selftest.mjs` | 0: `bascule.selftest — 56 passés, 0 échoués`. |
| `node deploy/ci/bascule-preprod/restore-mode.selftest.mjs`, initial run | 1: `restore-mode.selftest — 242 passed, 1 failed`; sole failure: no-SDK fixture got `[2,false,false]` rather than `[1,false,true]`. All new presence/annotation cases pass. |
| Same restore selftest with intended no-SDK fixture isolated | 0: `restore-mode.selftest — 243 passed, 0 failed`; fixture gets `[1,false,true]`; all new failure-handling assertions pass. |
| `make -f deploy/k8s/refresh-cronjobs/refresh-018.mk verify-renders ENV=review-sol-841` | 0: watchdog 900 + 300 = 1200 s; refresh window 18900 < 19800 < 21600 s; closest prod/preprod starts 60 minutes apart; bascule 97 minutes after backup start and 60 minutes before next refresh. |
| `bash deploy/k8s/refresh-cronjobs/verify-renders.test.sh` | 0: `verify-renders tests: 52 passed, 0 failed`. |
| `make k8s-validate ENV=review-sol-841` | 0: document-date-recovery preprod/prod offline render passes; `image entrypoint check: ok (25 reference(s) in 94 file(s), 18 entrypoint(s))`; `[k8s-validate] offline render ok`. |
| `node .review-tmp-sol/checks.mjs` | 0: runs/captures all five commands and retains the initial restore child exit 1. |
| `node .review-tmp-sol/isolate-restore.mjs` | 0: original SDK resolves from `/home/antoinefa/src/radar-immobilier/node_modules/@aws-sdk/client-s3/dist-cjs/index.js`; creates only a throwaway module shadow and runs the unchanged restore suite to 243/0. |
| `node .review-tmp-sol/audit.mjs` | 0 on completed run: 44 fake CLI executions, including fixed lookup controls, G2/G1 acceptance, original-state loss, drain/patch failures, force-refresh cases and checked-status controls. |
| `node .review-tmp-sol/followup.mjs` | 0: 32 exact-helper VM executions and 22 fake CLI executions, including name-keyed Job reuse/immutability and old/current helper comparisons. |
| `node .review-tmp-sol/safe-followup.mjs` | 0: four additional signal cases: G2 suspend/G2 Job list/force existence/R0 pod verdict all exit 1; no destructive dispatch. |
| `git diff --check`; `git diff --name-only` | Both 0, empty: no tracked-file modification. |
| Final `git status --short` | 0: only `?? docs/reviews/pr-841/` remains, matching the initial untracked review directory; all throwaway/root-copy scripts removed. |

The initial restore failure is a local fixture limitation, not a claim about CI: putting TMPDIR inside this repository lets its `node -e` child resolve the ancestor SDK, while the assertion explicitly requires the SDK to be absent (`restore-mode.selftest.mjs:445`–`:447`). A `.review-tmp-sol/node_modules/@aws-sdk/client-s3/index.js` shadow throwing MODULE_NOT_FOUND reproduces that intended condition. No source, installed dependency or selftest was edited. Both results are retained; remote CI is **unverified**.

Throwaway preparation failures are not guard evidence: the first audit launch found its script absent from the intended directory and was retried after creating it there. The early write had instead left two untracked root copies, which the final `git status --short` exposed; both were identified as this leg's preparation scripts and removed. The initial template-delete fake stored one Job rather than Jobs keyed by name; its migrate-to-rollback immutability rejection is **not used**. The corrected fake distinguishes names, permits identical apply, and rejects a changed template of the same Job. Its second restore rejects the changed rollback key, while identical migration/recon reuse is demonstrated. This is fake-interface evidence; real API interaction is **not covered**.

Representative outputs from completed checks:

```text
bascule.selftest — 56 passés, 0 échoués
restore-mode.selftest — 242 passed, 1 failed
  FAIL node -e — main triggered, exit 1 without the SDK, verdict written (got [2,false,false])
# Intended fixture isolated:
restore-mode.selftest — 243 passed, 0 failed
refresh-stagger: ok — prod "0 5,11,17,23 * * *", preprod "0 0,6,12,18 * * *": closest starts 60 min apart; nominal watchdog deletion request by 1200 s
bascule-window: ok — restore "0 4 * * *" UTC: 97 min after the backup start "23 2 * * *", next refresh start 60 min later
verify-renders tests: 52 passed, 0 failed
image entrypoint check: ok (25 reference(s) in 94 file(s), 18 entrypoint(s))
[k8s-validate] offline render ok; set K8S_VALIDATE_WITH_CLUSTER=1 for a server dry-run
```

### Fake-interface results

Each fake kubectl executable logs argv, writes small stdout synchronously, and either exits 1 or sends itself SIGTERM. All commands address the fake binary through PATH; no real cluster/bucket is contacted. Successful controls supply zero desired/current deployment replicas, suspended CronJobs, an empty Job list and successful Job status. The G2 scenario instead retains one current replica after scaling desired replicas to zero. The original-suspend scenario starts suspended; the drain scenarios retain an active CronJob-owned Job after a failed delete. The Job-poll scenario emits valid `{"succeeded":1}` before being killed; it proves acceptance of a failed read, not that the real rollback failed.

| Scenario | Actual exit/result |
| --- | --- |
| Presence lookup SIGTERM/exit 1, with/without name stdout | Eight quiesce/G2 executions: exit 1, no scale/patch/Job apply. |
| Presence successful empty output | Daily restore exits 0 and dispatches rollback + restore; absence is still supported. |
| Presence readable but unsuspended | G2 exits 1; no Job apply. |
| Annotation SIGTERM/exit 1/valid stdout then SIGTERM | Three Secret fill executions exit 1; no replace. |
| Current replicas readable 1, desired 0 | G2 exits 1; no Job apply. |
| Current-replica read SIGTERM or exit 1, actual fake current 1 | Chain restore exits 0; daily quiesce → restore exits 0/0; rollback + restore applies occur while current remains 1. |
| Original suspend read SIGTERM, actual true | Quiesce exits 0, saves false; unquiesce exits 0 and patches false. |
| Quiesce suspend patch SIGTERM | Quiesce exits 0 while suspend remains false; later G2 exits 1, no Job apply. |
| Quiesce Job list SIGTERM after valid active list | Quiesce exits 0 and skips deletion; later G2 exits 1, no Job apply. |
| Active-Job deletion SIGTERM, readable active 1 | Quiesce exits 0 after the deadline warning; later G2 exits 1, no Job apply. |
| Active-Job drain probe SIGTERM, including stdout `1` | Quiesce logs the still-active Job as drained and exits 0; later G2 exits 1, no Job apply. |
| Rollback status read SIGTERM with empty output, timeout 0 | Restore exits 1 after rollback apply; no restore apply. |
| Rollback status read emits `{"succeeded":1}` then SIGTERM | Restore exits 0; reports G1 OK and dispatches restore. |
| Force-refresh status SIGTERM with empty output, async deadline 0 | Exit 0; logs started while `.status=pending`. |
| Force-refresh status emits success JSON then SIGTERM | Exit 0; logs completed. |
| Force-refresh deletion SIGTERM leaves old Job | Strict create reports AlreadyExists; exit 1. |
| Failed generic deletion, identical migration/recon apply | Completed old Job reused; exit 0. Recon reuse permits flip's set-env without a new Job instance. |
| Failed generic deletion, changed same-name rollback template | Strict apply reports immutable template; second restore exits 1 without another restore apply. |

Old/current helper comparisons retain the same G2 acceptance, G1 failed-read acceptance and original-suspend loss. Two drain paths change: a killed active probe with stdout `1` used to wait to the deadline, now logs drained immediately; a killed Job-list read with valid active output used to drain it, now warns/skips. The subsequent checked G2 Job list still rejects the remaining active Job. These comparisons isolate the helper change without attributing inherited behavior to the new commit.

## Findings

### SOL-841-R4-01 — G2 treats unreadable current replicas as zero

- **Severity:** blocking.
- **File:line:** `deploy/ci/bascule-preprod/bascule.mjs:503`; permissive fallback at `:505`–`:506`. Daily destructive dispatch follows G2 at `restore-mode.mjs:414`–`:417`; chain at `bascule.mjs:765`–`:775`.
- **Evidence:** In `audit.mjs`, the readable control has desired 0/current 1 and exits 1 before any Job apply. With that same current replica remaining, SIGTERM or exit 1 for `get deploy radar-api -o jsonpath={.status.replicas}` produces empty stdout and the caller substitutes 0. Chain restore exits 0; the daily quiesce → restore sequence exits 0/0 and applies both rollback and restore. Current helper output includes `kubectl interrompu par le signal SIGTERM` followed by `GARDE G2 OK`. `followup.mjs` confirms the same acceptance with the old helper.
- **Finding/limits:** A failed current-state observation satisfies the final consumer-drain barrier. Desired replicas 0 do not establish that existing consumers have stopped. This is an inherited guard defect exposed by the requested audit. Actual live consumers, writes or corruption are **unverified**.
- **Fix:** Require successful current-replica reads before interpreting stdout; add a G2 problem for any nonzero result, as for the neighboring desired-replica read. Keep legitimate successful empty status handling explicit. Test signal/exit-1 reads with desired 0/current 1 and assert no restore dispatch. Fix the quiesce counterpart separately (R4-04).

### SOL-841-R4-02 — G1 accepts success JSON from a failed Job-status child

- **Severity:** non-blocking.
- **File:line:** `deploy/ci/bascule-preprod/bascule.mjs:884`; unchecked parse/acceptance at `:886`–`:888`, used by G1 at `:811` and before restore at `restore-mode.mjs:415`.
- **Evidence:** Fake `get job radar-db-rollback-bascule -o jsonpath={.status}` synchronously emits `{"succeeded":1}` then sends itself SIGTERM. `run()` returns status 1 with the preserved stdout. `audit.mjs` exits 0, logs the signal, `Job radar-db-rollback-bascule terminé OK`, `GARDE G1 OK`, then applies `radar-db-restore-backup`. The empty-output control exits 1 with timeout 0 and no restore apply. `followup.mjs` reproduces acceptance with old and current helpers.
- **Finding/limits:** The shared poller discards the unsuccessful child status and accepts its emitted success JSON. Only complete valid success JSON passed in this reproduction; empty/invalid output is not claimed to pass. That complete JSON is itself a positive Job-success observation, even though the child failed afterward. The test does **not** demonstrate an absent/failed rollback, so a weakened G1 Job-success prerequisite is **unverified** and this finding is non-blocking under the supplied rule. The demonstrated issue is inconsistent handling of the helper's failure status, not proof of an unsafe restore. This is inherited behavior.
- **Fix:** Parse/classify status only after status 0. On failed/interrupted reads, retry within the existing deadline or fail; never return `{ok:true}` from that result. Add a success-stdout-then-signal case at G1 and assert no restore apply until a subsequent successful observation.

### SOL-841-R4-03 — unreadable original suspend is saved as false

- **Severity:** non-blocking.
- **File:line:** `deploy/ci/bascule-preprod/bascule.mjs:625`–`:626`.
- **Evidence:** `audit.mjs` starts the fake refresh CronJob at suspend=true and kills only its suspend read. Quiesce exits 0 and stores `"radar-refresh-pv":false` in `quiesce-state.json`; unquiesce exits 0 and issues `patch cronjob radar-refresh-pv -p {"spec":{"suspend":false}}`. Fake final suspend=false. Old/current comparisons have the same result.
- **Finding/limits:** Failure is treated as a known original state and can arm an owner-suspended CronJob during recovery. It does not bypass the pre-restore suspended-state guard; therefore non-blocking under this round's severity rule. Live original values are **unverified**.
- **Fix:** Reject/retry a failed original-suspend read before writing state or mutating consumers. Preserve successfully read true/false (and explicitly handle any successful unset field); never infer false from a failed read.

### SOL-841-R4-04 — quiesce declares a deployment drained after a failed read

- **Severity:** non-blocking.
- **File:line:** `deploy/ci/bascule-preprod/bascule.mjs:673`–`:674`.
- **Evidence:** In both `current-signal-restore` and `current-exit-restore`, the fake deployment retains current replicas=1 after scale 0. Quiesce ignores the failed current-replica read, exits 0 and logs `deploy/radar-api drainé (status.replicas=0)` and `QUIESCE OK`.
- **Finding/limits:** Quiesce success is unsupported by its read. This caller is not the final restore gate; the separate final G2 failure is blocking R4-01. The same stdout-only behavior is present with the old helper.
- **Fix:** Check status, retry within the existing quiesce deadline, and reject or report drain **unknown** on persistent read failure. Accept zero/empty only from a successful read.

### SOL-841-R4-05 — failed active-Job probe is reported as drained

- **Severity:** non-blocking.
- **File:line:** `deploy/ci/bascule-preprod/bascule.mjs:662`–`:664`.
- **Evidence:** Fake deletion fails and the CronJob-owned Job remains active. A subsequent probe emits `1` then SIGTERM. Current helper returns status 1; `stillActive` becomes false and quiesce logs `Job en vol radar-refresh-pv-running drainé (supprimé/inactif)`, exit 0. Old helper instead follows the active/deadline branch for that same stdout. Both sequences' later G2 reject restore, exit 1 with no Job apply.
- **Finding/limits:** This is a demonstrated signal-normalization behavior change: a failed read becomes a successful drain statement. No final active-Job guard bypass was demonstrated; that guard checks its own list status.
- **Fix:** Distinguish confirmed absence/inactivity from failed reads, e.g. `--ignore-not-found` with status-0 checks, retrying to the deadline. Keep an unreadable drain **unknown** and let G2 refuse it.

### SOL-841-R4-06 — failed generic deletion can reuse an old completed Job

- **Severity:** non-blocking.
- **File:line:** `deploy/ci/bascule-preprod/bascule.mjs:873`–`:874`.
- **Evidence:** The corrected name-keyed fake preserves an existing Job after SIGTERM in delete and accepts an identical apply. Two `migrate` calls exit 0 with created=1/reused=1. `recon-backup` → `flip` likewise has created=1/reused=1, logs G4 re-confirmed and issues `set env deploy/radar-api GEO_DOCUMENTS_REPOINT-` without a new recon Job. Conversely, the second restore changes the same-name rollback template's timestamped key and exits 1 on immutable-template rejection before another restore apply.
- **Finding/limits:** Strict **apply** does not itself prove replacement when a spec is identical; an old Job's completion can be reported as a new execution. This is inherited behavior. A G1-old-rollback bypass before destructive restore was **not demonstrated**; the fresh rollback key changes its immutable template. Flip is a reversible serving change after restore, so this finding is non-blocking under the supplied rule. Real Job-controller behavior is **not covered** by these offline tests.
- **Fix:** Refuse failed deletion (absence is already covered by `--ignore-not-found`), then create a new Job or verify deletion/new UID before accepting its status. Retain the UID-bound pod-verdict checks.

### SOL-841-R4-07 — force-refresh reports success after failed status reads

- **Severity:** non-blocking.
- **File:line:** `deploy/ci/bascule-preprod/bascule.mjs:1121`–`:1137`.
- **Evidence:** `audit.mjs` uses FORCE_REFRESH_START_CONFIRM_SEC=0 and kills the Job-status probe with no stdout. It exits 0 and logs `force-refresh OK (async)` and `démarré (.status=pending)`. With success JSON before SIGTERM, it logs completed and exits 0. Source shows the default async deadline takes the same pending-state success branch.
- **Finding/limits:** An unsuccessful observation can establish completion or an unsupported start statement. This command is outside the bascule workflow; no restore guard is weakened. The empty-output async fallback is inherited, not caused by status normalization.
- **Fix:** Check read status and require a successful active/succeeded observation before reporting confirmed start/completion. On persistent unreadability at the existing deadline, return failure or explicitly report state **unknown**.

### SOL-841-R4-08 — failed quiesce suspend patch still permits quiesce success

- **Severity:** non-blocking.
- **File:line:** `deploy/ci/bascule-preprod/bascule.mjs:633`.
- **Evidence:** `suspend-patch` kills the patch, leaves suspend=false, and quiesce exits 0 with `QUIESCE OK`. The later G2 suspend read rejects, exit 1 without Job apply.
- **Finding/limits:** The caller ignores the new failure status and reports overall quiesce success despite a failed mutation. The final guard is retained, and no destructive dispatch occurred. This is inherited best-effort behavior, reported individually for the exhaustive audit.
- **Fix:** Collect named patch failures and return/report quiesce **partial** after attempting all consumers; retain the final independent G2 check.

### SOL-841-R4-09 — failed quiesce Job-list read skips draining before success

- **Severity:** non-blocking.
- **File:line:** `deploy/ci/bascule-preprod/bascule.mjs:643`–`:645`.
- **Evidence:** The fake emits a valid active Job list then SIGTERM. Old helper accepts the output and drains the Job; current helper warns/skips draining, leaves the Job active and still exits quiesce 0. The subsequent checked G2 list rejects, exit 1, no Job apply.
- **Finding/limits:** This is an explicit, documented best-effort fallback whose signal path is newly reached by normalization. It makes drain coverage **partial**, not a new final barrier bypass. The warning already names the skipped drain and G2 barrier; that warning is not described as absent.
- **Fix:** Keep rejecting failed list output. If proceeding to G2 is retained, describe the quiesce result as **partial/unknown** rather than all consumers at rest; alternatively retry or fail quiesce within its existing budget. Preserve G2's independent refusal.

### SOL-841-R4-10 — active-Job delete failure is ignored before drain continuation

- **Severity:** non-blocking.
- **File:line:** `deploy/ci/bascule-preprod/bascule.mjs:656`–`:657`.
- **Evidence:** `drain-delete` kills the delete, leaves the Job active, then supplies a readable active=1 probe. With QUIESCE_TIMEOUT=0, quiesce warns that it has not disappeared and exits 0; later G2 rejects with no Job apply. This control separates the ignored mutation result from R4-05's unreadable probe.
- **Finding/limits:** Failure is not recorded; the Job is immediately added to a list named `drained`, although the subsequent polling/deadline is still checked. The source explicitly intends best effort for missing delete RBAC and retains G2. No final barrier bypass was demonstrated; this is an inherited permitted continuation reported for completeness.
- **Fix:** Record the failed delete with its Job name and report drain **partial** or retry within the existing deadline. Do not weaken the subsequent active-Job guard.

## Verdict

**NO-GO** for **SOL-841-R4-01**: a failed current-replica observation satisfies G2 and permits destructive restore dispatch while a fake consumer remains present. The round-3 CronJob-presence finding is **fixed**, and the round-4 Secret annotation correction rejects failed reads. The remaining caller observations are non-blocking. In particular, R4-02 demonstrates acceptance of a failed child's valid success JSON, not a missing rollback; the active-Job drain failures are caught by the subsequent G2 list.

All five requested commands were executed. Bascule selftests, render verification, the 52-case render suite and offline K8s validation pass. Restore selftests initially fail the local no-SDK assumption and pass all 243 assertions with that intended fixture isolated; both outcomes are recorded. Remote CI and live state remain **unverified**. The daily **04:00 UTC** decision remains unchanged. Temporary files were removed and no tracked file was modified.
