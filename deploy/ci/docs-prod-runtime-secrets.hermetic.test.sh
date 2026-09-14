#!/usr/bin/env bash
set -euo pipefail

subject=deploy/ci/docs-prod-runtime-secrets.jq
fixture='{"data":{"DOCS_S3_ACCESS_KEY":"YWNjZXNz","DOCS_S3_SECRET_KEY":"c2VjcmV0","DOCS_S3_ENDPOINT":"ZW5kcG9pbnQ=","DOCS_S3_REGION":"cmVnaW9u","DOCS_S3_BUCKET":"YnVja2V0","DOCS_S3_FORCE_PATH_STYLE":"ZmFsc2U="}}'
rendered="$(jq -c -f "$subject" <<<"$fixture")"

jq -e '
  .kind == "List" and (.items | length) == 2
  and (.items[0].metadata.name == "radar-graph-s3-credentials")
  and (.items[0].data == {GRAPH_S3_ACCESS_KEY:"YWNjZXNz", GRAPH_S3_SECRET_KEY:"c2VjcmV0"})
  and (.items[1].metadata.name == "radar-scrape-s3-credentials")
  and (.items[1].data == {SCRAPE_S3_ACCESS_KEY:"YWNjZXNz", SCRAPE_S3_SECRET_KEY:"c2VjcmV0"})
' <<<"$rendered" >/dev/null

if jq -e -f "$subject" <<<'{"data":{"DOCS_S3_ACCESS_KEY":"YWNjZXNz"}}' >/dev/null 2>&1; then
  echo 'expected incomplete source Secret rejection' >&2
  exit 1
fi

echo 'PROD DOCS runtime Secret transform: PASS'
