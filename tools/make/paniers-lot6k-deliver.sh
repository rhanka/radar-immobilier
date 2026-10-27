#!/usr/bin/env bash
# Subject-only bounded commits; shared Git metadata remains untouched.
set -euo pipefail
task_dir="$PWD/tmp/paniers-6k"
repo="$task_dir/git"
base=$(git rev-parse '81678e05^{commit}')
plan=plan/PANIERS6K-BRANCH_feat-paniers-6k-lot-cutover.md
local_git() { git --git-dir="$repo/.git" --work-tree="$PWD" "$@"; }
scope() {
  while IFS= read -r path; do
    case "$path" in
      api/drizzle/0022_facet_lot_cutover.sql|api/drizzle/meta/_journal.json|api/src/db/schema.ts|api/src/app.ts|\
      api/src/services/facets/lots/*|api/src/services/chat/stream-bus*.ts|api/src/routes/chat.ts|\
      api/src/routes/lot-cutover-stream.test.ts|api/src/routes/scoped-lot-*.ts|api/src/routes/prospect-marks*.ts|\
      ui/src/lib/maps/lot-facet-counters*.ts|ui/src/lib/prospect/lot-cutover-client*.ts|\
      ui/src/lib/components/maps/LotFichePanel.svelte|ui/src/lib/components/maps/EvaluationMapView.svelte|\
      ui/src/lib/components/maps/LotCutover.ui.test.ts|tools/make/paniers-lot6*|"$plan") ;;
      *) echo "Forbidden delivery path: $path"; exit 1 ;;
    esac
  done < <(local_git diff --name-only "$base" "$1")
}
case "$1" in
  prepare-6k)
    mkdir -p "$task_dir/checkpoints"
    if [[ ! -d "$repo/.git" ]]; then git clone --shared --no-checkout --local . "$repo"; fi
    test "$(local_git rev-parse HEAD)" = "$base"
    local_git config core.worktree "$PWD"
    local_git config user.name Codex
    local_git config user.email codex@openai.com
    local_git read-tree "$base"
    : > "$task_dir/checkpoints/manifest"
    index=0; previous=$base
    while IFS='|' read -r subject files; do
      read -r -a paths <<< "$files"
      for path in "${paths[@]}"; do
        if [[ "$path" = cutover-fixture-base ]]; then
          target=api/src/services/facets/lots/cutover-fixture.ts
          blob=$(awk '/^\/\*\* Manifest with one real/ {skip=1}
            /^\/\*\* Recording safety/ {skip=0}
            !skip && !/^  syntheticLotVersion,/ && !/^  syntheticMark,/ {print}' "$target" \
            | local_git hash-object -w --stdin)
          local_git update-index --add --cacheinfo "100644,$blob,$target"
        else local_git add -- "$path"; fi
      done
      index=$((index + 1))
      blob=$(sed -E "s/Delivery checkpoint: [0-9]+/Delivery checkpoint: $index/" "$plan" \
        | local_git hash-object -w --stdin)
      local_git update-index --add --cacheinfo "100644,$blob,$plan"
      tree=$(local_git write-tree)
      local_git diff --numstat "$previous" "$tree" > "$task_dir/checkpoints/stat"
      awk '{n+=$1+$2; f++} END {exit !(n>0 && n<=150 && f<=15)}' "$task_dir/checkpoints/stat"
      test "${#subject}" -le 72
      [[ "$subject" =~ ^(feat|fix|test|docs|chore)(\([a-z0-9-]+\))?:\ [a-z] ]]
      scope "$tree"
      printf '%02d|%s|%s\n' "$index" "$tree" "$subject" >> "$task_dir/checkpoints/manifest"
      previous=$tree
    done < tools/make/paniers-lot6k-slices.txt
    local_git diff --exit-code "$tree" -- api ui tools/make
    echo "$index bounded delivery trees prepared"
    ;;
  deliver-6k)
    test "$(local_git rev-parse HEAD)" = "$base"
    for gate in final-api-ci-alone/api-ci final-build/build final-lint/lint \
      final-regression/regression final-ui/test-ui final-verify/verify final-mutations/mutation-proof; do
      test "$(cat "$task_dir/logs/$gate.status")" = 0
    done
    : > "$task_dir/commits.tsv"
    while IFS='|' read -r number tree subject; do
      local_git read-tree "$tree"
      make -f tools/make/paniers-lot6.mk commit MSG="$subject" LOT=6K ENV="$ENV"
      sha=$(local_git rev-parse HEAD)
      test "$(local_git rev-parse HEAD^{tree})" = "$tree"
      test "$(local_git log -1 --format=%B)" = "$subject"
      changes=$(local_git diff --numstat "$sha^" "$sha" | awk '{n+=$1+$2; f++} END {print n "\t" f}')
      printf '%s\t%s\t%s\n' "$sha" "$subject" "$changes" >> "$task_dir/commits.tsv"
    done < "$task_dir/checkpoints/manifest"
    local_git show "HEAD:$plan" > "$plan"
    local_git diff --check "$base" HEAD
    local_git diff --exit-code HEAD -- api ui tools/make "$plan"
    branch=$(local_git branch --show-current)
    local_git bundle create "$task_dir/6k.bundle" "$base..$branch"
    local_git bundle verify "$task_dir/6k.bundle"
    sha256sum "$task_dir/6k.bundle" > "$task_dir/bundle.sha256"
    ;;
  finalize-6k)
    # Record final review corrections after an interrupted packaging audit.
    local_git add -- api/src/services/facets/lots/lot-cutover-run.ts "$plan" \
      tools/make/paniers-lot6.mk tools/make/paniers-lot6k-deliver.sh tools/make/paniers-lot6k-slices.txt
    local_git diff --cached --numstat | awk '{n+=$1+$2; f++} END {exit !(n>0 && n<=150 && f<=15)}'
    scope "$(local_git write-tree)"
    subject='chore(paniers): finalize verified cutover delivery'
    make -f tools/make/paniers-lot6.mk commit MSG="$subject" LOT=6K ENV="$ENV"
    sha=$(local_git rev-parse HEAD)
    changes=$(local_git diff --numstat "$sha^" "$sha" | awk '{n+=$1+$2; f++} END {print n "\t" f}')
    printf '%s\t%s\t%s\n' "$sha" "$subject" "$changes" >> "$task_dir/commits.tsv"
    local_git diff --check "$base" HEAD
    local_git diff --exit-code HEAD -- api ui tools/make "$plan"
    branch=$(local_git branch --show-current)
    local_git bundle create "$task_dir/6k.bundle" "$base..$branch"
    local_git bundle verify "$task_dir/6k.bundle"
    sha256sum "$task_dir/6k.bundle" > "$task_dir/bundle.sha256"
    ;;
  audit-6k)
    for script in tools/make/paniers-lot6{k-run,k-mutation,k-deliver,-verify}.sh; do bash -n "$script"; done
    local_git merge-base --is-ancestor "$base" HEAD
    local_git diff --check "$base" HEAD
    local_git diff --exit-code HEAD -- api ui tools/make "$plan"
    scope HEAD
    while IFS= read -r sha; do
      local_git diff --numstat "$sha^" "$sha" | awk '{n+=$1+$2; f++} END {exit !(n<=150 && f<=15)}'
      subject=$(local_git log -1 --format=%s "$sha")
      test "${#subject}" -le 72
      test "$(local_git log -1 --format=%B "$sha")" = "$subject"
    done < <(local_git rev-list "$base..HEAD")
    : > "$task_dir/cleanup-inspect.log"
    for label in $(docker ps -a --format '{{.Label "com.docker.compose.project"}}' | sort -u); do
      case "$label" in radar-test-paniers-6k*|radar-test-paniers-l6k*) echo "Remaining stack: $label"; exit 1;; esac
    done
    for kind in container volume network; do
      flags=(-q); [[ "$kind" != container ]] || flags+=(-a)
      test -z "$(docker "$kind" ls "${flags[@]}" --filter 'name=radar-test-paniers-6k')"
      test -z "$(docker "$kind" ls "${flags[@]}" --filter 'name=radar-test-paniers-l6k')"
    done
    echo '6K test containers=0 volumes=0 networks=0' > "$task_dir/cleanup-inspect.log"
    local_git bundle verify "$task_dir/6k.bundle"
    sha256sum -c "$task_dir/bundle.sha256"
    df -h "$PWD" /var/lib/docker
    ;;
  *) exit 2 ;;
esac
