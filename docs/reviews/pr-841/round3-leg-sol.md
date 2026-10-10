---
status: completed
reviewer-host: codex
reviewer-model: gpt-6.1-sol
reviewer-effort: xhigh
target-ref: ops/bascule-restore-daily@e88a2f35bc63ea850d936ecfeb74a1ba5d90f951
round: 3
---

## Reasoning

Independent round-3 leg for PR #841, lens **test guard soundness, references and documentation accuracy**, including the changed subprocess helper's callers. HEAD is exactly `e88a2f35bc63ea850d936ecfeb74a1ba5d90f951`; `origin/main` is `ab7f4e70e9b05b6637cb1eb4a6769923cfb169e6`. Reviewed `git diff origin/main...e88a2f35bc63ea850d936ecfeb74a1ba5d90f951` and the seven-file round-3 delta `git diff 8f97478c..e88a2f35bc63ea850d936ecfeb74a1ba5d90f951`. Read only my own round-1/round-2 legs; no other reviewer leg was read.

Read `rules/MASTER.md`, `rules/workflow.md`, `rules/testing.md`, RTK and harness using-harness/review guidance. The owner's explicit independent-review scope and command allowlist govern this leg: no agents were launched, no cluster/bucket/network query was performed, and no commit, push or tracked-file edit was made. Temporary scripts, copied fixtures, fake executables and existing selftest artifacts were written only under `.review-tmp-sol/`. Only this review file is retained.

**04:00 UTC remains the owner-selected hour.** The full workflow diff changes its executable schedule from `17 3 * * 0` to `0 4 * * *`; the scheduled MODE=restore, latest-complete selection, auto-CONFIRM and arming expression are unchanged. Baseline render verification confirms a 97-minute backup-to-restore start gap and a 60-minute gap before the next refresh. No conflict in the current configured start times was demonstrated. Observed runtime durations, actual launch delay, IdP resource use, the live arming-variable value and remote CI are **unverified** offline.

Commit `94b62331` resolves the backup-selection bypass: `refresh-018.mk:250`–`:254` first renders a temporary Kustomization containing the backup manifest, then supplies that canonical render to the existing name/kind selector. The previous commented/spaced-separator decoys now fail for the real named backup's 37-minute gap or non-UTC timezone. Quoted backup metadata names pass; valid decoys report the correct 97-minute gap. The workflow extractor accepts trailing comments on both section keys while still rejecting multiple or unreadable active cron entries. Narrowing `W_FAIL` to the window-check message prevents a render/parser error from satisfying those window-mutation assertions. The repository suite passes all 52 cases; all 31 independent copied-fixture cases have the expected final result.

Commit `e88a2f35` resolves the reported un-quiesce signal case: a signal-killed patch returns status 1, warns with SIGTERM, names the failed CronJob, continues the remaining patches and emits no success log for the failed patch. Independent fake tests also confirm signal failures of deployment scale/rollout become visible failures. Normal success and nonzero-exit handling are unchanged.

However, the helper change exposes a **new signal-specific G2 regression** in `presentCronjobs()`. That caller treats every nonzero status as proof of absence. A killed existence lookup now removes an existing CronJob from both quiesce and G2. In a stateful fake of the normal `quiesce` → `restore-backup` sequence, two killed name lookups leave `radar-refresh-pv` unsuspended, record no CronJob state, and allow both rollback and restore Job dispatch. The old helper instead retains the CronJob, suspends it, and checks it before dispatch. SOL-841-R3-01 is blocking for this demonstrated guard regression; no live incident or actual database corruption is claimed.

### Other `run()` callers

Audited direct calls in `bascule.mjs` and injected calls in `restore-mode.mjs`, `ci-secrets.mjs` and `e2e-refs.mjs`. A VM matrix executed the exact old/current helper source with status 0/1/7/null, each capture mode and each allowFail mode (32 executions). Only the two allowFail/null combinations change their returned status and add a warning; stdout/stderr are preserved. Default strict calls already reject null status at `bascule.mjs:112`, before the changed return, and still reject it.

| Caller | Evidence / effect of the change |
| --- | --- |
| Un-quiesce CronJob patch, deployment scale, rollout (`bascule.mjs:716`–`:731`) | Independent old/current CLI tests: successes remain exit 0; patch exit 1 remains exit 1; each SIGTERM case changes exit 0 to exit 1 while continuing other recovery actions. The recorded `suspend: true` CronJob is still restored to true. |
| Strict flip (`:1036`) | With valid G4 sentinel and fake successful recon, SIGTERM in `kubectl set env` exits 1 in both revisions; neither prints flip success. |
| Smoke (`:1046`) | With the required URL and fake curl, success remains exit 0. Signal with no stdout exits 1 in both revisions; current emits SIGTERM and rejects at the status check. |
| Preflight, prod re-suspend, G2 deployment-spec/suspend/job-list checks, force-refresh existence | Source status checks at `:373`, `:478`–`:479`, `:501`–`:502`, `:509`–`:510`, `:524`–`:525`, `:1100`–`:1102` classify the new status as failure. No additional harmful behavior was demonstrated. |
| Job UID, backup-pod verdict, Secret labels/replace, ConfigMap references | Reviewed status branches at `bascule.mjs:873`–`:875`, `restore-mode.mjs:274`–`:275`, `ci-secrets.mjs:162`–`:174`, `e2e-refs.mjs:91`–`:98`. Signal results follow the existing failure branches. These branches were inspected; separate signal CLI cases for every injected caller are **not covered**. |
| Outputs used without checking status / ignored best-effort results | stdout/stderr remain unchanged. Job-status polling and original-suspend reads continue using that output. The Job-drain probe can stop on a failed get; the subsequent independent G2 active-Job check remains in place. No additional bypass was demonstrated. |
| CronJob presence filter (`:584`–`:586`) | Differential CLI and stateful sequence demonstrate omission of a present unsuspended CronJob and restore dispatch. See SOL-841-R3-01. |

## Previous findings status

| Finding | Status | Evidence at the reviewed head |
| --- | --- | --- |
| **SOL-841-R2-01 — raw backup documents substitute a decoy's fields** | **fixed** | `refresh-018.mk:250`–`:254` renders the backup before AWK selection. Both commented and spaced separators with real backup 03:23 exit 2 and report the actual 37-minute gap; both wrong-timezone variants exit 2 and name America/Toronto. Single/double-quoted metadata names exit 0. Valid decoys give 97 min, not the unrelated 180 min. Regression cases at `verify-renders.test.sh:194`–`:201` pass. |
| **SOL-841-R2-02 — comments on workflow section keys lose the schedule** | **fixed** | `bascule-crons.awk:12` and `:15` accept trailing comments. Each key-comment mutant, both comments together, and double-quoted `"on": # triggers` exit 0 with the unchanged daily 04:00 cron. With those same comments, extra double-quoted/unquoted crons still exit 2 for exactly-one enforcement, and an unreadable active entry exits 2. Repository cases at `verify-renders.test.sh:203`–`:207` pass. |
| **SOL-841-R2-03 — signal-killed patch reported as successful un-quiesce** | **fixed** | `bascule.mjs:117`–`:118` returns 1 for null status; `:725`–`:731` records that failure. New repository SIGTERM case at `restore-mode.selftest.mjs:827`–`:836` passes. Independent old/current fake patch test changes exit 0 to 1, warns SIGTERM, names the failed patch, continues watchdog/already-suspended patches and omits the refresh success log. The separate presence-filter regression is SOL-841-R3-01. |
| **SOL-841-01 — final workload schedules were not checked (round 2: partial)** | **fixed** | Refresh checks use final preprod/prod renders; backup input is now canonical too (`refresh-018.mk:254`, `bascule-window.awk:57` onward). Paired prod/preprod, prod-only, and later-preprod overlay mutations all exit 2 with the actual 04:00 collision. Direct/decoy late backups and timezones fail; valid backup/preprod quote and patch-comment variants pass. No remaining false pass in this schedule-selection contract was demonstrated. |
| **SOL-841-02 — single-cron assertion misses quoting variants** | **fixed** | Round-2 correction at `bascule.selftest.mjs:199`–`:202` remains. Mixed-quote extra active entries are rejected by the full render target even with the new key comments. The baseline selftest passes 56/0. |
| **SOL-841-03 — freshness overstated as same-day requirement** | **fixed** | README `:315`, workflow `:59`–`:61` and K8s README `:307` still describe latest-complete age, no same-day requirement, and qualifying later previous-day backups. Round-3 docs do not reverse the correction. |
| **SOL-841-04 — unsupported one-hour launch-delay assurance** | **fixed** | README `:316` and `:325`, workflow `:66`–`:67`, and `bascule-window.awk:24` retain the nominal 60-minute gap, 10-minute remainder using the supplied 50-minute observation, and unbounded launch-delay limitation. No hour change is proposed. |

## Commands and outputs

Existing test commands were run with `TMPDIR=<worktree>/.review-tmp-sol`; K8s validation also used `K8S_VALIDATE_WITH_CLUSTER=0`. These environment settings confine temporary output and keep validation offline. Commands were captured by the throwaway `checks.mjs`; each child exit is recorded separately, including the initial restore-suite failure.

| Command | Exit and relevant output |
| --- | --- |
| `git rev-parse HEAD origin/main` | 0: `e88a2f35bc63ea850d936ecfeb74a1ba5d90f951`; `ab7f4e70e9b05b6637cb1eb4a6769923cfb169e6`. |
| `git diff --stat origin/main...e88a2f35bc63ea850d936ecfeb74a1ba5d90f951` | 0: 11 files changed, 338 insertions, 21 deletions. |
| `git diff 8f97478c..e88a2f35bc63ea850d936ecfeb74a1ba5d90f951` | 0: all seven changed files inspected. |
| `node deploy/ci/bascule-preprod/bascule.selftest.mjs` | 0: `bascule.selftest — 56 passés, 0 échoués`. |
| `node deploy/ci/bascule-preprod/restore-mode.selftest.mjs`, initial run | 1: `restore-mode.selftest — 238 passed, 1 failed`; sole failure: `node -e — main triggered, exit 1 without the SDK, verdict written (got [2,false,false])`. New SIGTERM patch case passes. |
| Same restore command after isolating the intended no-SDK fixture | 0: `restore-mode.selftest — 239 passed, 0 failed`; no-SDK fixture returns `[1,false,true]`; SIGTERM patch case passes. |
| `make -f deploy/k8s/refresh-cronjobs/refresh-018.mk verify-renders ENV=review-sol-841` | 0: watchdog 900 + 300 = 1200 s; refresh window 18900 < 19800 < 21600 s; prod/preprod closest starts 60 min apart; bascule 97 min after backup and 60 min before next refresh. |
| `bash deploy/k8s/refresh-cronjobs/verify-renders.test.sh` | 0: `verify-renders tests: 52 passed, 0 failed`. |
| `make k8s-validate ENV=review-sol-841` | 0: document-date-recovery offline preprod/prod renders pass; `image entrypoint check: ok (25 reference(s) in 94 file(s), 18 entrypoint(s))`; `[k8s-validate] offline render ok`. |
| `node .review-tmp-sol/checks.mjs` | 0: launches and captures the five requested commands above; child failure retained. |
| `node .review-tmp-sol/isolate-restore.mjs` | 0: identifies ancestor SDK resolution and creates only a throwaway no-SDK shadow; unchanged restore command then exits 0. |
| `node .review-tmp-sol/mutations.mjs` | 0: 31 complete copied-render-target cases, expected accept/reject exits. One combined quoted-name fixture initially had an unintended malformed reference; corrected and rerun below. |
| `kubectl kustomize <copied-backup-wrapper>` | 0 for the 29 final valid backup fixtures. Intentional malformed YAML and duplicate resource cases exit 1. |
| `node .review-tmp-sol/callers.mjs` | 0: exact helper matrix (32 executions) and 26 old/current fake CLI executions; per-child results retained. The initial smoke/flip fixtures stopped before their target calls and were corrected below. |
| `node .review-tmp-sol/followup.mjs` | 0: corrected combined quoting mutation renders successfully and fails for 37 min; 15 old/current/copied-mitigation daily restore cases; four completed smoke cases; two completed strict flip cases. |
| `node .review-tmp-sol/sequence.mjs` | 0: three stateful `quiesce` → `restore-backup` sequences. Old: exit 0/0, refresh suspended true. Current: exit 0/0, refresh suspended false. Copied mitigation: quiesce exit 1, restore not run. |
| `git diff --check`; `git diff --name-only` | Both 0, empty: no tracked-file modification. Final cleanup removes `.review-tmp-sol/`. |

Baseline output:

```text
bascule.selftest — 56 passés, 0 échoués
restore-mode.selftest — 239 passed, 0 failed
refresh-stagger: ok — prod "0 5,11,17,23 * * *", preprod "0 0,6,12,18 * * *": closest starts 60 min apart; nominal watchdog deletion request by 1200 s
bascule-window: ok — restore "0 4 * * *" UTC: 97 min after the backup start "23 2 * * *", next refresh start 60 min later
verify-renders tests: 52 passed, 0 failed
image entrypoint check: ok (25 reference(s) in 94 file(s), 18 entrypoint(s))
```

**Restore-suite fixture limitation.** The initial local run resolves `@aws-sdk/client-s3` from `/home/antoinefa/src/radar-immobilier/node_modules/@aws-sdk/client-s3/dist-cjs/index.js`, because its temporary cwd is under this repository. The embedded-script assertion expects that SDK to be absent. A throwaway `.review-tmp-sol/node_modules/@aws-sdk/client-s3/index.js` throws MODULE_NOT_FOUND for that module, reproducing the intended fixture condition. No tracked source, selftest or installed dependency was changed. The initial failure remains reported; the isolated pass does not verify remote CI.

**Throwaway-fixture corrections.** In the initial combined decoy/quoted-name case, an unanchored replacement changed the decoy's embedded `radar-backup-daily-script` reference into malformed YAML. That run is not used as evidence of window rejection. An anchored metadata-name replacement produced valid YAML; offline Kustomize then exited 0 and the complete target rejected the actual 37-minute gap. The initial smoke cases omitted PREPROD_HEALTH_URL, and the initial flip cases wrote the wrong sentinel filename. Those runs are not used as caller evidence. Follow-up supplied the URL and a valid `recon.ok.json`, and reached the target calls in both revisions.

### Independent schedule mutations

Each case copied the same base/PVC/watchdog files, both overlays and refresh tooling as `verify-renders.test.sh`, plus the workflow and backup manifest. It then invoked the complete copied Make target with `ENV=review-sol-841`. Backup decoys used complete cloned jobTemplates. Make exit 2 represents rejection; expected outcomes below concern the declared guard contract, not live behavior.

| Mutation | Expected | Actual exit | Evidence |
| --- | --- | --- | --- |
| baseline | pass | 0 | bascule-window: ok — restore "0 4 * * *" UTC: 97 min after the backup start "23 2 * * *", next refresh start 60 min later |
| comment-separator-late | reject | 2 | bascule-window: the restore (0 4 * * *) starts 37 min after the backup start (23 3 * * *), below 60 min the same UTC day: `latest` would normally be the previous backup, refused by the 24 h guard |
| spaced-separator-late | reject | 2 | bascule-window: the restore (0 4 * * *) starts 37 min after the backup start (23 3 * * *), below 60 min the same UTC day: `latest` would normally be the previous backup, refused by the 24 h guard |
| comment-separator-timezone | reject | 2 | bascule-window: radar-backup-daily must run in Etc/UTC, got « America/Toronto » |
| spaced-separator-timezone | reject | 2 | bascule-window: radar-backup-daily must run in Etc/UTC, got « America/Toronto » |
| comment-separator-valid | pass | 0 | bascule-window: ok — restore "0 4 * * *" UTC: 97 min after the backup start "23 2 * * *", next refresh start 60 min later |
| spaced-separator-valid | pass | 0 | bascule-window: ok — restore "0 4 * * *" UTC: 97 min after the backup start "23 2 * * *", next refresh start 60 min later |
| end-marker-late | reject | 2 | bascule-window: the restore (0 4 * * *) starts 37 min after the backup start (23 3 * * *), below 60 min the same UTC day: `latest` would normally be the previous backup, refused by the 24 h guard |
| double-quoted-backup-name | pass | 0 | bascule-window: ok — restore "0 4 * * *" UTC: 97 min after the backup start "23 2 * * *", next refresh start 60 min later |
| single-quoted-backup-name | pass | 0 | bascule-window: ok — restore "0 4 * * *" UTC: 97 min after the backup start "23 2 * * *", next refresh start 60 min later |
| single-quoted-backup-schedule | pass | 0 | bascule-window: ok — restore "0 4 * * *" UTC: 97 min after the backup start "23 2 * * *", next refresh start 60 min later |
| quoted-name-comment-separator-late | reject | 2 | bascule-window: the restore (0 4 * * *) starts 37 min after the backup start (23 3 * * *), below 60 min the same UTC day: `latest` would normally be the previous backup, refused by the 24 h guard |
| direct-backup-timezone | reject | 2 | bascule-window: radar-backup-daily must run in Etc/UTC, got « America/Toronto » |
| direct-backup-late | reject | 2 | bascule-window: the restore (0 4 * * *) starts 37 min after the backup start (23 3 * * *), below 60 min the same UTC day: `latest` would normally be the previous backup, refused by the 24 h guard |
| backup-weekdays | reject | 2 | bascule-window: radar-backup-daily schedule must be `<minute> <hour> * * *`, got « 23 2 * * 1-5 » |
| missing-named-backup | reject | 2 | bascule-window: expected one radar-backup-daily CronJob in the backup manifest, got 0 |
| duplicate-named-backup | reject | 2 | Offline backup render rejects duplicate resource identity. |
| malformed-backup | reject | 2 | Offline backup render rejects malformed YAML. |
| on-key-comment | pass | 0 | bascule-window: ok — restore "0 4 * * *" UTC: 97 min after the backup start "23 2 * * *", next refresh start 60 min later |
| schedule-key-comment | pass | 0 | bascule-window: ok — restore "0 4 * * *" UTC: 97 min after the backup start "23 2 * * *", next refresh start 60 min later |
| both-key-comments | pass | 0 | bascule-window: ok — restore "0 4 * * *" UTC: 97 min after the backup start "23 2 * * *", next refresh start 60 min later |
| double-quoted-on-key-comment | pass | 0 | bascule-window: ok — restore "0 4 * * *" UTC: 97 min after the backup start "23 2 * * *", next refresh start 60 min later |
| comment-keys-extra-double-cron | reject | 2 | must carry exactly one active on.schedule cron (got: 0 4 * * *|0 5 * * *) |
| comment-keys-extra-unquoted-cron | reject | 2 | must carry exactly one active on.schedule cron (got: 0 4 * * *|0 5 * * *) |
| comment-keys-unreadable-cron | reject | 2 | bascule-crons: unreadable on.schedule line:     - kron: '0 5 * * *' |
| comment-keys-commented-extra-cron | pass | 0 | bascule-window: ok — restore "0 4 * * *" UTC: 97 min after the backup start "23 2 * * *", next refresh start 60 min later |
| paired-overlay-collision | reject | 2 | bascule-window: the restore (0 4 * * *) starts together with a refresh: prod@4:00 (single node) |
| prod-only-overlay-collision | reject | 2 | bascule-window: the restore (0 4 * * *) starts together with a refresh: prod@4:00 (single node) |
| later-preprod-overlay-collision | reject | 2 | bascule-window: the restore (0 4 * * *) starts together with a refresh: preprod@4:00 (single node) |
| single-quoted-preprod-schedule | pass | 0 | bascule-window: ok — restore "0 4 * * *" UTC: 97 min after the backup start "23 2 * * *", next refresh start 60 min later |
| comment-between-path-value | pass | 0 | bascule-window: ok — restore "0 4 * * *" UTC: 97 min after the backup start "23 2 * * *", next refresh start 60 min later |

Final total: **31 cases, no unexpected outcomes**. The previous false passes are all rejected at the actual named-workload check; there is no newly demonstrated schedule-guard defect.

### Independent recovery and G2 evidence

| Fake condition | Old helper (8f97478c) | Current helper (e88a2f35) |
| --- | --- | --- |
| All un-quiesce actions succeed | Exit 0; restores false/false/true CronJob suspend values | Same |
| Refresh patch exits 1 | Exit 1; remaining patches attempted; no failed-patch success log | Same |
| Refresh patch SIGTERM | Exit 0; failed patch logged as restored | Exit 1; SIGTERM warning; failed patch named; remaining patches attempted; no failed-patch success log |
| Deployment scale SIGTERM | Exit 0 | Exit 1; other deployment and CronJob recovery attempted |
| Deployment rollout SIGTERM | Exit 0 | Exit 1; other deployment and CronJob recovery attempted |
| Direct restore with readable unsuspended refresh | G2 refusal, exit 1, no Job apply | Same |
| Direct restore with SIGTERM in refresh existence lookup | G2 refusal, exit 1, no Job apply | G2 passes with empty cron list; exit 0; rollback and restore apply attempted |
| Same lookup emits a name before SIGTERM | G2 refusal, exit 1, no Job apply | Same bypass as the no-output signal |
| Existence lookup exits 1 | G2 bypass, restore dispatch | Same: inherited non-signal failure conflation, not introduced by this commit |

The direct cases were reproduced in **both chain restore and daily MODE=restore**. They use fake kubectl only. The stateful normal workflow sequence supplies stronger evidence: patch calls update the fake suspend state, and restore Job success is supplied as a fake status. Initial refresh suspend is false; each existence lookup is terminated by SIGTERM; deployments are at 0; the active-Job list is empty.

| Sequence | Quiesce exit | Recorded CronJobs | Refresh suspend during restore dispatch | Restore exit / apply |
| --- | --- | --- | --- | --- |
| Old helper | 0 | `{"radar-refresh-pv":false}` | **true** | 0 / yes |
| Current helper | 0 | `{}` | **false** | 0 / yes |
| Copied mitigation | 1 | `null` | No restore dispatch | Not run |

Current sequence output (both commands exit 0):

```text
::warning title=bascule::kubectl interrompu par le signal SIGTERM.
[bascule] quiesce — cronjob/radar-refresh-pv absent en préprod → ignoré (rien à quiescer).
[bascule] QUIESCE OK — consommateurs préprod au repos ; état d'origine capturé pour l'un-quiesce.
::warning title=bascule::kubectl interrompu par le signal SIGTERM.
[bascule] quiesce — cronjob/radar-refresh-pv absent en préprod → ignoré (rien à quiescer).
[bascule] GARDE G2 OK — quiesce vérifié (deploys=radar-api,radar-immo-mcp ; crons=)
```

Its fake call log contains no suspend patch and does contain:

```text
-n radar-immobilier-preprod apply -f <workdir>/radar-db-rollback-bascule.rendered.yaml
-n radar-immobilier-preprod apply -f <workdir>/radar-db-restore-backup.rendered.yaml
```

The decisive fake lookup is the same shell signal mechanism used by the new repository patch selftest:

```bash
case "$*" in
  *"get cronjob "*"-o name"*) kill -TERM "$$" ;;
  *"jsonpath={.spec.suspend}"*) read -r suspended < "$FAKE_STATE"; printf '%s' "$suspended" ;;
  # Other fake branches supply zero deployment replicas, an empty Job list,
  # successful Job statuses, and apply suspend patches to FAKE_STATE.
esac
```

## Findings

### SOL-841-R3-01

- **Severity:** blocking.
- **File:line:** `deploy/ci/bascule-preprod/bascule.mjs:118` (changed signal-to-status normalization); affected caller `:584`–`:586`, used by quiesce at `:601` and G2 at `:498`. Daily restore invokes G2 at `deploy/ci/bascule-preprod/restore-mode.mjs:414` before dispatch.
- **Finding:** A signal-killed CronJob existence lookup is now treated as absence, removing a present consumer from quiesce and G2. The helper fix correctly reports a failure, but `presentCronjobs()` interprets every nonzero result as NotFound. An unsuspended CronJob can therefore survive quiesce and be omitted from the guard immediately before destructive restore dispatch.
- **Evidence:** `node .review-tmp-sol/callers.mjs` and `followup.mjs` run old/current copies with fake kubectl that kills `get cronjob radar-refresh-pv -o name` by SIGTERM, returns false for its suspend property, zero deployment replicas and an empty active-Job list. Direct chain and daily restore change from exit 1/G2 refusal/no apply to exit 0/G2 OK/rollback and restore applies. `sequence.mjs` additionally runs the normal quiesce → daily restore sequence with stateful suspend patches: old records the CronJob, patches true, checks it and restores while true; current records `cronjobs: {}`, performs no patch, reports G2 OK with `crons=`, and restores while false. No real kubectl command, Job or database operation is involved.
- **Attribution and limits:** The presence filter already conflates ordinary nonzero exits with absence; that control reproduces in both revisions. The **SIGTERM-specific change** is attributable to `e88a2f35`: `status: null` previously became 0 and included the CronJob; it now becomes 1 and skips it. For the default workflow sequence, the reproduction terminates both quiesce and G2 presence probes; a successful later probe could still reject an unsuspended CronJob. Live incidence and data corruption are **unverified**.
- **Fix:** Keep the corrected nonzero signal handling. Make `presentCronjobs()` distinguish confirmed NotFound from unreadable/interrupted lookups. A bounded option is `kubectl get cronjob ... --ignore-not-found -o name`: skip only successful empty output; include successful nonempty output; fail or retry and then fail on every nonzero result. Add fake lookup failures alongside the patch signal test.
- **Fix evidence:** The change above was applied **only to a copied bascule file**. In the same stateful sequence it exits 1 at quiesce before state capture or restore dispatch. Direct daily signal/no-output, signal/partial-output and generic-exit cases also exit 1 before any Job apply; a readable unsuspended CronJob still fails G2; simulated successful empty NotFound output is still ignored and permits restore. This is offline fake-interface validation, not a deployed fix.
- **Acceptance:** Quiesce/G2 must fail for killed or otherwise unreadable CronJob presence lookups; no restore apply may follow. A real absent optional CronJob must still be ignored, and the fixed signal-patch un-quiesce behavior must remain. Keep daily 04:00 UTC unchanged.

## Verdict

**NO-GO** for SOL-841-R3-01: the changed helper permits a demonstrated signal-specific omission from the quiesce/restore barrier. All three round-2 findings and the remaining partial round-1 finding are fixed. No new schedule-selection or configured-start conflict was demonstrated; the owner-selected daily 04:00 UTC schedule matches the request.

All five requested checks were executed. Both render gates, the 52-case mutation suite, K8s validation and the bascule selftest pass. The restore selftest initially fails its local no-SDK assumption and passes all 239 assertions after isolating that fixture. Remote CI and live operational state are **unverified**. All temporary scripts/fixtures were removed; no tracked file was modified.
