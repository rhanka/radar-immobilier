---
status: completed
reviewer-host: codex
reviewer-model: gpt-6.1-sol
reviewer-effort: xhigh
target-ref: ops/bascule-restore-daily@c16289ad83f4519f4b54c53ba55080a589145a21
round: 1
---

## Reasoning

Independent leg for PR #841, lens **test guard soundness, references and documentation accuracy**. Reviewed `git diff origin/main...c16289ad83f4519f4b54c53ba55080a589145a21`; HEAD is exactly that commit and `origin/main` is `ab7f4e70e9b05b6637cb1eb4a6769923cfb169e6`. No other PR #841 reviewer leg was read. Read `rules/MASTER.md`, `rules/workflow.md`, `rules/testing.md`, RTK instructions and the harness review instructions. The explicit command allowlist and independent-leg scope govern this review; no additional reviewers, harness/Track writes, commits or remote actions were performed.

The operational change is the requested daily `0 4 * * *` schedule. **04:00 UTC remains the owner's decision.** The baseline renders agree with the documented backup and refresh schedules: backup 02:23 UTC, prod refresh 05:00/11:00/17:00/23:00 UTC, preprod refresh 00:00/06:00/12:00/18:00 UTC. The new test computes a 97-minute backup-to-restore gap and a 60-minute restore-to-next-refresh gap. No current rendered schedule conflict was demonstrated.

The new regression guard is **partial**: it checks the first matching source strings, not necessarily the named workload's final configuration. A rendered prod refresh at 04:00 can pass both the new bascule selftest and the existing refresh render verification. That is the blocking finding. It does not establish a live failure at the current schedule.

### Guard analysis and CI wiring

- `.github/workflows/ci.yml:1` runs CI for PRs and pushes to main. Its quality job runs refresh render verification at `:37`, its mutation suite at `:40`, and both bascule selftests at `:56` and `:57`, before workspace dependency installation at `:60`.
- The owner cadence assertion at `bascule.selftest.mjs:200` rejects weekday-only `0 4 * * 1-5`, 03:00, 05:00 and 04:30. A commented-out sole cron is rejected; a commented-out extra cron is ignored correctly.
- The workflow extractor at `:199` recognizes only single-quoted `- cron:` entries. An additional double-quoted or unquoted 05:00 cron is ignored, while the parsed workflow contains two active schedules. Changing the only valid 04:00 cron to double quotes or no quotes is rejected. This extractor already exists in the base revision; the updated assertion still claims to enforce a single daily cron.
- Backup and base-refresh extraction at `:208` and `:209` select the first double-quoted `schedule:` anywhere in each file. Prepending another valid CronJob with a safe schedule hides the named workload's changed schedule. Preprod extraction at `:210` selects the first schedule patch without checking its target or applying later patches.
- The prod overlay currently **does not patch the schedule**: it inherits the base (`refresh-cronjobs-prod/kustomization.yaml:84` onward). The new guard never reads that overlay, so adding a schedule patch defeats the guard. A paired mutation (prod 04:00/10:00/16:00/22:00, preprod 05:00/11:00/17:00/23:00) preserves the existing refresh parity, watchdog and one-hour stagger contracts while colliding with the 04:00 restore.
- Changing the backup `timeZone` to `America/Toronto` is accepted by the new guard although its UTC arithmetic then no longer describes the backup slot. Time zones are not read. The released backup and both refresh renders currently use `Etc/UTC`.
- Single-quoted backup/preprod schedules and a comment between the preprod patch's `path` and `value` are valid inputs but rejected. The preprod quoting/comment mutants render successfully with unchanged schedules.

### Reference audit

Ran the exact requested cadence search. It returned 95 matching tracked lines; long generated HTML/JSON lines were subsequently inspected by extracting context around the matched words. Every hit concerning the bascule cadence is classified below.

| Cadence-search hit | Classification |
| --- | --- |
| `.github/workflows/bascule-preprod.yml:57` | Updated current daily schedule; old Sunday 03:17 is explicitly dated 2026-09-26 to 2026-10-10. |
| `deploy/ci/bascule-preprod/README.md:15` | Updated daily cadence; dated former weekly cadence retained deliberately. |
| `deploy/ci/bascule-preprod/CD_NATIVE_MIGRATION.md:92` | Updated daily cadence; dated former weekly cadence retained deliberately. |
| `deploy/ci/bascule-preprod/bascule.selftest.mjs:196` | Updated daily assertion; dated former weekly cadence retained deliberately. |
| `docs/reviews/pr-838/leg-astra.md:62` | Deliberately retained historical review of the prior schedule. |
| `docs/reviews/pr-838/round1-leg-astra.md:50` | Deliberately retained historical review. |
| `docs/reviews/pr-838/round1-prompt-astra.md:10` | Deliberately retained historical review prompt. Its populate-geo time is for a different job. |
| `docs/reviews/pr-838/round2-leg-astra.md:49` | Deliberately retained historical review. |
| `docs/reviews/pr-838/round2-leg-astra.md:290` | Deliberately retained historical finding describing the then-Sunday bascule. |
| `docs/reviews/pr-838/round2-prompt-astra.md:8` | Deliberately retained historical review prompt. |
| `deploy/ci/bascule-preprod/restore-mode.selftest.mjs:431` and `:432` | Deliberately unchanged timestamp fixture for failure-summary rendering, not a schedule assertion. |

Other hits are unrelated to the bascule cadence:

- `.remote/REFRESH_PROD_CRON_SUMMARY.md:6`; `docs/architecture.md:429`, `:503`, `:604`; `docs/architecture/focus/scene-metadata.js:33`, `:157`; `docs/architecture/storage-audit.md:45`; `docs/spec/SPEC_EVOL_ARCHITECTURE_TWO_TRANSITIONS.md:30`; `docs/spec/SPEC_EVOL_REFRESH_018.md:29`; the dated architecture HTML at `docs/reports/architecture-monthly/architecture-before-after-2026-09-13.html:2`; and the three dated architecture graph JSON files at `:520`, `:489`, `:546` describe the unrelated former radar-refresh-scrape/projection jobs.
- `.track/events.jsonl:163` is an event timestamp; `:885` concerns radar-refresh-scrape; `:914` and `:915` concern backup retention. None asserts the bascule cadence.
- Backup README/RETENTION/code/selftests and `plan/BACKUP-BRANCH_feat-prod-daily-backup.md:5` concern weekly backup retention. Benchmark reports, decision-review availability, `plan/ARCH-BRANCH_docs-architecture-platform.md:87` and `docs/reviews/refresh-astra/production-acceptance.md:85` concern model-account weekly quotas. The remaining API/UI/domain/source hits describe data-source cadence; WP6 files describe weekly retrospectives.

Ran `git grep -n BASCULE_SCHEDULE_ENABLED`. Every operational hit is accounted for:

| Hit | Classification |
| --- | --- |
| workflow `:68` | Unchanged arming-variable explanation, shifted by added comments. |
| workflow `:130`, `:134` | Unchanged job arming explanation and executable condition. |
| CD_NATIVE_MIGRATION `:36` | Deliberately unchanged one-time arming command. |
| CD_NATIVE_MIGRATION `:53`, `:90` | Updated daily box and variable description. |
| README `:16` | Updated daily summary retaining the unchanged gate. |
| README `:305` | Deliberately unchanged restore-mode arming description. |
| bascule.selftest `:230`, `:231` | Deliberately unchanged assertion of the executable gate. |
| restore-mode.selftest `:499` | Deliberately unchanged assertion of the executable gate. |
| deploy/k8s/README `:307` | Added daily-restore description. |
| docs/reviews/pr-838/round1-leg-astra `:50`, round2-leg-astra `:49` | Deliberately retained historical reviews. |

Searches under `docs/spec/**`, `docs/architecture/**` and `docs/architecture.md` found no bascule-preprod/iso-prod cadence statement requiring an update. Architecture describes a controlled DB snapshot/restore operation (`docs/architecture.md:688`, `:698`) and historical snapshot-restore bindings (`:586`, `:600`), without setting this workflow's cadence. Other “bascule” references concern UI, model, storage or release transitions. **No missed current bascule weekly-cadence reference was demonstrated.**

### Documentation accuracy

| New claim | Code/evidence assessment |
| --- | --- |
| Daily 04:00 UTC, on the hour | Workflow `:74`; YAML parse gives exactly `[{"cron":"0 4 * * *"}]`. |
| Scheduled MODE=restore, latest complete, auto-CONFIRM, unchanged arming | Workflow `:134`, `:185` to `:187`, `:255` to `:256`; `backup-restore.cjs:119` onward. Semantically unchanged outside schedule. |
| Midnight preprod refresh Job is deleted during quiesce | `bascule.mjs:644` to `:651` select active Jobs by a CronJob owner in the present quiesce list and request deletion. Suspension is at `:627`; the workflow list at `:230` includes refresh-pv and watchdog. Deletion is attempted with `allowFail`; G2 remains the refusal barrier if drain fails. |
| Original CronJob suspend values are restored | Recorded at `bascule.mjs:618` to `:622`, reapplied at `:720` to `:722`; workflow un-quiesce at `:541` onward is an `always()` recovery step. Patches are best-effort; live success is unverified. |
| Active watchdog would trip G2 | G2 examines active non-bascule Jobs (`bascule.mjs:520` to `:550`); the watchdog is in the workflow's quiesce/drain list. |
| Preprod refresh hours/deadline and watchdog cadence | Released render: `0 0,6,12,18 * * *`, watchdog `*/5 * * * *`; base Job deadline 19800 s = 5 h 30 (`34-refresh-cronjob.yaml:110`). Observed 1 h 30 to 4 h duration is coordinator-provided, unverified offline. |
| Backup 02:23 UTC, age reference dump start | `cronjob-backup-daily.yaml:46` and `:47`; `backup-restore.cjs:151` onward. Nominal age at 04:00 is 97 min = 1.6 h; yesterday's normal 02:23 point is 25.6 h. Observed 7–45 min duration is coordinator-provided, unverified offline. The claim that any missing/late current backup must be refused is incorrect: SOL-841-03. |
| Prod refresh is not quiesced; starts 05/11/17/23 UTC | Released prod render and workflow preprod namespace at `:224`. No prod refresh target is in the preprod quiesce. Observed restore duration 18–50 min is coordinator-provided, unverified offline. The one-hour launch-delay assurance is incorrect: SOL-841-04. |
| Independent IdP sync 04:40, “CPU only” | Sentropic-side schedule and workload behavior are **unverified** in this offline checkout. The supplied context establishes an independent sync, but not its resource profile. No failure or resource conflict is asserted from this statement. |
| Workflow timeout 330 min; runner waits ~260 min | Workflow `:158`; defaults total `10 + 5 + 20 + 30 + 15 + 125 + 15 + 15 + 10 + 15 = 260` min. Sources: restore-mode `:353`, `:428`, `:455`, `:497`; bascule `:629`, `:818`, `:918`, `:710`; e2e-refs `:88`. Served-refs is optional. This is an upper budget for waits, not a measured restore duration. |
| Missed preprod 06:00 pass and next 12:00 pass | `startingDeadlineSeconds: 600` at `34-refresh-cronjob.yaml:95` and the next declared start at 12:00 agree. The wording “past 06:00 (or 06:10)” is imprecise: resuming within the 600-second allowance may permit catch-up; suspension beyond that allowance loses the 06:00 opportunity. Actual un-quiesce/controller timing is unverified. |
| Slot is bound relationally by the test | **Partial**: arithmetic works for the current source strings, but actual rendered configurations are not covered in the demonstrated cases (SOL-841-01). |

The CD_NATIVE_MIGRATION daily table, box label, variable description and eliminated-manual-dispatch item consistently use `0 4 * * *`. ASCII alignment is **partial but unchanged by this PR**: old and new line `:53` both contain 81 Unicode code points, as do interior lines `:54`–`:56`; the unchanged bottom border `:57` contains 80. The daily label replacement did not introduce or worsen that retained one-column border discrepancy. No new alignment finding.

### Merge side effects and preserved behavior

Three changed files under `deploy/ci/bascule-preprod/**` match `.github/workflows/bascule-bundle-cd.yml:72`; this is sufficient for the merge push to main to trigger that workflow, even though no bundle manifest is changed.

- `apply-bundle` runs only if `BASCULE_BUNDLE_CD_ENABLED == 'true'` (`:113`). It reapplies both SealedSecrets, deletes/recreates the strict RO-role provisioning Job, applies the dormant dump CronJob, reapplies VAP/RBAC and runs the admission gate. Live variable state is unknown.
- The independent `apply-backup` job also runs if both `BASCULE_BUNDLE_CD_ENABLED` and `BACKUP_DAILY_CD_ENABLED` are true (`:325`). It rewrites pre-created backup Secrets, reapplies the backup script ConfigMap and daily/freshness CronJobs. It does not require backup files themselves to have changed. A merge push does **not** satisfy the manual `backup_run_now` condition at `:529`.
- Main CI also runs. This merge does not immediately dispatch a restore. Scheduled execution remains gated by BASCULE_SCHEDULE_ENABLED, supplied as currently false by the coordinator and unverified offline; the coordinator's later arming is outside the diff.
- **PR body disclosure: unverified.** No PR body artifact is available in this review worktree; the available leg directory contained only this leg and its prompt. No `gh` or remote query was performed, so absence of disclosure cannot be claimed.
- Parsing both workflow revisions as YAML and removing only `on.schedule` produces byte-identical JSON representations of the remaining configuration. Thus BASCULE_SCHEDULE_ENABLED handling, MODE, BACKUP_ID, ALLOW_STALE_BACKUP, the configurable default-24-hour freshness setting, inputs, job conditions and timeouts are unchanged. The implementation files implementing the age guard and restore modes are absent from the five-file target diff.

## Commands and outputs

All commands were offline. Existing selftests ran as allowed by the review request. `TMPDIR` was set to the absolute repository-local `.review-tmp-sol/` so their artifacts remained in the permitted temporary directory. Original validation files were not edited.

| Command | Exit and relevant output |
| --- | --- |
| `git rev-parse HEAD origin/main` | 0: `c16289ad83f4519f4b54c53ba55080a589145a21`; `ab7f4e70e9b05b6637cb1eb4a6769923cfb169e6` |
| `git diff --stat origin/main...c16289ad83f4519f4b54c53ba55080a589145a21` | 0: 5 files changed, 78 insertions, 14 deletions |
| `node deploy/ci/bascule-preprod/bascule.selftest.mjs` | 0: `bascule.selftest — 61 passés, 0 échoués`; backup gap 97 min, next-refresh gap 60 min |
| `node deploy/ci/bascule-preprod/restore-mode.selftest.mjs`, first local-TMPDIR run | 1: `restore-mode.selftest — 236 passed, 1 failed`; sole failure `node -e — main triggered, exit 1 without the SDK, verdict written (got [2,false,false])` |
| Same restore command with its no-SDK fixture isolated as described below | 0: `restore-mode.selftest — 237 passed, 0 failed` |
| `make k8s-validate ENV=review-sol-841` | 0: offline Kustomize render and structure pass; document-date recovery renders pass; `image entrypoint check: ok (25 reference(s) in 94 file(s), 18 entrypoint(s))`; offline render ok |
| `make -f deploy/k8s/refresh-cronjobs/refresh-018.mk verify-renders ENV=review-sol-841` | 0: refresh window 18900 < 19800 < 21600 s; `refresh-stagger: ok — prod "0 5,11,17,23 * * *", preprod "0 0,6,12,18 * * *": closest starts 60 min apart; nominal watchdog deletion request by 1200 s` |
| `bash deploy/k8s/refresh-cronjobs/verify-renders.test.sh` | 0: `verify-renders tests: 28 passed, 0 failed` |
| `git grep -nE <cadence pattern>` (exact pattern below) | 0: 95 matching tracked lines; classifications above |
| `git grep -n BASCULE_SCHEDULE_ENABLED` | 0: operational and historical locations classified above |
| Broad/targeted `git grep` under docs/spec and docs/architecture | No current bascule cadence statement found; contextual results described above |
| `node .review-tmp-sol/mutations.mjs` | 0: 29 isolated cases; expected/observed table below |
| `kubectl kustomize --load-restrictor LoadRestrictionsNone <copied-overlay>` | 0 for every rendered mutation; schedules extracted by CronJob kind/name from YAML |
| Paired-mutant `make -f deploy/k8s/refresh-cronjobs/refresh-018.mk verify-renders ENV=review-sol-841`, run from copied fixture | 0: `refresh-stagger: ok — prod "0 4,10,16,22 * * *", preprod "0 5,11,17,23 * * *": closest starts 60 min apart; nominal watchdog deletion request by 1200 s` |
| `node .review-tmp-sol/evidence.mjs` | 0: remaining workflow configuration unchanged = true; ASCII counts and nominal timing calculations described above |
| `node .review-tmp-sol/manifest-age.mjs` | 0: previous-day complete manifest passes chooseDate/checkManifest and freshness, output below |
| `git diff --name-only` | 0, empty: no tracked files modified |

The exact reference search was `git grep -nE '17 3 \* \* 0|03:17|weekly|hebdomadaire|dimanche|Sunday'`; its raw output was retained during review, including generated long lines, then classified using short contexts without dropping bascule hits.

**Restore fixture diagnosis.** The existing assertion at `restore-mode.selftest.mjs:445` intentionally runs the embedded script with no configuration from a temporary cwd and expects the SDK to be unavailable. With TMPDIR under this repository, Node instead resolves the ancestor `/home/antoinefa/src/radar-immobilier/node_modules/@aws-sdk/client-s3/dist-cjs/index.js`. Reproducing that child invocation yielded exit 2 and `{"ok":false,"step":"resolve","exit":2,"reason":"missing S3_ENDPOINT"}`. To reproduce the intended no-SDK environment while keeping all writes inside the permitted directory, a throwaway `.review-tmp-sol/node_modules/@aws-sdk/client-s3/index.cjs` threw a MODULE_NOT_FOUND error on require. No selftest, runtime source or tracked dependency was changed. The rerun then passed all 237 assertions. Remote CI status is unverified; the initial local result remains recorded.

An initial paired-mutant Make invocation used a nonexistent nested TMPDIR and stopped at `mktemp` before checking renders. The corrected invocation used the existing fixture-parent TMPDIR and produced the successful output above; the setup failure is not counted as a guard verdict.

The mutation driver copied the bascule implementation/templates, backup CronJob, refresh bases/PVC/watchdog, both overlays and the two relevant workflows under `.review-tmp-sol/`, mutated only those copies, and ran the **complete existing bascule selftest** for each case. It parsed workflow YAML to count actual schedules and used offline Kustomize renders to identify the final named CronJobs. “Expected fail” means the altered configuration violates a declared guard invariant, not that a live incident was observed.

| Mutation | Expected | Observed | Assessment |
| --- | --- | --- | --- |
| `baseline` | pass | pass, exit 0 | as expected |
| `workflow-0_4_star_star_1-5` | fail | fail, exit 1 | as expected |
| `workflow-0_3_star_star_star` | fail | fail, exit 1 | as expected |
| `workflow-0_5_star_star_star` | fail | fail, exit 1 | as expected |
| `workflow-30_4_star_star_star` | fail | fail, exit 1 | as expected |
| `workflow-double-quoted-valid` | pass | fail, exit 1 | valid form rejected |
| `workflow-unquoted-valid` | pass | fail, exit 1 | valid form rejected |
| `workflow-comment-only` | fail | fail, exit 1 | as expected |
| `workflow-extra-single-quoted` | fail | fail, exit 1 | as expected |
| `workflow-extra-double-quoted` | fail | pass, exit 0 | not covered |
| `workflow-extra-unquoted` | fail | pass, exit 0 | not covered |
| `workflow-commented-extra` | pass | pass, exit 0 | as expected |
| `backup-late` | fail | fail, exit 1 | as expected |
| `backup-earlier` | pass | pass, exit 0 | as expected |
| `backup-weekdays` | fail | fail, exit 1 | as expected |
| `backup-single-quoted-valid` | pass | fail, exit 1 | valid form rejected |
| `backup-first-unrelated-cronjob` | fail | pass, exit 0 | not covered |
| `backup-wrong-timezone` | fail | pass, exit 0 | not covered |
| `base-first-unrelated-cronjob` | fail | pass, exit 0 | not covered |
| `preprod-conflict` | fail | fail, exit 1 | as expected |
| `preprod-30-min-gap` | fail | fail, exit 1 | as expected |
| `preprod-new-valid` | pass | pass, exit 0 | as expected |
| `preprod-weekdays` | fail | fail, exit 1 | as expected |
| `preprod-single-quoted-valid` | pass | fail, exit 1 | valid form rejected |
| `preprod-comment-between-path-value-valid` | pass | fail, exit 1 | valid form rejected |
| `preprod-later-patch-overrides` | fail | pass, exit 0 | not covered |
| `preprod-first-patch-targets-watchdog` | fail | pass, exit 0 | not covered |
| `prod-overlay-adds-conflicting-schedule` | fail | pass, exit 0 | not covered |
| `both-overlay-schedules-violate-bascule-only` | fail | pass, exit 0 | not covered |

Decisive paired-mutant patch added to the prod refresh target (alongside its existing suspend patch):

```yaml
      - op: replace
        path: /spec/schedule
        value: "0 4,10,16,22 * * *"
```

The preprod refresh patch value became `"0 5,11,17,23 * * *"`. Output from the complete selftest and the final rendered objects:

```text
bascule.selftest — 61 passés, 0 échoués
prod radar-refresh-pv:    schedule: 0 4,10,16,22 * * *; timeZone: Etc/UTC
preprod radar-refresh-pv: schedule: 0 5,11,17,23 * * *; timeZone: Etc/UTC
refresh-stagger: ok — prod "0 4,10,16,22 * * *", preprod "0 5,11,17,23 * * *": closest starts 60 min apart
verify-renders exit=0
```

Extra-cron mutant:

```yaml
  schedule:
    - cron: '0 4 * * *'
    - cron: "0 5 * * *"
```

```text
YAML on.schedule = [{"cron":"0 4 * * *"},{"cron":"0 5 * * *"}]
bascule.selftest — 61 passés, 0 échoués
```

Previous-day backup evidence used a manifest accepted by `checkManifest`, with date 2026-10-09, status complete, correct dated pg/docs keys and valid SHA formats, dumpStartedAt 06:00 UTC and completion 06:45. At 2026-10-10 04:00:

```text
chooseDate: {"date":"2026-10-09","source":"latestComplete","pointerSha256":null}
checkManifest: complete
staleGuard: {"ageHours":22,"stale":false,"reference":"pg.dumpStartedAt","referenceAt":"2026-10-09T06:00:00.000Z","overridden":false,"blocking":true}
```

A manual recovery backup at 06:00 is outside the manual-run exclusion window 02:00–05:30 in `cronjob-backup-daily.yaml:118`–`:128`, `:177`–`:179`. This is a code-level counterexample to the claim that missing today's backup necessarily causes refusal. The normal previous-day 02:23 example was also checked and refused at age 25.6 h.

Temporary files and copies were deleted after their evidence was incorporated into this leg. No tracked file was modified.

## Findings

### SOL-841-01

- **Severity:** blocking.
- **File:line:** `deploy/ci/bascule-preprod/bascule.selftest.mjs:209` (related extraction at `:206`, `:208`, `:210`).
- **Finding:** The new relational guard does not validate the final prod/preprod CronJob schedules. It assumes prod inherits the base and preprod uses the first matching patch; neither is enforced by this test.
- **Evidence:** A prod overlay schedule patch to `0 4,10,16,22 * * *` produces an actual 04:00 prod refresh, but the complete bascule selftest still reports **61 passed, 0 failed**. With preprod shifted to `0 5,11,17,23 * * *`, the existing `verify-renders` also exits **0** with a 60-minute stagger. A later preprod patch overriding its first schedule likewise renders a 04:00 refresh and passes the selftest. First unrelated CronJobs in the backup/base files and a first preprod schedule patch targeting the watchdog also bypass the new extraction. Backup timeZone changes are ignored. Valid quoting and patch comments cause false failures.
- **Fix:** Apply the relational check to the final released prod and preprod renders, selecting `kind: CronJob` plus `metadata.name: radar-refresh-pv`; select the backup CronJob by name and validate its time zone. Reuse the existing offline render-verification path rather than assuming overlay behavior from source regexes. Add mutation coverage for the paired prod/preprod case, later/wrong-target patches, other first resources, valid quoting/comments and backup timeZone. Keep the owner-selected 04:00 slot.
- **Gate rationale:** The new regression protection claims to bind the slot to actual neighboring workloads but admits a valid rendered collision that the adjacent render gate also accepts. This finding gates guard soundness, not the owner's hour or a demonstrated current live collision.

### SOL-841-02

- **Severity:** non-blocking.
- **File:line:** `deploy/ci/bascule-preprod/bascule.selftest.mjs:200` (extractor `:199`).
- **Finding:** The “a single cron” assertion counts only single-quoted entries, so it can pass a workflow with an additional active schedule.
- **Evidence:** Keeping `- cron: '0 4 * * *'` and adding `- cron: "0 5 * * *"` gives two `on.schedule` entries when parsed as YAML, but the full selftest returns **61 passed, 0 failed**. The unquoted extra cron does the same. Conversely, a single valid double-quoted or unquoted 04:00 cron returns exit 1. The extractor algorithm is unchanged from the base revision, which limits attribution to this PR.
- **Fix:** Inspect the actual `on.schedule` sequence and count every active entry independent of quote style; if a lightweight extractor is retained, reject any active cron it cannot parse. Add both mixed-quote-extra and single-valid-quote mutation cases.

### SOL-841-03

- **Severity:** non-blocking.
- **File:line:** `deploy/ci/bascule-preprod/README.md:315` (also workflow `:59`–`:61` and `deploy/k8s/README.md:307`).
- **Finding:** The new text overstates the 24-hour freshness guard as a requirement to restore the backup of the current day and a guarantee to refuse any missing/late current-day backup.
- **Evidence:** `chooseDate` selects latestComplete, and `staleGuard` checks age rather than equality to today's date (`backup-restore.cjs:119`, `:166`). A complete previous-day recovery backup whose dump starts at 06:00 is **22 h old** at the next 04:00 restore; the actual chooseDate/checkManifest/staleGuard functions accept it. The normal previous-day 02:23 backup is 25.6 h old and is refused. Both cases were executed.
- **Fix:** Describe today's backup as the normal outcome after a successful on-time daily backup. State that R0 refuses the latest complete backup only when it exceeds the configured freshness limit; a newer previous-day backup can still qualify. Retain the current 24-hour default and restore policy.

### SOL-841-04

- **Severity:** non-blocking.
- **File:line:** `deploy/ci/bascule-preprod/README.md:323` (also workflow `:65`–`:66`).
- **Finding:** The documented margin does not absorb a launch delay “of the order of an hour” while keeping the restore before the prod 05:00 refresh.
- **Evidence:** The configured restore-to-prod-start gap is 60 min. Using the supplied maximum observed restore of 50 min leaves **10 min** for launch delay before considering other overhead. A 60-minute launch delay starts restore at 05:00 and ends at 05:50, overlapping the declared prod refresh by 50 min. The guard only checks nominal cron times; it neither measures nor limits GitHub launch delay. Actual delayed runs/resource contention are unverified.
- **Fix:** Retain 04:00 and document the nominal margin, the possibility of an overlap after delayed starts, and any operational mitigation at that fixed hour. Remove the unsupported one-hour-delay assurance; distinguish observed durations from the 330-minute maximum workflow budget.

## Verdict

**NO-GO** for the new guard's demonstrated failure to cover final rendered schedules (SOL-841-01). The owner-selected daily 04:00 schedule itself matches the requested change. All requested offline validation passes after isolating the restore selftest's intended no-SDK fixture; references are accounted for, with no missed current weekly-cadence statement demonstrated. The remaining findings are non-blocking documentation/cadence-extraction corrections. Cluster behavior, repository-variable state, IdP resource usage, PR body disclosure and remote CI are unverified.
