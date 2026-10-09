#!/usr/bin/env bash
# Hermetic tests for check-image-entrypoints.sh: the released tree passes, and each
# mutation of a minimal fixture fails (or passes) for its own reason only.
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
CHECK="$HERE/check-image-entrypoints.sh"
PASS=0 FAIL=0
ok() { PASS=$((PASS + 1)); echo "ok: $1"; }
bad() { FAIL=$((FAIL + 1)); echo "FAIL: $1" >&2; }
run_ok() { bash "$CHECK" "$1" >/dev/null 2>&1 && ok "$2" || bad "$2"; }
run_bad() {
  local output
  output="$(bash "$CHECK" "$1" 2>&1)" && { bad "$2"; return; }
  grep -Fq "$3" <<<"$output" && ok "$2" || bad "$2 (expected: $3)"
}

CASES=()
trap 'rm -rf "${CASES[@]}"' EXIT
# Minimal tree: a Dockerfile with two entrypoints, their sources, one Job running each.
fixture() {
  CASE_ROOT="$(mktemp -d)"; CASES+=("$CASE_ROOT")
  mkdir -p "$CASE_ROOT/api/src/scripts" "$CASE_ROOT/deploy/k8s" "$CASE_ROOT/.github/workflows"
  printf '%s\n' \
    'RUN printf "%s\n" \' \
    "  \"    'api/src/index.ts',\" \\" \
    "  \"    'api/src/scripts/present.ts',\" \\" \
    '  > /workspace/esbuild.mjs' >"$CASE_ROOT/api/Dockerfile"
  : >"$CASE_ROOT/api/src/index.ts"
  : >"$CASE_ROOT/api/src/scripts/present.ts"
  : >"$CASE_ROOT/api/src/scripts/absent.ts"
  printf '%s\n' 'kind: Job' '          command: ["node", "dist/scripts/present.js", "--all"]' \
    >"$CASE_ROOT/deploy/k8s/job.yaml"
  printf '%s\n' 'jobs:' '  x:' '    steps:' '      - run: echo "https://h/build.json"' \
    >"$CASE_ROOT/.github/workflows/w.yml"
}

run_ok "$ROOT" 'accepts the released manifests and api/Dockerfile'

fixture
run_ok "$CASE_ROOT" 'accepts the untouched fixture'

fixture
printf '%s\n' '              node dist/scripts/absent.js __ARGS__' >>"$CASE_ROOT/deploy/k8s/job.yaml"
run_bad "$CASE_ROOT" 'rejects a Job script missing from the esbuild entrypoints (GH #812)' \
  'dist/scripts/absent.js but api/src/scripts/absent.ts is not an esbuild entrypoint'

fixture
mkdir -p "$CASE_ROOT/deploy/k8s/sub"
printf '%s\n' 'command: ["sh", "-c", "exec node api/dist/scripts/absent.js"]' >"$CASE_ROOT/deploy/k8s/sub/job.yaml"
run_bad "$CASE_ROOT" 'rejects the api/dist/ form in a nested manifest' 'deploy/k8s/sub/job.yaml:1 runs dist/scripts/absent.js'

fixture
printf '%s\n' '      - run: kubectl exec x -- node dist/scripts/absent.js' >>"$CASE_ROOT/.github/workflows/w.yml"
run_bad "$CASE_ROOT" 'rejects a workflow step running a missing entrypoint' '.github/workflows/w.yml:5'

fixture
printf '%s\n' 'command: ["node", "dist/scripts/ghost.js"]' >>"$CASE_ROOT/deploy/k8s/job.yaml"
run_bad "$CASE_ROOT" 'rejects a script with no source at all' 'no source api/src/scripts/ghost.ts exists'

fixture
printf '%s\n' "  \"    'api/src/scripts/gone.ts',\" \\" >>"$CASE_ROOT/api/Dockerfile"
run_bad "$CASE_ROOT" 'rejects a Dockerfile entrypoint whose source is gone' 'entrypoint api/src/scripts/gone.ts does not exist'

fixture
printf '%s\n' '# historic: node dist/scripts/absent.js was missing' '    # node dist/scripts/absent.js' \
  >>"$CASE_ROOT/deploy/k8s/job.yaml"
run_ok "$CASE_ROOT" 'ignores full-line comments'

fixture
printf '%s\n' 'image: x' 'command: ["node", "packages/immo-mcp/dist/server-http.js"]' \
  'command: ["node", "apps/auth-idp/dist/index.js"]' 'url: "https://h/dist/build.json"' \
  >>"$CASE_ROOT/deploy/k8s/job.yaml"
run_ok "$CASE_ROOT" 'ignores other dist trees and non-.js files'

echo "check-image-entrypoints tests: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
