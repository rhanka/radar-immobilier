#!/usr/bin/env bash
set -euo pipefail
if [[ ${PANIERS_VERIFY_SNAPSHOT:-} != 1 ]]; then
  export PANIERS_VERIFY_SNAPSHOT=1
  exec bash -c "$(cat "$0")" -- "$@"
fi
case "$ENV" in test-*|e2e-*) ;; *) exit 2;; esac
task_dir="$PWD/tmp/paniers-${LOT,,}"
log_dir="$task_dir/logs/${EVIDENCE_TAG:-$1}"
runtime_dir="$task_dir/runs/$ENV-${EVIDENCE_TAG:-$1}"
checkpoint_dir="${CHECKPOINT_DIR:-$task_dir/checkpoints}"
mkdir -p "$log_dir" "$checkpoint_dir" "$runtime_dir" "$task_dir/npm-cache"
export COMPOSE_DISABLE_ENV_FILE=1
export COMPOSE_PROJECT_NAME="radar-$ENV"
export POSTGRES_USER=radar POSTGRES_PASSWORD=synthetic-only POSTGRES_DB=radar
export S3_REGION=test S3_BUCKET=synthetic S3_ACCESS_KEY=synthetic S3_SECRET_KEY=synthetic
export OPENAI_API_KEY= ANTHROPIC_API_KEY= GEMINI_API_KEY= GOOGLE_API_KEY= MISTRAL_API_KEY= COHERE_API_KEY=
postgres_tmpfs=512m
# Parallel CI discovery creates many disposable databases simultaneously.
if [[ "$1" == api-ci ]]; then postgres_tmpfs=8g; fi
cat > "$runtime_dir/compose.yml" <<YAML
services:
  postgres:
    volumes: !reset []
    tmpfs:
      - /var/lib/postgresql/data:size=$postgres_tmpfs
    environment:
      POSTGRES_INITDB_ARGS: --no-sync
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -h 127.0.0.1 -U radar -d radar"]
      start_period: 180s
  api:
    entrypoint: []
    command: ["sleep", "infinity"]
    volumes: !override
      - $runtime_dir/source.tar:/source.tar:ro
      - $log_dir:/evidence
      - $checkpoint_dir:/checkpoints:ro
      - $task_dir/npm-cache:/npm-cache
      - runtime:/workspace
    environment:
      NODE_ENV: test
      LOG_LEVEL: silent
      LOT: '$LOT'
      LOT_MIGRATION_DB_TEST: '1'
volumes:
  runtime:
YAML
compose=(docker compose --env-file /dev/null -p "radar-$ENV" -f docker-compose.yml -f docker-compose.test.yml -f "$runtime_dir/compose.yml")
if [[ "$1" == diagnose ]]; then
  "${compose[@]}" logs --no-color --tail=30 postgres
  while IFS= read -r container; do
    docker top "$container" -eo pid,etime,comm
    docker logs --tail=30 "$container"
  done < <(docker ps -q --filter "label=com.docker.compose.project=radar-$ENV" --filter label=com.docker.compose.service=api)
  exit
fi
if [[ "$1" == clean ]]; then
  "${compose[@]}" down -v --remove-orphans
  exit
fi
if [[ "$1" == inspect ]]; then
  uptime
  docker ps -a --filter "label=com.docker.compose.project=radar-$ENV" --format '{{.Names}} {{.Status}}'
  docker volume ls --filter "label=com.docker.compose.project=radar-$ENV" --format '{{.Name}}'
  docker network ls --filter "label=com.docker.compose.project=radar-$ENV" --format '{{.Name}}'
  exit
fi
df -h "$PWD" /var/lib/docker | tee "$log_dir/disk-before.log"
uptime | tee "$log_dir/host-load-before.log"
if [[ $(df -Pk "$PWD" | awk 'NR==2 {print $4}') -lt 10485760 ]]; then
  echo 'STOP: less than 10 GiB available' >&2
  exit 3
fi
cleanup() {
  task_status=$?
  trap - EXIT
  if [[ -n ${disk_monitor:-} ]]; then kill "$disk_monitor" 2>/dev/null || true; fi
  "${compose[@]}" logs --no-color postgres > "$log_dir/postgres.log" 2>&1 || true
  "${compose[@]}" ps -a > "$log_dir/compose-state.log" 2>&1 || true
  "${compose[@]}" down -v --remove-orphans || { [[ $task_status != 0 ]] || task_status=1; }
  printf '%s\n' "$task_status" > "$log_dir/$1.status"
  exit "$task_status"
}
action=$1
trap 'cleanup "$action"' EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
# A fresh stack for every campaign, including retries after interruption.
"${compose[@]}" down -v --remove-orphans
(
  while sleep 10; do
    if [[ $(df -Pk "$PWD" | awk 'NR==2 {print $4}') -lt 10485760 ]]; then
      echo 'STOP: less than 10 GiB available' | tee "$log_dir/disk-stop.log" >&2
      "${compose[@]}" down -v --remove-orphans
      exit
    fi
  done
) &
disk_monitor=$!
# Only source/manifests: environment files, Git metadata and host dependencies
# are excluded before reading file contents. The container sees no host tree.
tar --exclude='.env*' --exclude=node_modules --exclude=dist --exclude=.svelte-kit \
  -cf "$runtime_dir/source.tar" api packages ui radar/ontology tools/make tools/h4-mcp.mk deploy/k8s/41-immo-mcp-ingress.yaml deploy/k8s/scrape/run-chunks.sh package.json package-lock.json tsconfig.base.json eslint.config.js \
  docs/spec/reports/study-2026-07/report.md docs/spec/reports/study-2026-07/slides.html
sha256sum "$runtime_dir/source.tar" > "$log_dir/source.sha256"
if [[ "$LOT" == 6J || "$LOT" == 6L2 ]]; then
  case "$LOT" in
    6J) echo "${RUNNER_VERSION:-6J-2}" > "$log_dir/runner-version.txt" ;;
    6L2) echo "${RUNNER_VERSION:-6L2-3}" > "$log_dir/runner-version.txt" ;;
  esac
  tar -tf "$runtime_dir/source.tar" > "$log_dir/archived-paths.txt"
  tar -tf "$runtime_dir/source.tar" | while IFS= read -r path; do
    [[ "$path" == */ ]] || sha256sum "$path"
  done > "$log_dir/archived-files.sha256"
fi
case "$1" in
  verify|test-api|mutation-proof|astra-proof|fix-proof|fix2-proof) "${compose[@]}" up -d --wait postgres ;;
  api-ci) "${compose[@]}" up -d --wait postgres minio ;;
esac
"${compose[@]}" run --rm --no-deps -T api sh -ec '
  tar -xf /source.tar
  npm ci --ignore-scripts --no-audit --no-fund --cache /npm-cache --prefer-offline
  cat > /workspace/api/vitest.isolated.config.ts <<'"'"'CONFIG'"'"'
import config from "./vitest.config.js";
export default { ...config, envDir: false, test: { ...config.test, fileParallelism: false, maxWorkers: 2 } };
CONFIG
  cat > /workspace/api/vitest.ci.config.ts <<'"'"'CONFIG'"'"'
import config from "./vitest.config.js";
export default { ...config, envDir: false };
CONFIG
  case "$1" in
    build) npm run build --workspace=api ;;
    typecheck-ui) npm run typecheck --workspace=ui ;;
    lint-ui) npx --no-install eslint ui/src ;;
    verify|typecheck) npm run typecheck --workspace=api ;;
    checkpoints)
      for snapshot in /checkpoints/*.tar; do
        number=$(basename "$snapshot" .tar)
        rm -rf api/src api/drizzle ui/src packages/immo-mcp/src
        tar -xf "$snapshot"
        npm run typecheck --workspace=api > "/evidence/checkpoint-$number.log" 2>&1 || {
          cat "/evidence/checkpoint-$number.log"; exit 1;
        }
        if [ "$LOT" != 6J ]; then
        ./node_modules/.bin/tsc --noEmit -p packages/immo-mcp/tsconfig.json >> "/evidence/checkpoint-$number.log" 2>&1 || {
          cat "/evidence/checkpoint-$number.log"; exit 1;
        }
        if [ -f ui/src/lib/signals/signal-facet-workspace.ts ]; then
          ./node_modules/.bin/tsc --noEmit --skipLibCheck --strict --target ES2022 --module ESNext \
            --moduleResolution Bundler ui/src/lib/signals/signal-facet-workspace*.ts >> "/evidence/checkpoint-$number.log" 2>&1 || {
            cat "/evidence/checkpoint-$number.log"; exit 1;
          }
        fi
        fi
        if [ -f ui/src/lib/signals/signal-projection-revision.ts ]; then
          ./node_modules/.bin/tsc --noEmit --skipLibCheck --strict --target ES2022 --module ESNext \
            --moduleResolution Bundler ui/src/lib/signals/signal-projection*.ts >> "/evidence/checkpoint-$number.log" 2>&1 || {
            cat "/evidence/checkpoint-$number.log"; exit 1;
          }
        fi
        grep "^$number|" /checkpoints/manifest | cut -d "|" -f 2 > "/evidence/checkpoint-$number.pass"
        echo "checkpoint-$number: typecheck PASS"
      done
      ;;
  esac
  if [ "$1" = fix2-proof ]; then
    test "$LOT" = 6J
    bash /workspace/tools/make/paniers-lot6j-fix2-mutation.sh
    exit
  fi
  if [ "$1" = fix-proof ]; then
    test "$LOT" = 6J
    bash /workspace/tools/make/paniers-lot6j-fix-mutation.sh
    exit
  fi
  if { [ "$LOT" = 6L1 ] || [ "$LOT" = 6L2 ]; } && { [ "$1" = verify ] || [ "$1" = typecheck ]; }; then
    ./node_modules/.bin/tsc --noEmit --skipLibCheck --strict --target ES2022 --module ESNext \
      --moduleResolution Bundler ui/src/lib/signals/signal-projection*.ts
  fi
  if [ "$1" = astra-proof ]; then
    test "$LOT" = 6H
    bash /workspace/tools/make/paniers-lot6h-fix-mutation.sh
    exit
  fi
  if [ "$1" = mutation-proof ]; then
    case "$LOT" in
      6I) bash /workspace/tools/make/paniers-lot6i-mutation.sh ;;
      6J) bash /workspace/tools/make/paniers-lot6j-mutation.sh ;;
      6L1) bash /workspace/tools/make/paniers-lot6l1-mutation.sh ;;
      6L2) bash /workspace/tools/make/paniers-lot6l2-mutation.sh ;;
      *) exit 2 ;;
    esac
    exit
  fi
  if [ "$1" = regression ] || [ "$1" = test-ui ]; then
    cat > /workspace/ui/vitest.isolated.config.ts <<'"'"'CONFIG'"'"'
import config from "./vitest.config.js";
export default { ...config, envDir: false, test: { ...config.test, fileParallelism: false, maxWorkers: 2 } };
CONFIG
    if [ "$1" = test-ui ]; then
      set -f
      npm run test --workspace=ui -- --config vitest.isolated.config.ts $2
      exit
    fi
    npm run test --workspace=ui -- --config vitest.isolated.config.ts \
      facets 6a-head 6b-version signaux-reglements signal-facets-client SignalFacetControls selection-bucket selection-camera signal-facet-scope \
      $(if [ "$LOT" = 6I ] || [ "$LOT" = 6J ] || [ "$LOT" = 6L1 ] || [ "$LOT" = 6L2 ]; then echo signal-facet-workspace; fi) \
      $(if [ "$LOT" = 6L1 ] || [ "$LOT" = 6L2 ]; then echo signal-projection; fi) \
      $(if [ "$LOT" = 6L2 ]; then echo signal-projection-invalidation; fi)
    cd /workspace/packages/immo-mcp
    ../../node_modules/.bin/tsc --noEmit -p tsconfig.json
    ../../node_modules/.bin/vitest run --config /workspace/api/vitest.isolated.config.ts src
    exit
  fi
  case "$1" in
    verify|lint)
      case "$LOT" in
        6G) npx --no-install eslint api/src/services/workspaces api/src/routes/workspaces.ts api/src/scripts/init-workspace-authority.ts ;;
        6H) npx --no-install eslint api/src/services/facets api/src/routes/scoped-signal-facets*.ts api/src/scripts/attach-personal-history.ts api/src/services/workspaces/authority*.ts api/src/services/workspaces/migration.test.ts packages/immo-mcp/src/workspace-context*.ts packages/immo-mcp/src/data-source.ts ui/src/lib/signals/signal-facet-scope*.ts ;;
        6I) npx --no-install eslint api/src/services/facets api/src/routes/scoped-workspace-archive*.ts ui/src/lib/signals/signal-facet-workspace*.ts ;;
        6J) npx --no-install eslint api/src/services/facets/lots api/src/routes/scoped-lot-*.ts api/src/services/facets/activation-db.test.ts api/src/services/workspaces/cli-db.test.ts ;;
        6L1) npx --no-install eslint api/src/services/facets/projection*.ts api/src/services/facets/scoped-writer.ts api/src/services/facets/workspace-writer.ts api/src/services/graph/graph-store.ts api/src/routes/scoped-projection*.ts ui/src/lib/signals/signal-projection*.ts ;;
        6L2) npx --no-install eslint api/src/services/facets/projection-invalidation*.ts api/src/routes/scoped-projection-events*.ts ui/src/lib/signals/signal-projection-invalidation*.ts ;;
        *) npx --no-install eslint api/src/services/facets ;;
      esac
      ;;
  esac
  case "$1" in
    verify|test-api|api-ci)
      LOG_LEVEL=info npm run db:migrate --workspace=api
      LOG_LEVEL=info npm run db:migrate --workspace=api
      cd api
      if [ "$1" = api-ci ]; then
        getconf _NPROCESSORS_ONLN
        cat /sys/fs/cgroup/cpu.max /proc/pressure/cpu
        npm run test -- --config vitest.ci.config.ts
      else
        set -f
        ../node_modules/.bin/vitest run --config vitest.isolated.config.ts $2
      fi
      ;;
  esac
  if [ "$1" = verify ] && [ "$LOT" = 6F ]; then bash /workspace/tools/make/paniers-lot6-mutation.sh; fi
  if [ "$1" = verify ] && [ "$LOT" = 6G ]; then bash /workspace/tools/make/paniers-lot6g-mutation.sh; fi
  if [ "$1" = verify ] && [ "$LOT" = 6G ]; then bash /workspace/tools/make/paniers-lot6g-fix-mutation.sh; fi
  if [ "$1" = verify ] && [ "$LOT" = 6H ]; then bash /workspace/tools/make/paniers-lot6h-mutation.sh; fi
' -- "$1" "$SCOPE" 2>&1 | tee "$log_dir/$1.log"
