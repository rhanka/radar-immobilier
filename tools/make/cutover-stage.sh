#!/usr/bin/env bash
# Daily template staging (preprod): the pinned backup is restored once into the sealed
# template `radar_tpl`; prepare then clones it in seconds (STRATEGY FILE_COPY).
# Stamp `radar-template-db`: status building|ready|failed + backup fingerprints.
template_read() {
  "${k[@]}" get configmap radar-template-db --ignore-not-found -o json > "$WORK/template.json"
}
template_write() {
  local status=$1 verb=replace
  template_read
  if [[ ! -s $WORK/template.json ]]; then
    verb=create
    jq -n --arg ns "$NS" '{apiVersion:"v1",kind:"ConfigMap",metadata:{name:"radar-template-db",namespace:$ns},data:{}}' > "$WORK/template.json"
  elif [[ $status != building ]]; then
    jq -e --arg run "$RUN" '.data.run==$run and .data.status=="building"' "$WORK/template.json" >/dev/null || fail 'Template stamp ownership changed'
  fi
  jq --slurpfile r "$WORK/record.json" --arg status "$status" --arg at "$(date -u +%FT%TZ)" '$r[0] as $r|
    .data={status:$status,run:$r.run,date:($r.pin.date//""),pgSha256:($r.pin.pgSha256//""),
      manifestSha256:($r.pin.manifestSha256//""),migrations:(($r.pin.migrations//0)|tostring),
      sizeBytes:(($r.jobs.tplseal.verdict.sizeBytes//0)|tostring),stagedAt:$at}' \
    "$WORK/template.json" > "$WORK/template-next.json"
  "${k[@]}" "$verb" -f "$WORK/template-next.json" >/dev/null
}
template_matches_pin() {
  template_read
  [[ -s $WORK/template.json ]] && jq -e --slurpfile r "$WORK/record.json" '.data as $d|$r[0].pin as $p|
    $d.status=="ready" and $d.date==$p.date and $d.pgSha256==$p.pgSha256 and $d.manifestSha256==$p.manifestSha256' \
    "$WORK/template.json" >/dev/null
}
volume_preflight() {
  # Projected peak on the PostgreSQL volume: what is stored now (live, any retained database, an
  # existing template, WAL) plus a fresh template and a clone of the live database. Above 75 % of
  # the claim capacity: warning and job summary (plan pvc-expand); above 90 %: refusal.
  [[ ${VOLUME_CHECKED:-0} == 1 ]] && return 0
  pvc_measure
  local peak=$((USED_BYTES + 2*DB_BYTES)) percent
  percent=$((peak * 100 / SIZE_BYTES))
  record_set '.volume={usedBytes:$u,liveDbBytes:$d,capacityBytes:$c,projectedPeakBytes:$p,projectedPercent:$pc}' \
    --argjson u "$USED_BYTES" --argjson d "$DB_BYTES" --argjson c "$SIZE_BYTES" --argjson p "$peak" --argjson pc "$percent"
  VOLUME_CHECKED=1
  if ((percent > 90)); then
    fail "volume_insufficient: projected peak $peak bytes is ${percent}% of the $SIZE_BYTES-byte volume (> 90 %); run pvc-expand first"
  fi
  if ((percent > 75)); then
    printf 'WARNING volume: projected peak %s bytes is %s%% of the %s-byte volume (> 75 %%); plan pvc-expand\n' "$peak" "$percent" "$SIZE_BYTES" >&2
    [[ -z ${GITHUB_STEP_SUMMARY:-} ]] || printf '### PostgreSQL volume above 75 %%\n\nProjected peak %s bytes = %s%% of %s bytes (live + template + clone + retained). Plan `pvc-expand` (refusal above 90 %%).\n' \
      "$peak" "$percent" "$SIZE_BYTES" >> "$GITHUB_STEP_SUMMARY"
  fi
}
stage_template() {
  # Rerun-safe: the template is dropped first. Documents are copied here (with their internal
  # reconciliation), outside the restore window of prepare.
  volume_preflight
  jq --arg tpl "$(jq -r .preprod.templateDb "$CONFIG")" '.restoreDb=$tpl' "$WORK/record.json" > "$WORK/next.json"
  mv "$WORK/next.json" "$WORK/record.json"; record_save
  STAGING=1
  template_write building
  run_job tplreset 60 90
  run_job restore 1800 1920
  run_job docs 7200 7500
  run_job tplseal 60 90
  template_write ready
  STAGING=0
  jq 'del(.restoreDb)' "$WORK/record.json" > "$WORK/next.json"
  mv "$WORK/next.json" "$WORK/record.json"; record_save
}
stage_command() {
  [[ $ENV == preprod ]] || fail 'Template staging is preprod-only'
  lock_acquire stage
  # A preparation in progress may be cloning the template: never drop it underneath.
  prepared_available
  deployed_release
  inventory
  run_job database 30 45
  jq --slurpfile db "$WORK/verdict.json" '.liveDb=$db[0].database' "$WORK/record.json" > "$WORK/next.json"
  mv "$WORK/next.json" "$WORK/record.json"; record_save
  suspend_writers drain
  BACKUP_ID=latest pin_backup
  stage_template
  restore_schedules
  lock_delete
  printf 'Template staged for backup %s\n' "$(jq -r .pin.date "$WORK/record.json")"
}
