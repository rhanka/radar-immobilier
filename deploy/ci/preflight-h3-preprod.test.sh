#!/usr/bin/env bash
# Prove default preflight is offline, and render failures stop the procedure.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
mkdir -p "$ROOT/tmp"
CASE_ROOT="$(mktemp -d "$ROOT/tmp/h3-preflight.XXXXXX")"
trap 'rm -rf "$CASE_ROOT"' EXIT
export TMPDIR="$CASE_ROOT"
export H3_TEST_REAL_KUBECTL="$(command -v "${KUBECTL:-kubectl}")"
export H3_TEST_CALLS="$CASE_ROOT/calls"
mkdir -p "$CASE_ROOT/bin" "$CASE_ROOT/repo"
cat >"$CASE_ROOT/bin/kubectl" <<'SH'
#!/bin/bash
printf '%s\n' "$*" >>"$H3_TEST_CALLS"
[ "$1" = kustomize ] || { echo 'FAIL: cluster access in offline preflight' >&2; exit 99; }
exec "$H3_TEST_REAL_KUBECTL" "$@"
SH
chmod +x "$CASE_ROOT/bin/kubectl"
export PATH="$CASE_ROOT/bin:$PATH"
export KUBECTL="$CASE_ROOT/bin/kubectl"
export KUBECONFIG="$CASE_ROOT/missing-kubeconfig"
bash "$HERE/preflight-h3-preprod.sh" >"$CASE_ROOT/output"
grep -Fq 'offline only' "$CASE_ROOT/output"
! grep -Ev '^kustomize ' "$H3_TEST_CALLS"
echo 'ok: inherited KUBECONFIG never enables cluster access'
for arg in --apply --write --unknown; do
  if bash "$HERE/preflight-h3-preprod.sh" "$arg" >"$CASE_ROOT/output" 2>&1; then
    echo "FAIL: preflight accepted $arg" >&2; exit 1
  fi
  grep -Eq 'refused|unknown argument' "$CASE_ROOT/output"
  echo "ok: rejects $arg"
done
(cd "$ROOT" && cp -r --parents deploy/ci deploy/k8s deploy/overlays/preprod "$CASE_ROOT/repo")
bash "$HERE/h3-disabled-fixture.sh" "$CASE_ROOT/repo"
CONTROL="$CASE_ROOT/repo/deploy/overlays/preprod/patch-artifacts-control.yaml"
cp "$CONTROL" "$CASE_ROOT/control.backup"
sed -i 's/ARTIFACTS_CONTROL_MODE: "off"/ARTIFACTS_CONTROL_MODE: validation/' "$CONTROL"
if bash "$CASE_ROOT/repo/deploy/ci/preflight-h3-preprod.sh" >"$CASE_ROOT/output" 2>&1; then
  echo 'FAIL: preflight masked render failure' >&2; exit 1
fi
grep -Fq 'expected off' "$CASE_ROOT/output"
! grep -Fq 'offline render gates passed' "$CASE_ROOT/output"
cp "$CASE_ROOT/control.backup" "$CONTROL"
cmp "$CASE_ROOT/control.backup" "$CONTROL"
bash "$CASE_ROOT/repo/deploy/ci/preflight-h3-preprod.sh" >/dev/null
echo 'ok: render failure stops preflight; restored copy passes; cmp identical'
echo 'preflight-h3-preprod tests: 5 passed, 0 failed'
