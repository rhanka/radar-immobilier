#!/usr/bin/env bash
# Exercise the public Make target; every invalid request must stop before kubectl.
set -euo pipefail
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
touch "$work/kubeconfig"
cat > "$work/kubectl" <<'MOCK'
#!/usr/bin/env bash
touch "${PURGE_TEST_CONTACTED:?}"
exit 99
MOCK
chmod +x "$work/kubectl"
export PURGE_TEST_CONTACTED="$work/contacted"
refused() {
  local expected="$1" out
  shift
  if out="$(make --no-print-directory purge-ai-annotations-preprod SKIP_DOTENV=1 \
    KUBECONFIG="$work/kubeconfig" KUBECTL="$work/kubectl" PURGE_MODE=apply \
    PURGE_ALL=0 PIPELINE_RUN_ID= PROMPT_SHA256= "$@" ENV=preprod 2>&1)"; then
    echo 'FAIL: unsafe purge accepted' >&2; exit 1
  fi
  grep -Fq "$expected" <<< "$out"
  test ! -e "$PURGE_TEST_CONTACTED"
  echo "ok: purge refused before cluster access ($*)"
}
refused 'Applied purge refused' PIPELINE_RUN_ID=""
refused 'Applied purge refused' PROMPT_SHA256=""
refused 'Invalid pipeline run id' PIPELINE_RUN_ID=bad/id
refused 'PURGE_ALL=1 cannot be combined with a filter' PURGE_ALL=1 PIPELINE_RUN_ID=run-1
