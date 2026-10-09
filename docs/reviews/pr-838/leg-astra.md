---
status: completed
reviewer-host: codex
reviewer-model: gpt-6-astra
reviewer-effort: xhigh
target-ref: fix/refresh-hours@b2f3c5f28123e9d749c4a582c163ffe1fd874d80
round: 3
lens: round2-fix-verification-and-schedules-references-and-render-guards
---

## Reasoning

Reviewed detached HEAD `b2f3c5f28123e9d749c4a582c163ffe1fd874d80`, the two fixes in `git diff d1bc29bf..HEAD`, and the schedules, references and render guards in `git diff origin/main...HEAD`. `origin/main` remains `641f48c31a89c9d7bc4f1bc06532728c29018cc8`. Read this lens's round-1 and round-2 prompts and reviews. No other review leg was consulted and no additional reviewer was launched. Loaded the repository rules and harness using/review/test instructions; the selftest failure also prompted the harness debug evidence loop. The explicit independent, offline review restrictions govern this leg.

**All three round-2 findings are fixed in the committed configuration.** The bascule workflow supplies the watchdog to every relevant consumer, duplicate numeric hours are rejected, and both refresh minutes must be zero. The strict watchdog comparison also rejects equality. No remaining blocking issue was demonstrated in this lens. One new non-blocking guard gap is reproduced below: the added workflow check finds a matching text line without verifying which job or step actually receives it.

**Quiesce environment and control flow.** `.github/workflows/bascule-preprod.yml:220` sets the literal list in `jobs.bascule.env` (the mapping begins at line 166). It retains all three defaults from `bascule.mjs:496,569` and adds `radar-refresh-pending-watchdog`. There is one assignment in the committed workflow, no step override, and no later shell/GITHUB_ENV reassignment. Parsing the YAML and combining workflow/job/step environment mappings confirms the following:

| Consumer | Workflow location | How the watchdog reaches it |
| --- | --- | --- |
| `quiesce` | `:459`, command `:461` | Inherits `bascule.env`; `quiesceTargets()` reads the override, `presentCronjobs()` retains present targets, `cmdQuiesce()` records their original suspension and suspends them. |
| Drain within quiesce | `bascule.mjs:633`, owner selection `:645` | Uses the same `presentCrons` list. An active Job owned by the watchdog is selected for deletion, followed by a wait for deletion/inactivity. No second environment is constructed. |
| Chain restore G2 | Workflow `:481`, command `:483`; `bascule.mjs:756` | Inherits the same job environment. `assertQuiesced()` reads the override at `:496`, checks suspension, and retains the active-Job refusal. |
| Backup restore G2 | Workflow `:486`, command `:488`; `restore-mode.mjs:414` | Inherits the same job environment. `makeRestoreMode()` receives the original `assertQuiesced` closure at `bascule.mjs:1203`; it does not implement a separate list or launch G2 with a cleared environment. |
| Un-quiesce, including failure cleanup | Workflow `:532`, `always()` condition `:533`, command `:535` | Remains in `bascule`, with the same environment on success or failure. `cmdUnquiesce()` restores every recorded CronJob suspension at `bascule.mjs:720`, including the watchdog. The recorded state is the source of the original boolean. |
| Other workflow jobs | `served-ids` at `:616`; `cycle-leg` at `:662` | Neither inherits `bascule.env`, but neither calls quiesce, restore/G2 or un-quiesce. Both call `served-ids.mjs` only. No consumer is missing the override. |

An offline simulation executed the exact five existing function bodies (`assertQuiesced`, `quiesceTargets`, `presentCronjobs`, `cmdQuiesce`, `cmdUnquiesce`) in a VM with in-memory kubectl/filesystem boundaries. Starting with an active Job owned by the watchdog, the unchanged default list leaves it unsuspended and undrained and G2 refuses it, reproducing R2-01. Using the literal workflow list suspends it, selects/deletes the Job, waits for inactivity, and lets G2 pass. Unsuspending the watchdog after that drain makes G2 fail, confirming it is checked rather than exempted. Un-quiesce restores both an originally active watchdog (`suspend=false`) and an originally suspended watchdog (`true`), as well as the deployment replicas. No kubectl executable or cluster was used by this simulation.

The explicit manual `SKIP_QUIESCE` path still requires manual quiescence; without a recorded state its `UNQUIESCE_REPLICAS` fallback restores deployments only. That behavior was not changed by these commits. A real Actions cancellation, live RBAC, drain completion and cleanup timing remain **unverified**. The code-level environment inheritance and state restoration are covered; this is not a claim of a live bascule run.

The override is confined to the workflow. `git diff --name-only origin/main...HEAD -- deploy/ci/bascule-preprod deploy/ci/backup` is empty. The push filters in `.github/workflows/bascule-bundle-cd.yml:72,73` cover those directories, supporting the stated decision to avoid changing the production bundle inputs. The documentation at `deploy/ci/README.md:326` correctly identifies the job-level override and the reason G2 needs it.

**Rendered configuration and delivery.** Both offline overlays contain one keyring PVC and these two active CronJobs:

| Environment | CronJob | Schedule | timeZone | suspend |
| --- | --- | --- | --- | --- |
| prod | radar-refresh-pv | `0 5,11,17,23 * * *` | Etc/UTC | false |
| preprod | radar-refresh-pv | `0 0,6,12,18 * * *` | Etc/UTC | false |
| prod | radar-refresh-pending-watchdog | `*/5 * * * *` | Etc/UTC | false |
| preprod | radar-refresh-pending-watchdog | `*/5 * * * *` | Etc/UTC | false |

Each refresh has four distinct starts, six hours apart. The cross-environment gaps alternate 300 and 60 minutes, including prod 23:00 to preprod 00:00. The nominal watchdog calculation is `900 + 300 = 1200 seconds < 3600 seconds`. Each environment separately satisfies `18900 < 19800` seconds with a 900-second shutdown margin, and `19800 + 60 < 21600` seconds between its own starts. These calculations do not measure scheduler admission, deletion completion or resource release.

Preprod CD still installs standalone Kustomize and calls `kustomize edit set image` before building (`.github/workflows/build-push-images.yml:989,994`). An isolated overlay `newTag` change rendered the chosen tag on all three image references: watchdog container, refresh container and refresh init container. Executing `render-prod` with a synthetic SHA-256 likewise put the digest on all three references. Prod read-back covers both CronJobs at `:1460,1468`; preprod lists both at `:997`. The standalone download/edit command, deployment, live read-back and current arming variables are **unverified**.

**Guard regressions and boundaries.** The old duplicate-hours mutant, numeric spelling variants (`0,00`, `00,0`, prod `05,5`), and the paired minute-17 mutant all fail the complete verifier. Reordered distinct hours and single-quoted source schedules still pass. The projection still counts comma entries, but that is sufficient in the complete verifier now that the stagger grammar rejects repeated numeric hours. The 60-second deadline floor and pod-template selector checks remain effective. One-sided minute, pass-count, day-field and timeZone mutations fail parity; internal one-hour intervals fail the appropriate environment's window guard. A watchdog-only CPU mutation is identified under the watchdog's object prefix.

At the new strict boundary, deadline 3299 plus period 300 passes (`3599 < 3600`); 3300 fails (`3600 == 3600`); 3400 fails. The round-2 direct `:50` positive case now correctly fails the new on-the-hour rule, rather than regressing to the old invented ten-minute separation. Genuine 04:50/05:00 and 23:50/00:00 pairs still report ten minutes and fail. A valid 23:00/00:00 pair reports 60 minutes and passes. Reordering rendered documents to put refresh first, watchdog second and PVC last, with no leading separator, preserves both contract projections and all three temporal/watchdog guards. No END-exit, first-document or ordering regression was reproduced.

The revised script header and watchdog manifest distinguish Job `FailureTarget` from terminal `Failed`, and a DELETE request from the scheduler observing deletion or a terminal pod phase. That wording avoids treating an accepted API request as proof that CPU requests have been released. Runtime watchdog implementation and controller behavior outside the manifest/guard/documentation contract are **not covered** by this leg.

**Scheduled-job inventory and overlaps.** The search again finds seven unique CronJob definitions and two GitHub scheduled workflows. No schedule changed after round 2. The only demonstrated new operational conflict from that round, the active watchdog reaching G2 without being drained, is fixed as described above.

| Scheduled job / reference | Assessment against the new hours and the old `17 5,11,17,23` schedule |
| --- | --- |
| `radar-backup-daily`, 02:23 UTC; `deploy/ci/backup/cronjob-backup-daily.yaml:46` | Its three-hour deadline reaches 05:23 on time: possible overlap with prod increases from six minutes at 05:17 to 23 at 05:00. A start delayed by its one-hour allowance can reach 06:23 and overlap preprod 06:00. Preprod midnight needs to run 2 h 23 to overlap the backup, versus 3 h 06 for old 23:17. These are widened timing exposures, not evidence of a new failure. |
| Manual backup exclusion `[02:00,05:30)`; same manifest `:120,177` | Governs manual backup starts, not refresh admission. Prod 05:00 and old 05:17 are both inside it. Preprod's new starts are outside; long passes can still extend into it. |
| `radar-backup-freshness`, 06:53 UTC; `deploy/ci/backup/cronjob-backup-freshness.yaml:30` | Can overlap new preprod 06:00 and prod 05:00 passes. The old 05:17 pass could already overlap it. This read-only freshness check does not establish a new conflicting operation. |
| `radar-consistency-snapshot`, 04:45 UTC, suspended; `deploy/k8s/35-consistency-snapshot-cronjob.yaml:30` | If enabled and delayed to 04:55, its 900-second deadline can reach 05:10, newly overlapping prod 05:00. The comment documents this exposure. No active conflict is established while suspended. |
| `radar-populate-geo-daily`, 04:17 America/Toronto; `deploy/k8s/35b-populate-geo-cronjob.yaml:17` | 08:17 UTC in EDT, 09:17 in EST. Both are after preprod's ordinary assumed two-hour morning window ending 08:00. Long passes could overlap before and after the schedule change. |
| `bascule-preprod`, Sunday 03:17 UTC; workflow `:64` | A midnight refresh can still be active, as old 23:17 could be, but the workflow suspends and drains it. The same mechanism now covers the watchdog. Scheduled arming is unknown. |
| `#2b` liveness, Monday 07:00 UTC; `.github/workflows/2b-proof-liveness-sweep.yml:22` | Overlaps the ordinary preprod morning window, as it could with the old 05:17–07:17 window. Proof-URL checks do not demonstrate a keyring or data conflict. |
| `radar-db-backup-prod`, every five minutes, suspended by default; `deploy/ci/bascule-preprod/cronjob-db-backup-prod.yaml:19` | If temporarily enabled, it now shares minute zero with refresh starts; the old refresh could already overlap a :15 dump. This does not establish a new active collision. |
| New watchdog, every five minutes; `deploy/k8s/34-refresh-pending-watchdog.yaml:51` | Its launches share the refresh minute grid, but it does not mount the keyring PVC. The bascule integration conflict is resolved by the override; simultaneous minute values alone do not reproduce the two-keyring incident. |

**References and local time.** The requested old-hours search now returns 26 tracked lines: the 25 classified in round 2 plus the deliberate paired-minute-17 negative test. No missed current hour reference was found by that search.

| Remaining matches | Classification |
| --- | --- |
| `.track/events.jsonl:36,65,66,67,68,69,70,71,72,886` | Ten historical timestamps; deliberately unchanged append-only history. |
| `deploy/ci/README.md:308`; `refresh-stagger.awk:6` | Old hours explicitly describe the dated incident. |
| `deploy/ci/backup/README.md:57`; `cronjob-backup-daily.yaml:45` | Deliberately unchanged stale prose/comments under the explicit backup-directory exclusion. Actual backup timing is accounted for above. |
| `verify-renders.test.sh:108` | New negative fixture rejecting the old minute 17. |
| `docs/architecture/focus/Pairs.svelte:26`, `portable.mjs:43`, `presentation-fr.js:10`, `report-render.mjs:73`, `scene-metadata.js:313` | Five historical architecture artifacts, explicitly excluded. |
| `docs/reports/architecture-monthly/architecture-before-after-2026-09-13.html:2`, `evidence-manifest-2026-09-13.json:21`; `docs/reports/assets/2026-09/archi/pipeline-after-20260913.graph.json:267`; `docs/reports/rapport-mois-2026-08-10_2026-09-13.html:3`, `.md:109` | Five dated report/evidence lines, explicitly excluded. |
| `docs/reviews/refresh-astra/production-acceptance.md:70` | Historical review, explicitly excluded. |

Neither `30 5,11,17,23` nor `05:30, 11:30` remains in tracked files. Current window references in `deploy/k8s/README.md:303`, `docs/spec/SPEC_FIX_GRAPH_CITY_KEY.md:97` and `plan/812-BRANCH_fix-graph-city-key.md:18` retain **1 h 30–2 h per pass**. For example, prod 05:00–06:30/07:00 and preprod 06:00–07:30/08:00 produce the same duration logic with shifted starts, not a new measured upper bound.

The Toronto table at `deploy/ci/README.md:304` remains correct: prod EDT 01:00/07:00/13:00/19:00, EST 00:00/06:00/12:00/18:00; preprod EDT 20:00 previous day/02:00/08:00/14:00, EST 19:00 previous day/01:00/07:00/13:00. DST ends on 2026-11-01 at 06:00 UTC; that day's prod 05:00 is 01:00 EDT and preprod 06:00 is 01:00 EST, still an hour apart. The live PR body is **not covered**.

## Commands and outputs

Shell commands used the RTK wrapper after loading its instructions; examples below omit the wrapper. Temporary files, copied overlays and selftest scratch directories were confined with `TMPDIR="$PWD/.review-tmp-astra"`. `K8S_VALIDATE_WITH_CLUSTER=0` explicitly kept validation offline. No Python, cluster/bucket access, push, commit or GitHub write was used.

```text
$ git rev-parse HEAD origin/main
b2f3c5f28123e9d749c4a582c163ffe1fd874d80
641f48c31a89c9d7bc4f1bc06532728c29018cc8
$ git log --oneline d1bc29bf..HEAD
b2f3c5f2 fix(refresh): strict watchdog-vs-gap comparison; precise Job FailureTarget/Failed and scheduler release wording
a963502d fix(refresh): quiesce the pending watchdog in the preprod bascule; refresh starts on the hour, no repeated hours
```

```text
$ bash deploy/k8s/refresh-cronjobs/verify-renders.test.sh
verify-renders tests: 26 passed, 0 failed
exit=0
$ make -f deploy/k8s/refresh-cronjobs/refresh-018.mk verify-renders ENV=review-astra-838
refresh-watchdog: ok — configured: pending deadline 900 s + watchdog period 300 s = nominal deletion request by 1200 s (not a measured bound); refresh Job deadline 19800 s
refresh-window: ok — balayage 18900 s < job 19800 s (marge 900 s, grâce 60 s) < créneau 21600 s
refresh-watchdog: ok — configured: pending deadline 900 s + watchdog period 300 s = nominal deletion request by 1200 s (not a measured bound); refresh Job deadline 19800 s
refresh-window: ok — balayage 18900 s < job 19800 s (marge 900 s, grâce 60 s) < créneau 21600 s
refresh-stagger: ok — prod "0 5,11,17,23 * * *", preprod "0 0,6,12,18 * * *": closest starts 60 min apart; nominal watchdog deletion request by 1200 s
exit=0
$ make k8s-validate ENV=review-astra-838
[k8s-validate] rendering deploy/k8s with kustomize…
[k8s-validate] structural check (every doc has apiVersion + kind)…
[document-date-recovery] offline render ok (preprod + prod)
[k8s-validate] every Job script is an esbuild entrypoint of api/Dockerfile…
image entrypoint check: ok (25 reference(s) in 92 file(s), 18 entrypoint(s))
[k8s-validate] offline render ok; set K8S_VALIDATE_WITH_CLUSTER=1 for a server dry-run
exit=0
```

Selftests ran with Node `v22.22.1`:

```text
$ node deploy/ci/bascule-preprod/bascule.selftest.mjs
bascule.selftest — 56 passés, 0 échoués
exit=0
$ node deploy/ci/bascule-preprod/restore-mode.selftest.mjs
FAIL node -e — main triggered, exit 1 without the SDK, verdict written (got [2,false,false])
restore-mode.selftest — 236 passed, 1 failed
exit=1
```

The second command's first run was **not green**. Its absent-SDK assertion at `restore-mode.selftest.mjs:445` starts `node -e` in a temporary directory. Because the required scratch location is inside the repository, Node resolves the parent checkout's installed SDK:

```text
require.resolve('@aws-sdk/client-s3', {paths: [<worktree> + '/.review-tmp-astra']})
/home/antoinefa/src/radar-immobilier/node_modules/@aws-sdk/client-s3/dist-cjs/index.js
```

Re-executing that exact embedded script with the same minimal environment produced exit 2 and `{"ok":false,"step":"resolve","exit":2,"reason":"missing S3_ENDPOINT"}`. The SDK loaded, so the intentionally absent endpoint was reached instead of the missing-SDK error. No network request was made.

To restore the test's explicit missing-SDK premise without modifying its code or writing outside the allowed directory, created `.review-tmp-astra/node_modules/@aws-sdk/client-s3/package.json` containing only:

```json
{"name":"@aws-sdk/client-s3","main":"intentionally-absent.cjs","exports":"./intentionally-absent.cjs"}
```

The nonexistent export prevents resolution from the test's scratch cwd. Reran the unchanged selftest with the same `TMPDIR`:

```text
ok   node -e — main triggered, exit 1 without the SDK, verdict written (got [1,false,true])
ok   node -e — unknown step refused (exit 2) (got 2)
ok   backup-read-job.tmpl.yaml — YAML parses, node -e arg == script
ok   db-restore-backup-job.tmpl.yaml — YAML parses, node -e arg == script
ok   docs-restore-backup-job.tmpl.yaml — YAML parses, node -e arg == script
restore-mode.selftest — 237 passed, 0 failed
exit=0
```

This is an isolated-environment pass, not an assertion that the first invocation passed. The fixture and all selftest temporary files were deleted at cleanup.

Additional commands and decisive outputs:

```text
$ node .review-tmp-astra/quiesce-check.mjs
default list: watchdog neither suspended nor drained; G2 refuses active watchdog (R2-01 reproduced)
workflow list: watchdog suspended/drained; G2 checks it and passes after drain; unquiesce restores suspend=false
workflow list: watchdog suspended/drained; G2 checks it and passes after drain; unquiesce restores suspend=true
restore-mode receives the same assertQuiesced closure; no separate quiesce environment
exit=0
$ node .review-tmp-astra/workflow-scope.mjs
committed workflow: bascule has 4 relevant CLI steps, all watchdog=true
served-ids: 0 relevant CLI steps; cycle-leg: 0 relevant CLI steps
env-in-wrong-job mutant: all 4 relevant steps watchdog=false
step-overrides-quiesce mutant: quiesce watchdog=false; other 3 watchdog=true
exit=0
```

`bash .review-tmp-astra/mutants.sh` exited 0 because all expected results matched. Individual full-verifier outcomes were:

| Mutation | Verifier result |
| --- | --- |
| Preprod `0 0,0,12,18 * * *` | Exit 2, stagger grammar refuses repeated hours. |
| Preprod `0 0,00,12,18 * * *`, `0 00,0,12,18 * * *`; prod `0 05,5,17,23 * * *` | Exit 2 each, numeric duplicates refused. |
| Both refreshes changed to minute 17 | Exit 2, `must start on the hour (minute 0)`. |
| Remove watchdog from the workflow list | Exit 2, `QUIESCE_CRONJOBS ... must list radar-refresh-pending-watchdog`. |
| Move the complete list to `served-ids.env` | **Exit 0**, although bascule does not receive it; R3-01. |
| Add a quiesce-step override with the old three-target list | **Exit 0**, although that step loses the watchdog; R3-01. |
| Label only on CronJob metadata / only on Job-template metadata | Exit 2 each, pod-template selector label missing. |
| Deadline 1 / 59 / 60 seconds | Exit 2 / 2 / 0, preserving the 60-second floor. |
| Deadline 3299 / 3300 / 3400 seconds | Exit 0 / 2 / 2; equality now fails. |
| Both schedules hourly | Exit 2, unsupported grammar. |
| Old preprod `50 5,11,17,23 * * *`; preprod minute 30 | Exit 2 each, minute parity. |
| Three preprod passes | Exit 2, pass-count parity. |
| Reordered preprod `0 18,0,12,6 * * *` | Exit 0, four distinct starts retained. |
| Preprod day fields `1 * *`, `* 1 *`, `* * 1` | Exit 2 each, parity. |
| Both weekday fields set to 1 | Exit 2, stagger grammar. |
| Preprod timeZone America/Toronto / removed | Exit 2 each, parity. |
| Preprod hours `0,1,12,18`; prod hours `5,6,17,23` | Exit 2 each, respective temporal contract. |
| Single-quoted source schedules | Exit 0 after rendering. |
| Prod watchdog request changed to 11m CPU | Exit 2, object-prefixed parity. |
| Refresh suspended, isolated from watchdog suspension | Exit 2, activation/model contract. |
| Watchdog command changed to `absent.js` | Exit 2, watchdog script contract. |

The initial suspension mutation changed both activation patches and failed the watchdog guard. A subsequent isolated refresh-only suspension mutation produced the activation/model failure reported above.

The copy/verify recipe used for the old round-2 mutants and new finding is reproducible as follows. Each `fixture` creates a fresh copy, now including the workflow required by the new guard:

```bash
SRC="$PWD"
export TMPDIR="$SRC/.review-tmp-astra"
mkdir -p "$TMPDIR"
BASE=deploy/k8s/34-refresh-cronjob.yaml
PRE=deploy/k8s/refresh-cronjobs/kustomization.yaml
WF=.github/workflows/bascule-preprod.yml
fixture() {
  CASE_ROOT="$TMPDIR/$1"
  mkdir -p "$CASE_ROOT/deploy/k8s" "$CASE_ROOT/.github/workflows"
  cp "$SRC/$BASE" "$SRC/deploy/k8s/34-refresh-pending-watchdog.yaml" \
    "$SRC/deploy/k8s/34-refresh-keyring-pvc.yaml" "$CASE_ROOT/deploy/k8s/"
  cp -r "$SRC/deploy/k8s/refresh-cronjobs" \
    "$SRC/deploy/k8s/refresh-cronjobs-prod" "$CASE_ROOT/deploy/k8s/"
  cp "$SRC/$WF" "$CASE_ROOT/$WF"
}
verify() {
  make --no-print-directory -f "$CASE_ROOT/deploy/k8s/refresh-cronjobs/refresh-018.mk" \
    verify-renders ENV=review-astra-838
}

fixture duplicate-hours
sed -i 's/value: "0 0,6,12,18 \* \* \*"/value: "0 0,0,12,18 * * *"/' "$CASE_ROOT/$PRE"
verify # exit 2

fixture both-off-hour
sed -i 's/schedule: "0 5,11,17,23 \* \* \*"/schedule: "17 5,11,17,23 * * *"/' "$CASE_ROOT/$BASE"
sed -i 's/value: "0 0,6,12,18 \* \* \*"/value: "17 0,6,12,18 * * *"/' "$CASE_ROOT/$PRE"
verify # exit 2

fixture env-in-wrong-job
awk '/^      QUIESCE_CRONJOBS:/ { saved=$0; next }
     /^  served-ids:/ { other=1 }
     other && /^    env:/ { print; print saved; next }
     { print }' "$CASE_ROOT/$WF" > "$CASE_ROOT/workflow-mutant.yml"
mv "$CASE_ROOT/workflow-mutant.yml" "$CASE_ROOT/$WF"
verify # exit 0; all bascule consumers now lack the override

fixture step-overrides-quiesce
sed -i '/id: quiesce/a\        env:\n          QUIESCE_CRONJOBS: radar-refresh-pv,radar-consistency-snapshot,radar-populate-geo-daily' "$CASE_ROOT/$WF"
verify # exit 0; only quiesce loses the watchdog
```

`bash .review-tmp-astra/direct-checks.sh` also exited 0: the direct stagger cases and document-order checks have the results described above. Both original overlays were rendered with `kubectl kustomize --load-restrictor LoadRestrictionsNone`; each exited 0. `render-prod` was executed with `IMAGE_REF=ghcr.io/rhanka/radar-api@sha256:` followed by 64 zeros and a `RENDER_OUT` inside the scratch directory, with `ENV=review-astra-838` last; it exited 0 and emitted three digest-pinned images.

Inventory/reference checks used:

```bash
git grep -nE 'kind:[[:space:]]*CronJob|cron:|schedule:' -- deploy .github/workflows
git grep -nE '17 5,11,17,23|05:17|11:17|17:17|23:17|30 5,11,17,23|05:30, 11:30'
git diff --name-only origin/main...HEAD -- deploy/ci/bascule-preprod deploy/ci/backup \
  docs/reports docs/architecture/focus docs/reviews/refresh-astra .track
```

The final command emitted nothing. The requested references are classified above.

## Round-2 findings status

| Finding | Status | Reproduction and disposition |
| --- | --- | --- |
| ASTRA-838-R2-01 — watchdog outside bascule quiesce/drain | **Fixed** | Exact-function simulation reproduces the old active-watchdog refusal with the default list, then suspends/drains/restores it with the workflow override. Parsed YAML confirms inheritance by quiesce, both G2 paths and `always()` un-quiesce; other jobs contain no consumer. No live result is claimed. |
| ASTRA-838-R2-02 — duplicate hours inflate passes | **Fixed** | Original `0 0,0,12,18 * * *` mutant now fails; numeric aliases and a prod-side duplicate also fail at `refresh-stagger.awk:53`. Reordered distinct hours pass. |
| ASTRA-838-R2-03 — common nonzero minute accepted | **Fixed** | Original paired minute-17 mutant now fails with `must start on the hour (minute 0)` from `refresh-stagger.awk:67`. Both released minute-zero schedules pass. |

The round-1 selector-placement, deadline-floor and grammar fixes remain effective. The actual-start/midnight arithmetic still works; the former minute-50 positive case is now intentionally invalid under the on-the-hour requirement. The additional strict comparison at `refresh-stagger.awk:83` rejects equality and accepts one second below it.

## Findings

**ASTRA-838-R3-01 — The new quiesce guard checks text presence without checking the receiving job or step**

- Severity: **non-blocking**.
- File:line: `deploy/k8s/refresh-cronjobs/refresh-018.mk:235` (related membership checks at `:236,237`).
- Evidence: In an otherwise unchanged copied fixture, moving the complete `QUIESCE_CRONJOBS` line from `jobs.bascule.env` to `jobs.served-ids.env` makes all four actual bascule consumers lose the override, yet full `verify-renders` exits 0. A separate fixture keeps the correct job-level list but adds the old three-target list to the `quiesce` step's `env`; parsed effective environment confirms that step loses the watchdog, and full verification still exits 0. The grep scans the whole workflow and concatenates assignments; its comma-membership tests are satisfied by a line that does not govern the consumer. Both mutants are valid YAML and reproduce the missing quiesce coverage from R2-01 at the configuration level.
- Scope/severity: The committed workflow is correctly scoped and has no conflicting override. This is a gap in the newly added regression guard, not an outstanding operational defect in the reviewed configuration; it does not keep R2-01 open.
- Fix: Check the effective environment of each quiesce/restore/un-quiesce consumer, accounting for workflow/job/step precedence, or enforce the intended `jobs.bascule.env` location and reject conflicting consumer-step overrides. Add the moved-job and step-override negative mutations. Preserve the active-Job G2 check.

## Verdict

**GO-with-nits.** All three round-2 findings are fixed, including the blocking watchdog/bascule integration. Required render tests pass (26/26), `verify-renders` and offline `k8s-validate` pass, and `bascule.selftest` passes (56/56). `restore-mode.selftest` passes (237/237) after explicitly isolating its missing-SDK fixture from the parent checkout; its initial unisolated failure and exact cause are recorded above. ASTRA-838-R3-01 is non-blocking. No remaining blocking issue was demonstrated in this lens. Live deployment, RBAC, admission and cleanup timing remain unverified.

Cleanup verified: `.review-tmp-astra/` was deleted and its absence checked. Checksums of every other supplied review/prompt file are unchanged. Both tracked and staged diffs are empty; final short status contains only the already-untracked `docs/reviews/pr-838/` directory. Only this leg was modified outside the deleted scratch directory. The YAML header is preserved with `status: completed`, and HEAD remains the requested commit.
