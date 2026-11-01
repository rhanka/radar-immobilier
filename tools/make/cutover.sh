#!/usr/bin/env bash
set -euo pipefail
umask 077
fail() { printf '%s\n' "Cutover refused: $*" >&2; exit 1; }
source tools/make/cutover-release.sh
source tools/make/cutover-cluster.sh
source tools/make/cutover-inventory.sh
source tools/make/cutover-close.sh
source tools/make/cutover-jobs.sh
source tools/make/cutover-render.sh
source tools/make/cutover-stages.sh
source tools/make/cutover-reopen.sh
source tools/make/cutover-smoke.sh
source tools/make/cutover-report.sh
source tools/make/cutover-prepared.sh
source tools/make/cutover-prepare.sh
source tools/make/cutover-prepared-smoke.sh
source tools/make/cutover-switch.sh
source tools/make/cutover-rbac.sh
cutover_config
[[ -z ${CYCLE_ID:-} || $CYCLE_ID =~ ^[A-Za-z0-9._-]{1,100}$ ]] || fail 'Invalid cycle identifier'
WORK=$(mktemp -d)
OWNED=0
ACQUIRED=0
cleanup() {
  local code=$?
  trap - EXIT INT TERM
  unset FAST_DEADLINE REQUEST_DEADLINE
  stop_forwards
  if [[ ${PREPARING:-0} == 1 && $code != 0 ]]; then
    (set -e; prepare_failed) || printf 'Prepared cleanup incomplete; slot remains blocked\n' >&2
    rm -rf "$WORK"
    exit "$code"
  fi
  if [[ $ACQUIRED == 1 && -f $WORK/record.json ]]; then report_outputs "$code" || true; fi
  if [[ $OWNED == 1 && $code != 0 ]]; then
    if jq -e '.kind=="writer"' "$WORK/record.json" >/dev/null; then
      printf 'Writer lock retained; resume after the workflow and its Jobs terminate\n' >&2
    elif jq -e '.checkpoints.close!=null' "$WORK/record.json" >/dev/null; then
      # A daily restore reopens on the verified live database (the atomic restore
      # either committed or left it intact); a refusal falls through and stays closed.
      if [[ ${REOPEN_ATTEMPTED:-0} != 1 ]] && jq -e '.mode=="restore" and .kind=="cutover"' "$WORK/record.json" >/dev/null; then
        # errexit stays effective inside the subshell only outside a tested context.
        local reopened
        set +e; (set -e; MODE=restore; restore_reopen); reopened=$?; set -e
        if ((reopened == 0)); then rm -rf "$WORK"; exit "$code"; fi
        printf 'Automatic reopening refused; daily restore remains closed for recovery\n' >&2
      fi
      # Any failure after reopening began must reclose schedules and every route.
      (set -e; stop_schedules) || printf 'Schedule state unknown; recovery lock retained\n' >&2
      (set -e; reclose_best_effort) || printf 'Route state unknown; recovery lock retained\n' >&2
      (set -e; stop_operation_jobs) || printf 'Database Job termination unknown; lock retained\n' >&2
      jq '.executor.state="stopped"' "$WORK/record.json" > "$WORK/next.json"
      mv "$WORK/next.json" "$WORK/record.json"
      record_save || printf 'Could not record executor stop; reconcile liveness through resume\n' >&2
    else
      # Preclosure helper Jobs must end before ownership is released.
      (set -e; stop_operation_jobs
        if jq -e '.checkpoints.suspend!=null' "$WORK/record.json" >/dev/null; then restore_schedules; fi
        lock_delete) || printf 'Helper state unknown; lock retained\n' >&2
    fi
  fi
  rm -rf "$WORK"
  exit "$code"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
cluster_preflight
case ${1:-} in
  prepare) validate_release "${RELEASE:-}"; rbac_preflight; prepare_database;;
  rollback)
    lock_resume
    if jq -e '.mode=="restore"' "$WORK/record.json" >/dev/null; then
      MODE=restore; RECOVERING=1; REOPEN_ATTEMPTED=1; restore_reopen
    else rollback_stages; fi;;
  recover)
    # Runs in the same workflow after the restore job ended (runner lost, cancelled
    # or failed): only this run's daily restore lock is taken over and reopened.
    [[ $ENV == preprod && ${GITHUB_ACTIONS:-} == true && ${GITHUB_RUN_ID:-} =~ ^[0-9]+$ ]] || fail 'Recovery runs from the daily restore workflow'
    "${k[@]}" get configmap radar-change-lock --ignore-not-found -o json > "$WORK/lock.json"
    if [[ ! -s $WORK/lock.json ]]; then printf 'No active change operation\n'; exit; fi
    record_read
    if ! jq -e --arg repo "${GITHUB_REPOSITORY:-}" --arg run "$GITHUB_RUN_ID" '.kind=="cutover" and .mode=="restore"
      and .executor.kind=="github" and .executor.repo==$repo and .executor.run==$run' "$WORK/record.json" >/dev/null; then
      printf 'Change lock belongs to another operation; nothing to recover\n'; exit
    fi
    RUN=$(jq -r .run "$WORK/record.json")
    lock_resume
    MODE=restore; RECOVERING=1; REOPEN_ATTEMPTED=1; restore_reopen;;
  status)
    "${k[@]}" get configmap radar-change-lock --ignore-not-found -o json > "$WORK/lock.json"
    if [[ ! -s $WORK/lock.json ]]; then printf 'No active change operation\n'; exit; fi
    record_read
    jq '{run,kind,stage,executor,checkpoints,jobs}' "$WORK/record.json";;
  lock) lock_acquire writer;;
  release-lock) writer_release;;
  force-refresh)
    [[ $ENV == preprod ]] || fail 'Forced refresh is preprod-only'
    lock_acquire writer
    run_job refresh 19800 21600
    lock_delete;;
  report-refs)
    [[ $ENV == preprod && -n ${CYCLE_ID:-} ]] || fail 'Reference reporting requires a preprod cycle'
    lock_acquire writer
    "${k[@]}" get configmap radar-cutover-receipt -o json > "$WORK/receipt.json"
    jq --slurpfile receipt "$WORK/receipt.json" '($receipt[0].data.receipt|fromjson) as $done|
      .release=$done.release|.pin=$done.pin' "$WORK/record.json" > "$WORK/next.json"
    mv "$WORK/next.json" "$WORK/record.json"; record_save
    report_refs; lock_delete;;
  run)
    case ${MODE:-run} in run|restore|list) ;; *) fail 'MODE must be restore or list when supplied';; esac
    [[ ${MODE:-run} != restore || $ENV == preprod ]] || fail 'Daily restore is preprod-only'
    [[ ${BACKUP_ID:-latest} == latest || ${BACKUP_ID:-} =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]] || fail 'Invalid backup selection'
    if [[ ${RELEASE:-} != deployed ]]; then validate_release "${RELEASE:-}"; fi
    rbac_preflight
    lock_acquire
    jq --arg mode "${MODE:-run}" '.mode=$mode' "$WORK/record.json" > "$WORK/next.json"
    mv "$WORK/next.json" "$WORK/record.json"; record_save
    if [[ ${GITHUB_ACTIONS:-} == true && $ENV == preprod && ${MODE:-} =~ ^(restore|list)$ ]]; then
      node deploy/cutover/secrets-cli.mjs
    fi
    if [[ ${RELEASE:-} == deployed ]]; then
      [[ $ENV == preprod && ${MODE:-} =~ ^(restore|list)$ ]] || fail 'Deployed release is only for the daily/reporting adapter'
      deployed_release
    else save_release "$RELEASE"; fi
    if [[ ${MODE:-} == list ]]; then run_job list 540 600; report_listing; lock_delete; exit; fi
    inventory
    suspend_writers kill
    if [[ ${MODE:-run} == restore ]]; then
      run_job database 30 45
      jq --slurpfile db "$WORK/verdict.json" '.liveDb=$db[0].database' "$WORK/record.json" > "$WORK/next.json"
      mv "$WORK/next.json" "$WORK/record.json"; record_save
    fi
    execute_stages;;
  resume)
    lock_resume
    MODE=$(jq -r '.mode//"run"' "$WORK/record.json")
    [[ $MODE != restore || $ENV == preprod ]] || fail 'Daily restore recovery is preprod-only'
    RECOVERING=1
    # Forward resume serves the restored pin again: a reopening marker is cleared.
    jq 'del(.restoreAborted)' "$WORK/record.json" > "$WORK/next.json"; mv "$WORK/next.json" "$WORK/record.json"
    if [[ $(jq -r .kind "$WORK/record.json") == writer ]]; then
      writer_release
    else
      jq .release "$WORK/record.json" | jq -e -f tools/make/cutover-release.jq >/dev/null || fail 'Recovery release is invalid'
      [[ $(jq -r .environment "$WORK/record.json") == "$ENV" ]] || fail 'Recovery environment mismatch'
      execute_stages
    fi;;
  *) fail 'Unknown operator command';;
esac
