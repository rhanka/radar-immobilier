#!/usr/bin/env bash
# Operator dispatcher for an already prepared, owned disposable campaign.
set -euo pipefail
action=${1:-}
TOOLS=$(cd -- "$(dirname -- "$0")" && pwd)
source "$TOOLS/base-api-guards.sh"
require_env
[[ $action == activate || $action == resume ]] || exit 2
workspace=${BASE_API_WORKSPACE:-}
actor=${BASE_API_ACTOR:-}
reason=${BASE_API_REASON:-}
evidence=${BASE_API_MAINTENANCE_EVIDENCE:-}
[[ $workspace =~ ^[a-fA-F0-9]{8}(-[a-fA-F0-9]{4}){3}-[a-fA-F0-9]{12}$ ]] || {
  echo 'Required UUID: BASE_API_WORKSPACE' >&2; exit 2;
}
[[ -n $actor && ${#actor} -le 256 && $actor != *[$'\r\n']* ]] || exit 2
[[ -n $reason && ${#reason} -le 512 && $reason != *[$'\r\n']* ]] || exit 2
[[ $evidence =~ ^tmp/base-api-evidence/[a-zA-Z0-9_./-]+\.json$ && $evidence != *..* ]] || exit 2
part=$evidence
while [[ $part != . ]]; do
  [[ ! -L $part && ${part##*/} != .env* ]] || exit 2
  if [[ $part == */* ]]; then part=${part%/*}; else part=.; fi
done
[[ -f $evidence && -s $evidence ]] || { echo 'Maintenance evidence file required' >&2; exit 2; }
script=api/src/scripts/base-api-personal-activation.ts
allowed_path "$script"
[[ -s $script ]] || { echo 'Operator implementation not received' >&2; exit 2; }
ROOT=$(pwd -P)
PROJECT=radar-$ENV
RUN_DIR=$ROOT/tmp/base-api-evidence/$ENV/runtime
for file in "$RUN_DIR" "$RUN_DIR/compose.yml" "$RUN_DIR/source.tar"; do [[ ! -L $file && -e $file ]] || exit 2; done
exec 9>"$RUN_DIR/lock"
flock -n 9 || { echo 'Runner already active' >&2; exit 2; }
OWNER=$(printf '%s' "$ROOT/$ENV" | sha256sum | cut -d' ' -f1)
export COMPOSE_DISABLE_ENV_FILE=1
unset COMPOSE_FILE COMPOSE_PROFILES COMPOSE_ENV_FILES
docker() { timeout --signal=TERM --kill-after=5 180 docker "$@"; }
source "$TOOLS/base-api-resources.sh"
verify_ownership
[[ -n $(docker ps -q --filter "label=com.docker.compose.project=$PROJECT" --filter 'label=com.docker.compose.service=postgres') ]] || {
  echo 'An owned synthetic campaign database must already be running' >&2; exit 2;
}
[[ $(tar -xOf "$RUN_DIR/source.tar" "$script" | sha256sum) == "$(sha256sum < "$script")" ]] || exit 2
compose=(docker compose --env-file /dev/null -p "$PROJECT" -f "$RUN_DIR/compose.yml")
"${compose[@]}" run --rm --no-deps -T --volume "$ROOT/$evidence:/maintenance-evidence.json:ro" \
  api node_modules/.bin/tsx "$script" "$action" --workspace "$workspace" --actor "$actor" \
  --reason "$reason" --maintenance-evidence /maintenance-evidence.json
