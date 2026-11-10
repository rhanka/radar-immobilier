#!/usr/bin/env bash
# Host-side runner for tools/make/git-artifact.mk. Every stack it starts is
# removed with `down -v`, on success and on failure.
#   proof [REF]  clean `npm ci --ignore-scripts` + `npm run build:artifact` on
#                the committed tree of REF (default HEAD), the app build of the
#                same tree and of origin/main, then a scripts-enabled install
#                to observe the install-script closure.
#   test         the version-tag main-ancestry test, then node --test on the
#                git-artifact tests (descriptor and build environment, dist
#                pre-flight, workflow guards).
set -euo pipefail
[[ ${ENV:-} == test-* ]] || { echo 'ENV must be test-*'; exit 2; }
root=$(cd "$(dirname "$0")/../.." && pwd)
cd "$root"
export COMPOSE_DISABLE_ENV_FILE=1
# UIDFIX-EX2: export the real host ids for the compose user:
# interpolation (run() also passes --user literally as before).
export UID="$(id -u)" GID="$(id -g)"
unset COMPOSE_FILE COMPOSE_ENV_FILES COMPOSE_PROFILES
mkdir -p tmp/git-artifact-proof
compose=(docker compose --env-file /dev/null -p "radar-${ENV}" -f tools/make/git-artifact.compose.yml)
cleanup() { "${compose[@]}" down -v --remove-orphans >/dev/null 2>&1 || true; }
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
run() { "${compose[@]}" run --rm --no-deps -T --user "$(id -u):$(id -g)" node bash -ec "$1"; }
# Tracked + untracked-not-ignored files: never node_modules, tmp or .env.
worktree_tar() { git ls-files -co --exclude-standard -z | tar --null -T - -cf -; }
case ${1:-} in
  proof)
    ref=${2:-HEAD}
    rm -rf tmp/git-artifact-proof/*
    git archive --format=tar "$ref" | run 'bash tools/make/git-artifact-proof.sh branch artifact ignore-scripts'
    git archive --format=tar "$ref" | run 'bash tools/make/git-artifact-proof.sh branch-app app ignore-scripts'
    git archive --format=tar origin/main | run 'bash tools/make/git-artifact-proof.sh main-app app ignore-scripts'
    git archive --format=tar "$ref" | run 'bash tools/make/git-artifact-proof.sh branch-scripts artifact scripts' \
      || echo '[git-artifact] scripts-enabled install failed (recorded in tmp/git-artifact-proof/branch-scripts-npm-ci.log)'
    a=$(jq -r .candidateDigest tmp/git-artifact-proof/branch-app-dist.json)
    b=$(jq -r .candidateDigest tmp/git-artifact-proof/main-app-dist.json)
    echo "[git-artifact] app build digest branch=$a main=$b"
    [[ $a == "$b" ]] || { echo '[git-artifact] app build is NOT byte-identical to origin/main'; exit 1; }
    echo '[git-artifact] app build byte-identical to origin/main'
    ;;
  test)
    # Host-side (bash + git only, no service): version-tag main ancestry guard.
    bash deploy/ci/require-main-ancestry.test.sh
    worktree_tar | run 'src=$(mktemp -d) && tar -xf - -C "$src" && cd "$src" && npm ci --ignore-scripts --no-audit --no-fund --silent && node --test tools/make/git-artifact*.test.mjs'
    ;;
  *) echo 'usage: git-artifact-verify.sh proof [REF] | test'; exit 2 ;;
esac
