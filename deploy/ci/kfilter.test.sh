#!/usr/bin/env bash
# Golden fixtures plus an independent awk oracle over the actual preprod render.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
T="$(mktemp -d)"
trap 'rm -rf "$T"' EXIT
PASS=0
check() {
  if ! cmp -s "$T/expected" "$T/actual"; then
    echo "FAIL: $1" >&2
    diff -u "$T/expected" "$T/actual" >&2 || true
    exit 1
  fi
  PASS=$((PASS + 1)); echo "ok: $1"
}
# Escaped JSON lines make intentional trailing whitespace visible in the fixture.
jq -r '.[]' "$HERE/fixtures/kfilter/render.json" >"$T/lf"
awk '{ printf "%s\r\n", $0 }' "$T/lf" >"$T/crlf"
awk '{ printf "%s\r", $0 }' "$T/lf" >"$T/cr"
awk '{ printf "%s%s", sep, $0; sep="\n" }' "$T/lf" >"$T/no-final-newline"
for variant in lf crlf cr no-final-newline; do
  while IFS= read -r test_case; do
    mapfile -t flags < <(jq -r '.flags // [] | .[]' <<<"$test_case")
    mapfile -t args < <(jq -r '.args[]' <<<"$test_case")
    jq -j '.output' <<<"$test_case" >"$T/expected"
    bash "$HERE/kfilter.sh" "${flags[@]}" "$T/$variant" "${args[@]}" >"$T/actual"
    check "$variant: $(jq -r '.label' <<<"$test_case")"
  done < <(jq -c '.[]' "$HERE/fixtures/kfilter/cases.json")
done

# Kustomize's canonical LF output lets awk select full documents independently.
kubectl kustomize --load-restrictor LoadRestrictionsNone "$HERE/../overlays/preprod" >"$T/render"
while read -r kind mode name; do
  pattern="$name"
  flags=()
  args=("$kind")
  case "$mode" in
    prefix) pattern="$name.*"; flags=(--name-prefix "$name") ;;
    exact) args+=("$name") ;;
    all) pattern='.*' ;;
  esac
  awk -v kind="$kind" -v wanted="$pattern" '
    BEGIN { RS="\n---\n"; ORS="" }
    $0 ~ ("(^|\n)kind: " kind "(\n|$)") &&
    $0 ~ ("(^|\n)  name: " wanted "(\n|$)") {
      sub(/\n+$/, ""); if (n++) print "---\n"; print $0 "\n"
    }' "$T/render" >"$T/expected"
  test -s "$T/expected"
  bash "$HERE/kfilter.sh" "${flags[@]}" "$T/render" "${args[@]}" >"$T/actual"
  check "preprod: $kind $mode $name (whole documents)"
done <<'QUERIES'
ConfigMap prefix radar-ui-nginx
ConfigMap exact radar-api
ConfigMap exact immo-mcp-config
ConfigMap all unused
Deployment exact radar-api
Deployment exact radar-ui
CronJob exact radar-consistency-snapshot
QUERIES

: >"$T/empty"
: >"$T/expected"
bash "$HERE/kfilter.sh" "$T/empty" ConfigMap >"$T/actual"
check 'empty render emits no bytes'
for invalid in unknown missing-prefix missing-args missing-file; do
  case "$invalid" in
    unknown) args=(--unknown) ;;
    missing-prefix) args=(--name-prefix) ;;
    missing-args) args=("$T/empty") ;;
    missing-file) args=("$T/not-found" ConfigMap) ;;
  esac
  if bash "$HERE/kfilter.sh" "${args[@]}" >"$T/actual" 2>"$T/error"; then
    echo "FAIL: accepted $invalid" >&2; exit 1
  fi
  test -s "$T/error"
  PASS=$((PASS + 1)); echo "ok: rejects $invalid"
done
echo "PASS=$PASS FAIL=0"
