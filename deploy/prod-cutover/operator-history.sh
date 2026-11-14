#!/usr/bin/env bash
set -euo pipefail
set +x
umask 077
private="$HOME/.local/share/radar-prod-copy"
sha=79c2bd967dacb84d445bf6462ee70393515f6a38
run=42669916074
job=129343420788
# v1.2.19 predates cutover-release artifacts. Its tag job built the images.
gh api "repos/rhanka/radar-immobilier/actions/runs/$run" > "$private/previous-run.json"
jq -e --arg sha "$sha" '.head_sha==$sha and .head_branch=="v1.2.19" and .conclusion=="success"' \
  "$private/previous-run.json" >/dev/null
gh api "repos/rhanka/radar-immobilier/actions/jobs/$job/logs" > "$private/previous-build.log"
# Associate each exported manifest with the following image naming line.
awk '
  /exporting manifest sha256:/ {if(match($0,/sha256:[a-f0-9]+/)) digest=substr($0,RSTART,RLENGTH)}
  /naming to ghcr.io\/rhanka\/radar-api:79c2bd9/ {api=digest}
  /naming to ghcr.io\/rhanka\/radar-ui:79c2bd9/ {ui=digest}
  END {if(length(api)!=71 || length(ui)!=71) exit 1; print api; print ui}
' "$private/previous-build.log" > "$private/previous-digests"
mapfile -t digests < "$private/previous-digests"
jq -n --arg sha "$sha" --arg api "${digests[0]}" --arg ui "${digests[1]}" \
  '{version:1,gitSha:$sha,apiImage:("ghcr.io/rhanka/radar-api@"+$api),
    uiImage:("ghcr.io/rhanka/radar-ui@"+$ui),apiServedSha:$sha,uiServedSha:$sha[0:7],dataMigration:null}' \
  > "$private/previous-release.json.partial"
if [[ -e $private/previous-release.json ]]; then
  cmp -s "$private/previous-release.json" "$private/previous-release.json.partial" || { printf 'STOP historical_manifest_conflict\n'; exit 1; }
  rm "$private/previous-release.json.partial"
else mv "$private/previous-release.json.partial" "$private/previous-release.json"; fi
chmod 600 "$private/previous-release.json"
printf '6 OK historical release from tag v1.2.19 run %s job %s; no public probes\n' "$run" "$job"
