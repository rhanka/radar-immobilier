#!/bin/sh
# Re-run a worker until its terminal JSON reports no new raw CAS documents.
# Default tranche: 25. Measured worker floor: ~439 MiB cgroup at 0 parsed docs;
# the 768 MiB limit and 512 MiB heap leave room for roughly 25 documents.
set -eu

chunk_size="${SCRAPE_CHUNK_SIZE:-25}"
max_iterations="${SCRAPE_CHUNK_MAX_ITERATIONS:-100}"
case "$chunk_size:$max_iterations" in
  *[!0-9:]*|0:*|*:0) echo "scrape chunks: sizes must be positive integers" >&2; exit 2 ;;
esac

output_file="$(mktemp)"
trap 'rm -f "$output_file"' EXIT HUP INT TERM

iteration=1
while [ "$iteration" -le "$max_iterations" ]; do
  echo "scrape chunks: iteration ${iteration}/${max_iterations}, size=${chunk_size}"
  if LIVE_SCRAPE_LIMIT="$chunk_size" "$@" >"$output_file" 2>&1; then
    :
  else
    status=$?
    cat "$output_file"
    exit "$status"
  fi
  cat "$output_file"
  summary="$(grep -E '^\{"newDocuments":[0-9]+,"skippedExisting":[0-9]+,"remaining":(null|[0-9]+)\}$' "$output_file" | tail -n 1 || true)"
  if [ -z "$summary" ]; then
    echo "scrape chunks: worker emitted no valid terminal JSON" >&2
    exit 1
  fi
  new_documents="$(printf '%s\n' "$summary" | sed -n 's/.*"newDocuments":\([0-9][0-9]*\).*/\1/p')"
  remaining="$(printf '%s\n' "$summary" | sed -n 's/.*"remaining":\(null\|[0-9][0-9]*\).*/\1/p')"
  if [ "$new_documents" = 0 ] || [ "$remaining" = 0 ]; then
    echo "scrape chunks: complete after ${iteration} iteration(s)"
    exit 0
  fi
  iteration=$((iteration + 1))
done

echo "scrape chunks: reached max iterations (${max_iterations})" >&2
exit 1
