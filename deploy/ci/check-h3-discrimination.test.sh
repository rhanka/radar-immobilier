#!/usr/bin/env bash
# Required disabled-state mutations: COPY, expected failure, restore, cmp, pass.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
mkdir -p "$ROOT/tmp"
CASE_ROOT="$(mktemp -d "$ROOT/tmp/h3-discrimination.XXXXXX")"
trap 'rm -rf "$CASE_ROOT"' EXIT
export TMPDIR="$CASE_ROOT"
GOOD="$CASE_ROOT/good.yaml"
CASE="$CASE_ROOT/case.yaml"
"${KUBECTL:-kubectl}" kustomize --load-restrictor LoadRestrictionsNone "$ROOT/deploy/overlays/preprod" >"$GOOD"
reject() {
  local mutation="$1" reason="$2" out
  cp "$GOOD" "$CASE"
  sed -i "$mutation" "$CASE"
  if out="$(bash "$HERE/check-h3-preprod-render.sh" "$CASE" 2>&1)"; then echo "FAIL: accepted $reason" >&2; exit 1; fi
  grep -Fq "$reason" <<<"$out" || { echo "$out" >&2; exit 1; }
  echo "ok: rejects $reason"
  cp "$GOOD" "$CASE"
  cmp "$GOOD" "$CASE"
  bash "$HERE/check-h3-preprod-render.sh" "$CASE" >/dev/null
  echo 'ok: restored copy passes; cmp identical'
}
reject 's/ARTIFACTS_CONTROL_MODE: "off"/ARTIFACTS_CONTROL_MODE: validation/' 'expected off: no activation by default'
reject '/automountServiceAccountToken: false/a\      volumes:\n      - name: fixture-credential\n        secret:\n          secretName: fixture-secret' 'credential or volume mount forbidden'
reject '/^        - content-deny$/a\        env:\n        - name: FIXTURE_CREDENTIAL\n          value: fixture-only' 'credential or volume mount forbidden'
reject 's/- content-deny/- api/' 'exact content-deny args missing'
echo 'check-h3-discrimination tests: 4 passed, 0 failed'
