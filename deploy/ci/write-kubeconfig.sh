#!/usr/bin/env bash
# Write $HOME/.kube/config from a KUBE_CONFIG_DATA* secret value, which may
# be raw YAML or base64-encoded YAML. No pipe feeds a `grep -q`: under
# `set -o pipefail` the old `base64 -d | grep -q '^apiVersion:'` test died
# by SIGPIPE, so a base64 secret was written raw and kubectl then refused
# the file (promote-prod run 44224775634). The decode happens in a
# variable, the choice is a string test, and the written file is checked
# with grep on the file itself. The value is never printed.
# Usage: write-kubeconfig.sh <secret-value> [destination]
set -euo pipefail
value="${1:-}"
dest="${2:-${HOME:-}/.kube/config}"
fail() { printf 'write-kubeconfig: %s\n' "$*" >&2; exit 1; }
[[ -n $value ]] || fail 'empty kubeconfig value: the KUBE_CONFIG_DATA* secret is missing or empty. Nothing was written.'
[[ -n $dest && $dest != / ]] || fail 'invalid kubeconfig destination.'
decoded="$(printf '%s' "$value" | base64 -d 2>/dev/null || true)"
mkdir -p "$(dirname "$dest")"
umask 077
# A kubeconfig starts with `apiVersion:`; string tests only, no pipe.
# Written with exactly one trailing newline (command substitution in the
# callers strips it, and YAML parsers do not care).
if [[ ${decoded%%$'\n'*} == 'apiVersion:'* ]]; then
  printf '%s\n' "${decoded%$'\n'}" >"$dest"
elif [[ ${value%%$'\n'*} == 'apiVersion:'* ]]; then
  printf '%s\n' "${value%$'\n'}" >"$dest"
else
  printf '%s\n' "${value%$'\n'}" >"$dest"
fi
chmod 600 "$dest"
# Validate the written file itself (grep reads a file, never a pipe).
if ! grep -q '^apiVersion:' "$dest" || ! grep -q '^kind: Config' "$dest"; then
  rm -f "$dest"
  fail "the KUBE_CONFIG_DATA* value is neither raw nor base64 kubeconfig YAML (no apiVersion/kind: Config). Nothing usable was written; fix the secret encoding."
fi
echo "write-kubeconfig: wrote ${dest} (validated kubeconfig, mode 600)"
