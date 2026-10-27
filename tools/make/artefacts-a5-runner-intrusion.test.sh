#!/usr/bin/env bash
set -euo pipefail
mode=${A5_GUARD_PROOF:-intrusion}
[[ $mode == intrusion || $mode == memory ]]
export A5_GUARD_PROOF=$mode
proof=$(mktemp -d "$PWD/tmp/a5-evidence/$mode-control.XXXXXX")
cat > "$proof/shell.sh" <<'SH'
# Add a synthetic observation only after our real test container starts.
# Every real foreign-stack observation still reaches the preflight unchanged.
docker() {
  command docker "$@"
  if [[ $A5_GUARD_PROOF == intrusion && $* == "ps --format {{.Names}}" ]] &&
    [[ -n $(command docker ps -q --filter "name=radar-$ENV-api-run-") ]]; then
    printf '%s\n' test-e2-int-qualification-synthetic-intrusion
  fi
}
awk() {
  if [[ $A5_GUARD_PROOF == memory && $* == '/MemAvailable/ {print $2} /proc/meminfo' ]] &&
    [[ -n $(command docker ps -q --filter "name=radar-$ENV-api-run-") ]]; then
    printf '0\n'
  else
    command awk "$@"
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
if [[ $mode == intrusion ]]; then
  grep -Fxq test-e2-int-qualification-synthetic-intrusion "$run_dir/occupancy-stop.log"
else
  grep -Fxq 'STOP: less than 8 GiB memory available' "$run_dir/memory-stop.log"
fi
[[ -s $run_dir/cleanup.log && ! -f $run_dir/residuals.log ]]
[[ -z $(docker ps -aq --filter "label=com.docker.compose.project=radar-$ENV") ]]
[[ -z $(docker volume ls -q --filter "label=com.docker.compose.project=radar-$ENV") ]]
[[ -z $(docker network ls -q --filter "label=com.docker.compose.project=radar-$ENV") ]]
printf 'PASS: synthetic %s stops the real campaign and removes owned resources\nCampaign: %s\n' "$mode" "$run_dir" |
  tee "$proof/result"
