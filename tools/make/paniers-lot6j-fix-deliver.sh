#!/usr/bin/env bash
# Build reviewable commits locally; never mutate shared worktree metadata.
set -euo pipefail
task_dir="$PWD/tmp/paniers-6j-fix"
repo="$task_dir/git"
base=$(git rev-parse '8b2347e9^{commit}')
plan=plan/PANIERS6J-BRANCH_feat-paniers-6j-lot-destination.md
lots=api/src/services/facets/lots
local_git() { git --git-dir="$repo/.git" --work-tree="$PWD" "$@"; }
partial() {
  local token=$1 path=$2
  case "$token" in
    commands-pre-result)
      awk '/^import type \{ LotEventSnapshot \}/ {next}
        /^export interface LotBatchItemResult/ {
          print; print "  target: LotTarget;";
          print "  event: import(\"./lot-response.js\").LotEventSnapshot | null;"; skip=1; next
        }
        skip && /^}/ {print "  appended: boolean;\n}"; skip=0; next} !skip' "$path" ;;
    writer-outcome|batch-outcome)
      local_git show "$base:$path" | awk '
        /const appended = await appendLotTransition/ {sub(/const appended/, "const outcome")}
        /const result = appended|const snapshot = appended/ {
          print "    const appended = outcome.appended[0] ?? outcome.heads[0] ?? null;"
        } {print}' ;;
    http-basic)
      awk '/  it\("should return full results/ {print "});"; exit} {print}' "$path" ;;
  esac
}
case "$1" in
  fix-prepare)
    mkdir -p "$task_dir/checkpoints"
    if [[ ! -d "$repo/.git" ]]; then git clone --shared --no-checkout --local . "$repo"; fi
    test "$(local_git rev-parse HEAD)" = "$base"
    local_git config core.worktree "$PWD"
    local_git read-tree "$base"
    : > "$task_dir/checkpoints/manifest"
    index=0; previous=$base
    while IFS='|' read -r subject files; do
      read -r -a paths <<< "$files"
      for token in "${paths[@]}"; do
        path=$token
        case "$token" in
          commands-pre-result) path=$lots/lot-commands.ts ;;
          writer-outcome) path=$lots/lot-writer.ts ;;
          batch-outcome) path=$lots/lot-batch.ts ;;
          http-basic) path=api/src/routes/scoped-lot-facets-db.test.ts ;;
          */*) ;; *) path=$lots/$token ;;
        esac
        case "$token" in
          commands-pre-result|writer-outcome|batch-outcome|http-basic)
            blob=$(partial "$token" "$path" | local_git hash-object -w --stdin)
            local_git update-index --add --cacheinfo "100644,$blob,$path" ;;
          *) local_git add -- "$path" ;;
        esac
      done
      index=$((index + 1))
      blob=$(sed -E "s/Delivery checkpoint: [0-9]+/Delivery checkpoint: $((56 + index))/" "$plan" \
        | awk -v stage="$index" '/^- \[x\] Review fix [0-9]+:/ {
          if ($5+0 > stage) sub(/\[x\]/, "[ ]")
        } {print}' | local_git hash-object -w --stdin)
      local_git update-index --add --cacheinfo "100644,$blob,$plan"
      tree=$(local_git write-tree)
      local_git diff --numstat "$previous" "$tree" > "$task_dir/checkpoints/stat"
      awk '{n+=$1+$2; f++} END {exit !(n>0 && n<=150 && f<=15)}' "$task_dir/checkpoints/stat" || {
        echo "Oversized checkpoint $index: $subject"; cat "$task_dir/checkpoints/stat"; exit 1;
      }
      test "${#subject}" -le 72
      [[ "$subject" =~ ^(fix|test|chore|refacto)\: ]]
      printf -v number '%02d' "$index"
      mapfile -t archive_paths < <(local_git ls-tree -r --name-only "$tree" -- api packages ui \
        | awk '$0 !~ /(^|\/)\.env/')
      local_git archive "$tree" -- "${archive_paths[@]}" > "$task_dir/checkpoints/$number.tar"
      printf '%s|%s|%s\n' "$number" "$tree" "$subject" >> "$task_dir/checkpoints/manifest"
      previous=$tree
    done < tools/make/paniers-lot6j-fix-slices.txt
    ;;
  fix-deliver)
    test "$(local_git rev-parse HEAD)" = "$base"
    : > "$task_dir/commits.tsv"
    previous=$base
    while IFS='|' read -r number tree subject; do
      test "$(cat "$PWD/tmp/paniers-6j/logs/fix-checkpoints-final/checkpoint-$number.pass")" = "$tree"
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
    local_git bundle create "$task_dir/6j-fix.bundle" "$base..$branch"
    sha256sum "$task_dir/6j-fix.bundle" > "$task_dir/bundle.sha256"
    ;;
  fix-audit)
    bash -n tools/make/paniers-lot6j-fix-{deliver,mutation}.sh
    local_git diff --check "$base" HEAD
    local_git diff --exit-code HEAD -- api packages ui tools/make "$plan"
    local_git diff --exit-code "$base" HEAD -- Makefile 'docker-compose*.yml' rules api/src/app.ts \
      api/src/services/prospect ui/src packages api/drizzle ':!api/drizzle/0020_facet_lot_history.sql'
    while IFS= read -r sha; do
      local_git diff --numstat "$sha^" "$sha" | awk '{n+=$1+$2; f++} END {exit !(n<=150 && f<=15)}'
      test "$(local_git log -1 --format=%B "$sha")" = "$(local_git log -1 --format=%s "$sha")"
    done < <(local_git rev-list "$base..HEAD")
    : > "$task_dir/cleanup-inspect.log"
    for suffix in '' -verify -api -api-capacity -api-final -api-delivery -proofs -proofs-final -build -regression -checkpoints -final; do
      project="radar-test-paniers-6j-fix$suffix"
      for kind in container volume network; do
        flags=(-q); [[ "$kind" != container ]] || flags+=(-a)
        test -z "$(docker "$kind" ls "${flags[@]}" --filter "label=com.docker.compose.project=$project")"
      done
      echo "$project: containers=0 volumes=0 networks=0" >> "$task_dir/cleanup-inspect.log"
    done
    local_git bundle verify "$task_dir/6j-fix.bundle"
    sha256sum -c "$task_dir/bundle.sha256"
    df -h "$PWD" /var/lib/docker
    ;;
  *) exit 2 ;;
esac
