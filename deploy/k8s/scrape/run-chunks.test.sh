#!/bin/sh
set -eu
root="$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
cat > "$tmp/worker" <<'WORKER'
#!/bin/sh
n=$(cat "$STATE")
if [ "$n" -gt 0 ]; then
  written=$((n > 25 ? 25 : n))
  remaining=$((n - written))
  echo "$remaining" > "$STATE"
else
  written=0
  remaining=0
fi
printf '{"newDocuments":%s,"skippedExisting":0,"remaining":%s}\n' "$written" "$remaining"
WORKER
chmod +x "$tmp/worker"
printf '60\n' > "$tmp/state"
STATE="$tmp/state" SCRAPE_CHUNK_SIZE=25 sh "$root/deploy/k8s/scrape/run-chunks.sh" "$tmp/worker" > "$tmp/sixty"
test "$(grep -c '^scrape chunks: iteration' "$tmp/sixty")" -eq 3
grep -q 'complete after 3 iteration(s)' "$tmp/sixty"
printf '0\n' > "$tmp/state"
STATE="$tmp/state" SCRAPE_CHUNK_SIZE=25 sh "$root/deploy/k8s/scrape/run-chunks.sh" "$tmp/worker" > "$tmp/zero"
test "$(grep -c '^scrape chunks: iteration' "$tmp/zero")" -eq 1
grep -q 'complete after 1 iteration(s)' "$tmp/zero"
echo 'scrape chunk loop hermetic tests: ok'
