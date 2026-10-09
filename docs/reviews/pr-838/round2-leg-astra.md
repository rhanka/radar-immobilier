---
status: completed
reviewer-host: codex
reviewer-model: gpt-6-astra
reviewer-effort: xhigh
target-ref: fix/refresh-hours@d1bc29bffa8785f83be0db4a0a8814ed9bc6a326
round: 2
lens: round1-fix-verification-and-schedules-references-and-render-guards
---

## Reasoning

Reviewed detached HEAD `d1bc29bffa8785f83be0db4a0a8814ed9bc6a326`, both `git diff 7fa9e468..HEAD` and the schedules/guards/manifests/documentation in `git diff origin/main...HEAD`. `origin/main` is `641f48c31a89c9d7bc4f1bc06532728c29018cc8`. Read this lens's round-1 prompt and review; no other review leg was read. Loaded the repository bootstrap, MASTER, workflow, testing, and harness using/review instructions. The explicit offline, independent-leg restrictions govern this review; no additional reviewer was launched.

**All four round-1 findings are fixed.** The committed refresh schedules implement the owner's correction, and all three required checks exit 0. Additional verification is **partial**: the new projection counts comma-separated hour entries rather than actual passes, and equality of minutes does not enforce the owner's on-the-hour requirement. Those two demonstrated guard gaps are non-blocking because the committed schedules themselves are correct. A separate, blocking integration conflict remains: the new active preprod watchdog is omitted from the bascule's quiesce/drain list, but its active Jobs are counted by G2 and cause restore refusal.

**Rendered configuration and delivery.** Both offline overlays contain exactly two CronJobs and one keyring PVC:

| Environment | CronJob | Schedule | timeZone | suspend |
| --- | --- | --- | --- | --- |
| prod | radar-refresh-pv | `0 5,11,17,23 * * *` | Etc/UTC | false |
| preprod | radar-refresh-pv | `0 0,6,12,18 * * *` | Etc/UTC | false |
| prod | radar-refresh-pending-watchdog | `*/5 * * * *` | Etc/UTC | false |
| preprod | radar-refresh-pending-watchdog | `*/5 * * * *` | Etc/UTC | false |

The daily chronological pattern is preprod 00:00, prod 05:00, preprod 06:00, prod 11:00, preprod 12:00, prod 17:00, preprod 18:00, prod 23:00, then preprod 00:00 next day. Cross-environment gaps alternate 300 and 60 minutes. Each environment retains a six-hour interval. The committed watchdog calculation is `900 + 300 = 1200 seconds`, less than the closest separation of `3600 seconds`; the nominal margin is 40 minutes. Each environment's window guard verifies `18900 < 19800` with 900 seconds of shutdown margin, and `19800 + 60 = 19860 < 21600` seconds between its own starts. These are configuration calculations, not measured admission, execution or deletion bounds.

Preprod delivery still installs standalone Kustomize 5.4.3 and calls `kustomize edit set image ghcr.io/rhanka/radar-api=ghcr.io/rhanka/radar-api:${SHA}` before building (`.github/workflows/build-push-images.yml:989`, `:994`). Both CronJobs and the refresh init container use that image name. An isolated replacement of the overlay's `newTag`, followed by offline rendering, produced the requested tag on all three image references. The standalone download/edit command was **not covered** by execution. Prod uses the actual `render-prod` recipe in `verify-renders`, including global placeholder-to-digest substitution (`refresh-018.mk:127`, workflow `:1452`). The prod workflow reads back both main-container images and suspension state at `:1460` and `:1468`; preprod lists both CronJobs at `:997` with `|| true`. Live application and read-back are **unverified**.

**Guard checks.** One-sided changes to the refresh minute, ordinary pass count, day of month, month, day of week, and timeZone all failed the complete verifier. Removing timeZone from preprod also failed parity. A non-daily schedule on both sides failed the stagger grammar check. The hour list may differ or be reordered while preserving the contract; a reordered preprod list passed. A preprod-only one-hour internal interval failed the window guard for preprod; a prod-only one-hour internal interval failed it for prod. Thus the window is checked separately for each environment rather than inferred from a common hour list.

The rewritten stagger computation handles actual starts, including midnight: the former `:00`/`:50` example on `5,11,17,23` now reports 50 minutes; a real 04:50/05:00 pair and a real 23:50/00:00 pair report 10 minutes and fail; 23:00/00:00 reports 60 minutes and passes. Full verification rejects the former `:50` overlay because minute divergence is now forbidden; the direct stagger test is necessary to isolate the corrected arithmetic. Minute 60, minute -1 and hour 24 were rejected directly. The equality boundary still accepts `deadline + period == separation`; the error text's “before” is stronger than that comparison, but the committed 60-minute separation has a substantial margin.

Changing source schedule quoting to single quotes passed after Kustomize serialization. Reordering each render to refresh first, watchdog second, PVC last, with no leading document separator, preserved each contract multiset; watchdog, window and stagger checks passed. A prod-only watchdog CPU change to 11m failed parity with the watchdog object prefix. Suspending refresh failed activation; replacing the watchdog script name failed its dedicated guard. No new object-order, first-document, name-prefix or END-exit bypass was reproduced. The window guard's warning for unsupported forms remains partial in isolation; the new stagger grammar rejects those forms in the complete verifier.

The changed documentation now describes a **nominal deletion request**, uid/resourceVersion preconditions, and unavailable/reserved-capacity limits rather than promising a measured deletion bound. Both namespace Roles grant pods `list/delete`, consistent with the script's list-and-conditional-delete API surface. The configured minimum matches `readWatchdogConfig` at `api/src/scripts/refresh-pending-watchdog.ts:76`. Runtime implementation testing belongs to the other lens and was **not covered** here. Live ServiceAccount/Role installation, quotas and timing remain **unverified**.

**Scheduled-job inventory and actual interactions.** The repository-wide search found seven unique CronJob definitions and two GitHub scheduled workflows. Overlay targets and self-test strings are not additional schedules. The comparison below uses the pre-PR refresh schedule, `17 5,11,17,23 * * *`, for both environments. An interval overlap alone does not establish a resource or data conflict.

| Job / source | Schedule and limits | Assessment against new prod/preprod hours |
| --- | --- | --- |
| radar-refresh-pv — `deploy/k8s/34-refresh-cronjob.yaml:92`, preprod patch `refresh-cronjobs/kustomization.yaml:68` | Four starts per environment, UTC; Job deadline 19800 s; start allowance 600 s; grace 60 s | Simultaneous nominal starts are removed. Running passes may overlap across environments for hours, as they could before; the change separates starts, not whole passes. |
| radar-refresh-pending-watchdog — `deploy/k8s/34-refresh-pending-watchdog.yaml:50` | Every five minutes in both environments; start allowance 120 s; Job deadline 180 s | New active Jobs overlap the start-minute grid of both refreshes. They do not mount the keyring PVC, so identical start minutes alone do not reproduce the attach incident. They do introduce the concrete bascule/G2 incompatibility in ASTRA-838-R2-01. |
| radar-backup-daily — `deploy/ci/backup/cronjob-backup-daily.yaml:46` | 02:23 UTC, active; Job deadline 10800 s; start allowance 3600 s | On-time maximum ends 05:23: old prod 05:17 permitted six minutes of overlap; new prod 05:00 permits 23 minutes. This widens an existing possible overlap by 17 minutes. New preprod 06:00 is after the on-time backup deadline; a delayed backup can reach 06:23, so overlap is still possible. The midnight preprod pass can run through the backup if it exceeds 2 h 23; the old 23:17 pass could do so if it exceeded 3 h 06. These are widened timing exposures, not evidence of a new backup failure. |
| Manual daily-backup guard — same manifest `:120`, `:177`; backup README `:103` | Refuses manual runs inside `[02:00,05:30)` UTC | This guard is for manual **backup** starts, not a global refresh exclusion. Prod 05:00 is inside it, as old prod 05:17 was. New preprod starts 00:00/06:00/12:00/18:00 are all outside it. A normal assumed 00:00–01:30/02:00 pass ends at/before the window; its actual 5 h 30 deadline can extend into it. No new invalid manual-run admission is demonstrated. |
| radar-backup-freshness — `deploy/ci/backup/cronjob-backup-freshness.yaml:30` | 06:53 UTC, active; deadline 300 s; start allowance 3600 s | Overlaps a normal preprod 06:00–07:30/08:00 pass and can overlap prod 05:00–06:30/07:00. Old 05:17–06:47/07:17 passes already permitted overlap. This is a read-only S3 freshness check; no new conflicting operation is shown. |
| radar-consistency-snapshot — `deploy/k8s/35-consistency-snapshot-cronjob.yaml:29` | 04:45 UTC, **suspended**; deadline 900 s; start allowance 600 s | If activated, a delayed 04:55–05:10 execution overlaps prod 05:00, whereas it did not overlap old 05:17. The source explicitly documents that potential new morning overlap. Preprod 06:00 is later; its prior midnight pass can still be active at 04:45 under the 5 h 30 deadline, as the old 23:17 pass could be until 04:47. No active snapshot conflict is established. |
| radar-populate-geo-daily — `deploy/k8s/35b-populate-geo-cronjob.yaml:17` | 04:17 America/Toronto; suspend omitted; deadline 3600 s | 08:17 UTC in EDT, 09:17 UTC in EST. New preprod's assumed two-hour morning window ends 08:00, so neither overlaps that normal window. A long refresh can overlap, both before and after the change. No new data/resource conflict is established. |
| bascule-preprod — `.github/workflows/bascule-preprod.yml:64` | Sunday 03:17 UTC, conditional on BASCULE_SCHEDULE_ENABLED; scheduled timeout 330 min | A midnight preprod pass is 3 h 17 old at 03:17, versus 4 h for old 23:17. The possible active-refresh overlap existed before; its duration threshold is now 43 minutes shorter. Crucially, the normal workflow suspends refresh and drains its active Jobs before G2 (`bascule.mjs:627`, `:640`). A blanket claim that the new midnight pass inevitably blocks restore is refuted. The newly introduced watchdog is outside that drain list and can independently trigger G2: see R2-01. Arming and live job state are unknown. |
| #2b liveness — `.github/workflows/2b-proof-liveness-sweep.yml:22` | Monday 07:00 UTC, GitHub-hosted runner | Now inside preprod's ordinary morning window; it was already inside the possible old 05:17–07:17 window. The workflow checks proof URLs, not the keyring or the refresh job; no new conflicting operation is shown. |
| radar-db-backup-prod — `deploy/ci/bascule-preprod/cronjob-db-backup-prod.yaml:19` | Every five minutes, **suspended** by default; deadline 3600 s; start allowance 600 s; timeZone omitted | When temporarily enabled, its starts now coincide with refresh starts at :00. Even old :17 refreshes could overlap a :15 dump. This dormant trigger's alignment is not evidence of a new active collision or the two-keyring incident. |

No cluster observation was made. The demonstrated new operational conflict is G2's treatment of the active watchdog, not an assertion that backup, geo or liveness has failed. That conflict is new versus `origin/main`; it was already present in the round-1 PR snapshot and is newly identified in this round, not introduced by the one-hour schedule correction.

**Windows, references and Toronto conversions.** Current operational references in `deploy/k8s/README.md:303`, `docs/spec/SPEC_FIX_GRAPH_CITY_KEY.md:97`, and `plan/812-BRANCH_fix-graph-city-key.md:18` now use prod 05:00/11:00/17:00/23:00 and preprod 00:00/06:00/12:00/18:00 UTC, retaining **1 h 30–2 h per pass**. For example, prod 05:00–06:30/07:00 and preprod 06:00–07:30/08:00 give a combined two-hour-assumption envelope of 05:00–08:00. The overnight pair is prod 23:00–00:30/01:00 and preprod 00:00–01:30/02:00. This is a duration assumption, not a new upper bound: the 5 h 15 sweep and 5 h 30 Job allowances remain documented. Actual duration is unverified.

The table at `deploy/ci/README.md:304` is correct:

| Environment | EDT (UTC−4) | EST (UTC−5) |
| --- | --- | --- |
| prod | 01:00, 07:00, 13:00, 19:00 | 00:00, 06:00, 12:00, 18:00 |
| preprod | 20:00 previous day, 02:00, 08:00, 14:00 | 19:00 previous day, 01:00, 07:00, 13:00 |

The transition is 2026-11-01 **06:00 UTC**. On that date specifically, preprod 00:00 UTC is October 31 20:00 EDT; prod 05:00 UTC is 01:00 EDT; preprod 06:00 UTC is 01:00 EST, after the rollback. Later starts use EST. UTC schedules do not change. The two consecutive prod/preprod starts can therefore both display “01:00” locally that morning while still being an hour apart.

The exact requested search returned **25 tracked matching lines**, all accounted for below. Neither `30 5,11,17,23` nor `05:30, 11:30` remains in tracked files. The supplied round-1 artifacts are untracked in this worktree, so `git grep` does not include their intentionally historical schedules.

| Remaining file:line(s) | Classification |
| --- | --- |
| `.track/events.jsonl:36,65,66,67,68,69,70,71,72,886` | Deliberately left: ten historical timestamp matches, not schedule settings; append-only history. |
| `deploy/ci/README.md:308` | Updated document; old schedule retained explicitly as the dated incident explanation. |
| `deploy/k8s/refresh-cronjobs/refresh-stagger.awk:6` | Deliberately retained incident history. |
| `deploy/ci/backup/README.md:57` | Deliberately left stale operational prose under the explicit backup-directory exclusion. Its “before” wording is not a non-overlap guarantee. |
| `deploy/ci/backup/cronjob-backup-daily.yaml:45` | Deliberately left stale comment under the same exclusion; actual schedule remains 02:23. |
| `docs/architecture/focus/Pairs.svelte:26`, `portable.mjs:43`, `presentation-fr.js:10`, `report-render.mjs:73`, `scene-metadata.js:313` | Deliberately left: historical architecture artifacts named in the review scope. |
| `docs/reports/architecture-monthly/architecture-before-after-2026-09-13.html:2` | Deliberately left: dated report, two occurrences on one line. |
| `docs/reports/architecture-monthly/evidence-manifest-2026-09-13.json:21` | Deliberately left: dated evidence manifest. |
| `docs/reports/assets/2026-09/archi/pipeline-after-20260913.graph.json:267` | Deliberately left: dated report graph. |
| `docs/reports/rapport-mois-2026-08-10_2026-09-13.html:3`, `.md:109` | Deliberately left: dated reports, two HTML occurrences on one line. |
| `docs/reviews/refresh-astra/production-acceptance.md:70` | Deliberately left: historical review excluded by the prompt. |

The excluded paths have no changes in the target diff. `.github/workflows/bascule-bundle-cd.yml:73` confirms that `deploy/ci/backup/**` is a deployment trigger. No unaccounted current hour reference was found by the requested search. A minor stale description remains at `verify-renders.test.sh:5`: “start-minute stagger” / “shared hours” describes round 1, although the test bodies now exercise distinct hours. The live GitHub PR body was **not covered**; documentation conclusions refer to committed files and the supplied request.

## Commands and outputs

Commands were run through the RTK wrapper after loading its instructions; the excerpts below omit that wrapper. All test temporary files were confined by `TMPDIR="$PWD/.review-tmp-astra"`. `K8S_VALIDATE_WITH_CLUSTER=0` explicitly kept the validator offline. No Python, cluster/bucket access, push, commit or GitHub write was used.

```text
$ git branch --show-current
(empty: detached worktree)
$ git rev-parse HEAD
d1bc29bffa8785f83be0db4a0a8814ed9bc6a326
$ git log --oneline 7fa9e468..HEAD
d1bc29bf docs(refresh): preprod refresh windows at 00:00/06:00/12:00/18:00 UTC
bb786799 fix(refresh): preprod on the hour, one hour after prod ...
8526387e fix(refresh): watchdog deletes with uid+resourceVersion preconditions ...
dd8df2eb fix(refresh): tighten render guards ...
$ kubectl kustomize --load-restrictor LoadRestrictionsNone deploy/k8s/refresh-cronjobs
$ kubectl kustomize --load-restrictor LoadRestrictionsNone deploy/k8s/refresh-cronjobs-prod
exit=0 for each; extracted configuration is in the rendered table above
```

```text
$ bash deploy/k8s/refresh-cronjobs/verify-renders.test.sh
ok: released overlays pass
ok: preprod on the prod hours (same starts)
ok: preprod off the hour (minute differs from prod)
ok: preprod with fewer passes than prod
ok: another hour list on the hour, one hour away, passes (relational, not pinned)
ok: a stalled pod outlives the one-hour gap
ok: prod render without the watchdog
ok: preprod watchdog left suspended
ok: refresh pod without the watchdog selector label
ok: watchdog selecting another label
ok: watchdog without its pending deadline
ok: watchdog deadline not shorter than the slot stagger
ok: refresh Job retrying a deleted pod
ok: selector label moved to the CronJob metadata (not on the pods)
ok: selector label moved to the Job template metadata (not on the pods)
ok: watchdog deadline below the 60 s floor the script enforces
ok: watchdog deadline at the 60 s floor passes
ok: hourly schedules (slot timing not checkable) are refused
ok: adjacent hours: preprod 04:50 vs prod 05:00 refused
ok: adjacent hours 30 min apart pass
ok: hour outside 0-23 refused
verify-renders tests: 21 passed, 0 failed
exit=0
```

```text
$ make -f deploy/k8s/refresh-cronjobs/refresh-018.mk verify-renders ENV=review-astra-838
refresh-watchdog: ok — configured: pending deadline 900 s + watchdog period 300 s = nominal deletion request by 1200 s (not a measured bound); refresh Job deadline 19800 s
refresh-window: ok — balayage 18900 s < job 19800 s (marge 900 s, grâce 60 s) < créneau 21600 s
refresh-watchdog: ok — configured: pending deadline 900 s + watchdog period 300 s = nominal deletion request by 1200 s (not a measured bound); refresh Job deadline 19800 s
refresh-window: ok — balayage 18900 s < job 19800 s (marge 900 s, grâce 60 s) < créneau 21600 s
refresh-stagger: ok — prod "0 5,11,17,23 * * *", preprod "0 0,6,12,18 * * *": closest starts 60 min apart; nominal watchdog deletion request by 1200 s
exit=0
```

```text
$ make k8s-validate ENV=review-astra-838
[k8s-validate] rendering deploy/k8s with kustomize…
[k8s-validate] structural check (every doc has apiVersion + kind)…
[document-date-recovery] offline render ok (preprod + prod)
[k8s-validate] every Job script is an esbuild entrypoint of api/Dockerfile…
image entrypoint check: ok (25 reference(s) in 92 file(s), 18 entrypoint(s))
[k8s-validate] offline render ok; set K8S_VALIDATE_WITH_CLUSTER=1 for a server dry-run
exit=0
```

Extra cases were run with `bash .review-tmp-astra/extra-tests.sh` and `bash .review-tmp-astra/order-checks.sh`. Each script exited 0 and reported individual guard exits. A script exit of 0 does not mean its negative mutants passed verification.

| Extra full-overlay mutant | Verifier exit and decisive output |
| --- | --- |
| Label only on CronJob metadata | 2; `the refresh pod template lacks the label ... that the watchdog selects` |
| Label only on Job-template metadata | 2; same pod-template error |
| Pending deadline 1 / 59 | 2 / 2; `below 60 (the script refuses it)` |
| Pending deadline 60 | 0; nominal watchdog calculation 360 seconds |
| Both refreshes `0 * * * *` | 2; stagger requires minute 0–59, hour list 0–23 and `* * *` |
| Old preprod `50 5,11,17,23 * * *` | 2; parity fails because the minutes differ under the new contract |
| Preprod `30 0,6,12,18 * * *` | 2; overlay parity fails |
| Both minutes changed to 17, retaining their respective hour lists | **0**; closest starts 60 min apart (R2-03) |
| Preprod `0 0,6,12 * * *` | 2; overlay parity fails |
| Preprod `0 0,0,12,18 * * *` | **0**; projection says four passes despite three distinct starts (R2-02) |
| Preprod `0 18,0,12,6 * * *` | 0; correctly accepts reordered hours |
| Preprod day fields `1 * *`, `* 1 *`, or `* * 1` | 2 each; overlay parity fails |
| Preprod timeZone America/Toronto / missing timeZone | 2 / 2; overlay parity fails |
| Preprod hours `0,1,12,18` | 2; temporal contract fails for preprod, gap 3600 s |
| Prod hours `5,6,17,23` | 2; temporal contract fails for prod, gap 3600 s |
| Single-quoted source schedules | 0 after Kustomize normalization |
| Prod watchdog request 11m CPU | 2; overlay parity fails |
| Refresh suspended | 2; refresh activation/model contract fails |
| Watchdog command changed to absent.js | 2; watchdog script contract fails |

Direct stagger cases used the full saved baseline renders, replacing only each refresh schedule:

| Preprod / prod schedules | Direct awk result |
| --- | --- |
| `50 5,11,17,23 * * *` / `0 5,11,17,23 * * *` | exit 0, **50 min** |
| `50 4,5 * * *` / `0 4,5 * * *` | exit 1, **10 min** |
| `0 0 * * *` / `0 23 * * *` | exit 0, **60 min**, midnight wrap |
| `50 23 * * *` / `0 0 * * *` | exit 1, **10 min**, midnight wrap |
| Preprod minute 60 or -1, prod baseline | exit 1, grammar error |
| Preprod hour 24, prod baseline | exit 1, grammar error |
| Both weekday fields 1, otherwise baseline | exit 1, grammar error |
| `20 5,11,17,23 * * *` / `0 5,11,17,23 * * *` | exit 0, equality boundary: 1200 s / 20 min |

Reproduction setup and the decisive full-overlay mutations (run inside Bash from this worktree; each `fixture` creates a fresh throwaway copy):

```bash
SRC="$PWD"
export TMPDIR="$SRC/.review-tmp-astra"
mkdir -p "$TMPDIR"
BASE=deploy/k8s/34-refresh-cronjob.yaml
DOG=deploy/k8s/34-refresh-pending-watchdog.yaml
PRE=deploy/k8s/refresh-cronjobs/kustomization.yaml
fixture() {
  CASE_ROOT="$TMPDIR/$1"
  mkdir -p "$CASE_ROOT/deploy/k8s"
  cp "$SRC/$BASE" "$SRC/$DOG" \
    "$SRC/deploy/k8s/34-refresh-keyring-pvc.yaml" "$CASE_ROOT/deploy/k8s/"
  cp -r "$SRC/deploy/k8s/refresh-cronjobs" \
    "$SRC/deploy/k8s/refresh-cronjobs-prod" "$CASE_ROOT/deploy/k8s/"
}
verify() {
  make --no-print-directory -f "$CASE_ROOT/deploy/k8s/refresh-cronjobs/refresh-018.mk" \
    verify-renders ENV=review-astra-838
}

fixture label-on-cronjob-only
sed -i '/app.kubernetes.io\/instance: radar-refresh-pv/d; /^  labels:$/a\    app.kubernetes.io/instance: radar-refresh-pv' "$CASE_ROOT/$BASE"
verify  # exit 2: pod-template label missing

fixture label-on-job-only
sed -i '/app.kubernetes.io\/instance: radar-refresh-pv/d; /^  jobTemplate:$/a\    metadata:\n      labels:\n        app.kubernetes.io/instance: radar-refresh-pv' "$CASE_ROOT/$BASE"
verify  # exit 2: pod-template label missing

for n in 1 59 60; do
  fixture "deadline-$n"
  sed -i "s/name: REFRESH_PENDING_DEADLINE_SECONDS, value: \"900\"/name: REFRESH_PENDING_DEADLINE_SECONDS, value: \"$n\"/" "$CASE_ROOT/$DOG"
  verify  # exits 2, 2, 0 respectively
done

fixture hourly-refresh
sed -i 's/schedule: "0 5,11,17,23 \* \* \*"/schedule: "0 * * * *"/' "$CASE_ROOT/$BASE"
sed -i 's/value: "0 0,6,12,18 \* \* \*"/value: "0 * * * *"/' "$CASE_ROOT/$PRE"
verify  # exit 2: stagger grammar

fixture duplicate-hours
sed -i 's/value: "0 0,6,12,18 \* \* \*"/value: "0 0,0,12,18 * * *"/' "$CASE_ROOT/$PRE"
verify  # exit 0, despite only three distinct daily starts

fixture both-off-hour
sed -i 's/schedule: "0 5,11,17,23 \* \* \*"/schedule: "17 5,11,17,23 * * *"/' "$CASE_ROOT/$BASE"
sed -i 's/value: "0 0,6,12,18 \* \* \*"/value: "17 0,6,12,18 * * *"/' "$CASE_ROOT/$PRE"
verify  # exit 0, despite both schedules being off the hour
```

The duplicate-hours mutant was additionally rendered and projected. Both it and baseline prod emitted:

```text
radar-refresh-pv spec schedule minute: 0
radar-refresh-pv spec schedule passes per day: 4
radar-refresh-pv spec schedule day fields: * * *
```

An independent distinct-hour count printed `comma entries=4, distinct daily starts=3`. Kubernetes cron hour lists represent matching hours, so repeating `0` does not create another midnight pass. No Kubernetes server validation or live scheduling was performed.

To reproduce ASTRA-838-04's arithmetic check independently of the new minute-parity rule:

```bash
kubectl kustomize --load-restrictor LoadRestrictionsNone deploy/k8s/refresh-cronjobs \
  > "$TMPDIR/preprod.yaml"
kubectl kustomize --load-restrictor LoadRestrictionsNone deploy/k8s/refresh-cronjobs-prod \
  > "$TMPDIR/prod.yaml"
sed 's/  schedule: 0 0,6,12,18 \* \* \*/  schedule: 50 5,11,17,23 * * */' \
  "$TMPDIR/preprod.yaml" > "$TMPDIR/preprod-fifty.yaml"
awk -f deploy/k8s/refresh-cronjobs/refresh-stagger.awk \
  "$TMPDIR/preprod-fifty.yaml" "$TMPDIR/prod.yaml"
# exit 0: closest starts 50 min apart
```

Inventory/reference checks:

```bash
git grep -nE 'kind:[[:space:]]*CronJob|cron:|schedule:' -- deploy .github/workflows
git grep -nE '17 5,11,17,23|05:17|11:17|17:17|23:17|30 5,11,17,23|05:30, 11:30'
git grep -nE 'QUIESCE_CRONJOBS|SKIP_ACTIVE_JOBS_CHECK' -- .github deploy/ci/bascule-preprod
git diff --name-only origin/main...HEAD -- deploy/ci/backup docs/reports docs/architecture/focus docs/reviews/refresh-astra .track
git cat-file -e origin/main:deploy/k8s/34-refresh-pending-watchdog.yaml
```

Results: inventory and 25 reference lines classified above; quiesce defaults at `bascule.mjs:496` and `:569` omit the watchdog and there is no workflow override; excluded-path diff is empty; `git cat-file` exits 128 because the watchdog file is absent from `origin/main`. The G2 finding is demonstrated by the committed control flow and rendered active CronJob, not by an executed bascule or an observed cluster failure.

## Round-1 findings status

| Finding | Status | Reproduction and reason |
| --- | --- | --- |
| ASTRA-838-01, blocking — selector label accepted outside pod template | **Fixed** | The old CronJob-only label mutation now exits 2, as does a Job-template-only label. `refresh-watchdog.awk:66` requires the rendered pod-template metadata/labels path; baseline passes. |
| ASTRA-838-02, blocking — deadline below script floor accepted | **Fixed** | Old deadline 1 mutation exits 2; 59 exits 2; 60 exits 0. The guard at `refresh-watchdog.awk:45` matches the script's 60-second floor. |
| ASTRA-838-03, non-blocking — unsupported cron grammar accepted | **Fixed** | Hourly schedules adapted to common minute 0 fail the complete verifier. Direct negative cases for minute bounds, hour bounds and non-wildcard day fields also fail. `refresh-stagger.awk:45` validates the advertised daily hour-list form. |
| ASTRA-838-04, non-blocking — modulo-hour distance invents a start | **Fixed** | Direct old :50 fixture now reports 50 minutes and passes; genuine cross-hour and midnight ten-minute fixtures fail. The full old :50 overlay now fails minute parity for the correct new-contract reason. `refresh-stagger.awk:63` uses actual daily starts and a 1440-minute wrap. |

## Findings

**ASTRA-838-R2-01 — The new preprod watchdog is not quiesced, so its active Jobs can refuse the bascule restore**

- Severity: **blocking**.
- File:line: `deploy/k8s/refresh-cronjobs/kustomization.yaml:72` (activation of the new CronJob); `deploy/k8s/34-refresh-pending-watchdog.yaml:50` (five-minute schedule). Integration evidence: `deploy/ci/bascule-preprod/bascule.mjs:496`, `:538`, `:541`, `:569`, `:640`; scheduled restore calls G2 at `deploy/ci/bascule-preprod/restore-mode.mjs:414`.
- Evidence: The released preprod render contains active `radar-refresh-pending-watchdog`, with a 180-second Job deadline and 120-second start allowance. Both bascule quiesce lists name only refresh-pv, consistency-snapshot and populate-geo-daily. Draining selects Jobs whose CronJob owner is in that list; watchdog Jobs are neither suspended nor drained. G2 then rejects every Job with finite `status.active > 0` unless it has the `sentropic.io/bascule` label. This watchdog has no such Job label. Consequently, an active watchdog Job remaining from 03:15 when the Sunday bascule reaches G2 is sufficient to produce `Job(s) batch ACTIF(s) ... GARDE G2 ... restore refusé`, even after the standard quiesce completed. Delayed admission or an ordinary Pending Job can realize that state within the manifest's limits; the issue is not limited to that specific minute because the watchdog keeps launching during quiesce. No claim is made that every bascule will fail or that a live failure was observed.
- New versus old: This active scheduled workload did not exist with the pre-PR `17 5,11,17,23` refreshes. It was already in the round-1 target, but this interaction was not identified then. Moving preprod to 00:00/06:00/12:00/18:00 does not resolve it. The existing refresh itself is covered by the bascule's drain logic and is not the reason for this finding.
- Fix: Include `radar-refresh-pending-watchdog` in the common quiesce/G2 targets so existing suspend, drain and state-restoration logic covers it. Keep the active-writer guard intact. Verify with a mocked active watchdog Job that normal quiesce suspends and drains it, G2 then proceeds, and unquiesce restores its former state. If implementing through an override, ensure both target consumers receive it; the committed workflow currently supplies none.

**ASTRA-838-R2-02 — The new pass-count projection counts duplicate hour entries as extra passes**

- Severity: **non-blocking**.
- File:line: `deploy/k8s/refresh-cronjobs/refresh-contract.awk:97`; related accepted grammar at `refresh-stagger.awk:50`.
- Evidence: In a copied overlay, replace only preprod `0 0,6,12,18 * * *` with `0 0,0,12,18 * * *`. Full `verify-renders` exits 0, reporting a 60-minute closest separation. Both projections claim `passes per day: 4`. The mutated schedule matches only midnight, noon and 18:00: three actual passes versus prod's four. The repeated midnight contributes no additional launch. Internal gaps remain large enough for the window guard, so neither temporal check catches the mismatch. This bypass is new with discarding the hour list in favor of its raw entry count. The committed lists contain no duplicates.
- Fix: Reject repeated numeric hours in the supported grammar, or project the number of distinct numeric hours. Normalize before detecting duplicates so equivalent spellings cannot inflate the count. Add a duplicate-hour negative mutation and retain the reordered-hour positive case.

**ASTRA-838-R2-03 — Common nonzero minutes still pass despite the owner's on-the-hour requirement**

- Severity: **non-blocking**.
- File:line: `deploy/k8s/refresh-cronjobs/refresh-stagger.awk:47`; common-minute projection at `refresh-contract.awk:98`; incomplete negative coverage at `verify-renders.test.sh:48`.
- Evidence: In a copied fixture, change prod to `17 5,11,17,23 * * *` and preprod to `17 0,6,12,18 * * *`. Full `verify-renders` exits 0 and reports 60-minute separation. The committed test named “preprod off the hour” proves only that different minutes fail parity; it does not prove that a shared minute must be zero. Both committed schedules are correct, and the same nominal 60-minute stagger remains in this mutant; the missing property is the explicit owner correction that refreshes start on the hour.
- Fix: Add an explicit zero-minute check for the refresh schedules while keeping the allowed hour lists relational. Add a paired-nonzero-minute mutation. This requirement applies to `radar-refresh-pv`, not to the intentionally five-minute watchdog.

## Verdict

**NO-GO** pending ASTRA-838-R2-01: integrate the new preprod watchdog with bascule quiesce/drain before enabling it alongside the scheduled restore workflow. Its active Jobs currently satisfy the existing G2 refusal predicate. This verdict does not assert a live incident; live arming, scheduling and admission are unverified.

All four round-1 findings are fixed; the committed UTC schedules, Toronto conversions, current window references and required offline checks pass. ASTRA-838-R2-02 and ASTRA-838-R2-03 are non-blocking guard gaps with reproduced mutants. Runtime watchdog correctness outside its manifest/guard/documentation contract and the live PR body were not covered by this leg.

Final cleanup: `.review-tmp-astra/` was deleted and its absence checked. Both `git diff --exit-code` and `git diff --cached --exit-code` exited 0; final short status contains only the already-untracked `docs/reviews/pr-838/` directory. Only this leg file was edited outside the deleted throwaway directory. Its YAML header is preserved with `status: completed` and the requested five sections are present.
