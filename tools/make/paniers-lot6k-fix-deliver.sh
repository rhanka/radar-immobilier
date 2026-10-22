#!/usr/bin/env bash
# Review corrections on independent Git metadata; shared checkout stays intact.
set -euo pipefail
round=${2:-fix}
case "$round" in fix|fix2|fix3) ;; *) exit 2;; esac
task_dir="$PWD/tmp/paniers-6k-$round"
repo="$task_dir/git"
base_ref=63a8991c
[[ "$round" != fix2 ]] || base_ref=323d0db9
[[ "$round" != fix3 ]] || base_ref=0456f85f
base=$(git rev-parse "$base_ref^{commit}")
slices="tools/make/paniers-lot6k-$round-slices.txt"
label='Review fix'
[[ "$round" != fix2 ]] || label='Second review fix'
[[ "$round" != fix3 ]] || label='Third review fix'
plan=plan/PANIERS6K-BRANCH_feat-paniers-6k-lot-cutover.md
local_git() { git --git-dir="$repo/.git" --work-tree="$PWD" "$@"; }
scope() {
  while IFS= read -r path; do
    case "$path" in
      api/drizzle/0023_facet_lot_versions_fence.sql|api/drizzle/meta/_journal.json|\
      api/src/services/facets/lots/lot-cutover*.ts|api/src/services/facets/lots/lot-city.ts|\
      api/src/services/facets/lots/lot-legacy-fence*.ts|api/src/routes/chat.ts|\
      api/src/routes/prospect-marks.ts|api/src/routes/lot-cutover-stream.test.ts|\
      tools/make/paniers-lot6*|"$plan") ;;
      *) echo "Forbidden review correction path: $path"; exit 1 ;;
    esac
  done < <(local_git diff --name-only "$base" "$1")
}
case "$1" in
  prepare)
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
      local_git add -- "${paths[@]}"
      index=$((index + 1))
      blob=$(sed -E "s/^- \[[ x]\] $label checkpoint: [0-9]+/- [x] $label checkpoint: $index/" "$plan" \
        | awk -v stage="$index" -v label="$label" '$0 ~ "^- \\[[ x]\\] " label " [0-9]+:" {
          step=$0; sub("^.*" label " ", "", step)
          if (step+0 <= stage) sub(/\[[ x]\]/, "[x]"); else sub(/\[[ x]\]/, "[ ]")
        } {print}' | local_git hash-object -w --stdin)
      local_git update-index --add --cacheinfo "100644,$blob,$plan"
      tree=$(local_git write-tree)
      local_git diff --numstat "$previous" "$tree" > "$task_dir/checkpoints/stat"
      awk '{n+=$1+$2; f++} END {exit !(n>0 && n<=150 && f<=15)}' "$task_dir/checkpoints/stat"
      test "${#subject}" -le 72
      [[ "$subject" =~ ^(feat|fix|test|docs|chore)(\([a-z0-9-]+\))?:\ [a-z] ]]
      scope "$tree"
      printf '%02d|%s|%s\n' "$index" "$tree" "$subject" >> "$task_dir/checkpoints/manifest"
      previous=$tree
    done < "$slices"
    local_git diff --exit-code "$tree" -- api ui tools/make
    if [[ "$round" == fix2 || "$round" == fix3 ]]; then
      diff_hash=$(git diff HEAD --no-ext-diff | sha256sum | cut -d ' ' -f 1)
      cat > "$task_dir/review.md" <<EOF
---
status: selection-failed
target-ref: $base_ref / current working tree
target-diff-sha256: $diff_hash
observed-failure: Muse author host, exact model and effort are unavailable.
---

The two supplied reviews define the correction criteria. No new peer consensus
is claimed. Review selection stops under harness-review's unknown-author rule.
EOF
    fi
    echo "$index bounded review correction trees prepared"
    ;;
  deliver)
    test "$(local_git rev-parse HEAD)" = "$base"
    gates=(fix-api-ci/api-ci fix-verify/verify fix-build/build fix-lint/lint
      fix-ui/test-ui fix-regression/regression fix-mutations/mutation-proof)
    if [[ "$round" == fix2 ]]; then
      gates=(fix2-api-ci/api-ci fix2-verify/verify fix2-build/build fix2-lint/lint
        fix2-typecheck/typecheck fix2-regression/regression fix2-mutations/mutation-proof)
    fi
    if [[ "$round" == fix3 ]]; then
      gates=(fix3-final-api-ci/api-ci fix3-final-verify/verify fix3-final-build/build fix3-final-lint/lint
        fix3-final-typecheck/typecheck fix3-final-ui/test-ui fix3-final-regression/regression fix3-final-mutations/mutation-proof)
    fi
    for gate in "${gates[@]}"; do
      test "$(cat "tmp/paniers-6k/logs/$gate.status")" = 0
      evidence="tmp/paniers-6k/logs/${gate%/*}/archived-files.sha256"
      awk '$2 ~ /^(api\/(src|drizzle)\/|ui\/src\/)/ && $2 !~ /__6k_baseline__/ {print}' \
        "$evidence" | sha256sum --check --quiet
    done
    : > "$task_dir/commits.tsv"
    while IFS='|' read -r number tree subject; do
      local_git read-tree "$tree"
      make -f tools/make/paniers-lot6.mk commit MSG="$subject" LOT=6K \
        DELIVERY_DIR="$repo" ENV="$ENV"
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
    local_git bundle create "$task_dir/6k-$round.bundle" "$base..$branch"
    local_git bundle verify "$task_dir/6k-$round.bundle"
    sha256sum "$task_dir/6k-$round.bundle" > "$task_dir/bundle.sha256"
    cp RAPPORT-SOL-6K.md "$task_dir/RAPPORT-SOL-6K.md"
    sha256sum "$task_dir/RAPPORT-SOL-6K.md" > "$task_dir/report.sha256"
    ;;
  audit)
    for script in tools/make/paniers-lot6{k-run,k-mutation,k-fix-deliver,-verify}.sh; do bash -n "$script"; done
    local_git merge-base --is-ancestor "$base" HEAD
    local_git diff --check "$base" HEAD
    local_git diff --exit-code HEAD -- api ui tools/make "$plan"
    scope HEAD
    while IFS= read -r sha; do
      local_git diff --numstat "$sha^" "$sha" | awk '{n+=$1+$2; f++} END {exit !(n<=150 && f<=15)}'
      subject=$(local_git log -1 --format=%s "$sha")
      test "${#subject}" -le 72
      [[ "$subject" =~ ^(feat|fix|test|docs|chore)(\([a-z0-9-]+\))?:\ [a-z] ]]
      test "$(local_git log -1 --format=%B "$sha")" = "$subject"
    done < <(local_git rev-list "$base..HEAD")
    local_git diff --exit-code "$base" HEAD -- api/drizzle ':!api/drizzle/meta/_journal.json' \
      ':!api/drizzle/0023_facet_lot_versions_fence.sql'
    : > "$task_dir/cleanup-inspect.log"
    for kind in container volume network; do
      flags=(-q); [[ "$kind" != container ]] || flags+=(-a)
      test -z "$(docker "$kind" ls "${flags[@]}" --filter "name=radar-test-paniers-6k-$round")"
      echo "$kind=0" >> "$task_dir/cleanup-inspect.log"
    done
    local_git bundle verify "$task_dir/6k-$round.bundle"
    sha256sum -c "$task_dir/bundle.sha256"
    sha256sum -c "$task_dir/report.sha256"
    cmp RAPPORT-SOL-6K.md "$task_dir/RAPPORT-SOL-6K.md"
    if [[ "$round" == fix3 ]]; then
      main_ref=$(git rev-parse origin/main)
      printf '%s\n' "$main_ref" > "$task_dir/main-ref.txt"
      local_git diff "$main_ref..HEAD" -- api/src/routes/chat.ts > "$task_dir/chat-vs-main.diff"
      if local_git show HEAD:api/src/routes/chat.ts | grep -Eq \
        'suspendedLive|suspendedBacklog|suspendLegacyMarks|revalidateFence|revalidating'; then exit 1; fi
      local_git diff --exit-code "$base" HEAD -- api/drizzle ui
    fi
    df -h "$PWD" /var/lib/docker
    ;;
  *) exit 2 ;;
esac
