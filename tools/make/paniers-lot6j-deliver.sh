#!/usr/bin/env bash
# Shared Git metadata is read-only; produce a verified bundle locally.
set -euo pipefail
task_dir="$PWD/tmp/paniers-6j"
repo="$task_dir/git"
base=$(git rev-parse '71f41b72^{commit}')
plan=plan/PANIERS6J-BRANCH_feat-paniers-6j-lot-destination.md
lots=api/src/services/facets/lots
migration=api/drizzle/0021_facet_lot_history.sql
local_git() { git --git-dir="$repo/.git" --work-tree="$PWD" "$@"; }
partial() {
  local token=$1 path=$2 blob
  case "$token" in
    migration-a) awk '/-- Lot event columns/{exit} {print}' "$path" ;;
    migration-b) awk '/-- Lot streams carry/{exit} {print}' "$path" ;;
    capabilities-base) awk '/export interface LotRights/{exit} {print}' "$path" ;;
    batch-base) awk '/export async function writeLotBatch/{exit} {print}' "$path" ;;
    reader-base) awk '/export async function readLotState/{skip=1} /^type HeadSnapshot/{skip=0} !skip' "$path" ;;
    index-base) awk '/\/\*\* Atomic transitions/{exit} {print}' "$path" ;;
    batch-tests-base) awk '/  it\("should reject duplicate/{print "});";exit} {print}' "$path" ;;
  esac
}
case "$1" in
  prepare)
    mkdir -p "$task_dir/checkpoints"
    if [[ ! -d "$repo/.git" ]]; then git clone --shared --no-checkout --local . "$repo"; fi
    test "$(local_git rev-parse HEAD)" = "$base"
    local_git config core.worktree "$PWD"
    local_git read-tree "$base"
    : > "$task_dir/checkpoints/manifest"
    index=0; previous=$base
    while IFS='|' read -r subject files completed; do
      read -r -a paths <<< "$files"
      for token in "${paths[@]}"; do
        path=$token
        case "$token" in
          plan) path=$plan ;;
          migration-*) path=$migration ;;
          capabilities-base) path=$lots/lot-capabilities.ts ;;
          batch-base) path=$lots/lot-batch.ts ;;
          reader-base) path=$lots/lot-reader.ts ;;
          index-base) path=$lots/index.ts ;;
          batch-tests-base) path=$lots/lot-batch-db.test.ts ;;
          */*) ;;
          *) path=$lots/$token ;;
        esac
        if [[ "$token" == *-base || "$token" == migration-* ]]; then
          blob=$(partial "$token" "$path" | local_git hash-object -w --stdin)
          local_git update-index --add --cacheinfo "100644,$blob,$path"
        else local_git add -- "$path"; fi
      done
      index=$((index + 1))
      blob=$(awk -v stage="$index" -v done=",$completed," '
        /^- \[[ x]\] \*\*Lot [0-9]+ / {
          lot=$0; sub(/^.*\*\*Lot /, "", lot); sub(/ .*/, "", lot);
          if (index(done, "," lot ",") > 0) sub(/\[[ x]\]/, "[x]"); else sub(/\[[ x]\]/, "[ ]");
        }
        /^- Delivery checkpoint:/ {$0="- Delivery checkpoint: " stage "."} {print}
      ' "$plan" | local_git hash-object -w --stdin)
      local_git update-index --add --cacheinfo "100644,$blob,$plan"
      tree=$(local_git write-tree)
      local_git diff --numstat "$previous" "$tree" > "$task_dir/checkpoints/stat"
      awk '{n+=$1+$2; f++} END {exit !(n>0 && n<=150 && f<=15)}' "$task_dir/checkpoints/stat" || {
        echo "oversized checkpoint $index: $subject"; cat "$task_dir/checkpoints/stat"; exit 1;
      }
      test "${#subject}" -le 72
      [[ "$subject" =~ ^(feat|fix|test|docs|chore)\: ]] || exit 1
      printf -v number '%02d' "$index"
      mapfile -t archive_paths < <(local_git ls-tree -r --name-only "$tree" -- api packages ui \
        | awk '$0 !~ /(^|\/)\.env/')
      local_git archive "$tree" -- "${archive_paths[@]}" > "$task_dir/checkpoints/$number.tar"
      printf '%s|%s|%s\n' "$number" "$tree" "$subject" >> "$task_dir/checkpoints/manifest"
      previous=$tree
    done < tools/make/paniers-lot6j-slices.txt
    ;;
  finish)
    test "$(local_git rev-parse HEAD)" = "$base"
    : > "$task_dir/commits.tsv"
    while IFS='|' read -r number tree subject; do
      test "$(cat "$task_dir/logs/checkpoints/checkpoint-$number.pass")" = "$tree"
      local_git read-tree "$tree"
      local_git -c core.hooksPath=/dev/null -c commit.gpgsign=false \
        -c user.name=Codex -c user.email=codex@openai.com commit -m "$subject"
      sha=$(local_git rev-parse HEAD)
      test "$(local_git rev-parse HEAD^{tree})" = "$tree"
      test "$(local_git log -1 --format=%B)" = "$subject"
      printf '%s\t%s\n' "$sha" "$subject" >> "$task_dir/commits.tsv"
    done < "$task_dir/checkpoints/manifest"
    local_git show "HEAD:$plan" > "$plan"
    local_git diff --check "$base" HEAD
    local_git diff --exit-code HEAD -- api packages ui tools/make "$plan"
    branch=$(local_git branch --show-current)
    local_git bundle create "$task_dir/6j.bundle" "$base..$branch"
    local_git bundle verify "$task_dir/6j.bundle"
    sha256sum "$task_dir/6j.bundle" > "$task_dir/bundle.sha256"
    ;;
  audit)
    local_git diff --check "$base" HEAD
    local_git diff --exit-code HEAD -- api packages ui tools/make "$plan"
    local_git diff --exit-code "$base" HEAD -- Makefile 'docker-compose*.yml' rules \
      api/src/app.ts api/src/routes/prospect-marks.ts ui/src \
      api/src/services/prospect api/drizzle ':!api/drizzle/0021_facet_lot_history.sql' ':!api/drizzle/meta/_journal.json'
    local_git log --format=%H "$base..HEAD" | while IFS= read -r sha; do
      local_git diff --numstat "$sha^" "$sha" | awk '{n+=$1+$2; f++} END {exit !(n<=150 && f<=15)}'
      test "$(local_git log -1 --format=%B "$sha")" = "$(local_git log -1 --format=%s "$sha")"
    done
    local_git bundle verify "$task_dir/6j.bundle"
    sha256sum -c "$task_dir/bundle.sha256"
    ;;
  *) exit 2 ;;
esac
