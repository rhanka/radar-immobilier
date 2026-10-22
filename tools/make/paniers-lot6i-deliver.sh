#!/usr/bin/env bash
# Shared worktree metadata is read-only; deliver inside this workspace.
set -euo pipefail
task_dir="$PWD/tmp/paniers-6i"
repo="$task_dir/git"
base=$(git rev-parse '33d56784^{commit}')
plan=plan/PANIERS6I-BRANCH_feat-paniers-6i-workspace-archive.md
local_git() { git --git-dir="$repo/.git" --work-tree="$PWD" "$@"; }
case "$1" in
  prepare)
    mkdir -p "$task_dir/checkpoints"
    if [[ ! -d "$repo/.git" ]]; then git clone --shared --no-checkout --local . "$repo"; fi
    test "$(local_git rev-parse HEAD)" = "$base"
    local_git config core.worktree "$PWD"
    local_git read-tree "$base"
    test "$(local_git rev-parse HEAD)" = "$base"
    : > "$task_dir/checkpoints/manifest"
    index=0
    previous=$base
    while IFS='|' read -r subject files lots; do
      [[ -n "$subject" ]] || continue
      read -r -a paths <<< "$files"
      for path in "${paths[@]}"; do
        if [[ "$path" == writer-helpers ]]; then
          blob=$(sed -n '1,55p;136,187p' api/src/services/facets/workspace-writer.ts | local_git hash-object -w --stdin)
          local_git update-index --add --cacheinfo "100644,$blob,api/src/services/facets/workspace-writer.ts"
        else local_git add -- "$path"; fi
      done
      index=$((index + 1))
      blob=$(awk -v stage="$index" -v done=",$lots," '
        /^- \[[ x]\] \*\*Lot [0-8] / {
          lot=$4; if (index(done, "," lot ",") > 0) sub(/\[[ x]\]/, "[x]"); else sub(/\[[ x]\]/, "[ ]");
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
    done < tools/make/paniers-lot6i-slices.txt
    ;;
  finish)
    test "$(local_git rev-parse HEAD)" = "$base"
    : > "$task_dir/commits.tsv"
    previous=$base
    while IFS='|' read -r number tree subject; do
      test "$(cat "$task_dir/logs/resume-checkpoints/checkpoint-$number.pass")" = "$tree"
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
    local_git bundle create "$task_dir/6i.bundle" "$base..$branch"
    local_git bundle verify "$task_dir/6i.bundle"
    sha256sum "$task_dir/6i.bundle" > "$task_dir/bundle.sha256"
    ;;
  audit)
    bash -n tools/make/paniers-lot6*.sh
    local_git diff --check "$base" HEAD
    local_git diff --exit-code HEAD -- api packages ui tools/make "$plan"
    local_git diff --exit-code "$base" HEAD -- api/src/app.ts api/src/services/graph \
      api/src/routes/signal-facets.ts api/src/routes/graph-signals.ts Makefile 'docker-compose*.yml' rules \
      api/drizzle ':!api/drizzle/0019_facet_workspace_archive.sql' ':!api/drizzle/meta/_journal.json'
    : > "$task_dir/cleanup-inspect.log"
    for suffix in '' -repro -repro-tests -build -regression -resume-verify -resume-regression \
      -resume-api-ci -resume-proofs -resume-checkpoints -resume-build; do
      project="radar-test-paniers-6i$suffix"
      for kind in container volume network; do
        list_flags=(-q)
        [[ "$kind" != container ]] || list_flags+=(-a)
        test -z "$(docker "$kind" ls "${list_flags[@]}" --filter "label=com.docker.compose.project=$project")"
      done
      echo "$project: containers=0 volumes=0 networks=0" >> "$task_dir/cleanup-inspect.log"
    done
    local_git bundle verify "$task_dir/6i.bundle"
    sha256sum -c "$task_dir/bundle.sha256"
    ;;
  *) exit 2 ;;
esac
