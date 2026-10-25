#!/usr/bin/env bash
# Guards shared by the executable runner and command-double proofs.
require_env() {
  [[ ${BASE_API_SOURCE:-worktree} == worktree || ${BASE_API_SOURCE:-worktree} == index ]] || return 2
  [[ ${ENV:-} =~ ^(test|e2e)-[a-z0-9]+(-[a-z0-9]+)*$ ]] || {
    echo "Refusing unqualified ENV: ${ENV:-}" >&2; return 2;
  }
}
require_scope() {
  [[ -n ${SCOPE:-} ]] || { echo 'Required scope is empty' >&2; return 2; }
  local path
  for path in $SCOPE; do
    [[ $path =~ ^(src|tests)/[a-zA-Z0-9_./-]+\.(test|spec)\.ts$ && $path != *..* ]] || {
      echo "Invalid required scope: $path" >&2; return 2;
    }
    [[ -f api/$path && ! -L api/$path ]] || return 2
  done
}
allowed_path() {
  local p=$1 part
  [[ $p != /* && $p != *..* && $p != *$'\n'* && $p != *$'\t'* ]] || return 2
  case /$p/ in
    */.env*|*/.git/*|*/node_modules/*|*/dist/*|*/credentials*|*/secrets*|*/fixtures/*|*/reports/*|*/input/*) return 2;;
  esac
  case $p in
    package.json|package-lock.json|tsconfig.base.json|eslint.config.js|api/package.json|api/tsconfig.json|api/vitest.config.ts|radar/ontology/ontology-profile.yaml|packages/radar-sources/src/geo/municipalities.qc.json) ;;
    api/src/*.ts|api/tests/integration/base-api*.ts|api/drizzle/*.sql|api/drizzle/meta/_journal.json) ;;
    packages/*/package.json|packages/*/tsconfig.json|packages/*/src/*.ts|packages/*/src/*.svelte|tools/make/base-api*.sh|tools/make/base-api*.mjs) ;;
    *) return 2;;
  esac
  # Reject symlink ancestors without opening the target.
  part=$p
  while [[ $part != . ]]; do
    [[ ! -L $part ]] || return 2
    if [[ $part == */* ]]; then part=${part%/*}; else part=.; fi
  done
}
allowed_delivery_path() {
  case $1 in
    plan/BASEAPI-BRANCH_feat_base-api-decouplee.md|docs/spec/SPEC_EVOL_BASE_API.md|docs/spec/SPEC_BASE_API.md|docs/spec/BASE_API_ACTIVATION.md|tools/make/base-api*.sh|tools/make/base-api*.mk|tools/make/base-api*.mjs) ;;
    api/src/app.ts|api/src/index.ts|api/src/routes/auth.ts|api/src/db/schema.ts|api/drizzle/*|tools/make/paniers-lot6.mk|tools/make/paniers-lot6-verify.sh) ;;
    api/src/services/facets/*|api/src/routes/scoped-*|api/src/routes/workspaces.ts|api/src/routes/signal-facets*|api/src/routes/graph-signals*|api/tests/integration/base-api*) ;;
    api/src/scripts/base-api-personal-activation.ts) ;;
    api/src/services/geo/ogc-pull.ts|api/src/services/geo/ogc-pull.test.ts|api/src/services/geo/ogc-pull-*.test.ts) ;;
    api/src/services/geo/populate-geo.ts|api/src/services/geo/populate-geo.test.ts|api/src/services/geo/populate-geo-*.test.ts) ;;
    api/src/services/exploitation/projection.ts|api/src/services/exploitation/projection.test.ts|api/src/services/exploitation/projection-*.test.ts) ;;
    *) echo "Out-of-scope staging: $1" >&2; return 2;;
  esac
  local part=$1
  [[ $part != *..* ]] || return 2
  while [[ $part != . ]]; do
    [[ ! -L $part ]] || return 2
    if [[ $part == */* ]]; then part=${part%/*}; else part=.; fi
  done
}
archive_sources() {
  local tracking=(--cached)
  [[ ${BASE_API_SOURCE:-worktree} != worktree ]] || tracking+=(--others)
  git ls-files "${tracking[@]}" --exclude-standard -- api/src api/drizzle api/package.json api/tsconfig.json api/vitest.config.ts \
    api/tests/integration packages tools/make radar/ontology/ontology-profile.yaml package.json package-lock.json tsconfig.base.json eslint.config.js \
    > "$RUN_DIR/candidates"
  : > "$RUN_DIR/paths"
  while IFS= read -r path; do
    # Non-source metadata is excluded without accessing its contents.
    if allowed_path "$path"; then printf '%s\n' "$path" >> "$RUN_DIR/paths"; fi
  done < "$RUN_DIR/candidates"
  while IFS= read -r path; do allowed_path "$path" || return 2; done < "$RUN_DIR/paths"
  local changed
  changed=$(git diff --name-only HEAD; git ls-files --others --exclude-standard)
  [[ -z ${BASE_API_LINT_FILES:-} ]] || changed=${BASE_API_LINT_FILES// /$'\n'}
  : > "$LOG_DIR/changed-files.txt"
  while IFS= read -r path; do
    case $path in api/src/*.ts|api/tests/integration/base-api*.ts)
      allowed_path "$path" && [[ -f $path ]] || return 2
      printf '%s\n' "$path" >> "$LOG_DIR/changed-files.txt";;
      '') ;;
      *) [[ -z ${BASE_API_LINT_FILES:-} ]] || return 2;;
    esac
  done <<< "$changed"
  if [[ ${BASE_API_SOURCE:-worktree} == index ]]; then
    local tree paths
    tree=$(git write-tree)
    mapfile -t paths < "$RUN_DIR/paths"
    git archive --format=tar "$tree" -- "${paths[@]}" > "$RUN_DIR/source.tar"
    printf '%s\n' "$tree" > "$LOG_DIR/source-tree.txt"
  else
    tar --verbatim-files-from --no-recursion -cf "$RUN_DIR/source.tar" -T "$RUN_DIR/paths"
  fi
  cp "$RUN_DIR/paths" "$LOG_DIR/archived-paths.txt"
  sha256sum "$RUN_DIR/source.tar" > "$LOG_DIR/source.sha256"
}
scope_check() {
  local path paths preview merge_head
  local comparison=HEAD
  if merge_head=$(git rev-parse -q --verify MERGE_HEAD); then
    preview=$(git merge-tree --write-tree HEAD "$merge_head") || [[ $? == 1 ]]
    comparison=${preview%%$'\n'*}
    [[ $comparison =~ ^[a-f0-9]{40}$ ]] || return 2
  fi
  paths=$(git diff --name-only "$comparison"; git ls-files --others --exclude-standard)
  while IFS= read -r path; do
    [[ -n $path ]] || continue
    case $path in
      tools/make/base-api*|plan/BASEAPI-BRANCH_feat_base-api-decouplee.md|docs/spec/SPEC_EVOL_BASE_API.md|docs/spec/SPEC_BASE_API.md|docs/spec/BASE_API_ACTIVATION.md) ;;
      api/src/services/facets/*|api/tests/integration/base-api*|api/src/routes/workspaces.ts|api/src/routes/scoped-*|api/src/routes/signal-facets*|api/src/routes/graph-signals*) ;;
      api/src/app.ts|api/src/index.ts|api/src/db/schema.ts|api/drizzle/*|api/src/routes/auth.ts|tools/make/paniers-lot6*) ;;
      api/src/services/geo/ogc-pull*|api/src/services/geo/populate-geo*|api/src/services/exploitation/projection*) ;;
      api/src/scripts/base-api-personal-activation.ts) ;;
      *) echo "Outside BASE branch scope: $path" >&2; return 2;;
    esac
  done <<< "$paths"
}
assert_tests_ran() {
  local summary=$1 path count failed skipped found total=0
  [[ -s $summary ]] || { echo 'Missing executed test evidence' >&2; return 1; }
  for path in $SCOPE; do
    found=0
    while IFS=$'\t' read -r file count failed skipped; do
      [[ $file == "$path" ]] || continue
      [[ $count =~ ^[0-9]+$ && $failed == 0 && $skipped == 0 && $count -gt 0 ]] || {
        echo "Required suite empty, failed or skipped: $path" >&2; return 1;
      }
      found=1; total=$((total + count))
    done < "$summary"
    [[ $found == 1 ]] || { echo "Required suite absent: $path" >&2; return 1; }
  done
  [[ $total -gt 0 ]] || { echo 'No required tests executed' >&2; return 1; }
}
