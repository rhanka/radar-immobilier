#!/usr/bin/env bash
# Independent Git metadata protects the conductor's read-only checkout.
set -euo pipefail
task_dir="$PWD/tmp/paniers-6j-fix2"
repo="$task_dir/git"
base=$(git rev-parse '4044af20^{commit}')
plan=plan/PANIERS6J-BRANCH_feat-paniers-6j-lot-destination.md
local_git() { git --git-dir="$repo/.git" --work-tree="$PWD" "$@"; }
case "$1" in
  prepare)
    mkdir -p "$task_dir/checkpoints"
    if [[ ! -d "$repo/.git" ]]; then git clone --shared --no-checkout --local . "$repo"; fi
    test "$(local_git rev-parse HEAD)" = "$base"
    local_git config core.worktree "$PWD"
    local_git read-tree "$base"
    : > "$task_dir/checkpoints/manifest"
    index=0; previous=$base
    while IFS='|' read -r subject files; do
      read -r -a paths <<< "$files"
      local_git add -- "${paths[@]}"
      index=$((index + 1))
      blob=$(sed -E "s/Delivery checkpoint: [0-9]+/Delivery checkpoint: $((68 + index))/" "$plan" \
        | awk -v stage="$index" '/^- \[[ x]\] Second-pass fix [0-9]+:/ {
          step=$0; sub(/^.*Second-pass fix /, "", step)
          if (step+0 <= stage) sub(/\[[ x]\]/, "[x]"); else sub(/\[[ x]\]/, "[ ]")
        } {print}' | local_git hash-object -w --stdin)
      local_git update-index --add --cacheinfo "100644,$blob,$plan"
      tree=$(local_git write-tree)
      local_git diff --numstat "$previous" "$tree" > "$task_dir/checkpoints/stat"
      awk '{n+=$1+$2; f++} END {exit !(n>0 && n<=150 && f<=15)}' "$task_dir/checkpoints/stat"
      test "${#subject}" -le 72
      [[ "$subject" =~ ^(fix|test|chore)\: ]]
      printf -v number '%02d' "$index"
      mapfile -t archive_paths < <(local_git ls-tree -r --name-only "$tree" -- api packages ui \
        | awk '$0 !~ /(^|\/)\.env/')
      local_git archive "$tree" -- "${archive_paths[@]}" > "$task_dir/checkpoints/$number.tar"
      printf '%s|%s|%s\n' "$number" "$tree" "$subject" >> "$task_dir/checkpoints/manifest"
      previous=$tree
    done < tools/make/paniers-lot6j-fix2-slices.txt
    ;;
  finish)
    test "$(local_git rev-parse HEAD)" = "$base"
    : > "$task_dir/commits.tsv"
    previous=$base
    while IFS='|' read -r number tree subject; do
      test "$(cat "$PWD/tmp/paniers-6j/logs/fix2-checkpoints/checkpoint-$number.pass")" = "$tree"
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
    local_git bundle create "$task_dir/6j-fix2.bundle" "$base..$branch"
    sha256sum "$task_dir/6j-fix2.bundle" > "$task_dir/bundle.sha256"
    ;;
  audit)
    bash -n tools/make/paniers-lot6j-fix2-{deliver,mutation}.sh
    local_git merge-base --is-ancestor "$base" HEAD
    local_git diff --check "$base" HEAD
    local_git diff --exit-code HEAD -- api packages ui tools/make "$plan"
    while IFS= read -r path; do
      case "$path" in
        api/src/services/facets/lots/*|api/src/routes/scoped-lot-*.ts|tools/make/paniers-lot6*|"$plan") ;;
        *) echo "Forbidden delivery path: $path"; exit 1 ;;
      esac
    done < <(local_git diff --name-only "$base" HEAD)
    while IFS= read -r sha; do
      local_git diff --numstat "$sha^" "$sha" | awk '{n+=$1+$2; f++} END {exit !(n<=150 && f<=15)}'
      subject=$(local_git log -1 --format=%s "$sha")
      test "${#subject}" -le 72
      [[ "$subject" =~ ^(fix|test|chore)\: ]]
      test "$(local_git log -1 --format=%B "$sha")" = "$subject"
    done < <(local_git rev-list "$base..HEAD")
    : > "$task_dir/cleanup-inspect.log"
    for project in $(docker ps -a --format '{{.Label "com.docker.compose.project"}}' \
      | sort -u | grep '^radar-test-paniers-6j-fix2' || true); do
      echo "Remaining project: $project"; exit 1
    done
    for suffix in api-ci verify gates proofs regression checkpoints; do
      project="radar-test-paniers-6j-fix2-$suffix"
      for kind in container volume network; do
        flags=(-q); [[ "$kind" != container ]] || flags+=(-a)
        test -z "$(docker "$kind" ls "${flags[@]}" --filter "label=com.docker.compose.project=$project")"
      done
      echo "$project: containers=0 volumes=0 networks=0" >> "$task_dir/cleanup-inspect.log"
    done
    local_git bundle verify "$task_dir/6j-fix2.bundle"
    sha256sum -c "$task_dir/bundle.sha256"
    df -h "$PWD" /var/lib/docker
    ;;
  *) exit 2 ;;
esac
