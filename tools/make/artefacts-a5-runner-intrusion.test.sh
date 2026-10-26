#!/usr/bin/env bash
set -euo pipefail
proof=$(mktemp -d "$PWD/tmp/a5-evidence/intrusion-control.XXXXXX")
cat > "$proof/shell.sh" <<'SH'
# Add a synthetic observation only after our real test container starts.
# Every real foreign-stack observation still reaches the preflight unchanged.
docker() {
  command docker "$@"
  if [[ $* == "ps --filter name=radar-test- --format {{.Names}}" ]] &&
    [[ -n $(command docker ps -q --filter "name=radar-$ENV-api-run-") ]]; then
    printf '%s\n' radar-test-synthetic-intrusion
  fi
}
SH
set +e
BASH_ENV="$proof/shell.sh" CMD='sleep 30' bash tools/make/artefacts-a5-run.sh > "$proof/run.log" 2>&1
status=$?
set -e
[[ $status == 143 ]]
run_dir=$(sed -n 's/^Evidence: //p' "$proof/run.log")
[[ $(cat "$run_dir/status") == 143 && ! -f $run_dir/result ]]
grep -Fxq radar-test-synthetic-intrusion "$run_dir/occupancy-stop.log"
[[ -s $run_dir/cleanup.log && ! -f $run_dir/residuals.log ]]
[[ -z $(docker ps -aq --filter "label=com.docker.compose.project=radar-$ENV") ]]
[[ -z $(docker volume ls -q --filter "label=com.docker.compose.project=radar-$ENV") ]]
[[ -z $(docker network ls -q --filter "label=com.docker.compose.project=radar-$ENV") ]]
printf 'PASS: synthetic foreign-stack intrusion stops the real campaign and removes owned resources\nCampaign: %s\n' "$run_dir" |
  tee "$proof/result"
