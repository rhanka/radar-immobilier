#!/usr/bin/env bash
# Guard for the intentional 3-file nginx split.
#
# The CLUSTER conf (deploy/k8s/nginx/default.conf, direct proxy_pass — in-cluster
# the radar-api Service DNS always exists), the COMPOSE/standalone conf
# (ui/nginx/default.conf, lazy `resolver` + variable proxy_pass so nginx boots
# even if the api is absent) and the PREPROD copy
# (deploy/overlays/preprod/nginx/default.conf, the preprod ConfigMap source —
# identical to the cluster conf except the /api/geo/collections upstream)
# legitimately differ ONLY on proxy resolution. Their
# SECURITY HEADERS must stay identical — a silent divergence would re-introduce a
# served-headers gap like #608. This compares the `add_header` + `server_tokens`
# directives of all three files, plus the `location ~ \.(js|mjs)$` block of the
# cluster and preprod confs (worker scripts: JS MIME, never SPA HTML), and exits
# non-zero on any difference.
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
CLUSTER="$DIR/default.conf"
COMPOSE="$DIR/../../../ui/nginx/default.conf"
PREPROD="$DIR/../../../deploy/overlays/preprod/nginx/default.conf"

extract() { grep -E '^[[:space:]]*(add_header|server_tokens)\b' "$1" | sed 's/^[[:space:]]*//' | sort; }
extract_js_block() {
  local block
  block="$(awk 'index($0, "location ~ \\.(js|mjs)$") { f = 1 } f { print } f && /^[[:space:]]*}$/ { exit }' "$1")"
  if [ -z "$block" ]; then echo "ERROR: worker location block not found in $1" >&2; exit 1; fi
  printf "%s\n" "$block"
}

if ! diff <(extract "$CLUSTER") <(extract "$COMPOSE"); then
  echo "ERROR: nginx security-header divergence between" >&2
  echo "  $CLUSTER" >&2
  echo "  $COMPOSE" >&2
  echo "Keep the add_header/server_tokens directives identical (the resolver/proxy_pass may differ)." >&2
  exit 1
fi
if ! diff <(extract "$CLUSTER") <(extract "$PREPROD"); then
  echo "ERROR: nginx security-header divergence between" >&2
  echo "  $CLUSTER" >&2
  echo "  $PREPROD" >&2
  echo "Keep the add_header/server_tokens directives identical (only the /api/geo/collections upstream may differ)." >&2
  exit 1
fi
cluster_js="$(extract_js_block "$CLUSTER")"
preprod_js="$(extract_js_block "$PREPROD")"
if [ "$cluster_js" != "$preprod_js" ]; then
  diff <(printf "%s\n" "$cluster_js") <(printf "%s\n" "$preprod_js") || true
  echo "ERROR: nginx worker location-block divergence between" >&2
  echo "  $CLUSTER" >&2
  echo "  $PREPROD" >&2
  echo "Keep the worker location block identical (JS MIME, never SPA HTML)." >&2
  exit 1
fi
echo "OK: nginx security headers identical between cluster, compose and preprod confs; worker location block identical between cluster and preprod."
