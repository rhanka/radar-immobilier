---
status: completed
reviewer-host: codex
reviewer-model: gpt-6-astra
reviewer-effort: xhigh
target-ref: fix/refresh-hours@7fa9e468f87d8dadcc5c7d564e3607deccf66976
round: 1
lens: schedules-references-and-render-guards
---

## Reasoning

Reviewed `git diff origin/main...7fa9e468f87d8dadcc5c7d564e3607deccf66976`, on `fix/refresh-hours`. HEAD was the requested commit and `origin/main` was `641f48c31a89c9d7bc4f1bc06532728c29018cc8`. This is an independent schedules/references/render-guards leg; no other review leg was read. Repository bootstrap, MASTER, workflow, testing, and harness review instructions were read. The explicit offline review restrictions took precedence over the broader implementation workflow.

The committed schedules satisfy the requested hours. The required offline checks exit 0. Guard coverage is **partial**: additional full-overlay mutations demonstrate two watchdog configurations that pass verification but cannot provide the intended protection. Findings ASTRA-838-01 and ASTRA-838-02 concern that new verification contract, not a claim that those mutations are present in the committed manifests.

Both offline renders contain one keyring PVC and these two CronJobs:

| Environment | CronJob | Rendered schedule | timeZone | suspend |
| --- | --- | --- | --- | --- |
| prod | radar-refresh-pv | `0 5,11,17,23 * * *` | Etc/UTC | false |
| preprod | radar-refresh-pv | `30 5,11,17,23 * * *` | Etc/UTC | false |
| prod | radar-refresh-pending-watchdog | `*/5 * * * *` | Etc/UTC | false |
| preprod | radar-refresh-pending-watchdog | `*/5 * * * *` | Etc/UTC | false |

Image pinning covers both CronJobs, including the refresh init container. In `.github/workflows/build-push-images.yml:987`, preprod installs standalone Kustomize 5.4.3, then at line 994 calls `kustomize edit set image ghcr.io/rhanka/radar-api=ghcr.io/rhanka/radar-api:${SHA}` and builds that overlay. Both resources use this image name. An isolated `newTag` substitution followed by offline rendering emitted the requested tag on all three image references. The standalone binary download and `edit` command were **not covered** by execution; their wiring was read, and the image transformation was exercised with `kubectl kustomize`.

For prod, `.github/workflows/build-push-images.yml:1452` invokes `render-prod`; `refresh-018.mk:131` renders the prod overlay and globally substitutes the placeholder with the supplied digest. The executed `verify-renders` invokes this actual recipe with a zero digest. A separate reproduction of that substitution also emitted the digest on all three image references. Prod reads back activation and the main-container image of both CronJobs at workflow lines 1460 and 1468; preprod prints both at line 997, with `|| true`. Live pinning/read-back is **unverified** because no cluster commands were run.

Guard inspection and counterchecks:

- `refresh-contract.awk:49` obtains object names from Kustomize's two-space metadata name. The emitted resource names are unquoted; nested container names do not match this expression. Prefixes correctly distinguish the watchdog's CPU from the refresh CPU: a prod-only watchdog request mutation from 10m to 11m fails parity and identifies `radar-refresh-pending-watchdog spec cpu`.
- Default document order is PVC, watchdog, refresh. Reordering to refresh, watchdog, PVC, with the first CronJob starting at byte zero without a leading `---`, leaves both projections unchanged as multisets and all three direct guards successful. No first-document or object-order defect was reproduced for these Kustomize records.
- Changing source schedules from double to single quotes passes the complete renderer. Kustomize emits the refresh schedule unquoted and the watchdog schedule single-quoted, which the watchdog and stagger guards handle. A direct, manually single-quoted tight-window render exposes **partial** coverage in `refresh-window.awk:39`: it strips only double quotes, so `'0 5,6 * * *'` yields a warning and exit 0, whereas the double-quoted equivalent exits 1. This parsing behavior was already in the base and was not reproduced through Kustomize serialization; it is not a new blocking finding.
- An explicitly suspended refresh and a changed required model each fail the activation/model guard. The `END { if (!pv) exit 1 }` clause at `refresh-018.mk:202` does not erase the earlier `exit 1` on the tested awk implementation. A changed watchdog command also fails its guard. The suspected END exit-code bypass was not reproduced.
- The committed relation is `900 + 300 = 1200 seconds < 30 minutes`, and `1200 < 19800 / 2`. These are configuration calculations, not an observed bound on pod deletion. Watchdog admission, startup, API availability and pod termination are **unverified**. The source documents RBAC/quota prerequisites at `deploy/ci/README.md:349`; it should not be inferred from an awk success message that they hold on either cluster.
- The equality boundary is accepted: preprod minute 20 yields exit 0 with a 1200-second watchdog calculation and a 1200-second separation. Thus line 60 of `refresh-stagger.awk` enforces `deadline + period <= separation`, not strictly “before.” The committed 30-minute separation has a ten-minute margin in this calculation.
- The new stagger guard also accepts hourly refresh schedules that the window guard cannot verify, and calculates an unnecessarily short distance for `:00`/`:50`. These are described separately below.

Scheduled-job inventory, obtained from `git grep` over **all** `deploy/**` and `.github/workflows/**`:

| Job / source | Schedule and relevant limits | Effect of the new refresh hours versus the old hours |
| --- | --- | --- |
| radar-refresh-pv — `deploy/k8s/34-refresh-cronjob.yaml:91`, preprod patch `refresh-cronjobs/kustomization.yaml:67` | Four UTC starts, prod :00 / preprod :30; Job deadline 19800 s; starting deadline 600 s; grace 60 s | Removes identical nominal starts. Normal running passes may still overlap across environments; the change does not claim to serialize their entire execution. |
| radar-refresh-pending-watchdog — `deploy/k8s/34-refresh-pending-watchdog.yaml:46` | Every five minutes UTC in both overlays; deadline 180 s; starting deadline 120 s | New simultaneous starts, including refresh start minutes. This manifest has no keyring PVC and requests 10m CPU / 64Mi. Resource headroom and runtime are unverified. No demonstrated repetition of the two-keyring attach conflict. |
| radar-backup-daily — `deploy/ci/backup/cronjob-backup-daily.yaml:46` | 02:23 UTC; active; deadline 10800 s; starting deadline 3600 s | An on-time Job can last to 05:23: old prod start 05:17 already permitted six minutes of overlap, new 05:00 permits 23 minutes. This widens the possible overlap by 17 minutes; it does not introduce the first possible overlap. A delayed start can extend it further (to 06:23 before termination), under both schedules. The preceding 23:xx refresh can already overlap the 02:23 backup if it uses its 5 h 30 allowance. |
| radar-backup-freshness — `deploy/ci/backup/cronjob-backup-freshness.yaml:30` | 06:53 UTC; active; deadline 300 s | Existing possible overlap with a morning refresh. Old 05:17 + 2 h reached 07:17. New prod can reach 07:00 and preprod 07:30 using the same two-hour assumption. The manifest describes a read-only S3 freshness check; no new conflict demonstrated. |
| radar-consistency-snapshot — `deploy/k8s/35-consistency-snapshot-cronjob.yaml:29` | 04:45 UTC; **suspended**; deadline 900 s; starting deadline 600 s | New potential overlap if later activated: a 04:55 start can run to 05:10, overlapping new prod 05:00 but not old 05:17. Lines 7–11 explicitly acknowledge this. An on-time 05:00 deadline is not proof that termination completes instantaneously. This is not a demonstrated active-job conflict. |
| radar-populate-geo-daily — `deploy/k8s/35b-populate-geo-cronjob.yaml:17` | 04:17 America/Toronto; suspend omitted; deadline 3600 s | 08:17 UTC in EDT / 09:17 UTC in EST. No overlap with the nominal 1 h 30–2 h morning windows; overlap with a refresh using its full deadline was already possible under 05:17 and remains possible. |
| bascule-preprod — `.github/workflows/bascule-preprod.yml:64` | Sunday 03:17 UTC; scheduled execution gated by BASCULE_SCHEDULE_ENABLED at line 124; scheduled timeout 330 min at line 148 | Its possible 08:47 completion already crossed the old morning refresh and crosses the new starts. Live arming and duration are unknown. No new conflict demonstrated. |
| #2b liveness — `.github/workflows/2b-proof-liveness-sweep.yml:22` | Monday 07:00 UTC; hosted GitHub runner | Fetches proof URLs using the versioned manifest. Morning refresh overlap was already possible. No shared keyring or new cluster-job conflict is shown by this workflow. |
| radar-db-backup-prod — `deploy/ci/bascule-preprod/cronjob-db-backup-prod.yaml:19` | Every five minutes; **suspended** by default; deadline 3600 s; starting deadline 600 s; no explicit timeZone | New refresh starts lie on the five-minute grid, but this job is dormant except when the bascule enables it. Even the old :17 refresh could overlap an enabled dump starting at :15. No new active conflict demonstrated. |

These are seven unique CronJob definitions and two scheduled GitHub workflows. Overlay target declarations are patches, not additional scheduled jobs. No claim of conflict-free operation can be made from schedules alone. The reviewed snapshot text accurately records the new conditional overlap. The two stale backup comments are explicitly excluded from this PR, and their “before” wording cannot establish non-overlap with the three-hour maximum in either version.

Window/reference review:

- `docs/spec/SPEC_FIX_GRAPH_CITY_KEY.md:97`, `plan/812-BRANCH_fix-graph-city-key.md:18`, and `deploy/k8s/README.md:303` retain **1 h 30–2 h per pass**, with prod shifted 17 minutes earlier and preprod shifted 13 minutes later. For the morning pass this means prod approximately 05:00–06:30/07:00 and preprod 05:30–07:00/07:30, not a shortened duration or a shared two-hour envelope. The union of the two two-hour windows is 05:00–07:30. This operational assumption is distinct from the unchanged 5 h 30 Job deadline, which `SPEC_EVOL_DOCUMENT_DATES.md:62` still records.
- Toronto conversions in `deploy/ci/README.md:304` and line 305 are arithmetically correct: UTC−4 gives prod 01:00/07:00/13:00/19:00 and preprod 01:30/07:30/13:30/19:30; UTC−5 gives 00:00/06:00/12:00/18:00 and 00:30/06:30/12:30/18:30. At the supplied 2026-11-01 DST transition, 05:00/05:30 UTC still precede the 06:00 UTC clock change; subsequent starts use EST. Neither refresh CronJob changes UTC hours with DST.
- The live PR body was **not covered**; accuracy statements here refer to the supplied PR description and the committed text.

The exact requested reference search returned **25 matching lines**. Every remaining hit is classified below; no unaccounted current schedule reference was found by that search.

| Remaining file:line(s) | Classification and stated reason |
| --- | --- |
| `.track/events.jsonl:36` | Deliberately left: timestamp substring in append-only historical event, not a refresh schedule. |
| `.track/events.jsonl:65,66,67,68,69,70,71,72` | Deliberately left: eight historical event timestamps, not schedule settings. |
| `.track/events.jsonl:886` | Deliberately left: historical event timestamp. |
| `deploy/ci/README.md:308` | Updated current document; old hours deliberately retained in the dated 2026-10-09 incident explanation. Current schedules are at lines 304–305. |
| `deploy/k8s/refresh-cronjobs/refresh-stagger.awk:6` | Deliberately left: dated explanation of the incident's old schedule. |
| `deploy/ci/backup/README.md:57` | Deliberately left, stale current prose: explicit owner exclusion to avoid triggering the bascule bundle CD. |
| `deploy/ci/backup/cronjob-backup-daily.yaml:45` | Deliberately left, stale comment: same explicit exclusion. The actual backup schedule remains 02:23. |
| `docs/architecture/focus/Pairs.svelte:26` | Deliberately left: historical architecture artifact identified in the request. |
| `docs/architecture/focus/portable.mjs:43` | Deliberately left: same historical artifact set. |
| `docs/architecture/focus/presentation-fr.js:10` | Deliberately left: same historical artifact set. |
| `docs/architecture/focus/report-render.mjs:73` | Deliberately left: same historical artifact set. |
| `docs/architecture/focus/scene-metadata.js:313` | Deliberately left: same historical artifact set. |
| `docs/reports/architecture-monthly/architecture-before-after-2026-09-13.html:2` | Deliberately left: dated report; two occurrences on one long line. |
| `docs/reports/architecture-monthly/evidence-manifest-2026-09-13.json:21` | Deliberately left: dated evidence manifest. |
| `docs/reports/assets/2026-09/archi/pipeline-after-20260913.graph.json:267` | Deliberately left: dated report graph. |
| `docs/reports/rapport-mois-2026-08-10_2026-09-13.html:3` | Deliberately left: dated report; two occurrences on one long line. |
| `docs/reports/rapport-mois-2026-08-10_2026-09-13.md:109` | Deliberately left: dated report. |
| `docs/reviews/refresh-astra/production-acceptance.md:70` | Deliberately left: historical review explicitly excluded by the request. |

The excluded paths have no changes in the target diff. `.github/workflows/bascule-bundle-cd.yml:71` includes `deploy/ci/backup/**` in its push path filter, supporting the stated reason for leaving that directory untouched. Updated current references also include `docs/architecture.md:6`, `docs/study/industrialisation-refresh-suivi.md:89`, `SPEC_EVOL_DOCUMENT_DATES.md:62,67`, the base/overlay comments, and the CD comments.

## Commands and outputs

All execution was offline. `TMPDIR` was set to `$PWD/.review-tmp-astra` for test-created temporary files. No Python, cluster/bucket access, commit, push, or GitHub write was used. The only review artifact written outside that throwaway directory is this leg.

```text
$ git branch --show-current
fix/refresh-hours
$ git rev-parse HEAD origin/main
7fa9e468f87d8dadcc5c7d564e3607deccf66976
641f48c31a89c9d7bc4f1bc06532728c29018cc8
$ git diff --stat origin/main...7fa9e468f87d8dadcc5c7d564e3607deccf66976
26 files changed, 954 insertions(+), 53 deletions(-)
```

```bash
kubectl kustomize --load-restrictor LoadRestrictionsNone deploy/k8s/refresh-cronjobs > .review-tmp-astra/preprod.yaml
kubectl kustomize --load-restrictor LoadRestrictionsNone deploy/k8s/refresh-cronjobs-prod > .review-tmp-astra/prod.yaml
```

Both commands exited 0. Relevant output locations in each rendered file: watchdog name line 24, schedule line 81, `suspend: false` line 84, `timeZone: Etc/UTC` line 85; refresh name line 94, schedule line 307, `suspend: false` line 310, `timeZone: Etc/UTC` line 311. Schedules are the four values in the first table. Image references occur at lines 54, 228 and 263.

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

```text
$ make -f deploy/k8s/refresh-cronjobs/refresh-018.mk verify-renders ENV=review-astra-838
refresh-watchdog: ok — a refresh pod Pending 900 s is deleted within 1200 s (watchdog every 300 s); refresh Job deadline 19800 s
refresh-window: ok — balayage 18900 s < job 19800 s (marge 900 s, grâce 60 s) < créneau 21600 s
refresh-watchdog: ok — a refresh pod Pending 900 s is deleted within 1200 s (watchdog every 300 s); refresh Job deadline 19800 s
refresh-window: ok — balayage 18900 s < job 19800 s (marge 900 s, grâce 60 s) < créneau 21600 s
refresh-stagger: ok — prod minute 0, preprod minute 30 (30 min apart, hours 5,11,17,23); a stalled pod is removed within 1200 s
exit=0
```

```text
$ bash deploy/k8s/refresh-cronjobs/verify-renders.test.sh
ok: released overlays pass
ok: preprod and prod on the same minute
ok: preprod only 10 minutes after prod
ok: preprod 10 minutes before the next prod start (cyclic)
ok: preprod hours diverge from prod
ok: another minute far enough away passes (relational, not pinned)
ok: 15 minutes apart, but a stalled pod outlives the gap
ok: prod render without the watchdog
ok: preprod watchdog left suspended
ok: refresh pod without the watchdog selector label
ok: watchdog selecting another label
ok: watchdog without its pending deadline
ok: watchdog deadline not shorter than the slot stagger
ok: refresh Job retrying a deleted pod
verify-renders tests: 14 passed, 0 failed
exit=0
```

Additional mutations were executed by `bash .review-tmp-astra/extra-tests.sh` and `bash .review-tmp-astra/boundary-tests.sh`, using separate copies of the same three base resources and two overlay directories as the supplied test. The scripts completed with exit 0 and captured the individual verification exit codes below. These script exit codes are not a claim that each mutated configuration passed.

Reproduction recipe for the four findings (inside `bash`; initialize the throwaway directory first). This is the copy/verify recipe used; each `fixture` creates a fresh case:

```bash
SRC="$PWD"
export TMPDIR="$SRC/.review-tmp-astra"
BASE=deploy/k8s/34-refresh-cronjob.yaml
DOG=deploy/k8s/34-refresh-pending-watchdog.yaml
PRE=deploy/k8s/refresh-cronjobs/kustomization.yaml
fixture() {
  CASE_ROOT="$TMPDIR/$1"
  mkdir -p "$CASE_ROOT/deploy/k8s"
  cp "$SRC/deploy/k8s/34-refresh-cronjob.yaml" \
     "$SRC/deploy/k8s/34-refresh-keyring-pvc.yaml" \
     "$SRC/deploy/k8s/34-refresh-pending-watchdog.yaml" "$CASE_ROOT/deploy/k8s/"
  cp -r "$SRC/deploy/k8s/refresh-cronjobs" \
        "$SRC/deploy/k8s/refresh-cronjobs-prod" "$CASE_ROOT/deploy/k8s/"
}
verify() {
  make -f "$CASE_ROOT/deploy/k8s/refresh-cronjobs/refresh-018.mk" \
    verify-renders ENV=review-astra-838
}
fixture label-on-cronjob-only
sed -i '/app.kubernetes.io\/instance: radar-refresh-pv/d; /^  labels:$/a\    app.kubernetes.io/instance: radar-refresh-pv' "$CASE_ROOT/$BASE"
verify
fixture watchdog-deadline-one-second
sed -i 's/name: REFRESH_PENDING_DEADLINE_SECONDS, value: "900"/name: REFRESH_PENDING_DEADLINE_SECONDS, value: "1"/' "$CASE_ROOT/$DOG"
verify
fixture hourly-refresh
sed -i 's/0 5,11,17,23 \* \* \*/0 * * * */' "$CASE_ROOT/$BASE"
sed -i 's/30 5,11,17,23 \* \* \*/30 * * * */' "$CASE_ROOT/$PRE"
verify
fixture minute-fifty
sed -i 's/value: "30 5,11,17,23/value: "50 5,11,17,23/' "$CASE_ROOT/$PRE"
verify
```

| Extra case | Observed output/result |
| --- | --- |
| Label on CronJob only | `verify exit=0`; watchdog reports `Pending 900 s is deleted within 1200 s`. Offline rendering shows the only instance label at line 92, under CronJob metadata; pod-template labels at lines 107–110 have no instance label. |
| Watchdog deadline `1` | `verify exit=0`; `refresh-watchdog: ok — a refresh pod Pending 1 s is deleted within 301 s`; stagger also exits 0. |
| Hourly refreshes | `verify exit=0`; window says `écart entre créneaux NON vérifié` for both `30 * * * *` and `0 * * * *`; stagger says `ok … (30 min apart, hours *)`. |
| Preprod minute 50 | `verify exit=2`; `preprod minute 50 and prod minute 0 are 10 min apart, below 15 min`; also reports the other environment starts `600 s later`. |
| Preprod minute 20 | `verify exit=0`; watchdog bound calculation `1200 s`, stagger `20 min apart`. |
| Refresh suspended | `verify exit=2`; `refresh activation/model contract failed`. |
| Required model changed to other-model | `verify exit=2`; `refresh activation/model contract failed`. |
| Prod-only watchdog CPU request 11m | `verify exit=2`; parity diff changes `radar-refresh-pending-watchdog spec cpu: 10m` to `11m`. |
| Watchdog script changed to absent.js | `verify exit=2`; `the watchdog must run node dist/scripts/refresh-pending-watchdog.js`. |
| Single-quoted source schedules | `verify exit=0` after Kustomize normalization. |
| Refresh first, watchdog second, PVC last | Both watchdog and window guards exit 0; each contract multiset difference is 0; stagger exits 0. |
| Direct single-quoted `'0 5,6 * * *'` render | Window exits 0 with `NON vérifié`. |
| Direct double-quoted `"0 5,6 * * *"` render | Window exits 1 with `écart 3600 s` and deadline-plus-grace overflow. Its following `ok` line does not change that exit status. |

The :50 distance was independently calculated across all starts in a 1440-minute day:

```bash
awk 'BEGIN {split("5 11 17 23",h," "); best=1440;
  for(i=1;i<=4;i++) for(j=1;j<=4;j++) {
    d=h[i]*60+50-h[j]*60; if(d<0)d=-d;
    if(1440-d<d)d=1440-d; if(d<best)best=d
  }
  print "minimum actual cross-environment distance for :00/:50 on 5,11,17,23 = " best " minutes"
}'
```

Output: `minimum actual cross-environment distance for :00/:50 on 5,11,17,23 = 50 minutes`.

Reference/inventory commands:

```bash
git grep -nE 'kind: CronJob|^[[:space:]]+schedule:|^[[:space:]]+- cron:' -- 'deploy/**/*.yaml' '.github/workflows/*.yml'
git grep -nE 'kind:[[:space:]]*CronJob|cron:|schedule:' -- deploy .github/workflows
git grep -nE '17 5,11,17,23|05:17|11:17|17:17|23:17'
git diff --name-only origin/main...7fa9e468f87d8dadcc5c7d564e3607deccf66976 -- deploy/ci/backup docs/reports docs/architecture/focus docs/reviews/refresh-astra .track
```

The first two yield the inventory above; the reference search yields the 25 classified lines; the last command has no output. Long report HTML lines were reduced to their matching text for inspection, without reading another leg. Tracked-file and staged diffs were empty before writing this originally untracked leg.

## Findings

**ASTRA-838-01 — The pod-selector guard accepts a label on the CronJob instead of its pod template**

- Severity: **blocking**.
- File:line: `deploy/k8s/refresh-cronjobs/refresh-watchdog.awk:60`.
- Evidence: The regex searches the whole CronJob document at any indentation. Moving `app.kubernetes.io/instance: radar-refresh-pv` from `spec.jobTemplate.spec.template.metadata.labels` to `metadata.labels` makes the complete `verify-renders` exit 0. The independently rendered mutant has exactly one such label, on the CronJob. The watchdog lists **pods** with that selector (`api/src/scripts/refresh-pending-watchdog.ts:120,169`); CronJob metadata labels do not label those pods. Thus the newly claimed selector-to-pod coupling is not enforced. The committed pod label is in the correct place; this finding is the demonstrated guard bypass.
- Fix: Scope the match to `spec.jobTemplate.spec.template.metadata.labels` in the refresh CronJob (using the known rendered indentation or explicit section tracking). Add a negative mutation that moves the label to CronJob metadata, and ideally another at Job-template metadata. Require verification to fail for these cases while the current render passes.

**ASTRA-838-02 — Verification accepts deadlines that the watchdog rejects before doing any work**

- Severity: **blocking**.
- File:line: `deploy/k8s/refresh-cronjobs/refresh-watchdog.awk:43`; runtime contract at `api/src/scripts/refresh-pending-watchdog.ts:64`.
- Evidence: Replacing the base watchdog deadline `"900"` with `"1"` leaves both overlay renders valid and makes the complete verifier exit 0, claiming deletion within 301 seconds. Runtime configuration explicitly throws unless the integer is at least 60, and `main` reads configuration before calling the API (`refresh-pending-watchdog.ts:187`). Every such watchdog run would terminate before listing pods. The new guard enforces only numeric syntax, and stagger checks only positivity. The committed value 900 is not affected.
- Fix: Match the runtime minimum (`deadline >= 60`) in the render guard and add tests for 1/59 rejected and 60 accepted when the other timing relations hold. Keep the deadline tunable; this requires no pinning to 900.

**ASTRA-838-03 — The new schedule-shape guard admits a form for which slot timing is not checked**

- Severity: **non-blocking**.
- File:line: `deploy/k8s/refresh-cronjobs/refresh-stagger.awk:48`.
- Evidence: Changing both refreshes to hourly `0 * * * *` / `30 * * * *` produces `verify exit=0`; the stagger message reports `ok … hours *`. The 19800-second Job deadline plus 60-second grace exceeds the actual 3600-second slot. `refresh-window.awk:63` explicitly warns that this form is unverified, but does not fail. The new stagger message says schedules must use an hour list, while its condition validates only field count and numeric minutes. The window guard's partial behavior predates this PR, so this is not presented as a newly introduced hourly production configuration or a regression of that existing fallback.
- Fix: Enforce the advertised supported grammar and ranges in the new stagger parser (minute 0–59, hour list 0–23, remaining fields `*`) or implement timing for additional cron forms. Add an hourly mutation that cannot pass while the Job allowance is 5 h 30.

**ASTRA-838-04 — The cyclic minute test invents a prod start in an unscheduled hour**

- Severity: **non-blocking**.
- File:line: `deploy/k8s/refresh-cronjobs/refresh-stagger.awk:54`; assertion at `deploy/k8s/refresh-cronjobs/verify-renders.test.sh:48`.
- Evidence: With hours `5,11,17,23`, prod `:00` and preprod `:50`, the complete verifier exits 2 and says the starts are 10 minutes apart. The actual cyclic day has gaps of 50 minutes (prod to preprod) and 310 minutes (preprod to the next prod). The independent full-day calculation yields a minimum of 50. There is no 06:00 prod start after 05:50 preprod. The supplied test's “10 minutes before the next prod start” description is therefore false for its own fixture. The committed :00/:30 pair is accepted, so this does not alter the requested schedule.
- Fix: Compute the minimum cross-environment distance over the actual daily starts, wrapping at 1440 minutes, and use that distance for the watchdog relation. Alternatively, explicitly document this as a deliberately stronger modulo-hour policy and remove the false statement about the next scheduled prod start. For a genuine ten-minute cross-hour negative test, use adjacent scheduled hours and valid shorter within-environment deadlines, or test the stagger awk directly.

## Verdict

**NO-GO** for the new guard contract: resolve ASTRA-838-01 and ASTRA-838-02 and add their negative mutations. The committed hours, UTC conversions, rendering, image-transform wiring, and required baseline checks satisfy the reviewed offline checks; the rejection is based on the two reproduced false-positive watchdog guards. ASTRA-838-03 and ASTRA-838-04 are non-blocking. Live scheduling, admission, RBAC, deletion timing, and the GitHub PR body remain unverified.

Final cleanup: `.review-tmp-astra/` was deleted. `git diff --exit-code` and `git diff --cached --exit-code` both exited 0; final short status contained only the already-untracked `docs/reviews/pr-838/` directory. The completed header and all four required sections were checked.
