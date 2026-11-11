#!/usr/bin/env bash
# Ops recipients wiring gate (port v1): the RENDERED manifests must
# open the recipients route in preprod only, with the static opaque
# bearer sourced from the operator-held Secret — never as a literal.
#
# Rules:
#   1. Preprod ConfigMap radar-api pins OPS_TARGET=immo-preprod and
#      OPS_REFERENCE_WORKSPACE_SLUG to the expected reference slug.
#   2. The radar-api Deployment (both renders) reads
#      OPS_RECIPIENTS_BEARER from Secret radar-ops-recipients
#      (key OPS_RECIPIENTS_BEARER, optional) and never as a literal
#      env value or ConfigMap key. The env entry MUST be present:
#      its removal fails this gate (B2).
#   3. The prod base render carries no OPS_TARGET /
#      OPS_REFERENCE_WORKSPACE_SLUG: prod stays inert until its own
#      Secret and ConfigMap keys are decided.
#
# Usage:
#   check-ops-recipients-render.sh            # renders the repo overlays
#   check-ops-recipients-render.sh ROOT_DIR   # renders ROOT_DIR instead
# No cluster access: offline render only (kubectl kustomize).
set -uo pipefail

KUBECTL="${KUBECTL:-kubectl}"
REPO_ROOT="$(cd "$(dirname "$0")/../.."; pwd)"
TARGET="${1:-$REPO_ROOT}"
EXPECTED_SLUG="agence-chaperon-immobilier"
fails=0
report() { echo "FAIL: $1" >&2; fails=$((fails + 1)); }

command -v "$KUBECTL" >/dev/null 2>&1 || { echo "FAIL: $KUBECTL not found" >&2; exit 1; }
[ -d "$TARGET/deploy/overlays/preprod" ] || { echo "FAIL: $TARGET has no preprod overlay" >&2; exit 1; }

TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
"$KUBECTL" kustomize --load-restrictor LoadRestrictionsNone "$TARGET/deploy/overlays/preprod" >"$TMP/preprod.yaml" \
  || { echo "FAIL: cannot render preprod overlay" >&2; exit 1; }
"$KUBECTL" kustomize "$TARGET/deploy/k8s" >"$TMP/prod.yaml" \
  || { echo "FAIL: cannot render prod base" >&2; exit 1; }

# One check pass per render ($1 = file, $2 = preprod|prod).
check_render() {
  awk -v mode="$2" -v slug="$EXPECTED_SLUG" '
    function unquote(v) { gsub(/^[ \t]+|[ \t]+$/, "", v); gsub(/^"|"$/, "", v); return v }
    function flush_env() {
      if (!env_ops) return
      if (env_literal) report("OPS_RECIPIENTS_BEARER set as a literal value (must come from Secret radar-ops-recipients)")
      if (env_secret != "radar-ops-recipients" || env_key != "OPS_RECIPIENTS_BEARER")
        report("OPS_RECIPIENTS_BEARER must read Secret radar-ops-recipients key OPS_RECIPIENTS_BEARER")
      if (!env_optional) report("OPS_RECIPIENTS_BEARER secretKeyRef must be optional (absent Secret keeps the route closed)")
      env_ops = 0; env_literal = 0; env_optional = 0; env_secret = ""; env_key = ""; inref = 0
    }
    function report(msg) { print "FAIL: " msg > "/dev/stderr"; bad++ }
    BEGIN { RS = "\n---\n" }
    /kind: ConfigMap/ && /name: radar-api/ {
      cm = 1
      if ($0 ~ /\n  OPS_TARGET:/) { t = $0; sub(/.*\n  OPS_TARGET:[ \t]*/, "", t); sub(/\n.*/, "", t); target = unquote(t) }
      if ($0 ~ /\n  OPS_REFERENCE_WORKSPACE_SLUG:/) { s = $0; sub(/.*\n  OPS_REFERENCE_WORKSPACE_SLUG:[ \t]*/, "", s); sub(/\n.*/, "", s); refslug = unquote(s) }
      if ($0 ~ /\n  OPS_RECIPIENTS_BEARER:/) report("OPS_RECIPIENTS_BEARER must not be a ConfigMap key (Secret radar-ops-recipients only)")
      if ($0 ~ /\n  OPS_RECIPIENTS_AUDIENCE:/) report("OPS_RECIPIENTS_AUDIENCE must not be a ConfigMap key (removed JWT wiring)")
    }
    /kind: Deployment/ && /name: radar-api/ {
      dep = 1
      n = split($0, lines, "\n")
      for (i = 1; i <= n; i++) {
        if (lines[i] ~ /- name: OPS_RECIPIENTS_BEARER/) { flush_env(); env_ops = 1; env_seen = 1; continue }
        if (lines[i] ~ /- name: OPS_RECIPIENTS_AUDIENCE/) { report("OPS_RECIPIENTS_AUDIENCE env entry must be removed (static bearer replaces JWT audience)"); continue }
        if (!env_ops) continue
        if (lines[i] ~ /- name:/) { flush_env(); continue }
        if (lines[i] ~ /^[ \t]*value:/) env_literal = 1
        if (lines[i] ~ /secretKeyRef:/) inref = 1
        if (inref && lines[i] ~ /name:/) { v = lines[i]; sub(/.*name:[ \t]*/, "", v); env_secret = unquote(v) }
        if (inref && lines[i] ~ /key:/) { v = lines[i]; sub(/.*key:[ \t]*/, "", v); env_key = unquote(v) }
        if (lines[i] ~ /optional: true/) { env_optional = 1; inref = 0 }
      }
      flush_env()
    }
    END {
      if (!cm) report("ConfigMap/radar-api not found in render (nothing checked)")
      if (!dep) report("Deployment/radar-api not found in render (nothing checked)")
      if (dep && !env_seen) report("OPS_RECIPIENTS_BEARER env entry missing from Deployment/radar-api (must read Secret radar-ops-recipients key OPS_RECIPIENTS_BEARER)")
      if (mode == "preprod") {
        if (target != "immo-preprod") report("ConfigMap/radar-api: OPS_TARGET=" (target == "" ? "<missing>" : target) " (expected immo-preprod)")
        if (refslug != slug) report("ConfigMap/radar-api: OPS_REFERENCE_WORKSPACE_SLUG=" (refslug == "" ? "<missing>" : refslug) " (expected " slug ")")
      } else {
        if (target != "") report("prod ConfigMap/radar-api must stay inert: OPS_TARGET=" target " (expected absent)")
        if (refslug != "") report("prod ConfigMap/radar-api must stay inert: OPS_REFERENCE_WORKSPACE_SLUG=" refslug " (expected absent)")
      }
      exit(bad > 0 ? 1 : 0)
    }
  ' "$1" || fails=$((fails + 1))
}

check_render "$TMP/preprod.yaml" preprod
check_render "$TMP/prod.yaml" prod

if [ "$fails" -ne 0 ]; then
  echo "ops recipients wiring: FAILED on $TARGET" >&2
  exit 1
fi
echo "ops recipients wiring: ok ($TARGET — preprod open via Secret radar-ops-recipients, prod inert)"
