#!/bin/bash
# Fault-inject Docker CLI failures without reaching a real daemon.
set -euo pipefail
root=$(pwd)
scratch=$(mktemp -d "$root/tmp/artefacts-mcp-a6/runner-guards.XXXXXX")
trap 'rm -rf "$scratch"' EXIT
mkdir "$scratch/bin"
cat > "$scratch/bin/docker" <<'SH'
#!/bin/bash
printf '%s\n' "$*" >> "$H5_GUARD_LOG"
if [[ "$H5_GUARD_MODE" == inspect ]]; then exit 21; fi
if [[ "$*" == *' down -v --remove-orphans'* ]]; then exit 22; fi
exit 0
SH
chmod +x "$scratch/bin/docker"
export PATH="$scratch/bin:$PATH" H5_GUARD_LOG="$scratch/docker.log"
export H5_GUARD_MODE=inspect
if make -f "$root/tools/h5-artifacts.mk" inspect API_PORT=18946 UI_PORT=15946 MAILDEV_UI_PORT=11946 ENV=test-artefacts-mcp-a6 > "$scratch/inspect.log" 2>&1; then
  echo 'FAIL: Docker inspection failure accepted' >&2; exit 1
fi
export H5_GUARD_MODE=cleanup
if make -f "$root/tools/h5-artifacts.mk" test-reader-unit API_PORT=18946 UI_PORT=15946 MAILDEV_UI_PORT=11946 ENV=test-artefacts-mcp-a6 > "$scratch/cleanup.log" 2>&1; then
  echo 'FAIL: Docker cleanup failure accepted' >&2; exit 1
fi
grep -Fq 'down -v --remove-orphans' "$H5_GUARD_LOG"
echo 'PASS: inspection and cleanup failures fail their targets; scoped teardown flags retained'
