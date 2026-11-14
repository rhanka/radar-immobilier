#!/usr/bin/env bash
# Future operator execution only. Reuse the controller's lock and recovery rules.
set -euo pipefail
umask 077
fail() { printf 'Fenêtre refusée : %s\n' "$*" >&2; exit 1; }
[[ ${ENV:-} == execution-prod ]] || fail 'execution-prod requis'
node deploy/prod-cutover/cli.cjs authorize
ENV=prod
for part in release cluster inventory close jobs render stages reopen smoke prepared switch rbac; do
  source "tools/make/cutover-$part.sh"
done
source deploy/prod-cutover/window-guards.sh
source deploy/prod-cutover/prod-bindings.sh
cutover_config
WORK=$(mktemp -d)
OWNED=0
ACQUIRED=0
cleanup() {
  local code=$?
  trap - EXIT
  stop_forwards
  if [[ $OWNED == 1 ]]; then
    if ! node deploy/prod-cutover/containers.cjs stop "$RUN"; then
      rm -rf "$WORK"
      exit 1
    fi
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
if [[ $1 == window-recover ]]; then
  [[ ${RUN:-} =~ ^[0-9a-f-]{36}$ ]] || fail 'RUN initial requis'
  "${k[@]}" get configmap radar-cutover-receipt -o json > "$WORK/receipt.json"
  jq -er '.data.receipt|fromjson' "$WORK/receipt.json" > "$WORK/record.json"
  jq -e --arg run "$RUN" '.run==$run and .manualV1220==true and .environment=="prod"
    and .checkpoints.reopen=="completed" and .checkpoints["manual-inventory"]=="completed"
    and .previousRelease!=null and .manualEnvironments!=null and .manualConfigmaps!=null' \
    "$WORK/record.json" >/dev/null || fail 'Reçu historique incompatible'
  validate_release "${PREVIOUS_RELEASE:-}"
  jq -e --slurpfile p "$PREVIOUS_RELEASE" '.previousRelease as $h|
    all(["gitSha","apiImage","uiImage"][]; . as $key|$h[$key]==$p[0][$key])' \
    "$WORK/record.json" >/dev/null || fail 'Manifeste historique divergent'
  node deploy/prod-cutover/containers.cjs guard "$RUN"
  executor_ended || fail 'Exécuteur précédent encore actif'
  ENV=execution-prod node deploy/prod-cutover/cli.cjs recover-authorize
  EXECUTOR=$(executor_identity)
  jq --argjson e "$EXECUTOR" '.executor=$e|.postReopenRecovery=true|
    del(.checkpoints.reopen,.checkpoints.close,.checkpoints["manual-deploy"])' \
    "$WORK/record.json" > "$WORK/next.json"
  mv "$WORK/next.json" "$WORK/record.json"
  jq -n --arg ns "$NS" --slurpfile r "$WORK/record.json" \
    '{apiVersion:"v1",kind:"ConfigMap",metadata:{name:"radar-change-lock",namespace:$ns},data:{record:($r[0]|tojson)}}' > "$WORK/new-lock.json"
  "${k[@]}" create -f "$WORK/new-lock.json" >/dev/null || fail 'Verrou concurrent ; récupération refusée'
  OWNED=1
  manual_cd_idle
  close_once
  exit
fi
if [[ $1 == window-start ]]; then
  validate_release "${RELEASE:-}"
  if [[ -n ${RUN:-} ]]; then
    lock_read; record_read
    jq -e '.kind=="cutover" and .manualV1220==true and .checkpoints.close==null
      and .checkpoints["manual-inventory"]==null' "$WORK/record.json" >/dev/null || fail 'Capture déjà terminée'
    node deploy/prod-cutover/containers.cjs guard "$RUN"
    lock_resume
  else lock_acquire cutover; fi
  jq '.manualV1220=true|.environment="prod"' "$WORK/record.json" > "$WORK/next.json"
  mv "$WORK/next.json" "$WORK/record.json"; record_save
  manual_cd_idle
  # Capture the previous release and consumers while they are still Ready.
  manual_deployed_release
  jq '.previousRelease=.release' "$WORK/record.json" > "$WORK/next.json"
  mv "$WORK/next.json" "$WORK/record.json"; record_save
  # Inventory the live release before installing the candidate's 6H ConfigMap.
  inventory
  manual_configuration_snapshot
  jq -e '.consumers|length>0' "$WORK/record.json" >/dev/null || fail 'Consommateurs initiaux requis'
  save_release "$RELEASE"
  checkpoint manual-inventory completed
  exit
fi
lock_read; record_read
jq -e '.kind=="cutover" and .manualV1220==true and .environment=="prod"
  and .checkpoints["manual-inventory"]=="completed"' "$WORK/record.json" >/dev/null || fail 'Inventaire de fenêtre requis'
node deploy/prod-cutover/containers.cjs guard "${RUN:-}"
lock_resume
export CUTOVER_LOCK_RUN="$RUN" CUTOVER_LOCK_EXECUTOR="$EXECUTOR"
case $1 in
  window-abort)
    jq -e '.checkpoints["manual-migrate"]==null and .postReopenRecovery!=true' "$WORK/record.json" >/dev/null || fail 'Restauration complète requise'
    close_once
    ENV=execution-prod node deploy/prod-cutover/cli.cjs abort-verify
    jq '.release=.previousRelease|.abortedBeforeDdl=true' "$WORK/record.json" > "$WORK/next.json"
    mv "$WORK/next.json" "$WORK/record.json"; record_save
    manual_restore_configmaps; manual_bindings previous
    restart_services; private_smoke
    reopen;;
  window-evidence)
    jq -e '.checkpoints.close=="completed"' "$WORK/record.json" >/dev/null || fail 'Drain requis'
    verify_closed || fail 'Consommateurs encore actifs'
    node -e 'const r=require("./deploy/prod-cutover/runtime.cjs");
      const record=r.json(process.argv[1]);
      if(!r.env.EVIDENCE || !r.path.isAbsolute(r.env.EVIDENCE) || /(^|\/)\.env/.test(r.env.EVIDENCE)) r.fail("evidence_path_required");
      r.output();
      r.fs.writeFileSync(r.env.EVIDENCE,JSON.stringify({run:record.run,release:r.SHA,
        instances:record.consumers,completedAt:record.closedAt})+"\n",{mode:0o600});' "$WORK/record.json";;
  window-configure)
    ENV=execution-prod node deploy/prod-cutover/cli.cjs configuration-check
    "${k[@]}" apply -f "$CONFIGURATION" >/dev/null
    checkpoint manual-configuration completed;;
  window-close)
    jq -e '.checkpoints["manual-configuration"]=="completed"' "$WORK/record.json" >/dev/null || fail 'Configuration approuvée requise'
    close_once
    jq 'del(.checkpoints["manual-deploy"])' "$WORK/record.json" > "$WORK/next.json"
    mv "$WORK/next.json" "$WORK/record.json"; record_save;;
  backup|migrate|transition|rollback|artifact-roles)
    jq -e '.checkpoints.close=="completed" and .checkpoints["manual-deploy"]==null' "$WORK/record.json" >/dev/null || fail 'Drain requis ; services arrêtés'
    verify_closed || fail 'Consommateurs encore actifs'
    if [[ $1 == migrate ]]; then checkpoint manual-migrate started; fi
    if [[ $1 == artifact-roles ]]; then ENV=execution-prod node deploy/prod-cutover/artifact-roles.cjs
    else ENV=execution-prod node deploy/prod-cutover/cli.cjs "$1"; fi;;
  window-deploy)
    ENV=execution-prod node deploy/prod-cutover/cli.cjs verify
    manual_bindings candidate
    restart_services
    private_smoke
    checkpoint manual-deploy completed;;
  window-rollback-services)
    ENV=execution-prod node deploy/prod-cutover/cli.cjs rollback-verify
    jq '.release=.previousRelease' "$WORK/record.json" > "$WORK/next.json"
    mv "$WORK/next.json" "$WORK/record.json"; record_save
    manual_restore_configmaps
    manual_bindings previous
    restart_services; private_smoke
    checkpoint manual-deploy completed;;
  window-reopen)
    jq -e '.checkpoints["manual-deploy"]=="completed"' "$WORK/record.json" >/dev/null || fail 'Recette privée requise'
    ENV=execution-prod node deploy/prod-cutover/cli.cjs reopen-authorize
    reopen;;
  *) fail 'Action inconnue';;
esac
