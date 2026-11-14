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
export CUTOVER_CONTAINER_TIMEOUT=1800
exec bash "${ROOT:-$PWD}/deploy/prod-cutover/run-container.sh" "${CUTOVER_CONTAINER_RUN:?}" \
  run --rm --label "ca.sent-tech.immo.cutover-run=$CUTOVER_CONTAINER_RUN" \
  -i --pull=never --network host --user "$(id -u):$(id -g)" \
  -e PGHOST -e PGPORT -e PGUSER -e PGDATABASE -e PGPASSWORD -e PGOPTIONS -e PGCONNECT_TIMEOUT \
  -v "$HOME/.local/share/radar-prod-copy:$HOME/.local/share/radar-prod-copy" \
  postgis/postgis@sha256:44126d872ac91993766c341e369c539e8196614321765d36a6f1bab0419a5fa5 \
  "$(basename "$0")" "$@"
SH
  chmod 700 "$private/bin/$bin"
done
echo 'Runtime clients préparé. Aucune instance démarrée.'
