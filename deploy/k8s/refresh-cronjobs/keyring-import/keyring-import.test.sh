#!/usr/bin/env bash
# Hermetic tests of the keyring import make targets (refresh-018.mk): no
# cluster. A fake `kubectl` on PATH records every call; `kustomize` and the
# client-side `create secret --dry-run=client` go to the real binary so the
# real overlay is rendered.
#   - import-keyring-account refuses a render destination inside the repo,
#     inside any git work tree, in a directory that is not 0700, an existing
#     file or a symlink, and deletes the render when a post-render guard fails;
#   - run-keyring-import ALWAYS cleans the Job, the Secret and the ConfigMap
#     and the local render: Job success, Job failure, create refused (without
#     echoing kubectl's stderr, which may quote the Secret), guard failure;
#   - cleanup-keyring-import removes the local render FIRST, even when the
#     guard or the API delete fails, and never follows a symlink.
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
  *" config view "*) echo "${MOCK_SERVER:-https://hlhedx.c1.bhs5.k8s.ovh.net}" ;;
  *" get serviceaccount radar-app -o name "*) echo serviceaccount/radar-app ;;
  *" apply "*) echo "client-side apply must not be used" >&2; exit 96 ;;
  *" create -f "*)
    [ "${MOCK_CREATE:-ok}" = ok ] || {
      printf '%s\n' 'Error from server (Invalid): error when creating: {"metadata":{"annotations":{"kubectl.kubernetes.io/last-applied-configuration":"{\"data\":{\".key\":\"U0VDUkVULUtFWS1MRUFL\"}}"}}}' >&2
      exit 1; } ;;
  *" get job radar-refresh-keyring-account-import "*)
    if [ "${MOCK_GET:-}" = hang ]; then sleep 30; fi
    printf '%s' "$MOCK_JOB_STATE" ;;
  *" logs job/radar-refresh-keyring-account-import "*) echo '{"status":"imported"}' ;;
  *" delete "*) [ "${MOCK_DELETE:-ok}" = ok ] || { echo "delete failed" >&2; exit 1; } ;;
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

existing="$(private_dir)"; echo keep >"$existing/r.yaml"
if render "$existing/r.yaml"; then bad "render over an existing file accepted"; else
  grep -q "must not exist yet" "$T/out" && [ "$(cat "$existing/r.yaml")" = keep ] && ok "render never overwrites an existing file" \
    || bad "existing file: wrong refusal ($(cat "$T/out"))"; fi

victim="$T/victim"; mkdir -p "$victim"
link_dir="$(private_dir)"; ln -s "$victim/secret.yaml" "$link_dir/r.yaml"
if render "$link_dir/r.yaml"; then bad "render through a dangling symlink accepted"; else
  grep -q "no symlink" "$T/out" && [ ! -e "$victim/secret.yaml" ] && ok "render through a symlink refused, its target never written" \
    || bad "symlink: wrong refusal or target written ($(cat "$T/out"))"; fi
echo original >"$victim/existing.yaml"; ln -s "$victim/existing.yaml" "$link_dir/r2.yaml"
if render "$link_dir/r2.yaml"; then bad "render through a symlink to a file accepted"; else
  [ "$(cat "$victim/existing.yaml")" = original ] && ok "symlink to an existing file: target untouched" \
    || bad "symlink target modified"; fi

good="$(private_dir)"
if render "$good/r.yaml" && grep -A1 'name: IMPORT_TRANSPORT$' "$good/r.yaml" | grep -q 'value: cloud-code'; then
  ok "render into a private 0700 directory outside the repo"
else bad "valid render failed ($(cat "$T/out"))"; fi

broken="$(private_dir)"
if FAKE_KUSTOMIZE=empty render "$broken/r.yaml"; then bad "render without a Job accepted"; else
  grep -q "render deleted" "$T/out" && [ ! -e "$broken/r.yaml" ] && ok "failed post-render guard deletes the render" \
    || bad "post-render failure left the file or wrong message ($(cat "$T/out"))"; fi

# --- run-keyring-import always cleans up -----------------------------------
run_case() { # $1 = label, $2 = expected exit (0|nonzero), env: MOCK_JOB_STATE, MOCK_CREATE, MOCK_SERVER
  local label="$1" expect="$2" file status
  file="$(private_dir)/r.yaml"; echo "kind: Job" >"$file"
  : >"$CALLS"
  make -s -f "$MK" run-keyring-import PREPROD_CONFIRM=1 KUBECONFIG="$T/kubeconfig" \
    IMPORT_RENDER_OUT="$file" IMPORT_POLL_SECONDS=0 IMPORT_WAIT_SECONDS=5 \
    IMPORT_REQUEST_SECONDS="${IMPORT_REQUEST_SECONDS:-30}" ENV=preprod >"$T/out" 2>&1
  status=$?
  if { [ "$expect" = 0 ] && [ "$status" -eq 0 ]; } || { [ "$expect" != 0 ] && [ "$status" -ne 0 ]; }; then :; else
    bad "$label: exit $status, expected $expect ($(cat "$T/out"))"; return; fi
  if grep -q "U0VDUkVULUtFWS1MRUFL\|last-applied" "$T/out"; then bad "$label: kubectl stderr echoed (may quote the Secret)"; return; fi
  if [ -n "${EXPECT_NO_REMOTE:-}" ]; then
    [ ! -e "$file" ] && ok "$label: render removed although the guard refused" || bad "$label: render left on disk"
    return; fi
  if grep -q "delete job/radar-refresh-keyring-account-import secret/radar-refresh-keyring-account-import configmap/radar-refresh-keyring-import-script --ignore-not-found" "$CALLS" \
    && [ ! -e "$file" ]; then ok "$label: Job, Secret, ConfigMap and render cleaned"
  else bad "$label: cleanup missing ($(cat "$CALLS"))"; fi
}
MOCK_JOB_STATE="1/" run_case "Job succeeded" 0
MOCK_JOB_STATE="/1" run_case "Job failed (e.g. master keys differ)" 1
MOCK_JOB_STATE="/" MOCK_CREATE=fail run_case "create refused" 1
grep -q "reason: Invalid" "$T/out" && ok "create refused: only the API reason is reported" || bad "create refusal reason missing ($(cat "$T/out"))"
MOCK_JOB_STATE="/" MOCK_SERVER=https://elsewhere.example EXPECT_NO_REMOTE=1 run_case "guard refused" 1
if grep -q " create \| apply " "$CALLS"; then bad "guard refused: objects were still created"; else ok "guard refused: nothing created"; fi

started=$(date +%s)
MOCK_JOB_STATE="/" MOCK_GET=hang IMPORT_REQUEST_SECONDS=1 run_case "API read hanging" 1
elapsed=$(( $(date +%s) - started ))
[ "$elapsed" -lt 20 ] && grep -q "could not read the import Job" "$T/out" \
  && ok "hanging API read is bounded (${elapsed}s) and still cleaned up" || bad "hanging read not bounded (${elapsed}s)"

cleanup_case() { # $1 = label, env: MOCK_DELETE, MOCK_SERVER
  local file; file="$(private_dir)/r.yaml"; echo "kind: Secret" >"$file"; : >"$CALLS"
  if make -s -f "$MK" cleanup-keyring-import KUBECONFIG="$T/kubeconfig" IMPORT_RENDER_OUT="$file" ENV=preprod >"$T/out" 2>&1; then
    bad "$1: cleanup reported success"; elif [ -e "$file" ]; then bad "$1: render left on disk"; else ok "$1: render removed first, failure reported"; fi
}
MOCK_DELETE=fail cleanup_case "cleanup with API delete failing"
MOCK_SERVER=https://elsewhere.example cleanup_case "cleanup with guard failing"

kept="$T/victim/kept.yaml"; echo kept >"$kept"; ln -s "$kept" "$(private_dir)/link.yaml"
link="$(ls -d "$T"/render.*/link.yaml)"
if make -s -f "$MK" cleanup-keyring-import KUBECONFIG="$T/kubeconfig" IMPORT_RENDER_OUT="$link" ENV=preprod >"$T/out" 2>&1 \
  && [ ! -L "$link" ] && [ "$(cat "$kept")" = kept ]; then ok "cleanup removes a symlink, never its target"
else bad "cleanup followed a symlink ($(cat "$T/out"))"; fi

: >"$CALLS"
if make -s -f "$MK" cleanup-keyring-import KUBECONFIG="$T/kubeconfig" ENV=preprod >"$T/out" 2>&1 \
  && make -s -f "$MK" cleanup-keyring-import KUBECONFIG="$T/kubeconfig" ENV=preprod >>"$T/out" 2>&1 \
  && [ "$(grep -c ' delete ' "$CALLS")" -eq 2 ]; then ok "cleanup-keyring-import is rerunnable"
else bad "cleanup-keyring-import rerun failed ($(cat "$T/out"))"; fi

echo "keyring-import.test.sh: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
