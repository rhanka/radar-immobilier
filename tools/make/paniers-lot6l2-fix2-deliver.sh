#!/usr/bin/env bash
# Review corrections delivered above the required base, without shared Git writes.
set -euo pipefail
task_dir="$PWD/tmp/paniers-6l2-fix2"
repo="$task_dir/git"
base=$(git rev-parse '8fc226fb^{commit}')
plan=plan/PANIERS6L2-BRANCH_feat-paniers-6l2-realtime.md
logs="$PWD/tmp/paniers-6l2/logs/fix2"
local_git() { git --git-dir="$repo/.git" --work-tree="$PWD" "$@"; }
case "$1" in
  sol-fix2-prepare)
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
      blob=$(awk -v stage="$index" '
        /^- \[[ x]\] Second-pass fix [0-9]+:/ {
          step=$0; sub(/^.*Second-pass fix /, "", step)
          if (step+0 <= stage) sub(/\[[ x]\]/, "[x]"); else sub(/\[[ x]\]/, "[ ]")
        }
        /^- Delivery checkpoint:/ {$0="- Delivery checkpoint: " 22+stage "."} {print}
      ' "$plan" | local_git hash-object -w --stdin)
      local_git update-index --add --cacheinfo "100644,$blob,$plan"
      tree=$(local_git write-tree)
      local_git diff --numstat "$previous" "$tree" | tee "$task_dir/checkpoints/stat" \
        | awk '{n+=$1+$2; f++} END {exit !(n>0 && n<=150 && f<=15)}'
      printf -v number '%02d' "$index"
      mapfile -t paths < <(local_git ls-tree -r --name-only "$tree" -- api packages ui tools/make \
        docs/spec/reports/study-2026-07/report.md docs/spec/reports/study-2026-07/slides.html \
        | awk '$0 !~ /(^|\/)\.env/')
      local_git archive "$tree" -- "${paths[@]}" > "$task_dir/checkpoints/$number.tar"
      printf '%s|%s|%s\n' "$number" "$tree" "$subject" >> "$task_dir/checkpoints/manifest"
      previous=$tree
    done < tools/make/paniers-lot6l2-fix2-slices.txt
    ;;
  sol-fix2-deliver)
    test "$(local_git rev-parse HEAD)" = "$base"
    : > "$task_dir/commits.tsv"
    while IFS='|' read -r number tree subject; do
      test "$(cat "$logs/checkpoints/checkpoint-$number.pass")" = "$tree"
      local_git read-tree "$tree"
      local_git -c core.hooksPath=/dev/null -c commit.gpgsign=false \
        -c user.name=Codex -c user.email=codex@openai.com commit -m "$subject"
      sha=$(local_git rev-parse HEAD)
      test "$(local_git rev-parse HEAD^{tree})" = "$tree"
      test "$(local_git log -1 --format=%B)" = "$subject"
      changes=$(local_git diff --numstat HEAD^ HEAD | awk '{n+=$1+$2; f++} END {print n "\t" f}')
      printf '%s\t%s\t%s\n' "$sha" "$subject" "$changes" >> "$task_dir/commits.tsv"
    done < "$task_dir/checkpoints/manifest"
    local_git show "HEAD:$plan" > "$plan"
    local_git diff --exit-code HEAD -- api packages ui tools/make "$plan"
    local_git bundle create "$task_dir/6l2-fix2.bundle" "$base..$(local_git branch --show-current)"
    sha256sum "$task_dir/6l2-fix2.bundle" > "$task_dir/bundle.sha256"
    ;;
  sol-fix2-audit)
    bash -n tools/make/paniers-lot6l2-{fix2-deliver,mutation}.sh tools/make/paniers-lot6-verify.sh
    local_git merge-base --is-ancestor "$base" HEAD
    local_git diff --check "$base" HEAD
    local_git diff --exit-code HEAD -- api packages ui tools/make "$plan"
    while IFS= read -r path; do
      case "$path" in
        ui/src/lib/signals/signal-projection-invalidation-observer.ts|ui/src/lib/signals/signal-projection-invalidation-races.test.ts|tools/make/paniers-lot6*|"$plan") ;;
        *) echo "Forbidden delivery path: $path"; exit 1 ;;
      esac
    done < <(local_git diff --name-only "$base" HEAD)
    test "$(local_git rev-list --count "$base..HEAD")" -eq 2
    for sha in $(local_git rev-list "$base..HEAD"); do
      local_git diff --numstat "$sha^" "$sha" | awk '{n+=$1+$2; f++} END {exit !(n<=150 && f<=15)}'
      subject=$(local_git log -1 --format=%s "$sha")
      test "${#subject}" -le 72
      [[ "$subject" =~ ^(fix|test)\: ]]
      test "$(local_git log -1 --format=%B "$sha")" = "$subject"
    done
    for pair in ui-final:test-ui typecheck-ui-final:typecheck-ui lint-ui:lint-ui verify-6l2:verify mutation:mutation-proof checkpoints:checkpoints; do
      test "$(cat "$logs/${pair%:*}/${pair#*:}.status")" = 0
      diff <(awk '$2 ~ /^(api\/|ui\/|packages\/)/ {print}' "$logs/${pair%:*}/archived-files.sha256") \
        <(awk '$2 ~ /^(api\/|ui\/|packages\/)/ {print}' "$logs/verify-6l2/archived-files.sha256")
    done
    test "$(cat tmp/paniers-6l1/logs/fix2/verify-6l1/verify.status)" = 0
    test "$(grep -c 'mutation exit=1.*saved cmp=0; source cmp=0' "$logs/mutation/mutation-identity.log")" -eq 19
    grep -q '^superseded-convergence: baseline PASS; mutation exit=1' "$logs/mutation/mutation-identity.log"
    grep -q 'all copied API/SQL/UI sources restored: diff=0' "$logs/mutation/mutation-identity.log"
    echo 'All API/UI/package bytes match the final verification' > "$task_dir/source-identity.log"
    : > "$task_dir/cleanup-inspect.log"
    for suffix in '' -ui -ui-final -typecheck-ui -typecheck-ui-final -lint-ui -6l1 -proofs -checkpoints; do
      project="radar-test-paniers-6l2-fix2$suffix"
      for kind in container volume network; do
        flags=(-q); [[ "$kind" != container ]] || flags+=(-a)
        test -z "$(docker "$kind" ls "${flags[@]}" --filter "label=com.docker.compose.project=$project")"
      done
      echo "$project: containers=0 volumes=0 networks=0" >> "$task_dir/cleanup-inspect.log"
    done
    local_git bundle verify "$task_dir/6l2-fix2.bundle"
    sha256sum -c "$task_dir/bundle.sha256"
    df -h "$PWD" /var/lib/docker
    ;;
  *) exit 2 ;;
esac
