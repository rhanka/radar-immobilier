#!/usr/bin/env bash
# B2 extends B0's allowlist for the retained 6L2 regression profile only.
set -euo pipefail
mode=${1:-full}
[[ $mode == full || $mode == 6l2 || $mode == 6l2-mcp ]]
TOOLS=$(cd -- "$(dirname -- "$0")" && pwd)
source "$TOOLS/base-api-guards.sh"
require_env
ROOT=$(pwd -P)
PROJECT=radar-$ENV
SCOPE=$(git ls-files --cached --others --exclude-standard -- api/src/services/facets/lots \
  api/src/services/facets/lot-migration-report api/src/routes/scoped-lot-* \
  api/src/routes/lot-cutover-stream.test.ts api/src/services/chat/stream-bus*.test.ts \
  api/src/services/facets/projection-invalidation*.test.ts api/src/routes/scoped-projection-events*.test.ts \
  | sed -n 's|^api/\(.*\.test\.ts\)$|\1|p' | sort -u | tr '\n' ' ')
require_scope
TASK_DIR=$ROOT/tmp/base-api-evidence/$ENV
RUN_DIR=$TASK_DIR/runtime
LOG_DIR=$TASK_DIR/$(date -u +%Y%m%dT%H%M%S)-$$-b2-$mode
mkdir -p "$RUN_DIR" "$LOG_DIR"
printf 'Evidence: %s\n' "$LOG_DIR"
exec 9>"$RUN_DIR/lock"
flock -n 9 || { echo 'Runner already active' >&2; exit 2; }
OWNER=$(printf '%s' "$ROOT/$ENV" | sha256sum | cut -d' ' -f1)
export COMPOSE_DISABLE_ENV_FILE=1
unset COMPOSE_FILE COMPOSE_PROFILES COMPOSE_ENV_FILES
docker() {
  if [[ $1 == compose && " $* " == *' run '* ]]; then command docker "$@";
  elif [[ $1 == compose && ( " $* " == *' down '* || " $* " == *' up '* ) ]]; then
    timeout --signal=TERM --kill-after=5 180 docker "$@";
  else timeout --signal=TERM --kill-after=5 60 docker "$@"; fi
}
compose=(docker compose --env-file /dev/null -p "$PROJECT" -f "$RUN_DIR/compose.yml")
source "$TOOLS/base-api-resources.sh"
source "$TOOLS/base-api-compose.sh"
write_compose
df -h "$ROOT" | tee "$LOG_DIR/disk-before.log"
[[ $(df -Pk "$ROOT" | awk 'NR==2 {print $4}') -ge 10485760 ]] || exit 3
archive_sources
git ls-files -- ui/src ui/package.json ui/vitest.config.ts ui/tsconfig.json ui/tsconfig.node.json \
  packages/immo-mcp/config/immo-tools.v1.json packages/immo-mcp/config/immo-artifacts.v1.json \
  packages/immo-mcp/src/fixtures/immo-tools.v1.json \
  packages/immo-mcp/src/fixtures/immo-tools.provenance.v1.json \
  packages/immo-mcp/src/fixtures/immo-deployed-baseline.v1.json \
  tools/h4-mcp.mk deploy/k8s/41-immo-mcp-ingress.yaml > "$RUN_DIR/ui-candidates"
: > "$RUN_DIR/ui-paths"
while IFS= read -r path; do
  case $path in
    packages/immo-mcp/config/immo-tools.v1.json|packages/immo-mcp/config/immo-artifacts.v1.json|\
    packages/immo-mcp/src/fixtures/immo-tools.v1.json|packages/immo-mcp/src/fixtures/immo-tools.provenance.v1.json|\
    packages/immo-mcp/src/fixtures/immo-deployed-baseline.v1.json|tools/h4-mcp.mk|deploy/k8s/41-immo-mcp-ingress.yaml) ;;
    *) case /$path/ in */.env*|*/fixtures/*|*/input/*|*/reports/*|*/credentials*|*/secrets*) continue;; esac
      case $path in ui/src/*.ts|ui/src/*.svelte|ui/src/*.css|ui/package.json|ui/vitest.config.ts|ui/tsconfig*.json) ;;
        *) continue;; esac;;
  esac
  part=$path
  while [[ $part != . ]]; do
    [[ ! -L $part ]] || exit 2
    if [[ $part == */* ]]; then part=${part%/*}; else part=.; fi
  done
  printf '%s\n' "$path" >> "$RUN_DIR/ui-paths"
done < "$RUN_DIR/ui-candidates"
tar --verbatim-files-from --no-recursion -rf "$RUN_DIR/source.tar" -T "$RUN_DIR/ui-paths"
cat "$RUN_DIR/ui-paths" >> "$LOG_DIR/archived-paths.txt"
sha256sum "$RUN_DIR/source.tar" > "$LOG_DIR/source.sha256"
verify_ownership
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
guarded_down
(
  while sleep 10; do
    if [[ $(df -Pk "$ROOT" | awk 'NR==2 {print $4}') -lt 10485760 ]]; then
      echo 'STOP: less than 10 GiB free' > "$LOG_DIR/disk-stop.log"
      kill -TERM "$$"; exit
    fi
  done
) 9>&- > "$LOG_DIR/disk-monitor.log" 2>&1 &
MONITOR=$!
"${compose[@]}" up -d --wait postgres
export BASE_API_RUN_PID=$$
"${compose[@]}" run --rm --no-deps -T api bash -ec \
  'tar -xf /source.tar -C /workspace; exec bash tools/make/base-api-b2-container.sh "$1" "$2"' -- "$SCOPE" "$mode" \
  > >(tee "$LOG_DIR/regression.log") 2>&1 &
RUN_PID=$!
wait "$RUN_PID"
RUN_PID=
if [[ $mode == full ]]; then assert_tests_ran "$LOG_DIR/tests.tsv"; fi
echo "PASS B2 $mode profile" > "$LOG_DIR/result"
