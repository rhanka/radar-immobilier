#!/usr/bin/env bash
# Offline H3 gate: disabled overlay or an explicit reviewed operator state.
# No apply, discovery, credential lookup or cluster access.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
TARGET="${1:-$(cd "$HERE/../.." && pwd)}"
PHASE="${H3_RENDER_PHASE:-auto}"
case "$PHASE" in auto|general|disabled|preparation|activation|rollback) ;; *) echo 'FAIL: unknown render phase' >&2; exit 1;; esac
if [ -f "$TARGET" ]; then
  RENDER="$TARGET"
elif [ -d "$TARGET" ]; then
  RENDER="$(mktemp)"
  trap 'rm -f "$RENDER"' EXIT
  "${KUBECTL:-kubectl}" kustomize --load-restrictor LoadRestrictionsNone \
    "$TARGET/deploy/overlays/preprod" >"$RENDER" || {
    echo "FAIL: cannot render $TARGET" >&2; exit 1;
  }
  PROD="$("${KUBECTL:-kubectl}" kustomize "$TARGET/deploy/k8s")"
  # The only ARTIFACTS_ entries allowed in the production base: the data keys
  # of ConfigMap radar-api listed in deploy/k8s/prod-configmap-keys.json
  # (artifacts activated in prod by the v1.2.20 cutover). Only the KEY NAME of
  # those lines is masked, inside that one document: the value is still
  # checked for radar-artifact, and the same key anywhere else still leaks.
  KEYS_FILE="$TARGET/deploy/k8s/prod-configmap-keys.json"
  ALLOWED=""
  if [ -f "$KEYS_FILE" ]; then
    ALLOWED="$(jq -r '.["radar-api"] // [] | map(select(test("ARTIFACTS_"))) | join("|")' "$KEYS_FILE")"
  fi
  if [ -n "$ALLOWED" ]; then
    PROD="$(awk -v allowed="$ALLOWED" '
      function flush(  i, cm, l) {
        cm = doc ~ /\nkind: ConfigMap(\n|$)/ && doc ~ /\n  name: radar-api(\n|$)/
        for (i = 1; i <= n; i++) {
          l = lines[i]
          if (cm && indata[i] && l ~ ("^  (" allowed "): ")) sub(/^  [A-Z0-9_]+:/, "  listed-prod-key:", l)
          print l
        }
        n = 0; doc = ""; d = 0
      }
      /^---$/ { flush(); print; next }
      { if ($0 ~ /^data:$/) d = 1; else if ($0 ~ /^[^ ]/) d = 0
        lines[++n] = $0; doc = doc "\n" $0; indata[n] = d && $0 ~ /^  [^ ]/ }
      END { flush() }' <<<"$PROD")"
  fi
  if grep -Eq 'ARTIFACTS_|radar-artifact' <<<"$PROD"; then
    echo 'FAIL: H3 configuration leaked into the production base' >&2; exit 1
  fi
else
  echo "FAIL: $TARGET is neither a render file nor a repo root" >&2; exit 1
fi
if [ "$PHASE" = auto ]; then
  PHASE=disabled
  if grep -q '^  ARTIFACTS_READER_TIER:' "$RENDER"; then PHASE=general; fi
fi
status=0
if [ "$PHASE" = general ]; then
  awk -f "$HERE/h3-render-common.awk" -f "$HERE/h3-render-general.awk" "$RENDER" || status=1
fi
awk -v phase="$PHASE" -f "$HERE/h3-render-common.awk" -f "$HERE/h3-render-workload.awk" "$RENDER" || status=1
awk -v phase="$PHASE" -f "$HERE/h3-render-common.awk" -f "$HERE/h3-render-routing.awk" "$RENDER" || status=1
[ "$status" -eq 0 ] || exit 1
bash "$HERE/check-preprod-auth-isolation.sh" "$RENDER"
if [ "$PHASE" = activation ] || [ "$PHASE" = preparation ]; then
  until_value="$(awk -f "$HERE/h3-render-common.awk" -f "$HERE/h3-render-until.awk" "$RENDER")"
  until_epoch="$(date -u -d "$until_value" +%s 2>/dev/null)" || {
    echo 'FAIL: invalid ARTIFACTS_VALIDATION_UNTIL' >&2; exit 1;
  }
  [ "$until_epoch" -gt "$(date -u +%s)" ] || {
    echo 'FAIL: expired ARTIFACTS_VALIDATION_UNTIL' >&2; exit 1;
  }
fi
echo "h3 preprod render: ok ($PHASE, isolated)"
