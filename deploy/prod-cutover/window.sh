#!/usr/bin/env bash
# Future operator execution only. Reuse the controller's lock and recovery rules.
set -euo pipefail
umask 077
fail() { printf 'Fenêtre refusée : %s\n' "$*" >&2; exit 1; }
[[ ${ENV:-} == execution-prod ]] || fail 'execution-prod requis'
export KUBECONFIG="$HOME/.kube/radar-prod-tenant-admin.kubeconfig"
node deploy/prod-cutover/cli.cjs authorize
ENV=prod
for part in release cluster inventory close jobs render stages reopen smoke prepared switch rbac; do
  source "tools/make/cutover-$part.sh"
done
cutover_config
WORK=$(mktemp -d)
OWNED=0
ACQUIRED=0
cleanup() {
  local code=$?
  trap - EXIT
  stop_forwards
  if [[ $OWNED == 1 ]]; then
    if ((code != 0)) && jq -e '.checkpoints.reopen!=null' "$WORK/record.json" >/dev/null; then
      (set -e; stop_schedules; reclose_best_effort) || code=1
    fi
    jq '.executor.state="stopped"' "$WORK/record.json" > "$WORK/next.json"
    mv "$WORK/next.json" "$WORK/record.json"
    record_save || code=1
  fi
  rm -rf "$WORK"
  exit "$code"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
cluster_preflight
if [[ $1 == window-start ]]; then
  validate_release "${RELEASE:-}"
  if [[ -n ${RUN:-} ]]; then
    lock_read; record_read
    jq -e '.kind=="cutover" and .manualV1220==true and .checkpoints.close==null
      and .checkpoints["manual-inventory"]==null' "$WORK/record.json" >/dev/null || fail 'Capture déjà terminée'
    lock_resume
  else lock_acquire cutover; fi
  jq '.manualV1220=true|.environment="prod"' "$WORK/record.json" > "$WORK/next.json"
  mv "$WORK/next.json" "$WORK/record.json"; record_save
  # Capture the previous release and consumers while they are still Ready.
  deployed_release
  jq '.previousRelease=.release' "$WORK/record.json" > "$WORK/next.json"
  mv "$WORK/next.json" "$WORK/record.json"; record_save
  # Inventory the live release before installing the candidate's 6H ConfigMap.
  inventory
  jq -e '.consumers|length>0' "$WORK/record.json" >/dev/null || fail 'Consommateurs initiaux requis'
  save_release "$RELEASE"
  checkpoint manual-inventory completed
  exit
fi
lock_read; record_read
jq -e '.kind=="cutover" and .manualV1220==true and .environment=="prod"
  and .checkpoints["manual-inventory"]=="completed"' "$WORK/record.json" >/dev/null || fail 'Inventaire de fenêtre requis'
lock_resume
export CUTOVER_LOCK_RUN="$RUN" CUTOVER_LOCK_EXECUTOR="$EXECUTOR"
case $1 in
  window-configure)
    ENV=execution-prod node deploy/prod-cutover/cli.cjs configuration-check
    "${k[@]}" apply -f "$CONFIGURATION" >/dev/null
    checkpoint manual-configuration completed;;
  window-close)
    jq -e '.checkpoints["manual-configuration"]=="completed"' "$WORK/record.json" >/dev/null || fail 'Configuration approuvée requise'
    close_once
    jq 'del(.checkpoints["manual-deploy"])' "$WORK/record.json" > "$WORK/next.json"
    mv "$WORK/next.json" "$WORK/record.json"; record_save;;
  backup|migrate|transition|rollback)
    jq -e '.checkpoints.close=="completed" and .checkpoints["manual-deploy"]==null' "$WORK/record.json" >/dev/null || fail 'Drain requis ; services arrêtés'
    verify_closed || fail 'Consommateurs encore actifs'
    ENV=execution-prod node deploy/prod-cutover/cli.cjs "$1";;
  window-deploy)
    ENV=execution-prod node deploy/prod-cutover/cli.cjs verify
    restart_services
    private_smoke
    checkpoint manual-deploy completed;;
  window-rollback-services)
    ENV=execution-prod node deploy/prod-cutover/cli.cjs rollback-verify
    jq '.release=.previousRelease' "$WORK/record.json" > "$WORK/next.json"
    mv "$WORK/next.json" "$WORK/record.json"; record_save
    restart_services; private_smoke
    checkpoint manual-deploy completed;;
  window-reopen)
    jq -e '.checkpoints["manual-deploy"]=="completed"' "$WORK/record.json" >/dev/null || fail 'Recette privée requise'
    ENV=execution-prod node deploy/prod-cutover/cli.cjs reopen-authorize
    reopen;;
  *) fail 'Action inconnue';;
esac
