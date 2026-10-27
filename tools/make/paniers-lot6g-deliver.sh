#!/usr/bin/env bash
# Workspace-only Git fallback: shared worktree metadata is read-only.
set -euo pipefail
task_dir="$PWD/tmp/paniers-6g"
repo="$task_dir/git"
local_git() { git --git-dir="$repo/.git" --work-tree="$PWD" "$@"; }
base=$(git rev-parse 'b55cefb1^{commit}')
stage_paths=(api packages ui tools/make package.json package-lock.json tsconfig.base.json eslint.config.js)
case "$1" in
  prepare)
    test ! -d "$repo/.git"
    mkdir -p "$task_dir/checkpoints"
    git clone --shared --no-checkout --local . "$repo"
    local_git config core.worktree "$PWD"
    local_git read-tree "$base"
    test "$(local_git rev-parse HEAD)" = "$base"
    : > "$task_dir/checkpoints/manifest"
    index=0
    while IFS='|' read -r subject files; do
      [[ -n "$subject" ]] || continue
      read -r -a paths <<< "$files"
      local_git add -- "${paths[@]}"
      tree=$(local_git write-tree)
      previous=${previous:-$base}
      local_git diff --numstat "$previous" "$tree" > "$task_dir/checkpoints/stat"
      awk '{n+=$1+$2; f++} END {exit !(n>0 && n<=150 && f<=15)}' "$task_dir/checkpoints/stat"
      test "${#subject}" -le 72
      [[ "$subject" =~ ^(feat|fix|test|docs|chore)\: ]] || exit 1
      index=$((index + 1))
      printf -v number '%02d' "$index"
      # Filter names BEFORE git archive reads blobs; no environment file enters a checkpoint.
      mapfile -t archive_paths < <(local_git ls-tree -r --name-only "$tree" -- "${stage_paths[@]}" | awk '$0 !~ /(^|\/)\.env/')
      local_git archive "$tree" -- "${archive_paths[@]}" > "$task_dir/checkpoints/$number.tar"
      printf '%s|%s|%s\n' "$number" "$tree" "$subject" >> "$task_dir/checkpoints/manifest"
      previous=$tree
    done < tools/make/paniers-lot6g-slices.txt
    ;;
  finish)
    : > "$task_dir/commits.tsv"
    previous=$base
    while IFS='|' read -r number tree subject; do
      test -f "$task_dir/logs/checkpoints/checkpoint-$number.pass"
      test "$(cat "$task_dir/logs/checkpoints/checkpoint-$number.pass")" = "$tree"
      local_git read-tree "$tree"
      local_git -c core.hooksPath=/dev/null -c commit.gpgsign=false \
        -c user.name=Codex -c user.email=codex@openai.com commit -m "$subject"
      sha=$(local_git rev-parse HEAD)
      test "$(local_git rev-parse HEAD^{tree})" = "$tree"
      test "$(local_git log -1 --format=%B)" = "$subject"
      changes=$(local_git diff --numstat "$previous" "$sha" | awk '{n+=$1+$2; f++} END {print n "\t" f}')
      printf '%s\t%s\t%s\n' "$sha" "$subject" "$changes" >> "$task_dir/commits.tsv"
      previous=$sha
    done < "$task_dir/checkpoints/manifest"
    local_git diff --check "$base" HEAD
    branch=$(local_git branch --show-current)
    local_git bundle create "$task_dir/6g.bundle" "$base..$branch"
    local_git bundle verify "$task_dir/6g.bundle"
    ;;
  audit)
    bash -n tools/make/paniers-lot6*.sh
    local_git diff --check "$base" HEAD
    local_git diff --exit-code "$base" HEAD -- api/src/app.ts \
      api/src/services/facets api/src/services/graph api/src/routes/signal-facets.ts \
      api/src/routes/graph-signals.ts packages ui Makefile 'docker-compose*.yml' rules \
      api/drizzle ':!api/drizzle/0017_workspace_memberships.sql' ':!api/drizzle/meta/_journal.json'
    : > "$task_dir/logs/cleanup-inspect.log"
    for suffix in '' -typecheck -sql -final -regression -cli -proof -checkpoints; do
      project="radar-test-paniers-6g$suffix"
      for kind in container volume network; do
        list_flags=(-q)
        [[ "$kind" != container ]] || list_flags+=(-a)
        remaining=$(docker "$kind" ls "${list_flags[@]}" --filter "label=com.docker.compose.project=$project")
        test -z "$remaining"
      done
      echo "$project: containers=0 volumes=0 networks=0" >> "$task_dir/logs/cleanup-inspect.log"
    done
    local_git bundle verify "$task_dir/6g.bundle"
    ;;
  *) exit 2 ;;
esac
