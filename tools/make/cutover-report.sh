#!/usr/bin/env bash
report_listing() {
  node deploy/cutover/report.mjs list "${OUTPUT:-.bascule-work}" "$WORK/verdict.json"
}
report_refs() {
  [[ -n ${CYCLE_ID:-} ]] || return 0
  run_job refs 840 900
  node deploy/cutover/report.mjs refs "${OUTPUT:-.bascule-work}/served-refs"
}
report_outputs() {
  [[ -n ${GITHUB_OUTPUT:-} ]] || return 0
  local key step value
  for key in backupId date manifestSha256 pgSha256 dumpStartedAt; do
    value=$(jq -r --arg key "$key" '.pin[$key]//""' "$WORK/record.json")
    case $key in backupId) key=backup_id;; date) key=backup_date;; manifestSha256) key=manifest_sha256;; pgSha256) key=pg_sha256;; dumpStartedAt) key=dump_started_at;; esac
    printf '%s=%s\n' "$key" "$value" >> "$GITHUB_OUTPUT"
  done
  for step in restore ddl docs recon reopen; do
    value=$(jq -r --arg step "$step" 'if .checkpoints[$step]=="completed" then "success" else "failure" end' "$WORK/record.json")
    if [[ $step == reopen && ${1:-1} != 0 ]]; then value=failure; fi
    printf 'o_%s=%s\n' "$step" "$value" >> "$GITHUB_OUTPUT"
  done
}
