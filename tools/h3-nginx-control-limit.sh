#!/bin/bash
# H3 T11 transport check against the actual preprod server configuration.
# All JavaScript runs in containers; no host ports or temporary files.
set -euo pipefail
ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
NAME="${COMPOSE_PROJECT_NAME:?test project required}-h3-proxy"
NGINX_IMAGE="nginx:1.27-alpine"
NODE_IMAGE="node:24-bookworm-slim"

# Never replace another run's resources, including after an interrupted run.
for resource in "$NAME-stub" "$NAME-proxy"; do
  if docker container inspect "$resource" >/dev/null 2>&1; then
    echo "[h3-nginx] refused: container $resource already exists" >&2; exit 1
  fi
done
docker network create --internal --label "com.docker.compose.project=$COMPOSE_PROJECT_NAME" "$NAME" >/dev/null
cleanup() {
  status=$?
  docker rm -f "$NAME-proxy" "$NAME-stub" >/dev/null 2>&1 || true
  docker network rm "$NAME" >/dev/null || status=1
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

docker run -d --rm --name "$NAME-stub" --network "$NAME" \
  --network-alias radar-api --network-alias geo-api.geo-preprod.svc.cluster.local \
  --label "com.docker.compose.project=$COMPOSE_PROJECT_NAME" "$NODE_IMAGE" node -e '
const http = require("node:http");
http.createServer((req, res) => {
  if (req.method === "GET") { res.end("ready"); return; }
  const chunks = [];
  req.on("data", chunk => chunks.push(chunk));
  req.on("end", () => {
    try {
      const bytes = Buffer.concat(chunks);
      const body = JSON.parse(bytes);
      if (!body.artifactId || !body.idempotencyKey || !Array.isArray(body.files)) throw Error("invalid publication");
      const decodedBytes = body.files.reduce((n, file) => n + Buffer.byteLength(file.text), 0);
      if (decodedBytes > 256 * 1024) throw Error("decoded budget");
      res.writeHead(201, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ bytes: bytes.length, decodedBytes }));
    } catch { res.writeHead(400); res.end(); }
  });
}).listen(3000, "0.0.0.0");' >/dev/null

docker run -d --rm --name "$NAME-proxy" --network "$NAME" \
  --label "com.docker.compose.project=$COMPOSE_PROJECT_NAME" \
  -v "$ROOT/deploy/overlays/preprod/nginx/nginx-test-control-limit.conf:/etc/nginx/nginx.conf:ro" \
  -v "$ROOT/deploy/overlays/preprod/nginx/default.conf:/etc/nginx/conf.d/default.conf:ro" \
  "$NGINX_IMAGE" >/dev/null

docker run --rm -i --network "$NAME" \
  --label "com.docker.compose.project=$COMPOSE_PROJECT_NAME" \
  -e PROXY_HOST="$NAME-proxy" "$NODE_IMAGE" node --input-type=module <<'JS'
import assert from "node:assert/strict";
import http from "node:http";
const host = process.env.PROXY_HOST;
const control = "/api/v1/artifacts/control/publish";
const publication = JSON.stringify({ artifactId: "123e4567-e89b-12d3-a456-426614174000",
  idempotencyKey: "transport", files: [{ path: "index.html", mimeType: "text/html", text: "x".repeat(1024) }] });
const body = size => publication + " ".repeat(size - Buffer.byteLength(publication));
function request(path, payload, chunked = false) {
  return new Promise((resolve, reject) => {
    const headers = { "Content-Type": "application/json" };
    if (chunked) headers["Transfer-Encoding"] = "chunked";
    else headers["Content-Length"] = Buffer.byteLength(payload);
    const req = http.request({ host, port: 8080, path, method: "POST", headers }, res => {
      let data = "";
      res.on("data", chunk => { data += chunk; });
      res.on("end", () => resolve({ status: res.statusCode, data }));
    });
    req.setTimeout(2000, () => req.destroy(Error("proxy timeout")));
    req.on("error", reject);
    if (chunked) { req.write(payload.slice(0, 1048576)); req.end(payload.slice(1048576)); }
    else req.end(payload);
  });
}
let ready = false;
for (let attempt = 0; attempt < 50; attempt++) {
  try {
    const response = await fetch(`http://${host}:8080/api/ready`, { signal: AbortSignal.timeout(1000) });
    if (response.ok) { ready = true; break; }
  } catch { /* Wait only for the isolated proxy to start. */ }
  await new Promise(resolve => setTimeout(resolve, 100));
}
assert.ok(ready, "proxy ready");
for (const [label, path, size, chunked, expected] of [
  ["control accepts 1.5 MiB", control, 1572864, false, 201],
  ["control accepts exactly 2 MiB", control, 2097152, false, 201],
  ["control refuses 2 MiB + 1", control, 2097153, false, 413],
  ["generic route refuses 1.5 MiB", "/api/echo", 1572864, false, 413],
  ["control accepts chunked exactly 2 MiB", control, 2097152, true, 201],
  ["control refuses chunked 2 MiB + 1", control, 2097153, true, 413],
]) {
  const response = await request(path, body(size), chunked);
  assert.equal(response.status, expected, label);
  if (expected === 201) {
    const receipt = JSON.parse(response.data);
    assert.equal(receipt.bytes, size, "upstream received complete body");
    assert.equal(receipt.decodedBytes, 1024, "decoded files stay within 256 KiB");
  }
  console.log(`[h3-nginx] PASS: ${label} -> ${response.status}`);
}
JS
