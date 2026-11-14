#!/usr/bin/env bash
# PG16 clients for the operator tunnel and the fresh final restore target.
set -euo pipefail
set +x
case "${PGHOST:-}:${PGPORT:-}:${PGDATABASE:-}" in
  127.0.0.1:25432:radar|127.0.0.1:25435:radar_cutover_final) ;;
  *) printf 'STOP explicit_operator_database_required\n' >&2; exit 1 ;;
esac
case "$(basename "$0")" in psql|pg_dump|pg_restore) client=$(basename "$0");; *) exit 1;; esac
private="$HOME/.local/share/radar-prod-copy"
export CUTOVER_CONTAINER_TIMEOUT=1800
exec bash "${ROOT:-$PWD}/deploy/prod-cutover/run-container.sh" "${CUTOVER_CONTAINER_RUN:?}" \
  run --rm -i --pull=never --network host --user "$(id -u):$(id -g)" \
  --label "ca.sent-tech.immo.cutover-run=$CUTOVER_CONTAINER_RUN" \
  -e PGHOST -e PGPORT -e PGUSER -e PGDATABASE -e PGPASSFILE -e PGPASSWORD \
  -e PGOPTIONS -e PGCONNECT_TIMEOUT -v "$private:$private" \
  postgis/postgis@sha256:44126d872ac91993766c341e369c539e8196614321765d36a6f1bab0419a5fa5 \
  "$client" "$@" <&0
