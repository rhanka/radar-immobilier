#!/usr/bin/env bash
# Hermetic tests of the keyring import make targets (refresh-018.mk): no
# cluster. A fake `kubectl` on PATH records every call; `kustomize` and the
# client-side `create secret --dry-run=client` go to the real binary so the
# real overlay is rendered.
#   - import-keyring-account refuses a render destination inside the repo,
#     inside any git work tree, or in a directory that is not 0700, and deletes
#     the render when a post-render guard fails;
#   - run-keyring-import ALWAYS cleans the Job, the Secret and the ConfigMap
#     (and the local render): Job success, Job failure, apply failure.
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
MK="$HERE/../refresh-018.mk"
ROOT="$(cd "$HERE/../../../.." && pwd -P)"
REAL_KUBECTL="$(command -v kubectl)" || { echo "FAIL: kubectl not found" >&2; exit 1; }
export REAL_KUBECTL
PASS=0 FAIL=0
ok() { PASS=$((PASS + 1)); echo "ok: $1"; }
bad() { FAIL=$((FAIL + 1)); echo "FAIL: $1" >&2; }

T="$(mktemp -d)"
trap 'rm -rf "$T"' EXIT
mkdir -p "$T/bin" "$T/source"
printf 'not-a-real-key\n' >"$T/source/.key"
: >"$T/kubeconfig"
cat >"$T/bin/kubectl" <<'FAKE'
#!/usr/bin/env bash
echo "$*" >>"$CALLS"
case " $* " in
  " kustomize "*)
    if [ "${FAKE_KUSTOMIZE:-}" = empty ]; then exit 0; fi
    exec "$REAL_KUBECTL" "$@" ;;
  *" create secret generic "*"--dry-run=client"*) exec "$REAL_KUBECTL" "$@" ;;
  *" config view "*) echo "https://hlhedx.c1.bhs5.k8s.ovh.net" ;;
  *" get serviceaccount radar-app -o name "*) echo serviceaccount/radar-app ;;
  *" apply -f "*) [ "${MOCK_APPLY:-ok}" = ok ] || { echo "apply refused" >&2; exit 1; } ;;
  *" get job radar-refresh-keyring-account-import "*) printf '%s' "$MOCK_JOB_STATE" ;;
  *" logs job/radar-refresh-keyring-account-import "*) echo '{"status":"imported"}' ;;
  *" delete "*) : ;;
  *) echo "unexpected kubectl call: $*" >&2; exit 97 ;;
esac
FAKE
chmod +x "$T/bin/kubectl"
export PATH="$T/bin:$PATH" CALLS="$T/calls"

DIGEST="ghcr.io/rhanka/radar-api@sha256:$(printf 'a%.0s' $(seq 64))"
render() { # $1 = destination file
  : >"$CALLS"
  make -s -f "$MK" import-keyring-account IMPORT_TRANSPORT=cloud-code IMPORT_IMAGE_REF="$DIGEST" \
    IMPORT_SOURCE_DIR="$T/source" IMPORT_RENDER_OUT="$1" ENV=ci >"$T/out" 2>&1
}
private_dir() { local d; d="$(mktemp -d "$T/render.XXXXXX")"; chmod 700 "$d"; echo "$d"; }

# --- render destination guards ---------------------------------------------
inside="$ROOT/keyring-import-render.test.yaml"
if render "$inside"; then bad "render inside the repo accepted"; else
  grep -q "outside the repository" "$T/out" && [ ! -e "$inside" ] && ok "render inside the repo refused, nothing written" \
    || bad "render inside the repo: wrong refusal ($(cat "$T/out"))"; fi
rm -f "$inside"

open_dir="$(mktemp -d "$T/open.XXXXXX")"; chmod 755 "$open_dir"
if render "$open_dir/r.yaml"; then bad "render into a 0755 directory accepted"; else
  grep -q "mode 0700" "$T/out" && [ ! -e "$open_dir/r.yaml" ] && ok "render into a non-0700 directory refused" \
    || bad "non-0700: wrong refusal ($(cat "$T/out"))"; fi

work_tree="$(private_dir)"; git -C "$work_tree" init -q
if render "$work_tree/r.yaml"; then bad "render inside a foreign git work tree accepted"; else
  grep -q "git work tree" "$T/out" && [ ! -e "$work_tree/r.yaml" ] && ok "render inside any git work tree refused" \
    || bad "git work tree: wrong refusal ($(cat "$T/out"))"; fi

good="$(private_dir)"
if render "$good/r.yaml" && grep -A1 'name: IMPORT_TRANSPORT$' "$good/r.yaml" | grep -q 'value: cloud-code'; then
  ok "render into a private 0700 directory outside the repo"
else bad "valid render failed ($(cat "$T/out"))"; fi

broken="$(private_dir)"
if FAKE_KUSTOMIZE=empty render "$broken/r.yaml"; then bad "render without a Job accepted"; else
  grep -q "render deleted" "$T/out" && [ ! -e "$broken/r.yaml" ] && ok "failed post-render guard deletes the render" \
    || bad "post-render failure left the file or wrong message ($(cat "$T/out"))"; fi

# --- run-keyring-import always cleans up -----------------------------------
run_case() { # $1 = label, $2 = expected exit (0|nonzero), env: MOCK_JOB_STATE, MOCK_APPLY
  local label="$1" expect="$2" file status
  file="$(private_dir)/r.yaml"; echo "kind: Job" >"$file"
  : >"$CALLS"
  make -s -f "$MK" run-keyring-import PREPROD_CONFIRM=1 KUBECONFIG="$T/kubeconfig" \
    IMPORT_RENDER_OUT="$file" IMPORT_POLL_SECONDS=0 IMPORT_WAIT_SECONDS=5 ENV=preprod >"$T/out" 2>&1
  status=$?
  if { [ "$expect" = 0 ] && [ "$status" -eq 0 ]; } || { [ "$expect" != 0 ] && [ "$status" -ne 0 ]; }; then :; else
    bad "$label: exit $status, expected $expect ($(cat "$T/out"))"; return; fi
  if grep -q "delete job/radar-refresh-keyring-account-import secret/radar-refresh-keyring-account-import configmap/radar-refresh-keyring-import-script --ignore-not-found" "$CALLS" \
    && [ ! -e "$file" ]; then ok "$label: Job, Secret, ConfigMap and render cleaned"
  else bad "$label: cleanup missing ($(cat "$CALLS"))"; fi
}
MOCK_JOB_STATE="1/" MOCK_APPLY=ok run_case "Job succeeded" 0
MOCK_JOB_STATE="/1" MOCK_APPLY=ok run_case "Job failed (e.g. master keys differ)" 1
MOCK_JOB_STATE="/" MOCK_APPLY=fail run_case "apply refused" 1

: >"$CALLS"
if make -s -f "$MK" cleanup-keyring-import KUBECONFIG="$T/kubeconfig" ENV=preprod >"$T/out" 2>&1 \
  && make -s -f "$MK" cleanup-keyring-import KUBECONFIG="$T/kubeconfig" ENV=preprod >>"$T/out" 2>&1 \
  && [ "$(grep -c ' delete ' "$CALLS")" -eq 2 ]; then ok "cleanup-keyring-import is rerunnable"
else bad "cleanup-keyring-import rerun failed ($(cat "$T/out"))"; fi

echo "keyring-import.test.sh: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
