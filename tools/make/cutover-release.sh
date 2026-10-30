#!/usr/bin/env bash
# Pure validation; no cluster changes and no environment-file discovery.
cutover_config() {
  case ${ENV:-} in preprod|prod) ;; *) fail 'ENV must be preprod or prod';; esac
  [[ -z ${NAMESPACE:-} && -z ${PREPROD_NAMESPACE:-} ]] || fail 'Namespace overrides are forbidden'
  CONFIG=deploy/cutover/config.json
  NS=$(jq -r --arg env "$ENV" '.[$env].namespace' "$CONFIG")
  URL=$(jq -r --arg env "$ENV" '.[$env].url' "$CONFIG")
  k=(cluster_request -n "$NS")
}
cluster_request() {
  local remaining=15
  if [[ -n ${FAST_DEADLINE:-} ]]; then
    remaining=$((FAST_DEADLINE-SECONDS))
    ((remaining>0)) || budget_exhausted
    ((remaining<=15)) || remaining=15
  fi
  if [[ -n ${REQUEST_DEADLINE:-} ]]; then
    remaining=$((REQUEST_DEADLINE-SECONDS))
    ((remaining>0)) || fail 'Shared cluster-operation deadline exceeded'
    ((remaining<=15)) || remaining=15
    if [[ -n ${FAST_DEADLINE:-} ]] && ((FAST_DEADLINE-SECONDS < remaining)); then remaining=$((FAST_DEADLINE-SECONDS)); fi
    ((remaining>0)) || budget_exhausted
  fi
  command kubectl --request-timeout="${remaining}s" "$@"
}
validate_release() {
  local path
  [[ -f $1 && ! -L $1 ]] || fail 'Release must be a regular manifest file'
  path=$(realpath -e "$1") || fail 'Release manifest is absent'
  [[ $path != */.env* ]] || fail 'Environment files are never release inputs'
  jq -e -f tools/make/cutover-release.jq "$1" >/dev/null 2>&1 || fail 'Invalid release manifest'
}
generate_release() {
  jq -n --arg sha "$GIT_SHA" --arg api "$API_DIGEST" --arg ui "$UI_DIGEST" \
    '{version:1,gitSha:$sha,apiImage:("ghcr.io/rhanka/radar-api@"+$api),uiImage:("ghcr.io/rhanka/radar-ui@"+$ui),apiServedSha:$sha,uiServedSha:$sha[0:7],dataMigration:"6h"}' > "$1"
  validate_release "$1"
}
budget_exhausted() {
  # The marker survives the stage subshell; the controller then rolls back and reopens.
  : > "$WORK/budget-exhausted"
  fail 'Five-minute cutover budget exhausted; rolling back to the previous release'
}
budget_check() {
  [[ -z ${FAST_DEADLINE:-} ]] || ((SECONDS < FAST_DEADLINE)) || budget_exhausted
}
