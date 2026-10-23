#!/usr/bin/env bash
# Behavioral qualification with daemon-free command doubles only.
set -euo pipefail
TOOLS=$(cd -- "$(dirname -- "$0")" && pwd)
CASE=${PROOF_ONLY:-all}
mkdir -p tmp/base-api-evidence/B0
PROOF_DIR=$(mktemp -d "$PWD/tmp/base-api-evidence/B0/proof-XXXXXX")
export PROOF_DIR PROOF_PROJECT=radar-test-proof
PROOF_OWNER=$(printf '%s' "$PWD/test-proof" | sha256sum | cut -d' ' -f1)
export PROOF_OWNER
mkdir "$PROOF_DIR/bin"
cp "$TOOLS/base-api-docker-double.sh" "$PROOF_DIR/bin/docker"
cat > "$PROOF_DIR/bin/git" <<'DOUBLE'
#!/usr/bin/env bash
[[ $1 == ls-files ]] || exit 2
printf '%s\n' api/src/config.ts
DOUBLE
cat > "$PROOF_DIR/bin/tar" <<'DOUBLE'
#!/usr/bin/env bash
printf 'tar %s\n' "$*" >> "$PROOF_DIR/commands"
while [[ $# -gt 0 ]]; do
  if [[ $1 == -cf ]]; then touch "$2"; exit; fi
  shift
done
exit 2
DOUBLE
chmod +x "$PROOF_DIR/bin/"*
export PATH="$PROOF_DIR/bin:$PATH"
source "$TOOLS/base-api-proof-cases.sh"
if [[ $CASE == all ]]; then
  for case_name in environment archive suite cleanup success failure INT TERM skipped cleanup-failure residual failure-cleanup INT-cleanup TERM-cleanup; do
    PROOF_ONLY=$case_name bash "$0" "$@"
  done
else
  : > "$PROOF_DIR/commands"
  case $CASE in
    environment|archive|suite) guard_cases;;
    cleanup) cleanup_cases;;
    *) lifecycle_case;;
  esac
  echo "PASS $CASE evidence=$PROOF_DIR"
fi
