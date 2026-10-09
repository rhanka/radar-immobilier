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
NOT_LISTED='dist/scripts/absent.js but api/src/scripts/absent.ts is not an esbuild entrypoint'

CASES=()
trap 'rm -rf "${CASES[@]}"' EXIT
# Minimal tree shaped like the real api/Dockerfile: one RUN writes the esbuild program with
# printf '%s\n' "<line>"..., an API build (outdir api/dist, outbase api/src) with two entries,
# and an independent immo-mcp build. One Job runs each listed API script.
# $1: extra Dockerfile lines inside the API entryPoints array; $2: extra lines after both builds.
fixture() {
  CASE_ROOT="$(mktemp -d)"; CASES+=("$CASE_ROOT")
  mkdir -p "$CASE_ROOT/api/src/scripts" "$CASE_ROOT/deploy/k8s" "$CASE_ROOT/.github/workflows"
  {
    cat <<'EOF'
FROM node:24-bookworm-slim AS build
# Bundle ALL runtime entrypoints: 'api/src/scripts/absent.ts' is NOT one (prose comment).
RUN npm install --no-save esbuild@0.24.0 \
 && printf '%s\n' \
  "import { build } from 'esbuild';" \
  "await build({" \
  "  entryPoints: [" \
  "    'api/src/index.ts'," \
  "    'api/src/scripts/present.ts'," \
EOF
    [ -z "${1:-}" ] || printf '%s\n' "$1"
    cat <<'EOF'
  "  ]," \
  "  bundle: true, platform: 'node', format: 'esm', target: 'node24'," \
  "  outdir: 'api/dist', outbase: 'api/src', entryNames: '[dir]/[name]'," \
  "  plugins: [{ name: 'ext', setup(b){ b.onResolve({ filter: /^[^.\/]/ }, a => null); } }]," \
  "});" \
  "// SECOND, separate build call: 'api/src/scripts/absent.ts' in a comment is no entry." \
  "await build({" \
  "  entryPoints: ['packages/immo-mcp/src/server-http.ts']," \
  "  outdir: 'packages/immo-mcp/dist', outbase: 'packages/immo-mcp/src'," \
  "  banner: { js: 'import { createRequire as __cr } from \"node:module\";' }," \
  "});" \
EOF
    [ -z "${2:-}" ] || printf '%s\n' "$2"
    cat <<'EOF'
  "// end of program" > /workspace/esbuild.mjs \
 && node /workspace/esbuild.mjs
EOF
  } >"$CASE_ROOT/api/Dockerfile"
  : >"$CASE_ROOT/api/src/index.ts"
  : >"$CASE_ROOT/api/src/scripts/present.ts"
  : >"$CASE_ROOT/api/src/scripts/absent.ts"
  printf '%s\n' 'kind: Job' '          command: ["node", "dist/scripts/present.js", "--all"]' \
    >"$CASE_ROOT/deploy/k8s/job.yaml"
  printf '%s\n' 'jobs:' '  x:' '    steps:' '      - run: echo "https://h/build.json"' \
    >"$CASE_ROOT/.github/workflows/w.yml"
}
# Literal (non-pattern) replacement in the fixture Dockerfile; a missing anchor is a test failure.
replace() {
  local content
  content="$(cat "$CASE_ROOT/api/Dockerfile")"
  [[ "$content" == *"$1"* ]] || { bad "fixture anchor not found: $1"; return 1; }
  printf '%s\n' "${content//"$1"/"$2"}" >"$CASE_ROOT/api/Dockerfile"
}
absent_job() { printf '%s\n' '              node dist/scripts/absent.js __ARGS__' >>"$CASE_ROOT/deploy/k8s/job.yaml"; }

run_ok "$ROOT" 'accepts the released manifests and api/Dockerfile'
released="$(bash "$CHECK" "$ROOT" 2>&1)"
grep -Fq ', 18 entrypoint(s))' <<<"$released" && ok 'counts the 18 active API entrypoints of api/Dockerfile' \
  || bad "counts the 18 active API entrypoints of api/Dockerfile (got: $released)"

fixture
run_ok "$CASE_ROOT" 'accepts the untouched fixture'

fixture
absent_job
run_bad "$CASE_ROOT" 'rejects a Job script missing from the esbuild entrypoints (GH #812)' "$NOT_LISTED"

fixture "  \"    'api/src/scripts/absent.ts',\" \\"
absent_job
run_ok "$CASE_ROOT" 'accepts the same Job once its entry is active in the API build'

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

fixture "  \"    'api/src/scripts/gone.ts',\" \\"
run_bad "$CASE_ROOT" 'rejects a Dockerfile entrypoint whose source is gone' 'entrypoint api/src/scripts/gone.ts does not exist'

# ASTRA-832-01: only ACTIVE entries of the API build count.
fixture "#  \"    'api/src/scripts/absent.ts',\" \\"
absent_job
run_bad "$CASE_ROOT" 'rejects an entry commented out with a Dockerfile # line' "$NOT_LISTED"

fixture "  \"    // 'api/src/scripts/absent.ts',\" \\"
absent_job
run_bad "$CASE_ROOT" 'rejects an entry commented out with a JS // comment' "$NOT_LISTED"

fixture "  \"    /* disabled:\" \\
  \"    'api/src/scripts/absent.ts',\" \\
  \"    */\" \\"
absent_job
run_bad "$CASE_ROOT" 'rejects an entry inside a JS /* */ block comment' "$NOT_LISTED"

fixture '' "  \"await build({ entryPoints: ['api/src/scripts/absent.ts'], outdir: 'other/dist', outbase: 'api/src' });\" \\"
absent_job
run_bad "$CASE_ROOT" 'rejects an entry that belongs to another build call (outdir other/dist)' "$NOT_LISTED"

fixture "  \"    'api/src/scripts/present.ts'.replace('//', '/* x */'),\" \\"
run_bad "$CASE_ROOT" 'rejects an entryPoints element that is not a plain string' 'unsupported entryPoints element'

fixture
sed -i "s#outdir: 'api/dist', ##" "$CASE_ROOT/api/Dockerfile"
run_bad "$CASE_ROOT" 'rejects a Dockerfile without an api/dist build call' "no esbuild build call with outdir 'api/dist'"

fixture
sed -i "s#outbase: 'api/src', ##" "$CASE_ROOT/api/Dockerfile"
run_bad "$CASE_ROOT" 'rejects an API build without an explicit outbase' "has no outbase"

fixture "  \"    'packages/immo-mcp/src/other.ts',\" \\"
run_bad "$CASE_ROOT" 'rejects an API entry outside its outbase' 'packages/immo-mcp/src/other.ts is outside outbase api/src'

fixture "  \"    'api/src/scripts/absent.ts', // still listed: '//' and '/*' inside strings are text\" \\"
absent_job
run_ok "$CASE_ROOT" 'keeps an active entry followed by a trailing JS comment'

# ASTRA-832-R2-01: output options must be complete string literals; absent != non-literal.
OPTS="outdir: 'api/dist', outbase: 'api/src', entryNames: '[dir]/[name]',"
IMPORT="\"import { build } from 'esbuild';\" \\"

fixture
replace "$OPTS" "outdir: 'api/dist', outbase: 'api/src', entryNames: '[dir]/[name]' + '-different',"
run_bad "$CASE_ROOT" 'rejects an entryNames concatenation' 'entryNames is not a plain string literal'

fixture
replace "$OPTS" "outdir: 'api/dist' + '/different', outbase: 'api/src', entryNames: '[dir]/[name]',"
run_bad "$CASE_ROOT" 'rejects an outdir concatenation' 'outdir is not a plain string literal'

fixture
replace "$OPTS" "outdir: 'api/dist', outbase: 'api/src', entryNames: names,"
replace "$IMPORT" "$IMPORT
  \"const names = '[name]';\" \\"
run_bad "$CASE_ROOT" 'rejects an entryNames variable' 'entryNames is not a plain string literal'

fixture
replace "$OPTS" "outdir: 'api/dist', outbase: 'api/src', entryNames: \\\`[name]\\\`,"
run_bad "$CASE_ROOT" 'rejects an entryNames template literal' 'entryNames is not a plain string literal'

fixture
replace "$OPTS" "outdir: 'api/dist', outbase: 'api/src', entryNames: '[name]',"
run_bad "$CASE_ROOT" 'rejects a literal entryNames other than [dir]/[name]' 'only [dir]/[name] is mapped'

fixture
replace "$OPTS" "outdir: 'api/dist', outbase: 'api/src',"
run_ok "$CASE_ROOT" 'accepts an absent entryNames (esbuild default [dir]/[name])'

fixture
replace "$OPTS" "outdir: 'api/dist', outbase: 'api' + '/src', entryNames: '[dir]/[name]',"
run_bad "$CASE_ROOT" 'rejects an outbase expression' 'outbase is not a plain string literal'

fixture
replace "$OPTS" "outdir: 'api/dist', outbase: 'api/src', entryNames,"
run_bad "$CASE_ROOT" 'rejects a shorthand entryNames property' 'entryNames is not a plain string literal'

fixture
replace "$OPTS" "outdir: 'api/dist', outbase: 'api/src', 'entryNames': '[name]',"
run_bad "$CASE_ROOT" 'reads a quoted entryNames key' 'only [dir]/[name] is mapped'

fixture
replace "$OPTS" "$OPTS entryNames: '[name]',"
run_bad "$CASE_ROOT" 'rejects a duplicated entryNames key' 'entryNames is not a plain string literal'

fixture
replace "$OPTS" "$OPTS ...extra,"
run_bad "$CASE_ROOT" 'rejects a spread in the build options' 'spread'

fixture
replace "$OPTS" "$OPTS ['entry' + 'Names']: '[name]',"
run_bad "$CASE_ROOT" 'rejects a computed key in the build options' 'computed key'

fixture
replace "$OPTS" "outdir: 'api\\\\x2fdist', outbase: 'api/src', entryNames: '[dir]/[name]',"
run_bad "$CASE_ROOT" 'rejects an escape sequence in an output option' 'outdir is not a plain string literal'

# ASTRA-832-R2-02: syntax checks apply to the selected api/dist build only.
fixture
replace "entryPoints: ['packages/immo-mcp/src/server-http.ts']," "entryPoints: [serverEntry],"
replace "$IMPORT" "$IMPORT
  \"const serverEntry = 'packages/immo-mcp/src/server-http.ts';\" \\"
run_ok "$CASE_ROOT" 'accepts a variable in the entryPoints of the independent immo-mcp build'

fixture
replace "outdir: 'packages/immo-mcp/dist'," "outdir: dir,"
run_bad "$CASE_ROOT" 'rejects a non-literal outdir in another build (output tree unknown)' 'outdir is not a plain string literal'

# ASTRA-832-02: two references sharing one separator are both checked.
fixture
printf '%s\n' '          for f in dist/scripts/present.js dist/scripts/absent.js; do node "$f"; done' \
  >>"$CASE_ROOT/deploy/k8s/job.yaml"
run_bad "$CASE_ROOT" 'rejects the second of two one-space-separated references' 'job.yaml:3 runs dist/scripts/absent.js'

fixture
printf '%s\n' '# historic: node dist/scripts/absent.js was missing' '    # node dist/scripts/absent.js' \
  >>"$CASE_ROOT/deploy/k8s/job.yaml"
run_ok "$CASE_ROOT" 'ignores full-line comments'

fixture
printf '%s\n' 'image: x' 'command: ["node", "packages/immo-mcp/dist/server-http.js"]' \
  'command: ["node", "apps/auth-idp/dist/index.js"]' 'url: "https://h/dist/build.json"' \
  'map: dist/scripts/absent.js.map' >>"$CASE_ROOT/deploy/k8s/job.yaml"
run_ok "$CASE_ROOT" 'ignores other dist trees and non-.js files'

# ASTRA-832-04: an empty or failed enumeration is not success.
fixture
rm -rf "$CASE_ROOT/.github"
run_bad "$CASE_ROOT" 'rejects a root without .github/workflows' 'scan directory .github/workflows not found'

fixture
rm -f "$CASE_ROOT/deploy/k8s/job.yaml" "$CASE_ROOT/.github/workflows/w.yml"
run_bad "$CASE_ROOT" 'rejects an empty YAML inventory' 'no YAML file under deploy/ or .github/workflows/'

fixture
printf '%s\n' 'kind: ConfigMap' >"$CASE_ROOT/deploy/k8s/job.yaml"
run_bad "$CASE_ROOT" 'rejects a scan that finds no dist/ reference at all' 'no dist/<path>.js reference found'

echo "check-image-entrypoints tests: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
