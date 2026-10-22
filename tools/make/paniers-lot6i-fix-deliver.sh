#!/usr/bin/env bash
# Workspace-local Git delivery; shared worktree metadata stays read-only.
set -euo pipefail
task_dir="$PWD/tmp/paniers-6i-fix"
repo="$task_dir/git"
base=$(git rev-parse 'aa30dd6b^{commit}')
plan=plan/PANIERS6I-BRANCH_feat-paniers-6i-workspace-archive.md
local_git() { git --git-dir="$repo/.git" --work-tree="$PWD" "$@"; }
case "$1" in
  fix-prepare)
    test ! -d "$repo/.git"
    mkdir -p "$task_dir/checkpoints"
    git clone --shared --no-checkout --local . "$repo"
    local_git config core.worktree "$PWD"
    local_git read-tree "$base"
    test "$(local_git rev-parse HEAD)" = "$base"
    : > "$task_dir/checkpoints/manifest"
    index=0
    previous=$base
    while IFS='|' read -r subject files; do
      read -r -a paths <<< "$files"
      local_git add -- "${paths[@]}"
      index=$((index + 1))
      blob=$(sed -E "s/Delivery checkpoint: [0-9]+/Delivery checkpoint: $((19 + index))/" "$plan" \
        | awk -v stage="$index" '/^- \[x\] Review fix [1-6]:/ {if ($5+0 > stage) sub(/\[x\]/, "[ ]")} {print}' \
        | local_git hash-object -w --stdin)
      local_git update-index --add --cacheinfo "100644,$blob,$plan"
      tree=$(local_git write-tree)
      local_git diff --numstat "$previous" "$tree" > "$task_dir/checkpoints/stat"
      awk '{n+=$1+$2; f++} END {exit !(n>0 && n<=150 && f<=15)}' "$task_dir/checkpoints/stat"
      test "${#subject}" -le 72
      [[ "$subject" =~ ^(fix|test|chore)\: ]] || exit 1
      printf -v number '%02d' "$index"
      mapfile -t paths < <(local_git ls-tree -r --name-only "$tree" -- api packages ui \
        | awk '$0 !~ /(^|\/)\.env/')
      local_git archive "$tree" -- "${paths[@]}" > "$task_dir/checkpoints/$number.tar"
      printf '%s|%s|%s\n' "$number" "$tree" "$subject" >> "$task_dir/checkpoints/manifest"
      previous=$tree
    done < tools/make/paniers-lot6i-fix-slices.txt
    ;;
  fix-deliver)
    test "$(local_git rev-parse HEAD)" = "$base"
    : > "$task_dir/commits.tsv"
    previous=$base
    while IFS='|' read -r number tree subject; do
      test "$(cat "$PWD/tmp/paniers-6i/logs/fix-checkpoints/checkpoint-$number.pass")" = "$tree"
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
    local_git show "HEAD:$plan" > "$plan"
    local_git diff --check "$base" HEAD
    local_git diff --exit-code HEAD -- api packages ui tools/make "$plan"
    branch=$(local_git branch --show-current)
    local_git bundle create "$task_dir/6i-fix.bundle" "$base..$branch"
    local_git bundle verify "$task_dir/6i-fix.bundle"
    sha256sum "$task_dir/6i-fix.bundle" > "$task_dir/bundle.sha256"
    ;;
  fix-audit)
    bash -n tools/make/paniers-lot6*.sh
    local_git diff --check "$base" HEAD
    local_git diff --exit-code "$base" HEAD -- api/src/app.ts api/drizzle api/src/services/graph \
      api/src/routes/signal-facets.ts api/src/routes/graph-signals.ts Makefile 'docker-compose*.yml' rules
    local_git diff --exit-code HEAD -- api packages ui tools/make "$plan"
    test "$(local_git rev-list --count "$base..HEAD")" -eq 6
    : > "$task_dir/cleanup-inspect.log"
    for suffix in verify-initial verify api build proofs regression checkpoints; do
      project="radar-test-paniers-6i-fix-$suffix"
      for kind in container volume network; do
        list_flags=(-q)
        [[ "$kind" != container ]] || list_flags+=(-a)
        test -z "$(docker "$kind" ls "${list_flags[@]}" --filter "label=com.docker.compose.project=$project")"
      done
      echo "$project: containers=0 volumes=0 networks=0" >> "$task_dir/cleanup-inspect.log"
    done
    local_git bundle verify "$task_dir/6i-fix.bundle"
    sha256sum -c "$task_dir/bundle.sha256"
    df -h "$PWD" /var/lib/docker
    ;;
  *) exit 2 ;;
esac
