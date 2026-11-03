#!/usr/bin/env bash
# Preprod auth-isolation gate: the RENDERED preprod overlay must carry no PROD
# auth value and no PROD routing.
#
# Why: reconcile-preprod.sh server-side-applies ConfigMaps radar-api and
# immo-mcp-config from the preprod render (#738, #835). Every key the overlay
# does not override inherits the base (deploy/k8s/30-api.yaml,
# deploy/k8s/40-immo-mcp-http-deploy.yaml), which holds the PROD values. That is
# how the PROD issuer / client id / redirect_uri / callback base reached preprod
# and broke every new preprod login (`missing_flow_state` on the PROD callback).
# Checking the base or the overlay file alone misses this class: only the
# rendered result shows what the apply writes. The Ingresses of the render are
# what the k8s operator applies to preprod: a PROD host there would claim
# immo.sent-tech.ca routes on the shared Traefik.
#
# Usage:
#   check-preprod-auth-isolation.sh            # renders <repo>/deploy/overlays/preprod
#   check-preprod-auth-isolation.sh ROOT_DIR   # renders ROOT_DIR/deploy/overlays/preprod
#   check-preprod-auth-isolation.sh RENDER     # checks an already rendered manifest file
#                                              # (reconcile-preprod.sh: exactly what it applies)
#
# Rules (all objects of the render):
#   1. no PROD app/IdP host: `immo.sent-tech.ca` or `auth.sent-tech.ca` unless
#      it is the `preprod.` subdomain. In kind Ingress it is reported as a PROD
#      routing host.
#   2. no `*CLIENT_ID` set to the PROD client id `radar-immobilier` (exact),
#      in ConfigMap data or in a container env literal.
#   3. ConfigMaps radar-api and immo-mcp-config are present (no vacuous pass)
#      and pin the keys below to the expected preprod values; the MCP issuer
#      equals the radar-api issuer (search_signals forwards the user bearer to
#      radar-api, which only accepts its own issuer).
#   4. no Ingress uses the PROD TLS Secret `radar-immo-tls`.
# No cluster access: offline render only (kubectl kustomize).
set -uo pipefail

KUBECTL="${KUBECTL:-kubectl}"
REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TARGET="${1:-$REPO_ROOT}"

# Expected preprod values, as <ConfigMap>:<KEY>=<value>. Kept in sync with
# deploy/overlays/preprod/patch-radar-api-auth.yaml and
# deploy/overlays/preprod/patch-immo-mcp-config.yaml on purpose: two
# independent records that must agree.
EXPECTED=(
  'radar-api:SENTROPIC_IDP_ISSUER=https://preprod.auth.sent-tech.ca'
  'radar-api:SENTROPIC_OAUTH_CLIENT_ID=radar-immobilier-preprod'
  'radar-api:SENTROPIC_OAUTH_REDIRECT_URI=https://preprod.immo.sent-tech.ca/api/v1/auth/oauth/callback'
  'radar-api:SENTROPIC_OAUTH_SCOPES=openid profile email'
  'radar-api:AUTH_CALLBACK_BASE_URL=https://preprod.immo.sent-tech.ca'
  'immo-mcp-config:IMMO_MCP_OAUTH_ISSUER=https://preprod.auth.sent-tech.ca'
  'immo-mcp-config:IMMO_MCP_OAUTH_RESOURCE=https://preprod.immo.sent-tech.ca/mcp'
  'immo-mcp-config:RADAR_PUBLIC_BASE_URL=https://preprod.immo.sent-tech.ca'
)

if [ -f "$TARGET" ]; then
  RENDER="$TARGET"
  SOURCE="$TARGET"
elif [ -d "$TARGET" ]; then
  command -v "$KUBECTL" >/dev/null 2>&1 || { echo "FAIL: $KUBECTL not found" >&2; exit 1; }
  RENDER="$(mktemp)"
  trap 'rm -f "$RENDER"' EXIT
  SOURCE="$TARGET/deploy/overlays/preprod"
  "$KUBECTL" kustomize --load-restrictor LoadRestrictionsNone "$SOURCE" >"$RENDER" || {
    echo "FAIL: cannot render $SOURCE" >&2
    exit 1
  }
else
  echo "FAIL: $TARGET is neither a render file nor a repo root" >&2
  exit 1
fi

# Documents are buffered and judged at their end: kustomize sorts keys, so
# `data:` comes BEFORE `kind:` / `metadata.name` in every document.
# POSIX awk only (mawk on CI runners): no IGNORECASE, no gensub.
awk -v expected="$(IFS='|'; echo "${EXPECTED[*]}")" '
  function unquote(v,   q) {
    sub(/^[ \t]+/, "", v); sub(/[ \t]+$/, "", v)
    q = substr(v, 1, 1)
    if (length(v) >= 2 && (q == "\"" || q == "\047") && substr(v, length(v), 1) == q)
      v = substr(v, 2, length(v) - 2)
    return v
  }
  function report(msg) { print "FAIL: " msg > "/dev/stderr"; fails++ }
  function judge(   i, line, low, key, val, k, id) {
    if (n == 0) return
    id = (kind == "" ? "?" : kind) "/" (name == "" ? "?" : name)
    for (i = 1; i <= n; i++) {
      line = buf[i]
      low = tolower(line)
      # Rule 1: PROD host = not preceded by a host char (so `preprod.` is exempt).
      if (low ~ /(^|[^a-z0-9.-])(immo|auth)\.sent-tech\.ca/) {
        if (kind == "Ingress") report(id ": PROD routing host -> " unquote(line))
        else report(id ": PROD auth host -> " unquote(line))
      }
      # Rule 4: the PROD TLS Secret on a preprod Ingress.
      if (kind == "Ingress" && line ~ /^[ \t]*secretName:/) {
        val = line; sub(/^[^:]*:/, "", val)
        if (unquote(val) == "radar-immo-tls") report(id ": PROD TLS secret -> secretName: radar-immo-tls")
      }
      # Rule 2a: ConfigMap-style `<X>CLIENT_ID: radar-immobilier`.
      if (line ~ /^[ \t]*[A-Z0-9_]*CLIENT_ID:[ \t]/) {
        val = line; sub(/^[^:]*:/, "", val)
        if (unquote(val) == "radar-immobilier") report(id ": PROD client id -> " unquote(line))
      }
      # Rule 2b: env-style `- name: <X>CLIENT_ID` then `value: radar-immobilier`.
      if (line ~ /-[ \t]+name:[ \t]*[A-Z0-9_]*CLIENT_ID[ \t]*$/ && i < n && buf[i + 1] ~ /^[ \t]*value:/) {
        val = buf[i + 1]; sub(/^[^:]*:/, "", val)
        if (unquote(val) == "radar-immobilier") report(id ": PROD client id (env) -> " unquote(line))
      }
      # Rule 3 input: top-level data keys of the pinned ConfigMaps
      # (radar-api, immo-mcp-config), stored as cm[<name> SUBSEP <KEY>].
      if (kind == "ConfigMap" && (name in pinned) && line ~ /^  [A-Z0-9_]+:/) {
        key = line; sub(/^  /, "", key); sub(/:.*/, "", key)
        val = line; sub(/^[^:]*:/, "", val)
        cm[name, key] = unquote(val)
      }
    }
    if (kind == "ConfigMap" && (name in pinned)) found[name] = 1
  }
  function reset() { n = 0; kind = ""; name = ""; inmeta = 0 }
  BEGIN {
    reset()
    # Parse the expected <ConfigMap>:<KEY>=<value> entries once; their
    # ConfigMap names are the pinned set (rule 3).
    m = split(expected, want, "|")
    for (j = 1; j <= m; j++) {
      if (want[j] == "") continue
      wc[j] = want[j]; sub(/:.*/, "", wc[j])
      wk[j] = want[j]; sub(/^[^:]*:/, "", wk[j]); sub(/=.*/, "", wk[j])
      wv[j] = want[j]; sub(/^[^=]*=/, "", wv[j])
      pinned[wc[j]] = 1
    }
  }
  /^---[ \t]*$/ { judge(); reset(); next }
  {
    buf[++n] = $0
    if ($0 ~ /^kind:[ \t]/) { kind = $0; sub(/^kind:[ \t]*/, "", kind); sub(/[ \t]+$/, "", kind) }
    if ($0 ~ /^metadata:/) { inmeta = 1; next }
    if ($0 ~ /^[^ \t]/) inmeta = 0
    if (inmeta && $0 ~ /^  name:[ \t]/) { name = $0; sub(/^  name:[ \t]*/, "", name); name = unquote(name) }
  }
  END {
    judge()
    for (c in pinned)
      if (!(c in found)) report("ConfigMap/" c " not found in the render (nothing checked)")
    for (j = 1; j <= m; j++) {
      if (!(j in wc) || !(wc[j] in found)) continue
      if (!((wc[j], wk[j]) in cm)) report("ConfigMap/" wc[j] ": " wk[j] " missing (expected " wv[j] ")")
      else if (cm[wc[j], wk[j]] != wv[j]) report("ConfigMap/" wc[j] ": " wk[j] "=" cm[wc[j], wk[j]] " (expected " wv[j] ")")
    }
    # The MCP forwards the user bearer to radar-api: one issuer for both.
    if (("immo-mcp-config", "IMMO_MCP_OAUTH_ISSUER") in cm && ("radar-api", "SENTROPIC_IDP_ISSUER") in cm &&
        cm["immo-mcp-config", "IMMO_MCP_OAUTH_ISSUER"] != cm["radar-api", "SENTROPIC_IDP_ISSUER"])
      report("ConfigMap/immo-mcp-config: IMMO_MCP_OAUTH_ISSUER differs from ConfigMap/radar-api SENTROPIC_IDP_ISSUER (" \
        cm["immo-mcp-config", "IMMO_MCP_OAUTH_ISSUER"] " vs " cm["radar-api", "SENTROPIC_IDP_ISSUER"] ")")
    exit(fails > 0 ? 1 : 0)
  }
' "$RENDER"
status=$?

if [ "$status" -ne 0 ]; then
  echo "preprod auth isolation: FAILED on $SOURCE (a PROD auth value or routing host would reach preprod)" >&2
  exit 1
fi
echo "preprod auth isolation: ok ($SOURCE — no PROD auth value or routing host; ${#EXPECTED[@]} preprod keys pinned in radar-api + immo-mcp-config)"
