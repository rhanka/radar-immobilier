#!/usr/bin/env bash
set -euo pipefail
umask 077
private="$HOME/.local/share/radar-prod-copy"
mkdir -p "$private/bin"
[[ -e $private/local-password ]] || openssl rand -base64 36 > "$private/local-password"
chmod 600 "$private/local-password"
for bin in psql pg_dump pg_restore; do
  cat > "$private/bin/$bin" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
[[ $PGHOST == 127.0.0.1 && $PGPORT == 25433 && $PGDATABASE == radar_cutover_owner_20261113 ]]
name="radar-prod-copy-client-$(cat /proc/sys/kernel/random/uuid)"
client=''; completed=0
cleanup() {
  ((completed == 0)) || return 0
  if [[ -n $client ]]; then kill -TERM "$client" 2>/dev/null || true; wait "$client" 2>/dev/null || true; fi
  for attempt in {1..3}; do
    timeout --kill-after=2s 10s docker rm -f "$name" >/dev/null 2>&1 && return 0
    sleep 1
  done
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
docker run --rm -i --name "$name" --pull=never --network radar-prod-copy-owner_copy-only --user "$(id -u):$(id -g)" \
  -e PGHOST=postgres -e PGPORT=5432 -e PGUSER -e PGDATABASE -e PGPASSWORD -e PGOPTIONS -e PGCONNECT_TIMEOUT \
  -v "$HOME/.local/share/radar-prod-copy:$HOME/.local/share/radar-prod-copy" \
  postgis/postgis@sha256:44126d872ac91993766c341e369c539e8196614321765d36a6f1bab0419a5fa5 \
  "$(basename "$0")" "$@" <&0 &
client=$!
wait "$client"
completed=1
SH
  chmod 700 "$private/bin/$bin"
done
echo 'Runtime clients préparé. Aucune instance démarrée.'
