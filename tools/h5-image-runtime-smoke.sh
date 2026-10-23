#!/bin/sh
# H5 runtime-image smoke (ARTEFACTS A6): the REAL api/Dockerfile runtime image
# starts in api, content-deny and content-reader entrypoint modes, and an
# unknown mode is refused at startup. All JavaScript runs in containers on
# an internal network; no host ports. A7 qualifies the deployed render.
set -eu
ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
cd "$ROOT"
NAME="${COMPOSE_PROJECT_NAME:?test project required}-h5img"
IMAGE="$NAME:local"
DENY="$NAME-deny"
READER="$NAME-reader"
API="$NAME-api"
UNKNOWN="$NAME-unknown"
NODE_IMAGE="node:24-bookworm-slim"

if test -n "$(find . -name '.env*' ! -name '.env.example' -print -quit)"; then
  echo "[h5-image] refused: .env* present in build context" >&2; exit 1
fi
for resource in "$DENY" "$READER" "$API" "$UNKNOWN"; do
  if docker container inspect "$resource" >/dev/null 2>&1; then
    echo "[h5-image] refused: container $resource already exists" >&2; exit 1
  fi
done
if docker network inspect "$NAME" >/dev/null 2>&1; then
  echo "[h5-image] refused: network $NAME already exists" >&2; exit 1
fi
if docker image inspect "$IMAGE" >/dev/null 2>&1; then
  echo "[h5-image] refused: image $IMAGE already exists" >&2; exit 1
fi
cleanup() {
  status=$?
  COMPOSE_DISABLE_ENV_FILE=1 docker compose --env-file /dev/null -p "$COMPOSE_PROJECT_NAME" -f docker-compose.yml -f docker-compose.test.yml down -v --remove-orphans || status=1
  if remaining=$(docker ps -aq --filter "label=com.docker.compose.project=$COMPOSE_PROJECT_NAME"); then
    if [ -n "$remaining" ]; then docker rm -f $remaining || status=1; fi
  else status=1; fi
  if remaining=$(docker network ls -q --filter "name=^$NAME$"); then
    if [ -n "$remaining" ]; then docker network rm $remaining || status=1; fi
  else status=1; fi
  if remaining=$(docker image ls -q --filter "reference=$IMAGE"); then
    if [ -n "$remaining" ]; then docker image rm $remaining || status=1; fi
  else status=1; fi
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

git_sha=$(git rev-parse HEAD)
set -- .dockerignore package.json package-lock.json tsconfig.base.json api packages/artifacts-host packages/radar-domain packages/radar-scoring packages/radar-sources packages/immo-mcp radar/ontology
if git ls-tree -r --name-only "$git_sha" -- "$@" | grep -Eq '(^|/)\.env'; then
  echo '[h5-image] refused: environment file in committed build paths' >&2; exit 1
fi
git archive --format=tar "$git_sha" -- "$@" |
  docker build --build-arg "GIT_SHA=$git_sha" -f api/Dockerfile -t "$IMAGE" - >/dev/null
docker image inspect --format '{{.Id}} {{json .RepoDigests}} {{json .Config.Entrypoint}} {{json .Config.Cmd}}' "$IMAGE"
printf 'Source commit: %s\n' "$git_sha"
git show "$git_sha:api/Dockerfile" | sha256sum
git show "$git_sha:api/docker-entrypoint.sh" | sha256sum
docker run --rm --network none --entrypoint sh "$IMAGE" -ec '
  test "$(id -u)" = 1001
  test -z "$(find /workspace -name ".env*" ! -name .env.example -print -quit)"
  for key in POSTGRES_PASSWORD S3_SECRET_KEY ARTIFACTS_S3_SECRET_KEY OPENAI_API_KEY ANTHROPIC_API_KEY; do
    test -z "$(printenv "$key" || true)"
  done
  test -s /workspace/api/dist/artifacts/content-reader-server.js
  echo "[h5-image] PASS: non-root runtime, no environment files, reader bundle present"
'
docker network create --internal --label "com.docker.compose.project=$COMPOSE_PROJECT_NAME" "$NAME" >/dev/null

docker run -d --rm --name "$DENY" --network "$NAME" \
  --label "com.docker.compose.project=$COMPOSE_PROJECT_NAME" \
  -e PORT=3000 "$IMAGE" content-deny >/dev/null
docker run -d --rm --name "$READER" --network "$NAME" \
  --label "com.docker.compose.project=$COMPOSE_PROJECT_NAME" \
  -e PORT=3001 -e ARTIFACTS_CONTENT_BASE=localhost \
  -e ARTIFACTS_READER_GRANT_SECRET=test-grant-secret-32-bytes-long!! \
  -e ARTIFACTS_READER_SESSION_SECRET=test-session-secret-32-bytes! \
  "$IMAGE" content-reader >/dev/null
docker run -d --rm --name "$API" --network "$NAME" \
  --label "com.docker.compose.project=$COMPOSE_PROJECT_NAME" \
  -e PORT=3002 "$IMAGE" >/dev/null

docker run --rm -i --network "$NAME" \
  --label "com.docker.compose.project=$COMPOSE_PROJECT_NAME" \
  -e DENY_HOST="$DENY" -e READER_HOST="$READER" -e API_HOST="$API" "$NODE_IMAGE" node --input-type=module <<'JS'
import assert from "node:assert/strict";
import http from "node:http";
const deny = process.env.DENY_HOST;
const reader = process.env.READER_HOST;
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
await waitReady(deny, 3000, "/health", 30);
const closed = await request(deny, 3000, "/", { headers: { Host: "123e4567-e89b-12d3-a456-426614174000.localhost" } });
assert.equal(closed.status, 404, "deny page stays 404");
assert.equal(JSON.parse(closed.data).error, "not_found");
console.log("[h5-image] PASS: deny -> closed boundary");
await waitReady(reader, 3001, "/health", 30);
const anon = await request(reader, 3001, "/index.html", { headers: { Host: "123e4567-e89b-12d3-a456-426614174000.localhost" } });
assert.equal(anon.status, 401, "reader anonymous page 401");
assert.equal(anon.headers["cache-control"], "private, no-store");
const sw = await request(reader, 3001, "/sw.js", { headers: { Host: "123e4567-e89b-12d3-a456-426614174000.localhost" } });
assert.equal(sw.status, 404, "reader service worker refused");
console.log("[h5-image] PASS: reader refuses anonymous content and service workers");
await waitReady(api, 3002, "/livez", 90);
const banner = await request(api, 3002, "/", { headers: { Host: "preprod.immo.sent-tech.ca" } });
assert.equal(banner.status, 200, "api GET / status");
assert.deepEqual(JSON.parse(banner.data), { name: "radar-immobilier-api", status: "up" }, "api banner");
console.log("[h5-image] PASS: api default mode serves the application banner");
JS

for mode in bogus ''; do
  status=0
  timeout 10 docker run --rm --name "$UNKNOWN" --network none --label "com.docker.compose.project=$COMPOSE_PROJECT_NAME" "$IMAGE" "$mode" >/dev/null 2>&1 || status=$?
  if [ "$status" -ne 2 ]; then
    echo "[h5-image] FAIL: mode '$mode' exited $status (expected 2)" >&2; exit 1
  fi
done
echo "[h5-image] PASS: unknown and empty modes refused at startup (exit 2)"
