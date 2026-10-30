#!/usr/bin/env bash
# One-time PostgreSQL volume expansion (Lot 1), run by the operator outside any cutover window.
# Occupancy is measured in SQL by a `volume` Job (databases + WAL) and compared to the claim
# capacity: no shell in the PostgreSQL Pod. The StatefulSet volumeClaimTemplate is immutable:
# the claim itself is patched (compare-and-swap), never shrunk; the patch right belongs to the
# one-time Role of rbac-adopt-<env>.yaml. A pending filesystem resize is reported, never restarted.
PVC_NAME=postgres-data-radar-postgres-0
GIB=$((1024*1024*1024))
pvc_capacity_bytes() {
  jq -r '.status.capacity.storage//"0"' "$WORK/pvc.json" | awk '
    /Gi$/ {printf "%.0f\n", int($0)*1073741824; next} /Mi$/ {printf "%.0f\n", int($0)*1048576; next}
    /Ti$/ {printf "%.0f\n", int($0)*1099511627776; next} /^[0-9]+$/ {print $0; next} {print 0}'
}
pvc_measure() {
  local step
  step="volume$(jq '[.jobs|keys[]|select(startswith("volume"))]|length' "$WORK/record.json")"
  run_job "$step" 60 90
  DB_BYTES=$(jq -r '.liveDbBytes' "$WORK/verdict.json"); USED_BYTES=$(jq -r '.volumeUsedBytes' "$WORK/verdict.json")
  [[ $DB_BYTES =~ ^[0-9]+$ && $USED_BYTES =~ ^[0-9]+$ ]] || fail 'Unreadable volume measurement'
  "${k[@]}" get pvc "$PVC_NAME" -o json > "$WORK/pvc.json"
  SIZE_BYTES=$(pvc_capacity_bytes)
  ((SIZE_BYTES > 0)) || fail 'Unreadable claim capacity'
  FREE_BYTES=$((SIZE_BYTES - USED_BYTES))
}
pvc_required_gib() {
  # Room for the staged template and one clone next to everything already stored:
  # max(10 GiB, used + 2 x live database + 2 GiB), rounded up to whole GiB.
  local bytes=$((USED_BYTES + 2*DB_BYTES + 2*GIB))
  ((bytes > 10*GIB)) || bytes=$((10*GIB))
  printf '%d' $(((bytes + GIB - 1) / GIB))
}
pvc_session() {
  # The measurement Job needs an operation record and an image: the deployed API image.
  lock_acquire volume
  deployed_release
}
pvc_expand() {
  local current requested target patch deadline
  pvc_session
  pvc_measure
  target=$(pvc_required_gib)
  if [[ -n ${SIZE:-} ]]; then
    [[ $SIZE =~ ^([0-9]+)Gi$ ]] || fail 'SIZE must be expressed in Gi'
    ((BASH_REMATCH[1] >= target)) || fail "SIZE is below the required ${target}Gi"
    target=${BASH_REMATCH[1]}
  fi
  current=$(jq -r .spec.resources.requests.storage "$WORK/pvc.json")
  [[ $current =~ ^([0-9]+)Gi$ ]] || fail "Unexpected claim size: $current"
  requested=${BASH_REMATCH[1]}
  if ((requested < target)); then
    patch=$(jq -n --arg uid "$(jq -r .metadata.uid "$WORK/pvc.json")" --arg from "$current" --arg to "${target}Gi" \
      '[{op:"test",path:"/metadata/uid",value:$uid},{op:"test",path:"/spec/resources/requests/storage",value:$from},
        {op:"replace",path:"/spec/resources/requests/storage",value:$to}]')
    "${k[@]}" patch pvc "$PVC_NAME" --type=json -p "$patch" >/dev/null || fail 'Claim size changed concurrently'
  fi
  deadline=$((SECONDS+300))
  while :; do
    "${k[@]}" get pvc "$PVC_NAME" -o json > "$WORK/pvc.json"
    if jq -e --arg size "${target}Gi" '.status.capacity.storage==$size' "$WORK/pvc.json" >/dev/null; then
      printf 'PVC %s resized to %sGi\n' "$PVC_NAME" "$target"; break
    fi
    if jq -e 'any(.status.conditions[]?; .type=="FileSystemResizePending" and .status=="True")' "$WORK/pvc.json" >/dev/null; then
      printf 'FileSystemResizePending: restart radar-postgres-0 once, outside any cutover window, then run pvc-verify\n'
      lock_delete
      return 0
    fi
    ((SECONDS < deadline)) || fail 'Volume expansion not observed within five minutes'
    sleep 5
  done
  pvc_check
  lock_delete
}
pvc_check() {
  pvc_measure
  local need=$((2*DB_BYTES + 2*GIB))
  printf 'live database=%s bytes used=%s bytes capacity=%s bytes free=%s bytes required free=%s bytes\n' \
    "$DB_BYTES" "$USED_BYTES" "$SIZE_BYTES" "$FREE_BYTES" "$need"
  ((FREE_BYTES >= need)) || fail 'volume_insufficient: free capacity below 2 x live database + 2 GiB'
  printf 'PVC verified: free capacity holds the template and the prepared database\n'
}
pvc_verify() { pvc_session; pvc_check; lock_delete; }
