#!/usr/bin/env bash
set -euo pipefail
[[ $ENV == test-artefacts-ouv-l3 && $API_PORT == 18935 && $UI_PORT == 15935 && $MAILDEV_UI_PORT == 11935 ]]
ROOT=$(pwd -P)
BASE=9a723753607097c7758027eb5cc9a2071c8e0023
BRANCH=feat/artefacts-ouverture-l3
GIT=(git --git-dir="$ROOT/tmp/sol-l3.git" --work-tree="$ROOT")
OUT=$ROOT/tmp/sol-l3-evidence
mkdir -p "$OUT"
[[ $("${GIT[@]}" branch --show-current) == "$BRANCH" ]]
"${GIT[@]}" merge-base --is-ancestor "$BASE" HEAD
"${GIT[@]}" merge-base --is-ancestor 17f439c8d8e75303177ba8972a4fd7d8a8cbdc35 HEAD
"${GIT[@]}" diff --check
: > "$OUT/commit-audit.tsv"
while IFS= read -r sha; do
  message=$("${GIT[@]}" show -s --format=%B "$sha")
  [[ $message != *$'\n'* && ${#message} -le 72 ]]
  [[ $message =~ ^(feat|fix|test|docs|chore|refacto|ci)(\([a-z0-9-]+\))?:\ .+$ ]]
  parents=$("${GIT[@]}" show -s --format=%P "$sha" | wc -w)
  if [[ $parents == 2 ]]; then
    # The requested main merge imports upstream work, not authored changes.
    [[ $message == 'chore(l3): merge current main' ]]
    stats=upstream-merge
  else
    [[ $parents == 1 ]]
    stats=$("${GIT[@]}" diff "$sha^" "$sha" --numstat |
      awk '{a+=$1;d+=$2;f++;if($1=="-"||$2=="-")bad=1} END {if(bad||a+d>150||f>15)exit 1; print a,d,f}')
  fi
  printf '%s\t%s\t%s\n' "$sha" "$stats" "$message" >> "$OUT/commit-audit.tsv"
done < <("${GIT[@]}" rev-list --first-parent --reverse "$BASE..HEAD")
[[ $("${GIT[@]}" rev-parse "$BASE:.track/events.jsonl") == $("${GIT[@]}" rev-parse HEAD:.track/events.jsonl) ]]
cat "$OUT/commit-audit.tsv"
if [[ ${1:-audit} == audit ]]; then exit; fi
[[ $1 == bundle ]]
final=$("${GIT[@]}" rev-parse HEAD)
tree=$("${GIT[@]}" rev-parse HEAD^{tree})
bundle=$OUT/artefacts-ouv-l3.bundle
"${GIT[@]}" bundle create "$bundle" "$BASE..$BRANCH"
"${GIT[@]}" bundle verify "$bundle"
fresh=$(mktemp -d "$OUT/reconstructed.XXXXXX")
trap 'rm -rf "$fresh"' EXIT
git init --bare "$fresh" > "$OUT/reconstruction.log"
git -C "$fresh" fetch --depth=1 --no-tags "$ROOT/tmp/sol-l3.git" "$BASE" >> "$OUT/reconstruction.log" 2>&1
git -C "$fresh" bundle verify "$bundle" >> "$OUT/reconstruction.log" 2>&1
git -C "$fresh" fetch "$bundle" "$BRANCH:refs/heads/verified" >> "$OUT/reconstruction.log" 2>&1
[[ $(git -C "$fresh" rev-parse verified) == "$final" ]]
[[ $(git -C "$fresh" rev-parse verified^{tree}) == "$tree" ]]
git -C "$fresh" fsck --full >> "$OUT/reconstruction.log" 2>&1
printf 'HEAD=%s\ntree=%s\n' "$final" "$tree" | tee "$OUT/final-ref.txt"
sha256sum "$bundle" | tee "$OUT/bundle.sha256"
