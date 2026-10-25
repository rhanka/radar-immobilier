#!/usr/bin/env bash
# Inspect only identity labels and mounts; never dump container environments.
resource_ids() {
  docker ps -aq --filter "label=com.docker.compose.project=$PROJECT" || return 1
  docker volume ls -q --filter "label=com.docker.compose.project=$PROJECT" || return 1
  docker network ls -q --filter "label=com.docker.compose.project=$PROJECT" || return 1
}
verify_resource() {
  local kind=$1 id=$2 labels=.Labels identity name volume
  [[ $kind != container ]] || labels=.Config.Labels
  identity=$(docker "$kind" inspect --format \
    "{{ index $labels \"com.docker.compose.project\" }}|{{ index $labels \"org.radar.base.owner\" }}" "$id") || return 1
  [[ $identity == "$PROJECT|$OWNER" ]] || { echo "Foreign $kind: $id" >&2; return 1; }
  name=$(docker "$kind" inspect --format '{{.Name}}' "$id") || return 1
  name=${name#/}
  [[ $name == "$PROJECT-"* || $name == "${PROJECT}_"* ]] || return 1
  if [[ $kind == container ]]; then
    local mounts
    mounts=$(docker container inspect --format '{{range .Mounts}}{{if eq .Type "volume"}}{{println .Name}}{{end}}{{end}}' "$id") || return 1
    while IFS= read -r volume; do
      [[ -z $volume ]] || verify_resource volume "$volume" || return 1
    done <<< "$mounts"
  fi
}
verify_ownership() {
  require_env || return
  [[ $PROJECT == "radar-$ENV" ]] || return 1
  local kind ids id
  for kind in container volume network; do
    case $kind in
      container) ids=$(docker ps -aq --filter "label=com.docker.compose.project=$PROJECT") || return 1;;
      *) ids=$(docker "$kind" ls -q --filter "label=com.docker.compose.project=$PROJECT") || return 1;;
    esac
    while IFS= read -r id; do
      [[ -z $id ]] || verify_resource "$kind" "$id" || return 1
    done <<< "$ids"
  done
}
guarded_down() {
  verify_ownership || return 1
  "${compose[@]}" down -v --remove-orphans || return 1
  local remaining
  remaining=$(resource_ids) || return 1
  [[ -z $remaining ]] || { printf 'Residual resources: %s\n' "$remaining" >&2; return 1; }
}
cleanup() {
  local status=$?
  trap - EXIT INT TERM
  [[ -z ${RUN_PID:-} ]] || { kill "$RUN_PID" 2>/dev/null || true; wait "$RUN_PID" 2>/dev/null || true; }
  [[ -z ${MONITOR:-} ]] || { kill "$MONITOR" 2>/dev/null || true; wait "$MONITOR" 2>/dev/null || true; }
  "${compose[@]}" logs --no-color > "$LOG_DIR/compose.log" 2>&1 || true
  "${compose[@]}" ps -a > "$LOG_DIR/compose-state.log" 2>&1 || true
  if ! guarded_down > "$LOG_DIR/cleanup.log" 2>&1; then
    echo "Cleanup failed; guarded retry: make -f tools/make/base-api.mk base-api-clean API_PORT=18910 UI_PORT=15910 MAILDEV_UI_PORT=11910 ENV=$ENV" \
      | tee "$LOG_DIR/residuals.log" >&2
    [[ $status != 0 ]] || status=1
    rm -f "$LOG_DIR/result"
  fi
  printf '%s\n' "$status" > "$LOG_DIR/status"
  exit "$status"
}
