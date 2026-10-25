#!/usr/bin/env bash
# Run the actual root targets, excluding only the forbidden environment include.
set -euo pipefail
dir=$(mktemp -d tmp/base-preprod-k8s.XXXXXX)
trap 'rm -rf "$dir"' EXIT
sed '/^-include \.env$/d' Makefile > "$dir/Makefile"
make -f "$dir/Makefile" k8s-validate MAKE="make -f $dir/Makefile" \
  API_PORT="$API_PORT" UI_PORT="$UI_PORT" MAILDEV_UI_PORT="$MAILDEV_UI_PORT" ENV="$ENV" \
  2>&1 | tee tmp/base-preprod-evidence/pr920-k8s-validate.log
