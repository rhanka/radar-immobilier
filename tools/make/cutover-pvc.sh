#!/usr/bin/env bash
# One-time PostgreSQL volume expansion (Lot 1), run by the conductor outside any cutover window.
# The StatefulSet volumeClaimTemplate is immutable: the claim itself is patched (compare-and-swap),
# never shrunk. A restart, when the filesystem resize is pending, stays an explicit operator act.
PVC_NAME=postgres-data-radar-postgres-0
GIB=$((1024*1024*1024))
pvc_measure() {
  # Live database size and filesystem free bytes, read inside the PostgreSQL Pod (socket auth).
  "${k[@]}" exec radar-postgres-0 -c postgres -- sh -c \
    'printf "%s %s\n" "$(psql -X -At -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT pg_database_size(current_database())")" "$(df -B1 --output=avail,size /var/lib/postgresql/data | tail -1)"' \
    > "$WORK/pvc-measure" || fail 'PostgreSQL volume measurement unavailable'
  read -r DB_BYTES FREE_BYTES SIZE_BYTES < "$WORK/pvc-measure"
  [[ $DB_BYTES =~ ^[0-9]+$ && $FREE_BYTES =~ ^[0-9]+$ && $SIZE_BYTES =~ ^[0-9]+$ ]] || fail 'Unreadable volume measurement'
}
pvc_required_gib() {
  # max(10 GiB, 3 x live database + 2 GiB), rounded up to whole GiB.
  local bytes=$((3*DB_BYTES + 2*GIB))
  ((bytes > 10*GIB)) || bytes=$((10*GIB))
  printf '%d' $(((bytes + GIB - 1) / GIB))
}
pvc_expand() {
  local current requested target patch deadline
  pvc_measure
  target=$(pvc_required_gib)
  if [[ -n ${SIZE:-} ]]; then
    [[ $SIZE =~ ^([0-9]+)Gi$ ]] || fail 'SIZE must be expressed in Gi'
    ((BASH_REMATCH[1] >= target)) || fail "SIZE is below the required ${target}Gi"
    target=${BASH_REMATCH[1]}
  fi
  "${k[@]}" get pvc "$PVC_NAME" -o json > "$WORK/pvc.json"
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
      return 0
    fi
    ((SECONDS < deadline)) || fail 'Volume expansion not observed within five minutes'
    sleep 5
  done
  pvc_verify
}
pvc_verify() {
  pvc_measure
  local need=$((2*DB_BYTES + 2*GIB))
  printf 'database=%s bytes free=%s bytes filesystem=%s bytes required_free=%s bytes\n' "$DB_BYTES" "$FREE_BYTES" "$SIZE_BYTES" "$need"
  ((SIZE_BYTES >= $(pvc_required_gib)*GIB*95/100)) || fail 'Filesystem not yet expanded (restart pending?)'
  ((FREE_BYTES >= need)) || fail 'Free space below 2 x database + 2 GiB'
  printf 'PVC verified: free space holds the template and the prepared database\n'
}
