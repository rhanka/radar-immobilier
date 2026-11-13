#!/usr/bin/env bash
# Historical identity is supplied independently of the public probes.
manual_deployed_release() {
  validate_release "${PREVIOUS_RELEASE:-}"
  "${k[@]}" get pods -o json > "$WORK/deployed-pods.json"
  curl -q -fsS --max-time 15 "$URL/health" -o "$WORK/health.json" 2>/dev/null || fail 'Cannot identify deployed API'
  curl -q -fsS --max-time 15 "$URL/build.json" -o "$WORK/build.json" 2>/dev/null || fail 'Cannot identify deployed UI'
  jq -e --slurpfile pods "$WORK/deployed-pods.json" --slurpfile health "$WORK/health.json" \
    --slurpfile build "$WORK/build.json" '
    . as $r | ($health[0].sha) as $api | ($build[0].sha) as $ui |
    ($api==$r.gitSha or ($api==$r.gitSha[0:7] and ($api|test("^[a-f0-9]{7}$"))))
    and ($ui==$r.gitSha or $ui==$r.gitSha[0:7])
    and all(["api","ui"][]; . as $component |
      [$pods[0].items[]|select(.metadata.labels["app.kubernetes.io/component"]==$component)|
        .status.containerStatuses[]?|select(.name==$component and .ready)|
        .imageID|sub("^docker-pullable://";"")]|unique ==
          [if $component=="api" then $r.apiImage else $r.uiImage end])' \
    "$PREVIOUS_RELEASE" >/dev/null || fail 'Historical release identity mismatch'
  jq --slurpfile h "$WORK/health.json" --slurpfile b "$WORK/build.json" \
    '.apiServedSha=$h[0].sha|.uiServedSha=$b[0].sha' "$PREVIOUS_RELEASE" > "$WORK/release.json"
  save_release "$WORK/release.json"
}
manual_cd_idle() {
  # Check ownership again before admitting the manual operation. Never expire a preparation.
  lock_read
  jq -e --arg run "$RUN" --argjson executor "$EXECUTOR" \
    '(.data.record|fromjson)|.run==$run and .executor==$executor and .executor.state=="running"' \
    "$WORK/lock.json" >/dev/null || fail 'Manual lock ownership required'
  prepared_read
  if [[ -s $WORK/prepared.json ]]; then
    jq -e '.data.status=="ready" or .data.status=="failed"' "$WORK/prepared.json" >/dev/null \
      || fail 'CD preparation active or indeterminate'
  fi
  # build-push-images contains the promote-prod job. Unknown dispatch targets also refuse.
  timeout --kill-after=5s 45s gh api --paginate --slurp \
    'repos/rhanka/radar-immobilier/actions/workflows/build-push-images.yml/runs?per_page=100' \
    > "$WORK/cd-runs.json" || fail 'Cannot establish CD inactivity'
  jq -e 'type=="array" and length>0 and all(.[];
    (.workflow_runs|type=="array") and all(.workflow_runs[];
      .status=="completed" or
      (.event!="workflow_dispatch" and (.head_branch|type=="string") and (.head_branch|startswith("v")|not))))' \
    "$WORK/cd-runs.json" >/dev/null || fail 'Tag build or promote-prod is active or pending'
  # A finished run must not leave an executor behind.
  "${k[@]}" get jobs -o json | jq -e 'all(.items[];
    any(.metadata.ownerReferences[]?;.kind=="CronJob" and .controller==true) or
    any(.status.conditions[]?;(.type=="Complete" or .type=="Failed") and .status=="True"))' \
    >/dev/null || fail 'Unscheduled CD Job has not terminated'
}
