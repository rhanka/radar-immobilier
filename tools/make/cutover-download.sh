#!/usr/bin/env bash
set -euo pipefail
umask 077
fail() { printf '%s\n' 'Release download refused' >&2; exit 1; }
source tools/make/cutover-release.sh
case ${ENV:-} in preprod|prod) ;; *) fail;; esac
[[ ${BUILD_RUN:-} =~ ^[0-9]+$ && ${SHA:-} =~ ^[0-9a-f]{40}$ ]] || fail
OUTPUT=${OUTPUT:-cutover-release}
[[ $OUTPUT != *'/.env'* && $OUTPUT != .env* ]] || fail
mkdir -p "$OUTPUT"
gh run download "$BUILD_RUN" --repo rhanka/radar-immobilier --name "cutover-release-$SHA" --dir "$OUTPUT"
validate_release "$OUTPUT/release.json"
jq -e --arg sha "$SHA" '.gitSha==$sha' "$OUTPUT/release.json" >/dev/null || fail
