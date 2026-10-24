#!/usr/bin/env bash
# Qualify worktree guards without checking out unrelated repository files.
set -euo pipefail
TOOLS=$(cd -- "$(dirname -- "$0")" && pwd)
source "$TOOLS/base-api-guards.sh"
require_env
root=$PWD
start=bf84974e78c6251cb9e1737a30a68c3e14af59e1
mkdir -p tmp/base-api-evidence/tooling
exec > >(tee tmp/base-api-evidence/tooling/worktree-proof.log) 2>&1
scratch=$(mktemp -d "$root/tmp/base-api-evidence/tooling/worktrees.XXXXXX")
trap 'rm -rf -- "$scratch"' EXIT
git init -q "$scratch/repo"
git -C "$scratch/repo" fetch -q --no-tags "$root" "$start:refs/heads/feat/base-api-decouplee-proof"
git -C "$scratch/repo" symbolic-ref HEAD refs/heads/feat/base-api-decouplee-proof
mkdir -p "$scratch/bin"
real_git=$(command -v git)
# The real registration is exercised; --no-checkout avoids reading unrelated files.
cat > "$scratch/bin/git" <<'SH'
#!/usr/bin/env bash
if [[ ${1:-} == worktree && ${2:-} == add ]]; then
  printf '%s\n' "$@" > "$WORKTREE_COMMAND"
  shift 2
  exec "$REAL_GIT" worktree add --no-checkout "$@"
fi
exec "$REAL_GIT" "$@"
SH
chmod +x "$scratch/bin/git"
export REAL_GIT=$real_git WORKTREE_COMMAND=$scratch/command
export PATH="$scratch/bin:$PATH"
cd "$scratch/repo"
reject() {
  local label=$1 code=0; shift
  rm -f "$WORKTREE_COMMAND"
  bash "$TOOLS/base-api-deliver.sh" worktree "$@" "ENV=$ENV" > "$scratch/rejection.log" 2>&1 || code=$?
  [[ $code == 2 && ! -e $WORKTREE_COMMAND ]]
  [[ $(git worktree list --porcelain | rg -c '^worktree ') == 1 ]]
  echo "PASS reject $label before registration"
}
for slug in tmp/base-api-b3 tmp/base-api-b4 tmp/base-api-b50 tmp/base-api-b5/../other /tmp/base-api-b5; do
  reject path "SLUG=$slug" BRANCH=feat/base-api-decouplee-b5 "START=$start"
done
for branch in feat/base-api-decouplee-b1 feat/base-api-decouplee-b50 main; do
  reject branch SLUG=tmp/base-api-b5 "BRANCH=$branch" "START=$start"
done
for pin in bf84974e 965cd42b57dbd1d793556acc0e7c243b19490005 BF84974E78C6251CB9E1737A30A68C3E14AF59E1 ''; do
  reject prerequisite SLUG=tmp/base-api-b5 BRANCH=feat/base-api-decouplee-b5 "START=$pin"
done
saved_env=$ENV; ENV=dev
reject environment SLUG=tmp/base-api-b5 BRANCH=feat/base-api-decouplee-b5 "START=$start"
ENV=$saved_env
mkdir outside
ln -s outside tmp
reject parent-symlink SLUG=tmp/base-api-b5 BRANCH=feat/base-api-decouplee-b5 "START=$start"
rm tmp
mkdir tmp
ln -s ../outside tmp/base-api-b5
reject target-symlink SLUG=tmp/base-api-b5 BRANCH=feat/base-api-decouplee-b5 "START=$start"
rm tmp/base-api-b5
for packet in b5 b1 b2; do
  slug=tmp/base-api-$packet
  branch=feat/base-api-decouplee-$packet
  bash "$TOOLS/base-api-deliver.sh" worktree "SLUG=$slug" "BRANCH=$branch" "START=$start" "ENV=$ENV"
  printf 'worktree\nadd\n%s\n-b\n%s\n%s\n' "$PWD/$slug" "$branch" "$start" > "$scratch/expected"
  cmp "$scratch/expected" "$WORKTREE_COMMAND"
  [[ $(git -C "$slug" rev-parse HEAD) == "$start" ]]
  [[ $(git -C "$slug" branch --show-current) == "$branch" ]]
  echo "PASS $packet exact path/branch/prerequisite registration (no checkout)"
done
