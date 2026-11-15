# Additive copy of the prod artifact blobs into the preprod artifacts bucket,
# under the preprod scope (owner decision 2026-11-15). POSIX sh + s5cmd only:
# runs as the `blobs` init container of the preprod catalogue Job, before the
# union import makes any row visible.
#
# Keys: artifacts/<scope>/blobs/sha256/<hex>, content addressed: a blob whose
# name already exists at the destination has the same bytes and is never
# copied again (explicit missing list + `cp -n`). Nothing is ever deleted.
# The prod bucket is only listed and read: the only write target is
# DST_BUCKET, which must differ from SRC_BUCKET, end in `-preprod` and not be
# listed in FORBIDDEN_DST_BUCKETS.
#
# Single-part only: the copy identity has no multipart right. Each copy is one
# server-side CopyObject with `-p` (part size, MiB) above the largest blob a
# release may hold (RELEASE_FILE_BYTES_MAX = 16 MiB, packages/artifacts-host/
# src/p0b-profile.ts). A blob larger than MAX_BLOB_BYTES is refused (exit 3)
# before any copy, never split into parts.
#
# Inputs (env): S5CMD (default /s5cmd), ENDPOINT, SRC_BUCKET, SRC_SCOPE,
# DST_BUCKET, DST_SCOPE, FORBIDDEN_DST_BUCKETS (comma list), WORK (default
# /work), MAX_BLOB_BYTES (default 16777216), PART_SIZE_MIB (default 64).
# Output: $WORK/preprod-blob-keys.txt, the destination listing (hex names)
# read by `artifacts-catalogue.sh blob-check`.
set -eu
S5CMD=${S5CMD:-/s5cmd}
WORK=${WORK:-/work}
MAX_BLOB_BYTES=${MAX_BLOB_BYTES:-16777216}
PART_SIZE_MIB=${PART_SIZE_MIB:-64}
[ $((PART_SIZE_MIB * 1048576)) -gt "$MAX_BLOB_BYTES" ] || { echo '[blobs] part size must exceed the largest blob' >&2; exit 2; }
for v in ENDPOINT SRC_BUCKET SRC_SCOPE DST_BUCKET DST_SCOPE; do
  eval "[ -n \"\${$v:-}\" ]" || { echo "[blobs] missing $v" >&2; exit 2; }
done
[ "$DST_BUCKET" != "$SRC_BUCKET" ] || { echo '[blobs] destination equals source' >&2; exit 2; }
case "$DST_BUCKET" in *-preprod) ;; *) echo '[blobs] destination is not a preprod bucket' >&2; exit 2;; esac
case ",${FORBIDDEN_DST_BUCKETS:-}," in *",$DST_BUCKET,"*) echo '[blobs] destination is forbidden' >&2; exit 2;; esac
case "$SRC_SCOPE$DST_SCOPE" in *[!a-z0-9.-]*) echo '[blobs] bad scope id' >&2; exit 2;; esac
src="s3://$SRC_BUCKET/artifacts/$SRC_SCOPE/blobs/sha256/"
dst="s3://$DST_BUCKET/artifacts/$DST_SCOPE/blobs/sha256/"

# Sorted sha256 hex names under a prefix; empty when the prefix holds nothing.
list() {
  if "$S5CMD" --endpoint-url "$ENDPOINT" ls "$1*" > "$2.raw" 2> "$2.err"; then
    awk '{print $NF}' "$2.raw" | sed 's#.*/##' | grep -E '^[0-9a-f]{64}$' | sort -u > "$2" || : > "$2"
    awk '{n=$NF; sub(".*/", "", n); print n, $(NF-1)}' "$2.raw" > "$2.sizes"
  elif grep -qi 'no object found' "$2.err"; then
    : > "$2"; : > "$2.sizes"
  else
    echo '[blobs] listing failed' >&2; exit 1
  fi
}

list "$src" "$WORK/src.keys"
list "$dst" "$WORK/dst.keys"
comm -23 "$WORK/src.keys" "$WORK/dst.keys" > "$WORK/missing.keys"
# Refuse, before any copy, a blob the single-part copy cannot carry.
over=$(awk -v max="$MAX_BLOB_BYTES" 'NR == FNR { want[$1] = 1; next } ($1 in want) && $2 + 0 > max + 0 { print $1 }' "$WORK/missing.keys" "$WORK/src.keys.sizes")
[ -z "$over" ] || { echo "[blobs] $(printf '%s\n' "$over" | wc -l) blob(s) over the single-part limit of $MAX_BLOB_BYTES bytes, refusing" >&2; exit 3; }
: > "$WORK/copy.cmds"
while read -r hex; do
  printf 'cp -n -p %s "%s%s" "%s%s"\n' "$PART_SIZE_MIB" "$src" "$hex" "$dst" "$hex" >> "$WORK/copy.cmds"
done < "$WORK/missing.keys"
if [ -s "$WORK/copy.cmds" ]; then
  "$S5CMD" --endpoint-url "$ENDPOINT" run "$WORK/copy.cmds" > /dev/null
fi
list "$dst" "$WORK/preprod-blob-keys.txt"
# Every prod blob is now present under the preprod scope.
[ -z "$(comm -23 "$WORK/src.keys" "$WORK/preprod-blob-keys.txt")" ] || { echo '[blobs] copy incomplete' >&2; exit 1; }
echo "[blobs] source=$(wc -l < "$WORK/src.keys") copied=$(wc -l < "$WORK/missing.keys") destination=$(wc -l < "$WORK/preprod-blob-keys.txt")"
