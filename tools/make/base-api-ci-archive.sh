#!/usr/bin/env bash
# Only repository test/code resources, never environment files or client data.
archive_ci_inputs() {
  git ls-files --cached --others --exclude-standard -- api/tests api/src packages/radar-sources/tests/fixtures \
    packages/radar-sources/src/sources/_spikes/roles-evaluation-fonciere-mamh/samples/*.first-record.xml \
    deploy/k8s/scrape/run-chunks.sh \
    > "$RUN_DIR/ci-candidates"
  : > "$RUN_DIR/ci-paths"
  local path part
  while IFS= read -r path; do
    case /$path/ in */.env*|*/credentials*|*/secrets*|*/reports/*|*/input/*) continue;; esac
    case $path in
      api/tests/integration/*.ts|api/tests/fixtures/*.json|api/src/services/geo/fixtures/simulation/*.json|api/src/services/graph/__fixtures__/*.tsv|\
      api/src/services/track/__fixtures__/*.jsonl|packages/radar-sources/tests/fixtures/*|\
      api/src/scripts/fixtures/prove-refresh-signals.ndjson|deploy/k8s/scrape/run-chunks.sh|\
      packages/radar-sources/src/sources/_spikes/roles-evaluation-fonciere-mamh/samples/*.first-record.xml) ;;
      *) continue;;
    esac
    part=$path
    while [[ $part != . ]]; do
      [[ ! -L $part ]] || return 2
      if [[ $part == */* ]]; then part=${part%/*}; else part=.; fi
    done
    printf '%s\n' "$path" >> "$RUN_DIR/ci-paths"
  done < "$RUN_DIR/ci-candidates"
  tar --verbatim-files-from --no-recursion -rf "$RUN_DIR/source.tar" -T "$RUN_DIR/ci-paths"
  cat "$RUN_DIR/ci-paths" >> "$LOG_DIR/archived-paths.txt"
  sha256sum "$RUN_DIR/source.tar" > "$LOG_DIR/source.sha256"
}
