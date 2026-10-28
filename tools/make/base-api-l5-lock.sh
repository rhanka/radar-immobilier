#!/usr/bin/env bash
# Use the same shared-host reservation as the qualified PW-C campaign.
acquire_l5_lock() {
  exec 8>"${XDG_CACHE_HOME:-$HOME/.cache}/radar-docker-campaign.lock"
  interproject=0
  local shared="$HOME/.cache-tmp/sentropic-docker.lock"
  if [[ -e $shared ]]; then
    [[ -f $shared && ! -L $shared ]]
    exec 7<"$shared"
    interproject=1
  fi
  while :; do
    [[ $interproject == 0 ]] || flock -x 7
    if [[ -z $(docker ps -q) ]] && flock -w 1 8; then
      [[ -n $(docker ps -q) ]] || break
      flock -u 8
    fi
    [[ $interproject == 0 ]] || flock -u 7
    echo 'Waiting for shared campaign locks and an empty Docker machine'
    sleep 10
  done
  printf 'Radar lock held; interproject reservation=%s; Docker empty\n' "$interproject" > "$LOG_DIR/reservation.txt"
}
release_l5_lock() {
  [[ $interproject == 0 ]] || flock -u 7
  flock -u 8
}
