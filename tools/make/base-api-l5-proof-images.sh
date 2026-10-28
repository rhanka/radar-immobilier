#!/usr/bin/env bash
head=$(git rev-parse HEAD)
[[ $(cat "$images/head.txt") == "$head" && $(cat "$images/status") == 0 && -s $images/lock-release.txt ]]
image_id=$(cat "$images/image-id.txt")
[[ $image_id =~ ^sha256:[a-f0-9]{64}$ ]]
migration_count=$(jq '.entries|length' api/drizzle/meta/_journal.json)
for host in pages.sent-tech.ca pages.reader.test; do
  directory="$images/$host"
  tests_passed "$directory" browser
  jq -e '.numPassedTests==5 and .numPendingTests==0 and
    all(.testResults[].assertionResults[];.status=="passed")' "$directory/browser.json" >/dev/null
  for service in runtime runtime-base runtime-read; do
    [[ $(cat "$directory/$service-release-sha.txt") == "$head" ]]
    [[ $(cat "$directory/$service-image-id.txt") == "$image_id" ]]
  done
  cmp <(sort "$directory/image-migrations.sha256") \
    <(sha256sum api/drizzle/*.sql api/drizzle/meta/_journal.json | sort)
  jq -e --arg head "$head" --argjson count "$migration_count" '.imageSha==$head and
    (.entries|length)==$count and (.history|length)==$count and
    ([.history[].hash]|unique|length)==$count' "$directory/image-database-migrations.json" >/dev/null
  for reader in 0 1; do
    jq -e --arg head "$head" --arg host "$host" --argjson reader "$reader" '.imageSha==$head and
      .contentBase==$host and .reader==$reader and (.normalOidcExchanges>0) and
      .navigation.method=="GET" and .navigation.status==200 and .navigation.mode=="navigate" and
      .navigation.dest=="document" and .navigation.site==(if $host=="pages.sent-tech.ca" then "same-site" else "cross-site" end) and
      all(.requests[]; if (.host|endswith($host)) then (.cookieNames|index("radar_session")|not) else true end) and
      (if $reader==0 then any(.requests[];.responseLost and .status==200 and (.path|endswith("/confirm"))) else true end)' \
      "$directory/browser-reader-$reader.json" >/dev/null
  done
  jq -e --arg head "$head" '.imageSha==$head and (.receipts|length)==6 and
    ([.receipts[].operation]|unique|length)==6' "$directory/browser-six-operations.json" >/dev/null
  for variant in base read; do
    jq -e --arg head "$head" --arg variant "$variant" '.imageSha==$head and .variant==$variant' \
      "$directory/browser-closure-$variant.json" >/dev/null
  done
  [[ -f $directory/runtime-stopped && -s $directory/runtime-stop.log && -s $directory/cleanup.log ]]
done
