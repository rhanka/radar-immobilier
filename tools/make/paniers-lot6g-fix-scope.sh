#!/usr/bin/env bash
# Exercise GNU Make's real defaults on a copy, without starting containers.
set -euo pipefail
task_dir="$PWD/tmp/paniers-6g-fix"
mkdir -p "$task_dir/logs/scope"
source_file=tools/make/paniers-lot6.mk
pristine="$task_dir/scope.pristine.mk"
mutant="$task_dir/scope.mutant.mk"
cp "$source_file" "$pristine"
cp "$pristine" "$mutant"
check_scope() {
  local lot=$1 expected=$2
  shift 2
  env -u SCOPE make --no-print-directory -f "$mutant" \
    --eval='proof-scope: ; @if [ "$$SCOPE" = "$(EXPECTED)" ]; then echo "scope=$$SCOPE PASS"; else echo "AssertionError: scope=$$SCOPE expected=$(EXPECTED)"; exit 1; fi' \
    proof-scope "LOT=$lot" "EXPECTED=$expected" "$@" \
    "API_PORT=$API_PORT" "UI_PORT=$UI_PORT" "MAILDEV_UI_PORT=$MAILDEV_UI_PORT" "ENV=$ENV"
}
check_scope 6G src/services/workspaces > "$task_dir/logs/scope/baseline.log" 2>&1
check_scope 6F src/services/facets >> "$task_dir/logs/scope/baseline.log" 2>&1
check_scope 6G explicit-synthetic-scope SCOPE=explicit-synthetic-scope >> "$task_dir/logs/scope/baseline.log" 2>&1
contents=$(< "$mutant")
printf '%s\n' "${contents/SCOPE ?= src\/services\/workspaces/SCOPE ?= src\/services\/facets}" > "$mutant"
status=0
check_scope 6G src/services/workspaces > "$task_dir/logs/scope/failed.log" 2>&1 || status=$?
test "$status" -eq 2
grep -q AssertionError "$task_dir/logs/scope/failed.log"
echo "default-scope: copied mutation assertion failure make-exit=$status" > "$task_dir/logs/scope/identity.log"
cp "$pristine" "$mutant"
cmp "$pristine" "$mutant"
cmp "$source_file" "$mutant"
echo 'default-scope: restored copy cmp=0; production cmp=0' >> "$task_dir/logs/scope/identity.log"
check_scope 6G src/services/workspaces > "$task_dir/logs/scope/restored.log" 2>&1
cat "$task_dir/logs/scope/identity.log"
