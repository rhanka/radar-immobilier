#!/usr/bin/env bash
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
T="$(mktemp -d)"
trap 'rm -rf "$T"' EXIT
PASS=0
ok() { PASS=$((PASS + 1)); echo "ok: $1"; }
# Fake kubeconfig only: dummy cluster and dummy token, no real credential.
cat >"$T/expected.yaml" <<'YAML'
apiVersion: v1
kind: Config
clusters:
- cluster: {server: https://example.invalid:6443}
  name: fake
contexts:
- context: {cluster: fake, user: fake}
  name: fake
current-context: fake
users:
- name: fake
  user: {token: fake-token}
YAML
# 1. Raw YAML stays byte-identical, mode 600.
bash "$HERE/write-kubeconfig.sh" "$(cat "$T/expected.yaml")" "$T/raw/config" >"$T/out"
cmp "$T/expected.yaml" "$T/raw/config"; [[ $(stat -c %a "$T/raw/config") == 600 ]]; ok 'raw YAML written as-is, mode 600'
# 2. Base64 YAML is decoded before writing (the promote-prod failure mode).
b64="$(base64 -w0 "$T/expected.yaml")"
bash "$HERE/write-kubeconfig.sh" "$b64" "$T/b64/config" >"$T/out"
cmp "$T/expected.yaml" "$T/b64/config"; ok 'base64 YAML decoded, never written raw'
# 3. Base64 with line wraps decodes too.
base64 "$T/expected.yaml" >"$T/wrapped.b64"
bash "$HERE/write-kubeconfig.sh" "$(cat "$T/wrapped.b64")" "$T/wrapped/config" >"$T/out"
cmp "$T/expected.yaml" "$T/wrapped/config"; ok 'wrapped base64 decoded'
# 4. Garbage is refused with a clear message and no file left behind.
if bash "$HERE/write-kubeconfig.sh" 'not-a-kubeconfig' "$T/bad/config" >"$T/out" 2>&1; then echo 'FAIL: accepted garbage' >&2; exit 1; fi
grep -Fq 'neither raw nor base64 kubeconfig YAML' "$T/out"; [[ ! -e $T/bad/config ]]; ok 'garbage refused, no file left'
# 5. Base64 of non-YAML is refused as well.
b64text="$(printf 'hello world' | base64 -w0)"
if bash "$HERE/write-kubeconfig.sh" "$b64text" "$T/bad2/config" >"$T/out" 2>&1; then echo 'FAIL: accepted base64 text' >&2; exit 1; fi
[[ ! -e $T/bad2/config ]]; ok 'base64 of non-YAML refused'
# 6. Empty value is refused.
if bash "$HERE/write-kubeconfig.sh" '' "$T/bad3/config" >"$T/out" 2>&1; then echo 'FAIL: accepted empty' >&2; exit 1; fi
grep -Fq 'empty kubeconfig value' "$T/out"; ok 'empty value refused'
echo "PASS=$PASS FAIL=0"
