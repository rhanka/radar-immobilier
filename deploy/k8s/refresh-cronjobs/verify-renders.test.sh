#!/usr/bin/env bash
# Hermetic tests for `refresh-018.mk verify-renders`: the released overlays pass,
# and each mutation of a copy fails for its own reason only.
#
# Covered: the prod/preprod start-minute stagger (incident 2026-10-09), the shared
# hours, the pending-pod watchdog CronJob and its coupling with the refresh pod
# (label selector, Job prefix, backoffLimit 0),
# and the daily bascule-preprod restore slot (bascule-crons.awk, bascule-window.awk).
#
# Usage: bash deploy/k8s/refresh-cronjobs/verify-renders.test.sh
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
SRC="$(cd "$HERE/../../.." && pwd)"
PASS=0 FAIL=0
ok() { PASS=$((PASS + 1)); echo "ok: $1"; }
bad() { FAIL=$((FAIL + 1)); echo "FAIL: $1" >&2; }

CASES=()
trap 'rm -rf "${CASES[@]}"' EXIT
fixture() {
  CASE_ROOT="$(mktemp -d)"; CASES+=("$CASE_ROOT")
  mkdir -p "$CASE_ROOT/deploy/k8s"
  cp "$SRC"/deploy/k8s/34-refresh-cronjob.yaml "$SRC"/deploy/k8s/34-refresh-keyring-pvc.yaml \
     "$SRC"/deploy/k8s/34-refresh-pending-watchdog.yaml "$CASE_ROOT/deploy/k8s/"
  cp "$SRC"/deploy/k8s/35-consistency-snapshot-cronjob.yaml "$SRC"/deploy/k8s/35b-populate-geo-cronjob.yaml "$CASE_ROOT/deploy/k8s/"
  cp -r "$SRC/deploy/k8s/refresh-cronjobs" "$SRC/deploy/k8s/refresh-cronjobs-prod" "$CASE_ROOT/deploy/k8s/"
  mkdir -p "$CASE_ROOT/.github/workflows" && cp "$SRC/.github/workflows/bascule-preprod.yml" "$CASE_ROOT/.github/workflows/"
  mkdir -p "$CASE_ROOT/deploy/ci/backup" && cp "$SRC/deploy/ci/backup/cronjob-backup-daily.yaml" "$CASE_ROOT/deploy/ci/backup/"
}
verify() { make --no-print-directory -f "$CASE_ROOT/deploy/k8s/refresh-cronjobs/refresh-018.mk" verify-renders ENV=test-refresh-renders 2>&1; }
run_ok() { local out; out="$(verify)" && ok "$1" || { bad "$1"; printf '%s\n' "$out" | tail -5 >&2; }; }
run_bad() {
  local out
  out="$(verify)" && { bad "$1 (passed)"; return; }
  grep -Fq "$2" <<<"$out" && ok "$1" || { bad "$1 (expected: $2)"; printf '%s\n' "$out" | tail -5 >&2; }
}
PRE="deploy/k8s/refresh-cronjobs/kustomization.yaml"
PROD="deploy/k8s/refresh-cronjobs-prod/kustomization.yaml"
BASE="deploy/k8s/34-refresh-cronjob.yaml"
DOG="deploy/k8s/34-refresh-pending-watchdog.yaml"

fixture; run_ok "released overlays pass"

# Explicit schedule + suspend contract: preprod radar-refresh-pv runs once a day
# at 06:00 UTC (suspend: false, watchdog active); prod stays unchanged at 4 runs
# per day (0 5,11,17,23 * * *, Etc/UTC, suspend: false).
fixture
PRE_RENDER="$CASE_ROOT/preprod-schedule.yaml"
PROD_RENDER="$CASE_ROOT/prod-schedule.yaml"
if make --no-print-directory -f "$CASE_ROOT/deploy/k8s/refresh-cronjobs/refresh-018.mk" render-preprod \
    IMAGE_REF='ghcr.io/rhanka/radar-api@sha256:0000000000000000000000000000000000000000000000000000000000000000' \
    RENDER_OUT="$PRE_RENDER" ENV=preprod >/dev/null 2>&1 \
  && make --no-print-directory -f "$CASE_ROOT/deploy/k8s/refresh-cronjobs/refresh-018.mk" render-prod \
    IMAGE_REF='ghcr.io/rhanka/radar-api@sha256:0000000000000000000000000000000000000000000000000000000000000000' \
    RENDER_OUT="$PROD_RENDER" ENV=prod >/dev/null 2>&1 \
  && awk 'BEGIN{RS="\n---\n"} /kind: CronJob/ && /\n  name: radar-refresh-pv\n/ { pv=1; if ($0 !~ /\n  suspend: false\n/ || $0 !~ /\n  schedule: "?0 6 \* \* \*"?\n/ || $0 !~ /\n  timeZone: "?Etc\/UTC"?\n/) exit 1 } /kind: CronJob/ && /\n  name: radar-refresh-pending-watchdog\n/ { wd=1; if ($0 !~ /\n  suspend: false\n/) exit 1 } END { if (!pv || !wd) exit 1 }' "$PRE_RENDER" \
  && awk 'BEGIN{RS="\n---\n"} /kind: CronJob/ && /\n  name: radar-refresh-pv\n/ { pv=1; if ($0 !~ /\n  suspend: false\n/ || $0 !~ /\n  schedule: "?0 5,11,17,23 \* \* \*"?\n/ || $0 !~ /\n  timeZone: "?Etc\/UTC"?\n/) exit 1 } END { if (!pv) exit 1 }' "$PROD_RENDER"; then
  ok "preprod renders 0 6 * * * UTC (suspend=false) and prod stays 0 5,11,17,23 * * * UTC (suspend=false)"
else
  bad "preprod renders 0 6 * * * UTC (suspend=false) and prod stays 0 5,11,17,23 * * * UTC (suspend=false)"
fi

fixture; sed -i '/name: radar-refresh-pv/,/value: false/s/value: false/value: true/' "$CASE_ROOT/$PRE"
run_bad "preprod radar-refresh-pv suspended is refused" "refresh activation/model contract failed"

fixture; sed -i '/name: radar-refresh-pv/,/value: false/s/value: false/value: true/' "$CASE_ROOT/$PROD"
run_bad "prod radar-refresh-pv suspended is refused" "refresh activation/model contract failed"

# Explicit render-prod and render-preprod check: both radar-refresh-pv renders
# must activate two-step B+C classification (keeping REFRESH_SINGLE_PASS=0), keep
# detection B on Astra medium primary + Gemini 3.8 Flash low fallback, pin
# classification C on Astra low primary + Muse Wonder 1.0 low fallback + budget,
# and mount the shared keyring mechanism identically.
fixture
PROD_RENDER="$CASE_ROOT/prod-rendered.yaml"
PREPROD_RENDER="$CASE_ROOT/preprod-rendered.yaml"
check_bc_render() {
  local ns="$1" file="$2"
  awk -v ns="$ns" 'BEGIN{RS="\n---\n"} /kind: CronJob/ && /\n  name: radar-refresh-pv\n/ {
      pv=1
      if ($0 !~ "namespace: " ns "\n") exit 1
      if ($0 !~ /name: REFRESH_PROVIDER\n[ ]+value: openai\n/) exit 1
      if ($0 !~ /name: REFRESH_MODEL\n[ ]+value: gpt-6-astra\n/) exit 1
      if ($0 !~ /name: REFRESH_REASONING_EFFORT\n[ ]+value: medium\n/) exit 1
      if ($0 !~ /name: REFRESH_FALLBACK_PROVIDER\n[ ]+value: gemini\n/) exit 1
      if ($0 !~ /name: REFRESH_FALLBACK_MODEL\n[ ]+value: gemini-3.8-flash\n/) exit 1
      if ($0 !~ /name: REFRESH_FALLBACK_REASONING_EFFORT\n[ ]+value: low\n/) exit 1
      if ($0 !~ /name: REFRESH_SINGLE_PASS\n[ ]+value: "0"\n/) exit 1
      if ($0 !~ /name: REFRESH_CLASSIFY_MODE\n[ ]+value: two-step\n/) exit 1
      if ($0 !~ /name: REFRESH_CLASSIFY_PROVIDER\n[ ]+value: openai\n/) exit 1
      if ($0 !~ /name: REFRESH_CLASSIFY_MODEL\n[ ]+value: gpt-6-astra\n/) exit 1
      if ($0 !~ /name: REFRESH_CLASSIFY_REASONING_EFFORT\n[ ]+value: low\n/) exit 1
      if ($0 !~ /name: REFRESH_CLASSIFY_CONCURRENCY\n[ ]+value: "2"\n/) exit 1
      if ($0 !~ /name: REFRESH_RUN_MAX_TOKENS\n[ ]+value: "100000000"\n/) exit 1
      if ($0 !~ /name: REFRESH_CLASSIFY_FALLBACK_PROVIDER\n[ ]+value: muse\n/) exit 1
      if ($0 !~ /name: REFRESH_CLASSIFY_FALLBACK_MODEL\n[ ]+value: muse-wonder-1.0\n/) exit 1
      if ($0 !~ /name: REFRESH_CLASSIFY_FALLBACK_REASONING_EFFORT\n[ ]+value: low\n/) exit 1
      if ($0 !~ /name: SENTROPIC_LLM_MESH_KEYRING_DIR\n[ ]+value: \/keyring\/runtime\n/) exit 1
      if ($0 !~ /claimName: radar-refresh-keyring\n/) exit 1
      if ($0 !~ /secretName: radar-refresh-keyring-bootstrap\n/) exit 1
      if ($0 !~ /mountPath: \/keyring\n/) exit 1
    } END { if (!pv) exit 1 }' "$file"
}
if make --no-print-directory -f "$CASE_ROOT/deploy/k8s/refresh-cronjobs/refresh-018.mk" render-prod \
    IMAGE_REF='ghcr.io/rhanka/radar-api@sha256:0000000000000000000000000000000000000000000000000000000000000000' \
    RENDER_OUT="$PROD_RENDER" ENV=prod >/dev/null 2>&1 \
  && check_bc_render "radar-immobilier" "$PROD_RENDER"; then
  ok "prod render pins two-step B+C, Gemini B fallback, Muse C fallback and keyring"
else
  bad "prod render pins two-step B+C, Gemini B fallback, Muse C fallback and keyring"
fi
if make --no-print-directory -f "$CASE_ROOT/deploy/k8s/refresh-cronjobs/refresh-018.mk" render-preprod \
    IMAGE_REF='ghcr.io/rhanka/radar-api@sha256:0000000000000000000000000000000000000000000000000000000000000000' \
    RENDER_OUT="$PREPROD_RENDER" ENV=preprod >/dev/null 2>&1 \
  && check_bc_render "radar-immobilier-preprod" "$PREPROD_RENDER"; then
  ok "preprod render pins two-step B+C, Gemini B fallback, Muse C fallback and keyring"
else
  bad "preprod render pins two-step B+C, Gemini B fallback, Muse C fallback and keyring"
fi
fixture; sed -i '/REFRESH_CLASSIFY_MODE/d' "$CASE_ROOT/$BASE"
run_bad "classification mode missing" "refresh activation/model contract failed"

for mode in off single-pass invalid; do
  fixture; sed -i "/REFRESH_CLASSIFY_MODE/s/value: \"two-step\"/value: \"$mode\"/" "$CASE_ROOT/$BASE"
  run_bad "classification mode $mode in base is refused" "refresh activation/model contract failed"
done

fixture; sed -i '/name: NODE_OPTIONS/a\                      - { name: REFRESH_CLASSIFY_MODE, value: "off" }' "$CASE_ROOT/$PROD"
run_bad "prod overlay setting classification mode to off is refused" "refresh activation/model contract failed"

fixture; printf '                      - { name: REFRESH_CLASSIFY_MODE, value: "off" }\n' >> "$CASE_ROOT/$PRE"
run_bad "preprod overlay setting classification mode to off is refused" "refresh activation/model contract failed"

fixture; sed -i '/REFRESH_RUN_MAX_TOKENS/d' "$CASE_ROOT/$BASE"
run_bad "classification run token budget missing" "refresh activation/model contract failed"

fixture; sed -i '/REFRESH_CLASSIFY_REASONING_EFFORT/s/value: "low"/value: "medium"/' "$CASE_ROOT/$BASE"
run_bad "classification must default to Astra low" "refresh activation/model contract failed"

fixture; sed -i '/REFRESH_CLASSIFY_FALLBACK_MODEL/s/muse-wonder-1.0/other/' "$CASE_ROOT/$BASE"
run_bad "classification fallback must stay Muse Wonder 1.0" "refresh activation/model contract failed"

fixture; sed -i '/name: REFRESH_FALLBACK_PROVIDER/s/value: "gemini"/value: "muse"/; /name: REFRESH_FALLBACK_MODEL/s/gemini-3.8-flash/muse-wonder-1.0/' "$CASE_ROOT/$BASE"
run_bad "detection B fallback switching from gemini to muse is refused" "refresh activation/model contract failed"

fixture; sed -i '/name: REFRESH_FALLBACK_MODEL/s/gemini-3.8-flash/other/' "$CASE_ROOT/$BASE"
run_bad "detection B gemini fallback without gemini-3.8-flash" "refresh activation/model contract failed"

fixture; sed -i '/name: REFRESH_FALLBACK_PROVIDER/s/value: "gemini"/value: "muse"/' "$CASE_ROOT/$BASE"
run_bad "detection B fallback provider drift" "refresh activation/model contract failed"

fixture; sed -i '/name: REFRESH_CLASSIFY_FALLBACK_PROVIDER/s/value: "muse"/value: "gemini"/' "$CASE_ROOT/$BASE"
run_bad "classify fallback provider without its muse model" "refresh activation/model contract failed"

fixture; sed -i '/name: REFRESH_FALLBACK_REASONING_EFFORT/s/value: "low"/value: "medium"/' "$CASE_ROOT/$BASE"
run_bad "detection B fallback reasoning effort must stay low" "refresh activation/model contract failed"

fixture; sed -i '/name: REFRESH_CLASSIFY_FALLBACK_REASONING_EFFORT/s/value: "low"/value: "medium"/' "$CASE_ROOT/$BASE"
run_bad "classify fallback reasoning effort must stay low" "refresh activation/model contract failed"

fixture; sed -i '/name: NODE_OPTIONS/a\                      - { name: REFRESH_CLASSIFY_FALLBACK_PROVIDER, value: "gemini" }\n                      - { name: REFRESH_CLASSIFY_FALLBACK_MODEL, value: "gemini-3.8-flash" }' "$CASE_ROOT/$PROD"
run_bad "prod overlay reverting classification C fallback to gemini is refused" "refresh activation/model contract failed"

fixture; printf '                      - { name: REFRESH_FALLBACK_PROVIDER, value: "muse" }\n                      - { name: REFRESH_FALLBACK_MODEL, value: "muse-wonder-1.0" }\n' >> "$CASE_ROOT/$PRE"
run_bad "preprod overlay switching detection B fallback to muse is refused" "refresh activation/model contract failed"

fixture; sed -i '/REFRESH_CLASSIFY_CONCURRENCY/s/value: "2"/value: "200"/' "$CASE_ROOT/$BASE"
run_bad "classification concurrency must stay bounded" "refresh activation/model contract failed"

fixture; sed -i '/REFRESH_SINGLE_PASS/d' "$CASE_ROOT/$BASE"
run_bad "single-pass flag missing" "refresh activation/model contract failed"

fixture; sed -i '/REFRESH_SINGLE_PASS/s/value: "0"/value: "1"/' "$CASE_ROOT/$BASE"
run_bad "single-pass enabled by default" "refresh activation/model contract failed"

fixture; sed -i '/REFRESH_SINGLE_PASS_REASONING_EFFORT/s/value: "low"/value: "medium"/' "$CASE_ROOT/$BASE"
run_bad "single-pass must default to Astra low" "refresh activation/model contract failed"

P='s#value: "0 6 \* \* \*"#value: "%s"#'
pre_sched() { sed -i "$(printf "$P" "$1")" "$CASE_ROOT/$PRE"; }

fixture; pre_sched "0 5,11,17,23 * * *"
run_bad "preprod on the prod hours (same starts)" "refresh stagger failed"

fixture; pre_sched "30 6 * * *"
run_bad "preprod off the hour (minute differs from prod)" "refresh overlay parity failed"

fixture; pre_sched "0 6 * * 1-5"
run_bad "preprod non-daily day fields (differs from prod)" "refresh overlay parity failed"

fixture; pre_sched "0 6,18 * * *"
run_ok "preprod with another valid daily hour count (2 passes/day, 1h from prod) passes"

fixture; pre_sched "0 1,7,13,19 * * *"
run_ok "another hour list on the hour, two hours away, passes (relational, not pinned)"

fixture; sed -i 's#value: "900" }#value: "3400" }#' "$CASE_ROOT/$DOG"
run_bad "a stalled pod outlives the one-hour gap" "not before the other environment starts"

fixture; sed -i 's#value: "900" }#value: "3300" }#' "$CASE_ROOT/$DOG"
run_bad "deadline + period exactly equal to the gap is refused" "not before the other environment starts"

fixture; sed -i 's#value: "900" }#value: "3299" }#' "$CASE_ROOT/$DOG"
run_ok "deadline + period just below the gap passes"

fixture; sed -i '/34-refresh-pending-watchdog.yaml/d' "$CASE_ROOT/$PROD"
run_bad "prod render without the watchdog" "refresh pending watchdog contract failed"

fixture; sed -i '/name: radar-refresh-pending-watchdog/,/value: false/s/value: false/value: true/' "$CASE_ROOT/$PRE"
run_bad "preprod watchdog left suspended" "refresh pending watchdog contract failed"

fixture; sed -i '/app.kubernetes.io\/instance: radar-refresh-pv/d' "$CASE_ROOT/$BASE"
run_bad "refresh pod without the watchdog selector label" "refresh pending watchdog contract failed"

fixture; sed -i 's#value: "app.kubernetes.io/instance=radar-refresh-pv"#value: "app.kubernetes.io/instance=other"#' "$CASE_ROOT/$DOG"
run_bad "watchdog selecting another label" "refresh pending watchdog contract failed"

fixture; sed -i '/REFRESH_PENDING_DEADLINE_SECONDS/d' "$CASE_ROOT/$DOG"
run_bad "watchdog without its pending deadline" "refresh pending watchdog contract failed"

fixture; sed -i 's#value: "900" }#value: "19800" }#' "$CASE_ROOT/$DOG"
run_bad "watchdog deadline not shorter than the slot stagger" "refresh pending watchdog contract failed"

fixture; sed -i '0,/      backoffLimit: 0/s//      backoffLimit: 1/' "$CASE_ROOT/$BASE"
run_bad "refresh Job retrying a deleted pod" "refresh pending watchdog contract failed"

fixture; sed -i '/^            app.kubernetes.io\/instance: radar-refresh-pv$/d' "$CASE_ROOT/$BASE"
sed -i '0,/^    app.kubernetes.io\/component: graph-projection$/s//&\n    app.kubernetes.io\/instance: radar-refresh-pv/' "$CASE_ROOT/$BASE"
run_bad "selector label moved to the CronJob metadata (not on the pods)" "refresh pending watchdog contract failed"

fixture; sed -i '/^            app.kubernetes.io\/instance: radar-refresh-pv$/d' "$CASE_ROOT/$BASE"
sed -i 's/^  jobTemplate:$/&\n    metadata:\n      labels:\n        app.kubernetes.io\/instance: radar-refresh-pv/' "$CASE_ROOT/$BASE"
run_bad "selector label moved to the Job template metadata (not on the pods)" "refresh pending watchdog contract failed"

fixture; sed -i 's#value: "900" }#value: "59" }#' "$CASE_ROOT/$DOG"
run_bad "watchdog deadline below the 60 s floor the script enforces" "refresh pending watchdog contract failed"

fixture; sed -i 's#value: "900" }#value: "60" }#' "$CASE_ROOT/$DOG"
run_ok "watchdog deadline at the 60 s floor passes"

fixture; sed -i 's#ttlSecondsAfterFinished: 21600#ttlSecondsAfterFinished: 3600#' "$CASE_ROOT/$DOG"
run_bad "watchdog TTL below the 6 h floor" "refresh retention contract failed"

fixture; sed -i 's#failedJobsHistoryLimit: 73#failedJobsHistoryLimit: 3#' "$CASE_ROOT/$DOG"
run_bad "watchdog failedJobsHistoryLimit pruning before 6 h" "refresh retention contract failed"

fixture; sed -i '/podFailurePolicy:/,/values: \[0\]/d' "$CASE_ROOT/$BASE"
run_bad "refresh Job without FailJob podFailurePolicy" "refresh retention contract failed"

fixture; sed -i 's#schedule: "0 5,11,17,23 \* \* \*"#schedule: "0 * * * *"#' "$CASE_ROOT/$BASE"
pre_sched "0 * * * *"
run_bad "hourly schedules (slot timing not checkable) are refused" "refresh stagger failed"

fixture; pre_sched "0 0,0,12,18 * * *"
run_bad "a repeated preprod hour (3 real passes counted as 4) is refused" "refresh stagger failed"

fixture; sed -i 's#schedule: "0 5,11,17,23 \* \* \*"#schedule: "17 5,11,17,23 * * *"#' "$CASE_ROOT/$BASE"
pre_sched "17 0,6,12,18 * * *"
run_bad "both refreshes off the hour (shared minute 17) are refused" "refresh stagger failed"

# Daily bascule-preprod restore slot (0 4 * * * UTC): checked on the RENDERED
# refresh CronJobs and on radar-backup-daily selected by name.
WF=".github/workflows/bascule-preprod.yml"
BK="deploy/ci/backup/cronjob-backup-daily.yaml"
restore_cron() { sed -i "s|^    - cron: '0 4 \* \* \*'\$|    - cron: $1|" "$CASE_ROOT/$WF"; }
W_FAIL="must stay after the daily backup and clear of every refresh start"

fixture; pre_sched "0 4 * * *"
run_bad "preprod single daily refresh starting with the restore (04:00)" "$W_FAIL"

fixture; pre_sched "0 4,10,16,22 * * *"
run_bad "preprod refresh starting with the restore (04:00)" "$W_FAIL"

fixture; sed -i '0,/^        value: false$/s//        value: false\n      - op: replace\n        path: \/spec\/schedule\n        value: "0 4,10,16,22 * * *"/' "$CASE_ROOT/$PROD"
run_bad "prod overlay patch moving the prod refresh to 04:00" "$W_FAIL"

fixture; printf '\n  - target:\n      kind: CronJob\n      name: radar-refresh-pv\n    patch: |\n      - op: replace\n        path: /spec/schedule\n        value: "0 4,10,16,22 * * *"\n' >> "$CASE_ROOT/$PRE"
run_bad "later preprod patch overriding the first schedule to 04:00" "$W_FAIL"

fixture; restore_cron "'0 3 * * *'"
run_bad "restore 37 min after the backup start" "$W_FAIL"

fixture; restore_cron "'30 4 * * *'"
run_bad "restore off the hour" "$W_FAIL"

fixture; restore_cron "'0 4 * * 1-5'"
run_bad "restore not daily (weekdays only)" "$W_FAIL"

fixture; restore_cron "'0 4,16 * * *'"
run_bad "restore twice a day" "$W_FAIL"

fixture; restore_cron "'0 5 * * *'"
run_bad "restore starting with the prod refresh (05:00)" "$W_FAIL"

fixture; restore_cron "'0 1 * * *'"
run_bad "restore at 01:00, before the backup of the day (previous-day backup)" "$W_FAIL"

fixture; restore_cron "'0 4 * * *'"; sed -i "s|^    - cron: '0 4 \* \* \*'\$|&\n    - cron: \"0 5 * * *\"|" "$CASE_ROOT/$WF"
run_bad "a second, double-quoted active cron" "exactly one active on.schedule cron"

fixture; sed -i "s|^    - cron: '0 4 \* \* \*'\$|&\n    - cron: 0 5 * * *|" "$CASE_ROOT/$WF"
run_bad "a second, unquoted active cron" "exactly one active on.schedule cron"

fixture; sed -i "s|^    - cron: '0 4 \* \* \*'\$|&\n    - kron: '0 5 * * *'|" "$CASE_ROOT/$WF"
run_bad "an unreadable on.schedule line" "unreadable on.schedule"

fixture; restore_cron '"0 4 * * *"'
run_ok "the restore cron double-quoted passes"

fixture; restore_cron '0 4 * * *  # daily'
run_ok "the restore cron unquoted with a trailing comment passes"

fixture; sed -i "s|^    - cron: '0 4 \* \* \*'\$|&\n    # - cron: '0 5 * * *'|" "$CASE_ROOT/$WF"
run_ok "a commented-out extra cron is ignored"

fixture; sed -i 's#^  timeZone: "Etc/UTC"$#  timeZone: "America/Toronto"#' "$CASE_ROOT/$BK"
run_bad "daily backup moved off UTC" "$W_FAIL"

fixture; sed -i 's#^  schedule: "23 2 \* \* \*"$#  schedule: "23 3 * * *"#' "$CASE_ROOT/$BK"
run_bad "daily backup moved to 03:23 (37 min before the restore)" "$W_FAIL"

fixture; sed -i 's#^  name: radar-backup-daily$#  name: radar-backup-other#' "$CASE_ROOT/$BK"
run_bad "no radar-backup-daily CronJob in the backup manifest" "$W_FAIL"

fixture; printf -- '---\napiVersion: batch/v1\nkind: CronJob\nmetadata:\n  name: radar-backup-early\nspec:\n  schedule: "0 1 * * *"\n  timeZone: "Etc/UTC"\n---\n' > "$CASE_ROOT/$BK.tmp"; cat "$CASE_ROOT/$BK" >> "$CASE_ROOT/$BK.tmp"; mv "$CASE_ROOT/$BK.tmp" "$CASE_ROOT/$BK"
sed -i 's#^  schedule: "23 2 \* \* \*"$#  schedule: "23 3 * * *"#' "$CASE_ROOT/$BK"
run_bad "an unrelated first CronJob does not stand in for radar-backup-daily" "$W_FAIL"

early_doc() { # $1 separator line placed after an unrelated first CronJob (01:00)
  printf -- 'apiVersion: batch/v1\nkind: CronJob\nmetadata:\n  name: radar-backup-early\nspec:\n  schedule: "0 1 * * *"\n  timeZone: "Etc/UTC"\n  jobTemplate: { spec: { template: { spec: { restartPolicy: Never, containers: [ { name: x, image: x } ] } } } }\n%s\n' "$1" > "$CASE_ROOT/$BK.tmp"
  cat "$CASE_ROOT/$BK" >> "$CASE_ROOT/$BK.tmp"; mv "$CASE_ROOT/$BK.tmp" "$CASE_ROOT/$BK"
}
fixture; early_doc '--- # next YAML document'; sed -i 's#^  schedule: "23 2 \* \* \*"$#  schedule: "23 3 * * *"#' "$CASE_ROOT/$BK"
run_bad "commented YAML separator does not let the first CronJob stand in for radar-backup-daily" "$W_FAIL"

fixture; early_doc '---   '; sed -i 's#^  timeZone: "Etc/UTC"$#  timeZone: "America/Toronto"#; 0,/America\/Toronto/s//Etc\/UTC/' "$CASE_ROOT/$BK"
run_bad "spaced YAML separator does not hide the real backup time zone" "$W_FAIL"

fixture; sed -i 's#^  name: radar-backup-daily$#  name: "radar-backup-daily"#' "$CASE_ROOT/$BK"
run_ok "a quoted backup metadata name passes (canonical render)"

fixture; sed -i 's#^  schedule:$#  schedule: \# daily restore#' "$CASE_ROOT/$WF"
run_ok "a comment on the on.schedule key passes"

fixture; sed -i 's#^on:$#on: \# triggers#' "$CASE_ROOT/$WF"
run_ok "a comment on the on: key passes"

# refresh-stagger.awk alone, on minimal renders: adjacent hours make a real
# cross-hour proximity (preprod 04:50, prod 05:00) that the overlays cannot reach.
stagger_case() { # $1 preprod schedule, $2 prod schedule
  local dir; dir="$(mktemp -d)"; CASES+=("$dir")
  local dog='kind: CronJob
metadata:
  name: radar-refresh-pending-watchdog
spec:
  schedule: "*/5 * * * *"
            - name: REFRESH_PENDING_DEADLINE_SECONDS
              value: "900"'
  printf 'kind: CronJob\nmetadata:\n  name: radar-refresh-pv\nspec:\n  schedule: "%s"\n---\n%s\n' "$1" "$dog" >"$dir/preprod.yaml"
  printf 'kind: CronJob\nmetadata:\n  name: radar-refresh-pv\nspec:\n  schedule: "%s"\n' "$2" >"$dir/prod.yaml"
  awk -v min_minutes=15 -f "$HERE/refresh-stagger.awk" "$dir/preprod.yaml" "$dir/prod.yaml" 2>&1
}
out="$(stagger_case "50 4,5 * * *" "0 4,5 * * *")" && bad "adjacent hours: preprod 04:50 vs prod 05:00 (passed)" \
  || { grep -Fq "closest prod and preprod starts are 10 min apart" <<<"$out" && ok "adjacent hours: preprod 04:50 vs prod 05:00 refused" || bad "adjacent hours (got: $out)"; }
out="$(stagger_case "0 3,4 * * *" "0 5,6 * * *")" && ok "adjacent hour lists, on the hour, 60 min apart pass" || bad "adjacent hour lists 60 min apart (got: $out)"
out="$(stagger_case "30 5,11 * * *" "0 5,24 * * *")" && bad "hour 24 accepted" \
  || { grep -Fq "hour list 0-23" <<<"$out" && ok "hour outside 0-23 refused" || bad "hour 24 (got: $out)"; }

echo "verify-renders tests: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
