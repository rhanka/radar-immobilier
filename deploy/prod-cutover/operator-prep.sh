#!/usr/bin/env bash
set -euo pipefail
set +x
umask 077
private="$HOME/.local/share/radar-prod-copy"
export KUBECONFIG="$HOME/.kube/radar-prod-tenant-admin.kubeconfig"
k=(kubectl --request-timeout=15s -n radar-immobilier)
image=postgis/postgis@sha256:44126d872ac91993766c341e369c539e8196614321765d36a6f1bab0419a5fa5
mkdir -p "$private"
chmod 700 "$private"
if [[ ${1:-} == forward ]]; then
  # The detached supervisor keeps the loopback tunnel alive between operator calls.
  trap 'kill "${child:-0}" 2>/dev/null || true; exit' TERM INT
  while true; do
    "${k[@]}" port-forward --address 127.0.0.1 svc/radar-postgres 25432:5432 &
    child=$!
    printf '%s\n' "$child" > "$private/prod-forward-child.pid"
    wait "$child" || true
    sleep 2
  done
fi
fail() { printf 'STOP %s\n' "$1"; exit 1; }
if [[ -s $private/prod-forward.pid ]] && kill -0 "$(< "$private/prod-forward.pid")" 2>/dev/null; then
  printf '1 tunnel supervisor reused\n'
else
  [[ -z $(ss -H -ltn 'sport = :25432') ]] || fail port_25432_occupied
  "${k[@]}" get svc radar-postgres -o name >/dev/null
  nohup setsid bash "$0" forward > "$private/prod-forward.log" 2>&1 < /dev/null &
  printf '%s\n' "$!" > "$private/prod-forward.pid"
fi
for attempt in {1..30}; do
  [[ -n $(ss -H -ltn 'sport = :25432') ]] && break
  sleep 1
done
[[ -n $(ss -H -ltn 'sport = :25432') ]] || fail port_forward_not_ready
printf '1 OK supervisor=%s child=%s\n' "$(< "$private/prod-forward.pid")" "$(< "$private/prod-forward-child.pid")"
[[ ${1:-} != tunnel ]] || exit 0
for pair in radar-db-credentials:prod-admin:radar radar-db-ro-prod:prod-ro:radar_db_ro_prod; do
  IFS=: read -r secret file role <<< "$pair"
  [[ ! -L $private/$file.pgpass ]] || fail pgpass_symlink
  "${k[@]}" get secret "$secret" -o json | jq -er --arg role "$role" '
    .data | select((.POSTGRES_USER|@base64d)==$role and (.POSTGRES_DB|@base64d)=="radar") |
    (.POSTGRES_PASSWORD|@base64d) | select(length>0 and (test("[\r\n]")|not)) |
    "127.0.0.1:25432:radar:"+$role+":"+(gsub("\\\\";"\\\\")|gsub(":";"\\:"))' > "$private/$file.pgpass.partial" 2> "$private/pgpass-extract.error"
  chmod 600 "$private/$file.pgpass.partial"
  mv "$private/$file.pgpass.partial" "$private/$file.pgpass"
  result=$(docker run --rm --pull=never --network host --user "$(id -u):$(id -g)" \
    -v "$private:$private:ro" -e PGHOST=127.0.0.1 -e PGPORT=25432 -e PGDATABASE=radar \
    -e PGUSER="$role" -e PGPASSFILE="$private/$file.pgpass" -e PGCONNECT_TIMEOUT=5 \
    -e PGOPTIONS='-c default_transaction_read_only=on' "$image" \
    psql -X -tAc 'select 1' 2> "$private/pgcheck.error") || fail "pgcheck_$file"
  [[ $result == 1 ]] || fail "pgcheck_result_$file"
  printf '2 %s OK (select 1 = 1, read only)\n' "$file"
done
# Parse only allowlisted assignments. Never source or evaluate the operator dotenv.
for kind in backup provision; do
  if [[ $kind == backup ]]; then target=backup-writer.env; else target=s3-provision.input; fi
  [[ ! -L $private/$target ]] || fail input_symlink
  awk -v kind="$kind" '
    BEGIN {n=split(kind=="backup" ? "RADAR_BACKUP_WRITER_ACCESS_KEY RADAR_BACKUP_WRITER_SECRET_KEY BACKUP_S3_ENDPOINT BACKUP_S3_REGION" : "ARTIFACTS_PROD_S3_ACCESS_KEY ARTIFACTS_PROD_S3_SECRET_KEY ARTIFACTS_PROD_S3_USER ARTIFACTS_PROD_S3_USERID ARTIFACTS_PROD_S3_ENDPOINT ARTIFACTS_PROD_S3_REGION ARTIFACTS_PROD_S3_BUCKET ARTIFACTS_PROD_S3_PREFIX", keys," "); for(i=1;i<=n;i++) allowed[keys[i]]=1}
    {line=$0; sub(/^export[ \t]+/,"",line); p=index(line,"="); key=substr(line,1,p-1);
      if(allowed[key]) {if(seen[key]++) exit 2; print line; count++}}
    END {if(count!=n) exit 3}
  ' /home/antoinefa/src/radar-immobilier/.env > "$private/$target.partial" || fail "dotenv_fields_$kind"
  chmod 600 "$private/$target.partial"
  mv "$private/$target.partial" "$private/$target"
done
printf '4 OK allowlisted S3 provision input, mode 0600\n'
while IFS='=' read -r key value; do
  value="${value%$'\r'}"
  if [[ $value == \"*\" || $value == \'*\' ]]; then value=${value:1:${#value}-2}; fi
  [[ -n $value ]] || fail backup_empty_field
  case $key in
    RADAR_BACKUP_WRITER_ACCESS_KEY) export AWS_ACCESS_KEY_ID="$value" ;;
    RADAR_BACKUP_WRITER_SECRET_KEY) export AWS_SECRET_ACCESS_KEY="$value" ;;
    BACKUP_S3_ENDPOINT) endpoint=$value ;;
    BACKUP_S3_REGION) export AWS_REGION="$value" AWS_DEFAULT_REGION="$value" ;;
    *) fail backup_unexpected_key ;;
  esac
done < "$private/backup-writer.env"
[[ $endpoint == https://s3.bhs.io.cloud.ovh.net && $AWS_REGION == bhs ]] || fail backup_endpoint_region
printf 'operator preparation probe\n' > "$private/s3-probe.txt"
uri="s3://sentropic-pgbackup/immo/v1220/tonight/operator-prep-$(date -u +%Y%m%dT%H%M%SZ)-$$.txt"
s3_status=0
: > "$private/s3-probe-status.txt"
for operation in put ls delete; do
  case $operation in
    put) args=(cp "$private/s3-probe.txt" "$uri") ;;
    ls) args=(ls 's3://sentropic-pgbackup/immo/v1220/tonight/') ;;
    delete) args=(rm "$uri") ;;
  esac
  code=0
  timeout --kill-after=5s 45s s5cmd --endpoint-url "$endpoint" "${args[@]}" > "$private/s3-probe.result" 2>&1 || code=$?
  printf '3 S3 %s exit=%s\n' "$operation" "$code"
  printf '%s exit=%s\n' "$operation" "$code" >> "$private/s3-probe-status.txt"
  if (( code != 0 )); then
    # Only a fixed service-error token may leave the private result file.
    awk 'match($0,/(AccessDenied|InvalidAccessKeyId|SignatureDoesNotMatch|NoSuchBucket|RequestTimeTooSkewed)/) {print "S3 error=" substr($0,RSTART,RLENGTH); exit}' "$private/s3-probe.result"
    s3_status=3
  fi
done
unset AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY
bash "$(dirname "$0")/operator-history.sh"
source "$(dirname "$0")/operator-prep-local.sh"
exit "$s3_status"
