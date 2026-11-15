#!/usr/bin/env bash
# Prod ConfigMap key gate: the source the prod CD applies must carry EVERY key
# the live prod ConfigMaps radar-api and immo-mcp-config need.
#
# Why (incident 2026-11-14): the v1.2.20 cutover client-side applied a partial
# render of both ConfigMaps (artifact keys only). Their last-applied annotation
# then listed only those keys, while deploy/k8s/30-api.yaml and
# deploy/k8s/40-immo-mcp-http-deploy.yaml did not carry them. The next
# client-side `kubectl apply -f` of those files (k8s-apply-mcp.yaml) would have
# pruned every artifact key and the classification cursor key id.
#
# The required key set lives in deploy/k8s/prod-configmap-keys.json. Each
# ConfigMap is rendered the two ways a prod path applies it:
#   - raw file   : `kubectl apply -f <file>` (k8s-apply-mcp.yaml, build-push
#                  deploy job);
#   - kustomize  : `kubectl kustomize deploy/k8s` / `deploy/k8s/immo-mcp`.
# Rules, per ConfigMap and per render:
#   1. every required key is present with a non-empty value;
#   2. the render carries no key outside the list (the list is the exact key
#      set, so an annotation aligned on the source matches live);
#   3. no key name looks like a credential (SECRET, PASSWORD, ACCESS_KEY,
#      PRIVATE, TOKEN): credentials stay secretKeyRef entries.
#
# Usage:
#   check-prod-configmap-keys.sh [check] [ROOT]   offline gate (CI)
#   check-prod-configmap-keys.sh extract OUT [ROOT]
#       writes both ConfigMaps exactly as the raw-file prod apply sends them
#       (input of `kubectl apply set-last-applied -f OUT`); offline.
#   (check also requires the literal env entries listed under
#   `radar-api-deployment-env` on Deployment radar-api in the prod renders,
#   and their absence from the preprod render.)
#   check-prod-configmap-keys.sh diff [ROOT]
#       READ-ONLY cluster check. Needs KUBECONFIG set explicitly (never the
#       default ~/.kube/config) and NAMESPACE (default radar-immobilier).
#       Per ConfigMap: last-applied keys vs live keys vs source keys, and
#       source values vs live values. Deployments radar-api and
#       radar-immo-mcp: last-applied env names absent from the source (a
#       client apply removes them) and the listed radar-api literals vs live.
#       Exit 1 on any difference.
set -uo pipefail

KUBECTL="${KUBECTL:-kubectl}"
MODE="${1:-check}"
case "$MODE" in
  check) ROOT="${2:-}";;
  extract) OUT="${2:?extract needs an output file}"; ROOT="${3:-}";;
  diff) ROOT="${2:-}";;
  *) ROOT="$MODE"; MODE=check;;
esac
ROOT="${ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
KEYS="$ROOT/deploy/k8s/prod-configmap-keys.json"
CMS=(radar-api immo-mcp-config)
declare -A RAW=([radar-api]=deploy/k8s/30-api.yaml [immo-mcp-config]=deploy/k8s/40-immo-mcp-http-deploy.yaml)
declare -A KUS=([radar-api]=deploy/k8s [immo-mcp-config]=deploy/k8s/immo-mcp)

command -v "$KUBECTL" >/dev/null 2>&1 || { echo "FAIL: $KUBECTL not found" >&2; exit 1; }
command -v jq >/dev/null 2>&1 || { echo "FAIL: jq not found" >&2; exit 1; }
[ -f "$KEYS" ] || { echo "FAIL: missing $KEYS" >&2; exit 1; }
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# One document (normalized YAML) of a given kind and name out of a
# multi-document render.
pick_doc() {
  awk -v kind="$2" -v name="$3" 'BEGIN { RS = "\n---\n" }
    $0 ~ ("(^|\n)kind: " kind "(\n|$)") && $0 ~ ("\n  name: " name "(\n|$)") { print; n++ }
    END { exit n == 1 ? 0 : 1 }' "$1"
}
pick_cm() { pick_doc "$1" ConfigMap "$2"; }
# `NAME<TAB>literal value<TAB>literal|ref` per container env entry of a
# normalized Deployment document (an entry is a `- name:` line directly
# followed by `value:` or `valueFrom:`).
env_kv() {
  awk 'pending != "" { if ($0 ~ /^ +value: /) { v = $0; sub(/^ +value: /, "", v); print pending "\t" v "\tliteral" }
      else if ($0 ~ /^ +valueFrom:/) print pending "\t\tref"
      pending = "" }
    /^ +- name: [^ ]+$/ { pending = $0; sub(/^ +- name: /, "", pending) }'
}
# Normalized raw-file render: a throwaway kustomization with the file as its
# only resource adds nothing (no namespace, no label) to the document.
render_raw() {
  local dir="$WORK/raw-$1"
  mkdir -p "$dir"
  cp "$ROOT/${RAW[$1]}" "$dir/source.yaml"
  printf 'resources:\n  - source.yaml\n' > "$dir/kustomization.yaml"
  "$KUBECTL" kustomize "$dir" > "$dir/render.yaml" 2>/dev/null && pick_cm "$dir/render.yaml" "$1"
}
# Deployment of a raw prod source file, normalized the same way.
render_raw_deploy() { # <source file> <deployment>
  local dir="$WORK/rawd-$2"
  mkdir -p "$dir"
  cp "$ROOT/$1" "$dir/source.yaml"
  printf 'resources:\n  - source.yaml\n' > "$dir/kustomization.yaml"
  "$KUBECTL" kustomize "$dir" > "$dir/render.yaml" 2>/dev/null && pick_doc "$dir/render.yaml" Deployment "$2"
}
DEPLOY_ENV_KEY=radar-api-deployment-env
declare -A DEPLOY_SRC=([radar-api]=deploy/k8s/30-api.yaml [radar-immo-mcp]=deploy/k8s/40-immo-mcp-http-deploy.yaml)
render_kustomize() {
  "$KUBECTL" kustomize --load-restrictor LoadRestrictionsNone "$ROOT/${KUS[$1]}" > "$WORK/kus-$1.yaml" 2>/dev/null \
    && pick_cm "$WORK/kus-$1.yaml" "$1"
}
# `KEY<TAB>raw scalar` per data entry of a normalized ConfigMap document;
# a plain scalar folded by kustomize onto indented continuation lines is
# joined back with single spaces.
data_kv() {
  awk '/^data:$/ { d = 1; next } d && /^[^ ]/ { d = 0 }
    d && /^  [A-Za-z0-9_.-]+:/ {
      if (k != "") print k "\t" v
      line = $0; sub(/^  /, "", line); k = line; sub(/:.*/, "", k)
      v = line; sub(/^[^:]*:[ ]*/, "", v); next }
    d && k != "" && /^    / { c = $0; sub(/^ +/, "", c); v = (v == "" ? c : v " " c) }
    END { if (k != "") print k "\t" v }'
}
# Decoded value of a raw scalar (plain, "double" or 'single' quoted).
decode() {
  case "$1" in
    \"*\") printf '%s' "$1" | jq -r .;;
    \'*\') local v="${1:1:${#1}-2}"; printf '%s\n' "${v//\'\'/\'}";;
    *) printf '%s\n' "$1";;
  esac
}

if [ "$MODE" = extract ]; then
  : > "$OUT"
  for cm in "${CMS[@]}"; do
    doc="$(render_raw "$cm")" || { echo "FAIL: no single ConfigMap $cm in ${RAW[$cm]}" >&2; exit 1; }
    printf -- '---\n%s\n' "$doc" >> "$OUT"
  done
  echo "wrote $OUT (${CMS[*]})"
  exit 0
fi

if [ "$MODE" = diff ]; then
  [ -n "${KUBECONFIG:-}" ] || { echo "FAIL: set KUBECONFIG explicitly (the default ~/.kube/config is refused)" >&2; exit 1; }
  NS="${NAMESPACE:-radar-immobilier}"
  rc=0
  for cm in "${CMS[@]}"; do
    "$KUBECTL" -n "$NS" get configmap "$cm" -o json > "$WORK/live.json" || { echo "FAIL: cannot read $cm" >&2; rc=1; continue; }
    jq -r '.data // {} | keys[]' "$WORK/live.json" | sort > "$WORK/live.keys"
    jq -r '.metadata.annotations["kubectl.kubernetes.io/last-applied-configuration"] // "{}"
      | fromjson | .data // {} | keys[]' "$WORK/live.json" | sort > "$WORK/annot.keys"
    render_raw "$cm" > "$WORK/src.yaml" || { echo "FAIL: source render $cm" >&2; rc=1; continue; }
    data_kv < "$WORK/src.yaml" > "$WORK/src.kv"
    cut -f1 "$WORK/src.kv" | sort > "$WORK/src.keys"
    echo "== $cm: live=$(wc -l < "$WORK/live.keys") last-applied=$(wc -l < "$WORK/annot.keys") source=$(wc -l < "$WORK/src.keys")"
    for pair in "last-applied:annot" "source:src"; do
      label="${pair%%:*}"; f="$WORK/${pair##*:}.keys"
      only_live="$(comm -23 "$WORK/live.keys" "$f" | tr '\n' ' ')"
      only_other="$(comm -13 "$WORK/live.keys" "$f" | tr '\n' ' ')"
      if [ -z "$only_live$only_other" ]; then echo "  $label keys == live keys"
      else
        rc=1
        [ -n "$only_live" ] && echo "  live keys missing from $label: $only_live"
        [ -n "$only_other" ] && echo "  $label keys absent from live: $only_other"
      fi
    done
    # Source values vs live values, on shared keys (ConfigMaps hold no secret).
    while IFS= read -r key; do
      live_v="$(jq -r --arg k "$key" '.data[$k]' "$WORK/live.json")"
      src_v="$(decode "$(awk -F'\t' -v k="$key" '$1 == k { sub(/^[^\t]*\t/, ""); print; exit }' "$WORK/src.kv")")"
      [ "$live_v" = "$src_v" ] || { rc=1; echo "  value differs: $key (live=$live_v source=$src_v)"; }
    done < <(comm -12 "$WORK/live.keys" "$WORK/src.keys")
  done
  # Deployments applied by k8s-apply-mcp.yaml: an env entry in the live
  # last-applied but absent from the source would be removed by a client
  # apply; the required literals must equal live.
  for dep in radar-api radar-immo-mcp; do
    "$KUBECTL" -n "$NS" get deployment "$dep" -o json > "$WORK/dlive.json" || { echo "FAIL: cannot read deployment $dep" >&2; rc=1; continue; }
    render_raw_deploy "${DEPLOY_SRC[$dep]}" "$dep" > "$WORK/dsrc.yaml" || { echo "FAIL: source render deployment $dep" >&2; rc=1; continue; }
    env_kv < "$WORK/dsrc.yaml" > "$WORK/dsrc.kv"
    cut -f1 "$WORK/dsrc.kv" | sort -u > "$WORK/dsrc.names"
    jq -r '.metadata.annotations["kubectl.kubernetes.io/last-applied-configuration"] // "{}"
      | fromjson | [.spec.template.spec.containers[]?.env[]?.name] | .[]' "$WORK/dlive.json" | sort -u > "$WORK/dannot.names"
    removed="$(comm -23 "$WORK/dannot.names" "$WORK/dsrc.names" | tr '\n' ' ')"
    echo "== deployment/$dep: last-applied env=$(wc -l < "$WORK/dannot.names") source env=$(wc -l < "$WORK/dsrc.names")"
    if [ -n "$removed" ]; then rc=1; echo "  last-applied env absent from source (a client apply removes them): $removed"
    else echo "  every last-applied env is in the source"; fi
    [ "$dep" = radar-api ] || continue
    while IFS= read -r name; do
      live_v="$(jq -r --arg n "$name" '[.spec.template.spec.containers[0].env[]? | select(.name == $n) | .value // "<ref>"] | first // "<absent>"' "$WORK/dlive.json")"
      src_v="$(decode "$(awk -F'\t' -v n="$name" '$1 == n && $3 == "literal" { print $2; exit }' "$WORK/dsrc.kv")")"
      [ "$live_v" = "$src_v" ] && echo "  env $name == live" || { rc=1; echo "  env value differs: $name (live=$live_v source=$src_v)"; }
    done < <(jq -r --arg k "$DEPLOY_ENV_KEY" '.[$k] // [] | .[]' "$KEYS")
  done
  exit "$rc"
fi

PASS=0 FAIL=0
ok() { PASS=$((PASS + 1)); echo "ok: $1"; }
bad() { FAIL=$((FAIL + 1)); echo "FAIL: $1" >&2; }
for cm in "${CMS[@]}"; do
  jq -er --arg c "$cm" '.[$c] | select(type == "array" and length > 0) | .[]' "$KEYS" | sort > "$WORK/want-$cm" \
    || { bad "$cm: no key list in prod-configmap-keys.json"; continue; }
  for how in raw kustomize; do
    if ! "render_$how" "$cm" > "$WORK/doc"; then bad "$cm ($how): exactly one ConfigMap rendered"; continue; fi
    data_kv < "$WORK/doc" > "$WORK/have"
    cut -f1 "$WORK/have" | sort > "$WORK/have-keys"
    missing="$(comm -23 "$WORK/want-$cm" "$WORK/have-keys" | tr '\n' ' ')"
    extra="$(comm -13 "$WORK/want-$cm" "$WORK/have-keys" | tr '\n' ' ')"
    empty="$(awk -F'\t' '$2 == "" || $2 == "\"\"" || $2 == "'\'''\''" { printf "%s ", $1 }' "$WORK/have")"
    secretish="$(cut -f1 "$WORK/have" | grep -E 'SECRET|PASSWORD|ACCESS_KEY|PRIVATE|TOKEN$' | tr '\n' ' ')"
    [ -z "$missing" ] && ok "$cm ($how): every required key present" || bad "$cm ($how): missing keys: $missing"
    [ -z "$extra" ] && ok "$cm ($how): no key outside the list" || bad "$cm ($how): keys not in prod-configmap-keys.json: $extra"
    [ -z "$empty" ] && ok "$cm ($how): no empty value" || bad "$cm ($how): empty values: $empty"
    [ -z "$secretish" ] && ok "$cm ($how): no credential-like key" || bad "$cm ($how): credential-like keys: $secretish"
  done
done
# Deployment radar-api: the required PROD literal env entries are in the raw
# and kustomize prod renders, and the preprod render does not carry them.
jq -er --arg k "$DEPLOY_ENV_KEY" '.[$k] | select(type == "array" and length > 0) | .[]' "$KEYS" > "$WORK/want-env" \
  || bad "radar-api Deployment: no $DEPLOY_ENV_KEY list in prod-configmap-keys.json"
"$KUBECTL" kustomize "$ROOT/deploy/k8s" > "$WORK/kus-base.yaml" 2>/dev/null || true
"$KUBECTL" kustomize --load-restrictor LoadRestrictionsNone "$ROOT/deploy/overlays/preprod" > "$WORK/preprod.yaml" 2>/dev/null || true
for how in raw kustomize preprod; do
  case "$how" in
    raw) render_raw_deploy deploy/k8s/30-api.yaml radar-api > "$WORK/dep" ;;
    kustomize) pick_doc "$WORK/kus-base.yaml" Deployment radar-api > "$WORK/dep" ;;
    preprod) pick_doc "$WORK/preprod.yaml" Deployment radar-api > "$WORK/dep" ;;
  esac || { bad "radar-api Deployment ($how): exactly one rendered"; continue; }
  env_kv < "$WORK/dep" > "$WORK/env"
  while IFS= read -r name; do
    if [ "$how" = preprod ]; then
      awk -F'\t' -v n="$name" '$1 == n { f = 1 } END { exit f }' "$WORK/env" \
        && ok "radar-api Deployment (preprod): no $name entry (ConfigMap value kept)" \
        || bad "radar-api Deployment (preprod): carries the PROD $name entry"
    else
      awk -F'\t' -v n="$name" '$1 == n && $3 == "literal" && $2 != "" && $2 != "\"\"" { f = 1 } END { exit !f }' "$WORK/env" \
        && ok "radar-api Deployment ($how): literal $name present" \
        || bad "radar-api Deployment ($how): literal $name missing or empty"
    fi
  done < "$WORK/want-env"
done
echo "PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ]
