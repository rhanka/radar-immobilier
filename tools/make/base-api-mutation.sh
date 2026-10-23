#!/usr/bin/env bash
# Mutate disposable tooling copies; a killed mutant requires the named assertion.
set -euo pipefail
ROOT=$PWD
mkdir -p tmp/base-api-evidence/B0
DIR=$(mktemp -d "$PWD/tmp/base-api-evidence/B0/mutations-XXXXXX")
for kind in environment archive suite skipped cleanup; do
  copy=$DIR/$kind
  mkdir -p "$copy/tools/make" "$copy/api/src/services/facets"
  cp tools/make/base-api* "$copy/tools/make/"
  touch "$copy/api/src/services/facets/scoped-db.test.ts"
  target=$copy/tools/make/base-api-guards.sh
  [[ $kind != cleanup ]] || target=$copy/tools/make/base-api-resources.sh
  cp "$target" "$copy/original"
  proof_case=$kind; [[ $kind != skipped ]] || proof_case=suite
  (cd "$copy"; PROOF_ONLY=$proof_case bash tools/make/base-api-runner-proof.sh) > "$copy/control.log" 2>&1
  case $kind in
    environment) sed -i '/^require_env() {/a\  return 0 # behavior mutant' "$target";;
    archive) sed -i '/^allowed_path() {/a\  return 0 # behavior mutant' "$target";;
    suite) sed -i '/^require_scope() {/a\  return 0 # behavior mutant' "$target";;
    skipped) sed -i '/^assert_tests_ran() {/a\  return 0 # behavior mutant' "$target";;
    cleanup) sed -i '/^verify_ownership() {/a\  return 0 # behavior mutant' "$target";;
  esac
  bash -n "$target"
  code=0
  (cd "$copy"; PROOF_ONLY=$proof_case bash tools/make/base-api-runner-proof.sh) > "$copy/mutant.log" 2>&1 || code=$?
  [[ $code == 1 ]] && grep -q 'ASSERTION FAILED: accepted' "$copy/mutant.log" || {
    echo "Mutant did not fail its behavioral assertion: $kind" >&2; exit 1;
  }
  cp "$copy/original" "$target"
  cmp "$copy/original" "$target"
  (cd "$copy"; PROOF_ONLY=$proof_case bash tools/make/base-api-runner-proof.sh) > "$copy/restored.log" 2>&1
  echo "KILLED $kind; restored byte-for-byte; control PASS; evidence=$copy"
done
