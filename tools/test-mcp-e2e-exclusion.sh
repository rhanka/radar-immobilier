#!/bin/bash
# Execute both ordinary recipes against real Vitest canaries, then remove each
# exclusion in a copy and require that the previously excluded suite fails.
set -euo pipefail
case "${ENV:-}" in
  test-*) ;;
  *) echo "[test-e2e-exclusion] refused: ENV must be test-*, got '${ENV:-}'" >&2; exit 1;;
esac
root=$PWD
mkdir -p tmp
fixture=$(mktemp -d "$root/tmp/h4-e2e-canary.XXXXXX")
project="${ENV}-canary"
original_path="$PATH"
isolation_bin=
real_started=0
isolated_make() {
  env -u DOCKER_COMPOSE -u COMPOSE -u COMPOSE_PROJECT_NAME -u COMPOSE_FILES -u COMPOSE_DISABLE_ENV_FILE \
    make "$@" DOCKER_COMPOSE='docker compose' COMPOSE_PROJECT_NAME="radar-${project}" COMPOSE_DISABLE_ENV_FILE=1 ENV="$project"
}
cleanup() {
  if [ "$real_started" = 1 ]; then
    isolated_make --no-print-directory -f "$root/tools/h4-mcp.mk" down \
      API_PORT="$API_PORT" UI_PORT="$UI_PORT" MAILDEV_UI_PORT="$MAILDEV_UI_PORT"
  fi
  if [ -n "$isolation_bin" ]; then rm -rf "$isolation_bin"; fi
}
trap cleanup EXIT
mkdir -p "$fixture/packages/immo-mcp/src" "$fixture/tools"
cp package-lock.json docker-compose.test.yml "$fixture/"
cp packages/immo-mcp/package.json "$fixture/packages/immo-mcp/"
printf '%s\n' '{"name":"radar-immobilier-workspace","version":"0.0.0","private":true,"type":"module","workspaces":["packages/immo-mcp"]}' > "$fixture/package.json"
printf '%s\n' 'import { it, expect } from "vitest";' 'it("runs the ordinary suite", () => expect(true).toBe(true));' > "$fixture/packages/immo-mcp/src/ordinary.test.ts"
printf '%s\n' 'import { it } from "vitest";' 'it("detects service E2E selection", () => { throw new Error("H4_E2E_EXCLUSION_CANARY"); });' > "$fixture/packages/immo-mcp/src/probe.e2e.test.ts"
cp "$root/tools/artifact-host.mk" "$fixture/tools/artifact-host.mk"
cp "$root/tools/immo-mcp-test.mk" "$fixture/tools/immo-mcp-test.mk"
isolation_bin=$(mktemp -d "$root/tmp/h4-e2e-isolation-bin.XXXXXX")
isolation_log="$fixture/isolation-docker.log"
printf '%s\n' '#!/bin/sh' '{ printf "env=%s project=%s" "$COMPOSE_DISABLE_ENV_FILE" "$COMPOSE_PROJECT_NAME"; printf " <%s>" "$@"; printf "\n"; } >> "$ISOLATION_LOG"' > "$isolation_bin/docker"
chmod +x "$isolation_bin/docker"
export ISOLATION_LOG="$isolation_log"
export PATH="$isolation_bin:$PATH"
export DOCKER_COMPOSE='docker compose -p radar-dev'
export COMPOSE='docker compose -p radar-dev'
export COMPOSE_PROJECT_NAME='radar-dev'
export COMPOSE_FILES='-f docker-compose.yml -p radar-dev'
export COMPOSE_DISABLE_ENV_FILE=0
check_isolation_log() {
  if [ ! -s "$isolation_log" ] || grep -Fv "env=1 project=radar-${project} <compose> <--env-file> </dev/null> <-p> <radar-${project}>" "$isolation_log"; then
    echo "[test-e2e-exclusion] FAIL: compose isolation $1 missed pinned command/project" >&2
    cat "$isolation_log" >&2
    exit 1
  fi
  if grep -Fq 'radar-dev' "$isolation_log"; then
    echo "[test-e2e-exclusion] FAIL: compose isolation $1 leaked radar-dev" >&2
    cat "$isolation_log" >&2
    exit 1
  fi
  if [ "$(grep -oF '<-p>' "$isolation_log" | wc -l)" -ne "$(wc -l < "$isolation_log")" ]; then
    echo "[test-e2e-exclusion] FAIL: compose isolation $1 must have one -p per call" >&2
    exit 1
  fi
  if ! grep -Fq -- "<$2>" "$isolation_log" || ! grep -Fq '<down> <-v> <--remove-orphans>' "$isolation_log"; then
    echo "[test-e2e-exclusion] FAIL: compose isolation $1 missed $2 call" >&2
    exit 1
  fi
  cat "$isolation_log"
  echo "[test-e2e-exclusion] PASS: compose isolation $1"
}
for spec in artifact-host.mk:down immo-mcp-test.mk:down; do
  runner=${spec%:*}
  target=${spec#*:}
  : > "$isolation_log"
  make -C "$fixture" --no-print-directory -f "tools/$runner" "$target" \
    COMPOSE_FILES='-f docker-compose.test.yml' \
    API_PORT="$API_PORT" UI_PORT="$UI_PORT" MAILDEV_UI_PORT="$MAILDEV_UI_PORT" \
    COMPOSE='docker compose -p radar-dev' DOCKER_COMPOSE='docker compose -p radar-dev' COMPOSE_PROJECT_NAME='radar-dev' COMPOSE_DISABLE_ENV_FILE=0 ENV="$project" > /dev/null 2>&1
  check_isolation_log "$runner:$target" down
  cp "$isolation_log" "$fixture/$runner.$target.docker.log"
done
for spec in artifact-host.mk:test-mcp immo-mcp-test.mk:test-immo-mcp; do
  runner=${spec%:*}
  target=${spec#*:}
  : > "$isolation_log"
  make -C "$fixture" --no-print-directory -f "tools/$runner" "$target" \
    COMPOSE_FILES='-f docker-compose.test.yml' \
    API_PORT="$API_PORT" UI_PORT="$UI_PORT" MAILDEV_UI_PORT="$MAILDEV_UI_PORT" \
    COMPOSE='docker compose -p radar-dev' DOCKER_COMPOSE='docker compose -p radar-dev' COMPOSE_PROJECT_NAME='radar-dev' COMPOSE_DISABLE_ENV_FILE=0 ENV="$project" > /dev/null 2>&1
  check_isolation_log "$runner:$target" run
  cp "$isolation_log" "$fixture/$runner.$target.docker.log"
done
: > "$isolation_log"
if ENV=e2e-h4-refusal bash "$root/tools/test-mcp-e2e-exclusion.sh" > "$fixture/e2e-refusal.log" 2>&1; then exit 1; fi
grep -Fq 'refused: ENV must be test-*' "$fixture/e2e-refusal.log"
test ! -s "$isolation_log"
echo '[test-e2e-exclusion] PASS: e2e-* refused before Docker (0 calls)'
PATH="$original_path"
unset ISOLATION_LOG DOCKER_COMPOSE COMPOSE COMPOSE_PROJECT_NAME COMPOSE_FILES COMPOSE_DISABLE_ENV_FILE
echo "[test-e2e-exclusion] logs: $fixture"
if [ "${1:-}" = --isolation-only ]; then exit 0; fi
real_started=1
for spec in artifact-host.mk:test-mcp immo-mcp-test.mk:test-immo-mcp; do
  runner=${spec%:*}
  target=${spec#*:}
  # Only the synthetic standalone compose is needed for these two fixture files.
  args=(-C "$fixture" --no-print-directory -f "tools/$runner" "$target"
    COMPOSE_FILES='-f docker-compose.test.yml'
    API_PORT="$API_PORT" UI_PORT="$UI_PORT" MAILDEV_UI_PORT="$MAILDEV_UI_PORT")
  if ! isolated_make "${args[@]}" > "$fixture/$runner.normal.log" 2>&1; then
    cat "$fixture/$runner.normal.log"; exit 1
  fi
  grep -Eq '1 passed' "$fixture/$runner.normal.log"
  if grep -Fq H4_E2E_EXCLUSION_CANARY "$fixture/$runner.normal.log"; then exit 1; fi
  echo "[test-e2e-exclusion] PASS: $runner:$target excludes the failing E2E suite"
  sed "s/ --exclude '[^']*\.e2e\.test\.ts'//" "$root/tools/$runner" > "$fixture/tools/$runner"
  if cmp -s "$root/tools/$runner" "$fixture/tools/$runner"; then
    echo '[test-e2e-exclusion] FAIL: inverse did not change the recipe'; exit 1
  fi
  if isolated_make "${args[@]}" > "$fixture/$runner.inverse.log" 2>&1; then
    echo '[test-e2e-exclusion] FAIL: inverse accepted the E2E canary'; exit 1
  fi
  grep -Fq H4_E2E_EXCLUSION_CANARY "$fixture/$runner.inverse.log"
  grep -Fq probe.e2e.test.ts "$fixture/$runner.inverse.log"
  cp "$root/tools/$runner" "$fixture/tools/$runner"
  cmp "$root/tools/$runner" "$fixture/tools/$runner"
  echo "[test-e2e-exclusion] PASS: $runner:$target inverse fails on the E2E canary; restored cmp=0"
done
echo "[test-e2e-exclusion] logs: $fixture"
