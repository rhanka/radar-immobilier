#!/usr/bin/env bash
# Use the same shared-host reservation as the qualified PW-C campaign.
recover_l5_resources() {
  local PROJECT="radar-$ENV" OWNER
  OWNER=$(printf '%s' "$ROOT/$ENV" | sha256sum | cut -d' ' -f1)
  local remaining
  remaining=$(docker ps -aq --filter "label=com.docker.compose.project=$PROJECT")
  remaining+=$(docker volume ls -q --filter "label=com.docker.compose.project=$PROJECT")
  remaining+=$(docker network ls -q --filter "label=com.docker.compose.project=$PROJECT")
  [[ -n $remaining ]] || return 0
  [[ -f $RUN_DIR/compose.yml && ! -L $RUN_DIR/compose.yml ]]
  export COMPOSE_DISABLE_ENV_FILE=1
  unset COMPOSE_FILE COMPOSE_PROFILES COMPOSE_ENV_FILES
  local -a compose=(docker compose --env-file /dev/null -p "$PROJECT" -f "$RUN_DIR/compose.yml")
  source tools/make/base-api-resources.sh
  exec 8>"${XDG_CACHE_HOME:-$HOME/.cache}/radar-docker-campaign.lock"
  flock 8
  # Never wait for an empty machine while our interrupted stack remains alive.
  # The project and owner labels must match before any cleanup is attempted.
  guarded_down > "$LOG_DIR/recovered-own-resources.log" 2>&1
  flock -u 8
}
acquire_l5_lock() {
  recover_l5_resources
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
