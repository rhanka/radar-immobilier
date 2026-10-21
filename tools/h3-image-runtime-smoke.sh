#!/bin/sh
# H3 unit 9 runtime-image smoke: the REAL api/Dockerfile runtime image starts
# in both entrypoint modes, and an unknown mode is refused at startup.
# All JavaScript runs in containers on an internal network; no host ports.
set -eu
ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
cd "$ROOT"
NAME="${COMPOSE_PROJECT_NAME:?test project required}-h3img"
IMAGE="$NAME:local"
DENY="$NAME-deny"
API="$NAME-api"
UNKNOWN="$NAME-unknown"
NODE_IMAGE="node:24-bookworm-slim"

# Never ship local secrets into the build context and never reuse resources
# from another run, including after an interrupted run.
if test -n "$(find . -name '.env*' ! -name '.env.example' -print -quit)"; then
  echo "[h3-image] refused: .env* present in build context" >&2; exit 1
fi
for resource in "$DENY" "$API" "$UNKNOWN"; do
  if docker container inspect "$resource" >/dev/null 2>&1; then
    echo "[h3-image] refused: container $resource already exists" >&2; exit 1
  fi
done
if docker network inspect "$NAME" >/dev/null 2>&1; then
  echo "[h3-image] refused: network $NAME already exists" >&2; exit 1
fi

if docker image inspect "$IMAGE" >/dev/null 2>&1; then
  echo "[h3-image] refused: image $IMAGE already exists" >&2; exit 1
fi
cleanup() {
  status=$?
  docker rm -f "$DENY" "$API" "$UNKNOWN" >/dev/null 2>&1 || true
  docker network rm "$NAME" >/dev/null 2>&1 || true
  docker image rm "$IMAGE" >/dev/null 2>&1 || true
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

# The runtime image (default target), not the build stage.
docker build -f api/Dockerfile -t "$IMAGE" . >/dev/null
docker run --rm --network none --entrypoint sh "$IMAGE" -ec '
  test "$(id -u)" = 1001
  test -z "$(find /workspace -name ".env*" ! -name .env.example -print -quit)"
  for key in POSTGRES_PASSWORD S3_SECRET_KEY ARTIFACTS_S3_SECRET_KEY OPENAI_API_KEY ANTHROPIC_API_KEY; do
    test -z "$(printenv "$key" || true)"
  done
  echo "[h3-image] PASS: non-root runtime, no environment files or embedded credential values"
'
docker network create --internal --label "com.docker.compose.project=$COMPOSE_PROJECT_NAME" "$NAME" >/dev/null

docker run -d --rm --name "$DENY" --network "$NAME" \
  --label "com.docker.compose.project=$COMPOSE_PROJECT_NAME" \
  -e PORT=3000 "$IMAGE" content-deny >/dev/null
docker run -d --rm --name "$API" --network "$NAME" \
  --label "com.docker.compose.project=$COMPOSE_PROJECT_NAME" \
  -e PORT=3001 "$IMAGE" api >/dev/null

docker run --rm -i --network "$NAME" \
  --label "com.docker.compose.project=$COMPOSE_PROJECT_NAME" \
  -e DENY_HOST="$DENY" -e API_HOST="$API" "$NODE_IMAGE" node --input-type=module <<'JS'
import assert from "node:assert/strict";
import http from "node:http";
const deny = process.env.DENY_HOST;
const api = process.env.API_HOST;
function request(host, port, path, { method = "GET", headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host, port, path, method, headers }, res => {
      let data = "";
      res.on("data", chunk => { data += chunk; });
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, data }));
    });
    req.setTimeout(2000, () => req.destroy(Error("smoke timeout")));
    req.on("error", reject);
    req.end();
  });
}
async function waitReady(host, port, path, attempts) {
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await request(host, port, path);
      if (res.status === 200) return;
    } catch { /* Starting up; retry. */ }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  assert.fail(`${host}:${port}${path} never became ready`);
}
function expectClosed(res, label, status, error) {
  assert.equal(res.status, status, label);
  assert.deepEqual(JSON.parse(res.data), { error }, `${label} body`);
  assert.equal(res.headers["cache-control"], "no-store", `${label} cache`);
  for (const [name, value] of Object.entries({ "x-content-type-options": "nosniff", "referrer-policy": "no-referrer", "x-frame-options": "DENY", "cross-origin-resource-policy": "same-origin" })) assert.equal(res.headers[name], value, `${label} ${name}`);
  assert.equal(res.headers["set-cookie"], undefined, `${label} cookie`);
  assert.equal(res.headers["location"], undefined, `${label} redirect`);
}
const STABLE = "123e4567-e89b-12d3-a456-426614174000.pages.example.net";
const PINNED = "123e4567-e89b-12d3-a456-426614174001.pinned.pages.example.net";
await waitReady(deny, 3000, "/health", 30);
for (const host of [STABLE, PINNED, `${STABLE}:3000`, STABLE.toUpperCase(), `${STABLE}.`, "not-a-uuid.pages.example.net", `extra.${STABLE}`, "under_score.pages.example.net", "x..pages.example.net", "odd host value", `${STABLE}:invalid`, "[::1]", "", `${"a".repeat(64)}.pages.example.net`]) {
  expectClosed(await request(deny, 3000, "/", { headers: { Host: host } }), `deny ${host} page`, 404, "not_found");
  expectClosed(await request(deny, 3000, "/api/x", { headers: { Host: host } }), `deny ${host} api`, 401, "unauthenticated");
}
expectClosed(await request(deny, 3000, "/", { headers: { Host: STABLE } }), "deny stable /", 404, "not_found");
expectClosed(await request(deny, 3000, "/api/v1/auth/me", { headers: { Host: "not-a-uuid.pages.example.net" } }), "deny malformed api", 401, "unauthenticated");
expectClosed(await request(deny, 3000, "/api/x", { headers: { Host: `extra.${STABLE}` } }), "deny extra-label api", 401, "unauthenticated");
expectClosed(await request(deny, 3000, "/index.html", { headers: { Host: `${PINNED}.` } }), "deny dotted pinned page", 404, "not_found");
expectClosed(await request(deny, 3000, "/livez", { method: "POST", headers: { Host: STABLE } }), "deny POST /livez", 404, "not_found");
expectClosed(await request(deny, 3000, "/", { headers: { Host: STABLE, Accept: "text/html", Cookie: "radar_session=dummy", "X-Forwarded-Host": "app.example.test" } }), "deny forged browser", 404, "not_found");
const head = await request(deny, 3000, "/livez", { method: "HEAD", headers: { Host: "odd host value" } });
assert.equal(head.status, 200, "deny HEAD /livez");
assert.equal(head.data, "");
assert.equal(head.headers["set-cookie"], undefined);
console.log("[h3-image] PASS: content-deny mode denies every host form");
await waitReady(api, 3001, "/livez", 90);
console.log("[h3-image] PASS: api mode boots and serves /livez");
JS

for mode in bogus ''; do
  status=0
  timeout 10 docker run --rm --name "$UNKNOWN" --network none --label "com.docker.compose.project=$COMPOSE_PROJECT_NAME" "$IMAGE" "$mode" >/dev/null 2>&1 || status=$?
  if [ "$status" -ne 2 ]; then
    echo "[h3-image] FAIL: mode '$mode' exited $status (expected 2)" >&2; exit 1
  fi
done
echo "[h3-image] PASS: unknown and empty modes refused at startup (exit 2)"
