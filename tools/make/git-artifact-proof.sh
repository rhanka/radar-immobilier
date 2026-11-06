#!/usr/bin/env bash
# In-container proof of the closed artifact recipe (G0 v3 §4.1), from a CLEAN
# tree read on stdin (tar of a git tree, no node_modules, no .env):
#   locked install at the lockfile directory, then the named build script.
# Usage: git-artifact-proof.sh <label> <artifact|app> <ignore-scripts|scripts>
# Writes <label>-*.json and <label>-npm-ci.log into /out.
set -euo pipefail
label=$1 build=$2 install=$3
out=/out
tools=/workspace/tools/make
# Fixed build path: the Svelte scoped-CSS hashes depend on the absolute source
# path, so two builds of one tree compare byte-for-byte only at the same path.
src=/tmp/radar-immobilier
mkdir "$src"
tar -xf - -C "$src"
cd "$src"
{
  echo "node=$(node -v) npm=$(npm -v)"
  echo "python3=$(command -v python3 || echo absent) python=$(command -v python || echo absent)"
  echo "make=$(command -v make || echo absent) gcc=$(command -v gcc || echo absent) g++=$(command -v g++ || echo absent)"
  echo "node_modules_before=$(test -e node_modules && echo present || echo absent) dotenv=$(ls -a | grep -c '^\.env' || true)"
} | tee "$out/$label-toolchain.txt"
node "$tools/git-artifact-closure.mjs" package-lock.json > "$out/$label-closure.json"
flags=(--no-audit --no-fund --foreground-scripts --loglevel=info)
[[ $install == ignore-scripts ]] && flags+=(--ignore-scripts)
start=$(date +%s)
npm ci "${flags[@]}" > "$out/$label-npm-ci.log" 2>&1 || { echo "npm ci failed"; tail -40 "$out/$label-npm-ci.log"; exit 1; }
echo "npm_ci_seconds=$(( $(date +%s) - start ))" | tee -a "$out/$label-toolchain.txt"
find node_modules -name binding.gyp -not -path '*/node_modules/*/node_modules/*/test/*' 2>/dev/null \
  | sed 's#/binding.gyp$##' | sort > "$out/$label-binding-gyp.txt" || true
find node_modules -name '*.node' -type f 2>/dev/null | sort > "$out/$label-native-addons.txt" || true
[[ $install == ignore-scripts ]] || exit 0
start=$(date +%s)
if [[ $build == artifact ]]; then npm run build:artifact; else npm run build -w ui; fi > "$out/$label-build.log" 2>&1 \
  || { echo "build failed"; tail -40 "$out/$label-build.log"; exit 1; }
echo "build_seconds=$(( $(date +%s) - start ))" | tee -a "$out/$label-toolchain.txt"
node "$tools/git-artifact-dist.mjs" ui/dist index.html > "$out/$label-dist.json"
# Kept under a `dist` directory so the repository lint ignore (**/dist/**) covers it.
mkdir -p "$out/$label" && cp -r ui/dist "$out/$label/dist"
node -e 'const s=require(process.argv[1]);console.log(`files=${s.fileCount} bytes=${s.totalBytes} largest=${s.largestFile.path}:${s.largestFile.bytes} digest=${s.candidateDigest} violations=${s.violations.length}`)' "$out/$label-dist.json" \
  | tee -a "$out/$label-toolchain.txt"
