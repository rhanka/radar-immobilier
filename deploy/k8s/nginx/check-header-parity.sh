#!/usr/bin/env bash
# Guard for the intentional 2-file nginx split.
#
# The CLUSTER conf (deploy/k8s/nginx/default.conf, direct proxy_pass — in-cluster
# the radar-api Service DNS always exists) and the COMPOSE/standalone conf
# (ui/nginx/default.conf, lazy `resolver` + variable proxy_pass so nginx boots
# even if the api is absent) legitimately differ ONLY on proxy resolution. Their
# SECURITY HEADERS must stay identical — a silent divergence would re-introduce a
# served-headers gap like #608. This compares the `add_header` + `server_tokens`
# directives of both files and exits non-zero on any difference.
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
CLUSTER="$DIR/default.conf"
COMPOSE="$DIR/../../../ui/nginx/default.conf"

extract() { grep -E '^[[:space:]]*(add_header|server_tokens)\b' "$1" | sed 's/^[[:space:]]*//' | sort; }

if ! diff <(extract "$CLUSTER") <(extract "$COMPOSE"); then
  echo "ERROR: nginx security-header divergence between" >&2
  echo "  $CLUSTER" >&2
  echo "  $COMPOSE" >&2
  echo "Keep the add_header/server_tokens directives identical (the resolver/proxy_pass may differ)." >&2
  exit 1
fi
echo "OK: nginx security headers identical between cluster and compose conf."
