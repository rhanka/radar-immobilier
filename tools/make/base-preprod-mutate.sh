#!/usr/bin/env bash
# Mutations apply only to disposable test copies, never to the working tree.
apply_operator_mutation() {
  local dir=$1
  case $BASE_PREPROD_MUTANT in
    init-binding) git show c100e6cc:tools/make/base-preprod-input.jq > "$dir/tools/make/base-preprod-input.jq";;
    sql-table-lock|sql-row-update)
      local filter='.activate.lock_authority -= ["facet_event_bindings"]'
      [[ $BASE_PREPROD_MUTANT != sql-row-update ]] || filter='.activate.update=[]'
      jq "$filter" "$dir/api/src/scripts/base-preprod-rights.json" > "$dir/rights.json"
      mv "$dir/rights.json" "$dir/api/src/scripts/base-preprod-rights.json";;
    image-proof) sed -i '/^and \.image==\$c.image/d' "$dir/tools/make/base-preprod-proof.jq";;
    live-digest) sed -i '/^  \[\[ -n \$uid && \$job_image/,/Running pod image digest mismatch/d' "$dir/tools/make/base-preprod-collect.sh";;
    q2-restart) sed -i '/assert_api_instance q2/d' "$dir/tools/make/base-preprod-maintenance.sh";;
    failed-receipt) sed -i '/wait_job || true/a\  [[ $(tail -n1 "$OUTPUT/wait.txt") != Failed ]] || fail "Job not complete"' "$dir/tools/make/base-preprod-operator.sh";;
    init-receipt) sed -i '/^  if \[\[ \$action == init/,/^  fi$/d' "$dir/tools/make/base-preprod-collect.sh";;
    *) exit 2;;
  esac
}
