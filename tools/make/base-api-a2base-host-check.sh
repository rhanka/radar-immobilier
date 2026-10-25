#!/usr/bin/env bash
# Owner-authorized static qualification without Docker or environment discovery.
set -euo pipefail
if [[ -x $HOME/.nvm/versions/node/v24.18.0/bin/node ]]; then
  export PATH=$HOME/.nvm/versions/node/v24.18.0/bin:$PATH
fi
source tools/make/base-api-guards.sh
require_env
require_scope
[[ $ENV == test-a2base-api && $API_PORT == 18919 && $UI_PORT == 15919 && $MAILDEV_UI_PORT == 11919 ]]
ROOT=$(pwd -P)
RUN_DIR=$ROOT/tmp/a2base-api-evidence/host/runtime
LOG_DIR=$ROOT/tmp/a2base-api-evidence/host/$(date -u +%Y%m%dT%H%M%S)-$$-check
mkdir -p "$RUN_DIR" "$LOG_DIR"
printf 'Evidence: %s\n' "$LOG_DIR"
archive_sources
source tools/make/base-api-ci-archive.sh
archive_ci_inputs
tar -xf "$RUN_DIR/source.tar" -C "$RUN_DIR"
cd "$RUN_DIR"
: > npmrc-static
export npm_config_userconfig=$RUN_DIR/npmrc-static npm_config_globalconfig=/dev/null
export npm_config_ignore_scripts=true npm_config_audit=false npm_config_fund=false
export npm_config_cache=$ROOT/tmp/a2base-api-evidence/host/npm-cache
if [[ ! -d $npm_config_cache/_cacache ]]; then
  mkdir -p "$npm_config_cache"
  cp -R "$HOME/.npm/_cacache" "$npm_config_cache/"
fi
if [[ ! -f installed-lock.sha256 ]] || ! sha256sum -c installed-lock.sha256 >/dev/null; then
  npm ci --prefer-offline --ignore-scripts --no-audit --no-fund > "$LOG_DIR/install.log" 2>&1
  sha256sum package-lock.json > installed-lock.sha256
fi
node --version > "$LOG_DIR/toolchain.log"
node_modules/.bin/tsc --version >> "$LOG_DIR/toolchain.log"
cat > api/tsconfig.a2base-tests.json <<'CONFIG'
{"extends":"./tsconfig.json","compilerOptions":{"rootDir":"..","noEmit":true},"include":["src/**/*.ts","tests/integration/mcp-signal-search*.ts"],"exclude":["dist","node_modules"]}
CONFIG
status=0
node_modules/.bin/tsc --noEmit -p api/tsconfig.json > "$LOG_DIR/typecheck-api.log" 2>&1 || status=1
node_modules/.bin/tsc --noEmit -p api/tsconfig.a2base-tests.json > "$LOG_DIR/typecheck-tests.log" 2>&1 || status=1
node_modules/.bin/eslint api/src/routes/mcp-signal-search*.ts api/src/routes/graph-signals.ts \
  api/src/services/facets/mcp-signal-*.ts api/tests/integration/mcp-signal-search*.ts \
  tools/make/base-api-a2base*.mjs > "$LOG_DIR/lint.log" 2>&1 || status=1
for file in tools/make/base-api-a2base*.sh; do bash -n "$file"; done
for file in tools/make/base-api-a2base*.mjs; do node --check "$file"; done
cat "$LOG_DIR/typecheck-api.log" "$LOG_DIR/typecheck-tests.log" "$LOG_DIR/lint.log"
printf '%s\n' "$status" > "$LOG_DIR/status"
[[ $status == 0 ]] || exit "$status"
printf 'PASS host typecheck and lint\n' | tee "$LOG_DIR/result"
