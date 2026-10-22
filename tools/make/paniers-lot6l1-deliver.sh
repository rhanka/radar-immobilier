#!/usr/bin/env bash
# Local metadata only: the checkout's shared Git directory is read-only.
set -euo pipefail
task_dir="$PWD/tmp/paniers-6l1"
repo="$task_dir/git"
base=$(git rev-parse '71f41b72^{commit}')
plan=plan/PANIERS6L1-BRANCH_feat-paniers-6l1-revisions.md
local_git() { git --git-dir="$repo/.git" --work-tree="$PWD" "$@"; }
case "$1" in
  sol-prepare)
    mkdir -p "$task_dir/checkpoints"
    if [[ ! -d "$repo/.git" ]]; then git clone --shared --no-checkout --local . "$repo"; fi
    test "$(local_git rev-parse HEAD)" = "$base"
    local_git config core.worktree "$PWD"
    local_git read-tree "$base"
    : > "$task_dir/checkpoints/manifest"
    index=0
    previous=$base
    while IFS='|' read -r subject files lots; do
      read -r -a paths <<< "$files"
      for path in "${paths[@]}"; do
        if [[ "$path" = projection-store ]]; then
          blob=$(awk '/^export interface ProjectionRead/ {exit} {print}' api/src/services/facets/projection-revisions.ts \
            | local_git hash-object -w --stdin)
          local_git update-index --add --cacheinfo "100644,$blob,api/src/services/facets/projection-revisions.ts"
        else local_git add -- "$path"; fi
      done
      index=$((index + 1))
      blob=$(awk -v stage="$index" -v done=",$lots," '
        /^- \[[ x]\] \*\*Lot [0-8] / {
          lot=$0; sub(/^.*\*\*Lot /, "", lot); sub(/ .*/, "", lot);
          if (index(done, "," lot ",") > 0) sub(/\[[ x]\]/, "[x]"); else sub(/\[[ x]\]/, "[ ]");
        }
        /^- Delivery checkpoint:/ {$0="- Delivery checkpoint: " stage "."} {print}
      ' "$plan" | local_git hash-object -w --stdin)
      local_git update-index --add --cacheinfo "100644,$blob,$plan"
      tree=$(local_git write-tree)
      local_git diff --numstat "$previous" "$tree" > "$task_dir/checkpoints/stat"
      awk '{n+=$1+$2; f++} END {exit !(n>0 && n<=150 && f<=15)}' "$task_dir/checkpoints/stat"
      test "${#subject}" -le 72
      [[ "$subject" =~ ^(feat|fix|test|docs|chore)\: ]] || exit 1
      printf -v number '%02d' "$index"
      mapfile -t archive_paths < <(local_git ls-tree -r --name-only "$tree" -- api packages ui tools/make \
        radar/ontology deploy/k8s/41-immo-mcp-ingress.yaml deploy/k8s/scrape/run-chunks.sh tools/h4-mcp.mk \
        package.json package-lock.json tsconfig.base.json eslint.config.js | awk '$0 !~ /(^|\/)\.env/')
      local_git archive "$tree" -- "${archive_paths[@]}" > "$task_dir/checkpoints/$number.tar"
      printf '%s|%s|%s\n' "$number" "$tree" "$subject" >> "$task_dir/checkpoints/manifest"
      previous=$tree
    done < tools/make/paniers-lot6l1-slices.txt
    ;;
  sol-deliver)
    test "$(local_git rev-parse HEAD)" = "$base"
    : > "$task_dir/commits.tsv"
    previous=$base
    while IFS='|' read -r number tree subject; do
      test "$(cat "$task_dir/logs/checkpoints/checkpoint-$number.pass")" = "$tree"
      local_git read-tree "$tree"
      make -f tools/make/paniers-lot6.mk commit MSG="$subject" LOT=6L1 ENV="$ENV"
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
    local_git bundle create "$task_dir/6l1.bundle" "$base..$branch"
    local_git bundle verify "$task_dir/6l1.bundle"
    sha256sum "$task_dir/6l1.bundle" > "$task_dir/bundle.sha256"
    ;;
  sol-audit)
    bash -n tools/make/paniers-lot6*.sh
    local_git diff --check "$base" HEAD
    local_git diff --exit-code HEAD -- api packages ui tools/make "$plan"
    local_git diff --exit-code "$base" HEAD -- api/src/app.ts Makefile 'docker-compose*.yml' rules \
      api/src/services/facets/scoped-reader.ts api/src/services/facets/workspace-reader.ts packages/immo-mcp
    test "$(local_git rev-list --count "$base..HEAD")" -eq "$(wc -l < tools/make/paniers-lot6l1-slices.txt)"
    for sha in $(local_git rev-list "$base..HEAD"); do
      local_git diff --numstat "$sha^" "$sha" | awk '{n+=$1+$2; f++} END {exit !(n<=150 && f<=15)}'
    done
    : > "$task_dir/cleanup-inspect.log"
    for project in $(docker ps -a --format '{{.Label "com.docker.compose.project"}}' | sort -u); do
      [[ "$project" != radar-test-paniers-6l1* ]] || { echo "Unexpected surviving stack: $project"; exit 1; }
    done
    for kind in container volume network; do
      flags=(-q)
      [[ "$kind" != container ]] || flags+=(-a)
      test -z "$(docker "$kind" ls "${flags[@]}" --filter 'label=com.docker.compose.project' \
        --filter 'name=radar-test-paniers-6l1')"
    done
    echo '6L1 test containers=0 volumes=0 networks=0' > "$task_dir/cleanup-inspect.log"
    local_git bundle verify "$task_dir/6l1.bundle"
    sha256sum -c "$task_dir/bundle.sha256"
    df -h "$PWD" /var/lib/docker
    ;;
  *) exit 2 ;;
esac
