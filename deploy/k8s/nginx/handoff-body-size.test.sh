#!/usr/bin/env bash
# Container test for the live-host handoff body-size exception.
#
# For each shipped radar-ui nginx conf (prod cluster, preprod overlay,
# compose/standalone), boot that conf in an nginx container in front of a
# mock upstream (a second nginx container aliased `radar-api`, returning
# 200 on every path) and assert:
#   - POST 10 MiB to /api/v1/artifacts/live-host/v1/handoff  -> 200 (not 413)
#   - POST 10 MiB to /api/v1/artifacts/live-host/v1/job      -> 413 (exact path only)
#   - POST 10 MiB to /api/other                              -> 413 (global limit unchanged)
#   - POST small body to /api/other                          -> 200 (proxy still works)
#
# Requires docker. Run: bash deploy/k8s/nginx/handoff-body-size.test.sh
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$DIR/../../.." && pwd)"
IMAGE="${NGINX_IMAGE:-nginx:alpine}"
SUFFIX="handoff-test-$$"
NET="$SUFFIX-net"
UPSTREAM="$SUFFIX-upstream"
FRONT="$SUFFIX-front"
TMP="$(mktemp -d)"

cleanup() {
  docker rm -f "$FRONT" "$UPSTREAM" >/dev/null 2>&1 || true
  docker network rm "$NET" >/dev/null 2>&1 || true
  rm -rf "$TMP"
}
trap cleanup EXIT

command -v docker >/dev/null 2>&1 || { echo "SKIP: docker not found" >&2; exit 1; }
docker image inspect "$IMAGE" >/dev/null 2>&1 || docker pull "$IMAGE" >/dev/null

# Mock upstream: 200 on every path, on the radar-api port (3000) and on 80
# (so geo proxy_pass hostnames added via --add-host also resolve/connect).
# Its own body limit is disabled so only the FRONT conf's limit is measured
# (a stock nginx upstream would reject a 10 MiB body itself with 413).
cat > "$TMP/upstream.conf" <<'EOF'
server {
  listen 3000;
  listen 80;
  client_max_body_size 0;
  location / { return 200 '{"ok":true}'; }
}
EOF

docker network create "$NET" >/dev/null
docker run -d --name "$UPSTREAM" --network "$NET" --network-alias radar-api \
  -v "$TMP/upstream.conf:/etc/nginx/conf.d/default.conf:ro" "$IMAGE" >/dev/null

# Real HTTP client with an explicit Content-Length (busybox wget sends a
# chunked body, which the front nginx does not size-check the same way).
CLIENT_IMAGE="${CLIENT_IMAGE:-curlimages/curl:latest}"
docker image inspect "$CLIENT_IMAGE" >/dev/null 2>&1 || docker pull "$CLIENT_IMAGE" >/dev/null
head -c 10485760 /dev/zero > "$TMP/body10"
printf '{}' > "$TMP/body-small"

post_status() {
  # $1 = front container name, $2 = path, $3 = host body file
  docker run --rm --network "$NET" -v "$3:/body:ro" "$CLIENT_IMAGE" \
    -s -o /dev/null -w '%{http_code}' -X POST --data-binary @/body \
    "http://$1:8080$2" 2>/dev/null || true
}

check_conf() {
  conf="$1"
  echo "== $conf"
  docker rm -f "$FRONT" >/dev/null 2>&1 || true
  docker run -d --name "$FRONT" --network "$NET" \
    --add-host geo-api.geo.svc.cluster.local:127.0.0.1 \
    --add-host geo-api.geo-preprod.svc.cluster.local:127.0.0.1 \
    -v "$ROOT/$conf:/etc/nginx/conf.d/default.conf:ro" "$IMAGE" >/dev/null

  docker exec "$FRONT" nginx -t >/dev/null
  # Wait until nginx answers (SPA root is served from the stock html root).
  for _ in $(seq 1 30); do
    docker exec "$FRONT" sh -c 'wget -q -O /dev/null http://127.0.0.1:8080/' 2>/dev/null && break
    sleep 0.3
  done
  handoff="$(post_status "$FRONT" /api/v1/artifacts/live-host/v1/handoff "$TMP/body10")"
  job="$(post_status "$FRONT" /api/v1/artifacts/live-host/v1/job "$TMP/body10")"
  other="$(post_status "$FRONT" /api/other "$TMP/body10")"
  small="$(post_status "$FRONT" /api/other "$TMP/body-small")"
  echo "  handoff 10MiB=$handoff (want 200)  job 10MiB=$job (want 413)  /api/other 10MiB=$other (want 413)  /api/other small=$small (want 200)"
  [ "$handoff" = "200" ] || { echo "FAIL: handoff 10 MiB body not accepted in $conf" >&2; exit 1; }
  [ "$job" = "413" ] || { echo "FAIL: sibling /job path must keep the default limit in $conf" >&2; exit 1; }
  [ "$other" = "413" ] || { echo "FAIL: /api/ must keep the default limit in $conf" >&2; exit 1; }
  [ "$small" = "200" ] || { echo "FAIL: small /api/ body must still proxy in $conf" >&2; exit 1; }
  docker rm -f "$FRONT" >/dev/null
}

check_conf deploy/k8s/nginx/default.conf
check_conf deploy/overlays/preprod/nginx/default.conf
check_conf ui/nginx/default.conf

echo "OK: handoff accepts 10 MiB, every other route keeps its limit (all 3 confs)."
