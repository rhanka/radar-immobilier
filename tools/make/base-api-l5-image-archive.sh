#!/usr/bin/env bash
# Complete tracked Docker COPY inputs; no environment/credential discovery.
image_archive_inputs() {
  local path
  git ls-files -- api packages package.json package-lock.json tsconfig.base.json \
    radar/ontology/ontology-profile.yaml > "$RUN_DIR/image-candidates"
  : > "$RUN_DIR/image-paths"
  while IFS= read -r path; do
    case /$path/ in */.env*|*/node_modules/*|*/dist/*|*/input/*|*/credentials*|*/secrets*) continue;; esac
    [[ -f $path && ! -L $path ]]
    printf '%s\n' "$path" >> "$RUN_DIR/image-paths"
  done < "$RUN_DIR/image-candidates"
  tar --verbatim-files-from --no-recursion -rf "$RUN_DIR/source.tar" -T "$RUN_DIR/image-paths"
  cp "$RUN_DIR/image-paths" "$CAMPAIGN_DIR/image-context-paths.txt"
  while IFS= read -r path; do sha256sum "$path"; done < "$RUN_DIR/image-paths" > "$CAMPAIGN_DIR/image-context.sha256"
}
