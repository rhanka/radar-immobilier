#!/usr/bin/env bash
# Inside the isolated test container. No host listeners or environment files.
set -euo pipefail
export SESSION_SECRET=synthetic-mcp-session-secret-not-a-credential
export E2E_SESSION_SECRET=$SESSION_SECRET
export SENTROPIC_IDP_ISSUER=https://auth.e2e.invalid
export SENTROPIC_OAUTH_CLIENT_ID=radar-e2e
export SENTROPIC_OAUTH_CLIENT_SECRET=synthetic-not-a-credential
export SENTROPIC_OAUTH_REDIRECT_URI=http://localhost:8080/api/v1/auth/oauth/callback
export AUTH_CALLBACK_BASE_URL=http://localhost:8080
export E2E_STATE_DIR=/workspace/tmp/mcp-browser-state
export PLAYWRIGHT_UI_BASE_URL=http://localhost:8080
export PLAYWRIGHT_API_BASE_URL=http://localhost:3000
export API_PROXY_TARGET=http://localhost:3000
export PLAYWRIGHT_BROWSERS_PATH=/cache/mcp-browsers
export MCP_SIGNAL_SEARCH_ENABLED=1
npm run db:migrate --workspace=api
node --import tsx ui/e2e-real/seed.mjs
node --import tsx ui/e2e-real/signal-mcp-seed.mjs
export E2E_MCP_SEEDED=1
node --import tsx api/src/index.ts > /workspace/tmp/mcp-api.log 2>&1 &
api_pid=$!
npm run dev --workspace=ui -- --port 8080 > /workspace/tmp/mcp-ui.log 2>&1 &
ui_pid=$!
trap 'kill "$api_pid" "$ui_pid" 2>/dev/null || true; cp /workspace/tmp/mcp-api.log /workspace/tmp/mcp-ui.log /evidence/; cp -r /workspace/tmp/e2e-real /evidence/browser 2>/dev/null || true' EXIT
for attempt in $(seq 1 30); do
  if node -e 'Promise.all([fetch("http://localhost:3000/livez"),fetch("http://localhost:8080/")]).then(r=>process.exit(r.every(x=>x.ok)?0:1),()=>process.exit(1))'; then break; fi
  sleep 1
done
./node_modules/.bin/playwright install --only-shell chromium
cd ui
../node_modules/.bin/playwright test --config playwright.real.config.ts e2e-real/signal-mcp.spec.ts
