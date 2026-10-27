#!/usr/bin/env bash
# Execute the real Dockerfile identity layer and workflow served-build checks.
set -euo pipefail
root=$(cd "$(dirname "$0")/../.." && pwd)
cd "$root"
scratch=$(mktemp -d "$root/tmp/release-sha-tests.XXXXXX")
trap 'rm -rf "$scratch"' EXIT
full=1234567890abcdef1234567890abcdef12345678
short=${full:0:7}
layer=$(awk '/^RUN / {s=$0; while(sub(/\\$/, "", s)){getline; s=s $0} if(s~/release-sha/){sub(/^RUN /,"",s); print s}}' api/Dockerfile)
[[ -n $layer ]]
layer=${layer//\/workspace\/api\/release-sha/$scratch/release-sha}
for candidate in "$full" unknown; do
  GIT_SHA=$candidate bash -ec "$layer"
  [[ $(cat "$scratch/release-sha") == "$candidate" ]]
done
for candidate in "$short" '' "${full}a" "${full^^}" "${full:0:39}z"; do
  rm -f "$scratch/release-sha"
  if GIT_SHA=$candidate bash -ec "$layer"; then echo "Invalid API build identity accepted: $candidate" >&2; exit 1; fi
  [[ ! -e $scratch/release-sha ]]
done
workflow=.github/workflows/build-push-images.yml
grep -qF "GIT_SHA=\${{ matrix.service == 'api' && github.sha || steps.vars.outputs.sha }}" "$workflow"
grep -qF -- '--build-arg "GIT_SHA=$(git rev-parse HEAD)" -f api/Dockerfile' "$workflow"
grep -qF 'echo "sha=${GITHUB_SHA::7}"' "$workflow"
grep -qF 'echo "${IMAGE_PREFIX}/${{ matrix.image }}:${{ steps.vars.outputs.sha }}"' "$workflow"
[[ $(grep -cF 'API_SHA: ${{ github.sha }}' "$workflow") == 3 ]]
extract_run() {
  awk -v step="$1" '$0=="      - name: " step {found=1;next}
    found && /^        run: \|/ {body=1;next}
    body && /^          / {print substr($0,11);next}
    body && /[^[:space:]]/ {exit}' "$workflow"
}
mkdir "$scratch/bin"
cat > "$scratch/bin/curl" <<'SH'
#!/bin/bash
case ${!#} in */health) printf '{"sha":"%s"}' "$FAKE_API_SHA";;
  */build.json) printf '{"sha":"%s"}' "$FAKE_UI_SHA";; *) exit 1;; esac
SH
cat > "$scratch/bin/date" <<'SH'
#!/bin/bash
if [[ -e $RELEASE_DATE_FILE ]]; then echo 1000; else touch "$RELEASE_DATE_FILE"; echo 0; fi
SH
chmod +x "$scratch/bin/"*
export PATH="$scratch/bin:$PATH" RELEASE_DATE_FILE="$scratch/date-called"
export SHA=$short API_SHA=$full ROLLOUT_STATE=complete
cases=0
for step in 'Assert served sha' 'Assert served sha (preprod)' 'Assert served sha (prod)'; do
  extract_run "$step" > "$scratch/served.sh"
  [[ -s $scratch/served.sh ]]
  for scenario in valid short-api foreign-api foreign-ui; do
    export FAKE_API_SHA=$full FAKE_UI_SHA=$short
    case $scenario in
      short-api) FAKE_API_SHA=$short;;
      foreign-api) FAKE_API_SHA=${full:0:39}9;;
      foreign-ui) FAKE_UI_SHA=foreign;;
    esac
    rm -f "$RELEASE_DATE_FILE"
    if bash "$scratch/served.sh" > "$scratch/result.log" 2>&1; then status=0; else status=$?; fi
    if [[ $scenario == valid ]]; then
      [[ $status == 0 ]] || { cat "$scratch/result.log" >&2; exit 1; }
    else
      [[ $status != 0 ]] || { echo "$step accepted $scenario" >&2; exit 1; }
    fi
    cases=$((cases+1))
  done
done
echo "PASS release identity layer (7 cases), short tags, full API build arguments, served-build guards ($cases cases)"
