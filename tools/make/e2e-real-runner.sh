#!/usr/bin/env bash
# Runs INSIDE the e2e runner container (docker-compose.e2e.yml service `e2e`,
# stock node:24-bookworm-slim, repo at /workspace). Never run on the host.
#   prepare: install workspace deps, migrate, seed the synthetic database.
#   run:     wait for the production images, read the seed back through the
#            scoped API, install Chromium, run the real-stack Playwright suite.
set -euo pipefail
phase="${1:?usage: e2e-real-runner.sh prepare|run}"
cd /workspace

wait_for() {
  local url="$1" tries=0
  until node -e "fetch(process.argv[1]).then((r)=>process.exit(r.status<500?0:1),()=>process.exit(1))" "$url"; do
    tries=$((tries + 1))
    if [ "$tries" -ge 90 ]; then echo "[e2e] timeout waiting for $url" >&2; exit 1; fi
    sleep 2
  done
}

case "$phase" in
  prepare)
    npm ci --no-audit --no-fund
    npm run db:migrate --workspace=api
    node --import tsx ui/e2e-real/seed.mjs
    ;;
  run)
    wait_for "${PLAYWRIGHT_API_BASE_URL}/livez"
    wait_for "http://${E2E_UI_UPSTREAM}/"
    node ui/e2e-real/local-proxy.mjs "${PLAYWRIGHT_UI_BASE_URL##*:}" "${E2E_UI_UPSTREAM}" &
    wait_for "${PLAYWRIGHT_UI_BASE_URL}/"
    node --import tsx ui/e2e-real/seed.mjs --verify
    ./node_modules/.bin/playwright install --with-deps --only-shell chromium
    cd ui
    ../node_modules/.bin/playwright test --config playwright.real.config.ts
    ;;
  *)
    echo "[e2e] unknown phase: $phase" >&2
    exit 2
    ;;
esac
