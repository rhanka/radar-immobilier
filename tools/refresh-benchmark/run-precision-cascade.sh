#!/bin/sh
# Precision cascade astra-low -> gemini-low (precision-cascade.mjs) inside the benchmark container,
# like run-oracle-v3-mesh.sh: repository read-only, only the precision-cascade directory writable,
# keyring copied into a tmpfs, API keys never passed.
#
#   ORACLE_V3_GO=1 tools/refresh-benchmark/run-precision-cascade.sh [--source astra-medium] [--docs id,id] [--concurrency n]
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
# --source astra-low (default, CP) or astra-medium (CPM): the writable directory follows the source.
case " $* " in
  *" --source astra-medium "*) OUT="$ROOT/docs/reviews/refresh-benchmark/v101b/precision-cascade-medium"; TARGET=precision-cascade-medium ;;
  *) OUT="$ROOT/docs/reviews/refresh-benchmark/v101b/precision-cascade"; TARGET=precision-cascade ;;
esac
MAIN_ROOT=$(CDPATH= cd -- "$ROOT/../.." && pwd)
KEYRING_SOURCE=/home/antoinefa/.sentropic/llm-mesh-keyring
OWNER_SCOPE=cli:antoinefa-ROG-Flow-Z13-GZ302EA-GZ302EA
MESH_VERSION=0.19.3
test "${ORACLE_V3_GO:-}" = 1 || { echo "ORACLE_V3_GO=1 required (GO i-cond)" >&2; exit 2; }
mkdir -p "$OUT/decisions" "$OUT/campaign"

exec docker run --rm --user "$(id -u):$(id -g)" -e HOME=/tmp \
  --tmpfs /workspace:exec,mode=1777 --tmpfs /run:mode=1777 --tmpfs /tmp:mode=1777 \
  --mount type=bind,source="$MAIN_ROOT",target="$MAIN_ROOT",readonly \
  --mount type=bind,source="$ROOT",target=/src,readonly \
  --mount type=bind,source="$OUT",target=/src/docs/reviews/refresh-benchmark/v101b/$TARGET \
  --mount type=bind,source="$KEYRING_SOURCE",target=/keyring-source,readonly \
  -e BENCHMARK_OWNER_SCOPE="$OWNER_SCOPE" -e ORACLE_V3_GO="${ORACLE_V3_GO:-}" \
  -w /src node:22-bookworm-slim sh -c \
  'cp -a /keyring-source /run/benchmark-keyring && chmod -R u+rw /run/benchmark-keyring \
    && cd /workspace && npm install --silent --ignore-scripts @sentropic/llm-mesh@'"$MESH_VERSION"' >/dev/null \
    && cd /src && exec node tools/refresh-benchmark/precision-cascade.mjs "$@"' precision-cascade "$@"
