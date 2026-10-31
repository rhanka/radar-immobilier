#!/usr/bin/env bash
# PostgreSQL major upgrade by logical replication: radar-postgres (PG16) <-> radar-pg18.
# Verbs: pg-replicate, pg-verify, pg-switch, pg-reverse. Procedure and failure
# handling: deploy/cutover/PG18-UPGRADE.md. No Python; SQL runs inside the
# PostgreSQL containers (kubectl exec in a namespace, docker compose in tests).
set -euo pipefail
umask 077
fail() { printf 'PG upgrade refused: %s\n' "$*" >&2; exit 1; }
log() { printf '[pg-upgrade] %s\n' "$*" >&2; }

PUB=pgup_pub
ROLE=radar_pgup
# Created by the PostGIS image init script, used by no migration or query (L0
# inventory): not recreated on PG18, so their tables are never published.
EXCLUDED_EXTENSIONS=(postgis_tiger_geocoder postgis_topology fuzzystrmatch)
VERB=${1:-}
other() { if [[ $1 == pg16 ]]; then echo pg18; else echo pg16; fi; }
sub_on() { echo "pgup_from_$(other "$1")"; }   # subscription held by side $1
pod_of() { if [[ $1 == pg16 ]]; then echo radar-postgres-0; else echo radar-pg18-0; fi; }
side_of_pod() {
  case $1 in radar-postgres-0) echo pg16;; radar-pg18-0) echo pg18;; *) fail "Unknown PostgreSQL pod $1";; esac
}

case ${ENV:-} in
  preprod|prod) BACKEND=k8s;;
  test-cutover) BACKEND=compose;;
  *) fail 'ENV must be preprod, prod or test-cutover';;
esac
CONFIG=deploy/cutover/config.json
if [[ $BACKEND == k8s ]]; then
  [[ -z ${NAMESPACE:-} && -z ${PREPROD_NAMESPACE:-} ]] || fail 'Namespace overrides are forbidden'
  [[ -n ${KUBECONFIG:-} && $KUBECONFIG != *:* && -f $KUBECONFIG ]] \
    || fail 'KUBECONFIG must name one tenant kubeconfig file explicitly'
  [[ $(realpath -m "$KUBECONFIG") != "$(realpath -m "$HOME/.kube/config")" ]] || fail 'The default kubeconfig is never used'
  jq -e --arg e "$ENV" '.[$e].pgUpgrade==true' "$CONFIG" >/dev/null \
    || fail "The PG upgrade is not enabled for $ENV (config.json pgUpgrade)"
  NS=$(jq -r --arg e "$ENV" '.[$e].namespace' "$CONFIG")
  kc() { command kubectl --kubeconfig "$KUBECONFIG" --request-timeout=30s -n "$NS" "$@"; }
  [[ $(command kubectl --kubeconfig "$KUBECONFIG" config view --minify -o jsonpath='{.clusters[0].cluster.server}') \
    == "$(jq -r .server "$CONFIG")" ]] || fail 'Cluster identity mismatch'
  LIVE_DB=$(kc get secret radar-db-credentials -o jsonpath='{.data.POSTGRES_DB}' | base64 -d)
else
  [[ -n ${PG_STATE_DIR:-} && -d $PG_STATE_DIR ]] || fail 'PG_STATE_DIR is required by the compose backend'
  COMPOSE=(docker compose --env-file /dev/null -p radar-test-cutover -f deploy/cutover/test.compose.yml)
  LIVE_DB=${PG_LIVE_DB:-radar_next}
fi
[[ $LIVE_DB =~ ^[a-z_][a-z0-9_]{0,62}$ ]] || fail 'Invalid live database name'

# pexec <side> <command...>: run inside the PostgreSQL container, stdin attached.
pexec() {
  local side=$1; shift
  if [[ $BACKEND == k8s ]]; then
    command kubectl --kubeconfig "$KUBECONFIG" -n "$NS" exec -i "$(pod_of "$side")" -c postgres -- "$@"
  else
    local svc=postgres; [[ $side == pg18 ]] || svc=postgres16
    "${COMPOSE[@]}" exec -T "$svc" "$@"
  fi
}
# q <side> <db>: SQL on stdin, unaligned tuples. Operator sessions are never frozen.
q() {
  pexec "$1" sh -c 'PGOPTIONS="-c default_transaction_read_only=off -c TimeZone=UTC -c statement_timeout=0" \
    exec psql -X -q -At -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$1"' sh "$2"
}
q1() { q "$1" "$2" <<< "$3"; }
# Remote clients run in the subscriber container and reach the other side by its
# direct Service name, with the namespace superuser password of that container.
remote() {
  local side=$1; shift
  pexec "$side" bash -o pipefail -c 'export PGPASSWORD="$POSTGRES_PASSWORD" PGHOST="$1" PGUSER="$POSTGRES_USER"; shift; eval "$*"' \
    sh "radar-$(other "$side")" "$*"
}
db_exists() { [[ $(q1 "$1" postgres "SELECT count(*) FROM pg_database WHERE datname='$LIVE_DB'") == 1 ]]; }
excluded_sql() { printf "'%s'," "${EXCLUDED_EXTENSIONS[@]}" | sed 's/,$//'; }
# Application tables: every permanent table that no extension owns.
TABLES_SQL="SELECT format('%I.%I', n.nspname, c.relname) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE c.relkind='r' AND c.relpersistence='p' AND n.nspname NOT IN ('pg_catalog','information_schema')
  AND n.nspname NOT LIKE 'pg\_%'
  AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid='pg_class'::regclass AND d.objid=c.oid AND d.deptype='e')
  ORDER BY 1"
tables() { q1 "$1" "$LIVE_DB" "$TABLES_SQL"; }
new_password() { od -An -N24 -tx1 /dev/urandom | tr -d ' \n'; }

active_side() {
  if [[ $BACKEND == compose ]]; then cat "$PG_STATE_DIR/active" 2>/dev/null || echo pg16; return; fi
  local pod
  pod=$(kc get service radar-postgres -o json | jq -r '.spec.selector["statefulset.kubernetes.io/pod-name"]//""')
  [[ -n $pod ]] || fail 'The radar-postgres Service selector is not pinned to one pod; run pg-switch TARGET=pg16 first'
  side_of_pod "$pod"
}

preflight_source() {   # $1 = publishing side
  local side=$1 bad
  [[ $(q1 "$side" postgres 'SHOW wal_level') == logical ]] \
    || fail "$side runs without wal_level=logical (restart it with the manifest args first)"
  bad=$(q1 "$side" "$LIVE_DB" "SELECT string_agg(t, ', ') FROM ($TABLES_SQL) l(t) JOIN pg_class c ON c.oid=t::regclass
    WHERE c.relreplident NOT IN ('f','i') AND NOT EXISTS (SELECT 1 FROM pg_constraint k WHERE k.conrelid=c.oid AND k.contype='p')")
  [[ -z $bad ]] || fail "Tables without primary key or replica identity: $bad"
  bad=$(q1 "$side" "$LIVE_DB" "SELECT (SELECT count(*) FROM pg_matviews)||' materialized views, '||
    (SELECT count(*) FROM pg_largeobject_metadata)||' large objects, '||
    (SELECT count(*) FROM pg_class WHERE relkind='p')||' partitioned tables, '||
    (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind='r'
      AND c.relpersistence='u' AND n.nspname NOT LIKE 'pg\_%')||' unlogged tables'")
  [[ $bad == '0 materialized views, 0 large objects, 0 partitioned tables, 0 unlogged tables' ]] \
    || fail "Objects logical replication does not carry: $bad"
}

ensure_role() {   # $1 side: replication role exists, never frozen in the live database
  q "$1" postgres <<SQL
DO \$\$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='$ROLE') THEN
    CREATE ROLE $ROLE LOGIN REPLICATION SUPERUSER;
  END IF;
END \$\$;
SQL
  if db_exists "$1"; then
    q1 "$1" postgres "ALTER ROLE $ROLE IN DATABASE $LIVE_DB SET default_transaction_read_only = off" >/dev/null
  fi
}
ensure_publication() {   # $1 publishing side: publication = application tables
  local list current wanted
  list=$(tables "$1" | paste -sd, -)
  [[ -n $list ]] || fail "No application table on $1"
  if [[ $(q1 "$1" "$LIVE_DB" "SELECT count(*) FROM pg_publication WHERE pubname='$PUB'") == 0 ]]; then
    q1 "$1" "$LIVE_DB" "CREATE PUBLICATION $PUB FOR TABLE $list" >/dev/null
  fi
  current=$(q1 "$1" "$LIVE_DB" "SELECT format('%I.%I', schemaname, tablename) FROM pg_publication_tables WHERE pubname='$PUB' ORDER BY 1")
  wanted=$(tables "$1")
  [[ $current == "$wanted" ]] || fail "Publication on $1 differs from the application tables (DDL since setup?)"
}
# subscribe <subscriber side> <copy_data true|false>: the subscriber pulls from the other side.
subscribe() {
  local side=$1 copy=$2 pw sub
  sub=$(sub_on "$side")
  [[ $(q1 "$side" "$LIVE_DB" "SELECT count(*) FROM pg_subscription WHERE subname='$sub'") == 0 ]] || return 0
  pw=$(new_password)
  ensure_role "$(other "$side")"
  q "$(other "$side")" postgres <<< "ALTER ROLE $ROLE PASSWORD '$pw'" >/dev/null
  q "$side" "$LIVE_DB" >/dev/null <<SQL
CREATE SUBSCRIPTION $sub
  CONNECTION 'host=radar-$(other "$side") port=5432 dbname=$LIVE_DB user=$ROLE password=$pw'
  PUBLICATION $PUB WITH (copy_data = $copy, origin = none, disable_on_error = true);
ALTER SUBSCRIPTION $sub OWNER TO $ROLE;
SQL
}
lag_bytes() {   # $1 publishing side: WAL the standby has not confirmed yet
  q1 "$1" postgres "SELECT coalesce((SELECT pg_wal_lsn_diff(pg_current_wal_lsn(), confirmed_flush_lsn)::bigint
    FROM pg_replication_slots WHERE slot_name='$(sub_on "$(other "$1")")'), -1)"
}
ready() {   # $1 subscriber side: subscription enabled and every table in state r
  q1 "$1" "$LIVE_DB" "SELECT s.subenabled AND count(r.*)>0 AND bool_and(r.srsubstate='r')
    FROM pg_subscription s LEFT JOIN pg_subscription_rel r ON r.srsubid=s.oid WHERE s.subname='$(sub_on "$1")' GROUP BY s.subenabled"
}
caught_up() {   # $1 publishing side, $2 LSN: the standby confirmed everything up to $2
  [[ $(q1 "$1" postgres "SELECT coalesce((SELECT confirmed_flush_lsn >= '$2'::pg_lsn FROM pg_replication_slots
    WHERE slot_name='$(sub_on "$(other "$1")")'), false)") == t ]]
}
wait_caught_up() {   # $1 publishing side, $2 seconds
  local lsn deadline=$((SECONDS+$2))
  lsn=$(q1 "$1" postgres 'SELECT pg_current_wal_lsn()')
  until caught_up "$1" "$lsn"; do
    ((SECONDS<deadline)) || return 1
    sleep 1
  done
}

freeze() {   # $1 side: new sessions read-only, current client sessions ended
  q "$1" postgres >/dev/null <<SQL
ALTER DATABASE $LIVE_DB SET default_transaction_read_only = on;
SELECT count(pg_terminate_backend(pid)) FROM pg_stat_activity
  WHERE datname='$LIVE_DB' AND backend_type='client backend' AND pid<>pg_backend_pid() AND usename<>'$ROLE';
SQL
}
unfreeze() { q1 "$1" postgres "ALTER DATABASE $LIVE_DB RESET default_transaction_read_only" >/dev/null; }
frozen() {
  q1 "$1" postgres "SELECT count(*) FROM pg_db_role_setting s JOIN pg_database d ON d.oid=s.setdatabase
    WHERE d.datname='$LIVE_DB' AND s.setrole=0 AND 'default_transaction_read_only=on'=ANY(s.setconfig)"
}
copy_sequences() {   # $1 -> $2: sequence positions (not carried by logical replication)
  local sql
  sql=$(q1 "$1" "$LIVE_DB" "SELECT format('SELECT setval(%L, %s, true);', format('%I.%I', s.schemaname, s.sequencename), s.last_value)
    FROM pg_sequences s WHERE s.last_value IS NOT NULL AND NOT EXISTS (SELECT 1 FROM pg_depend d
      WHERE d.classid='pg_class'::regclass AND d.objid=format('%I.%I', s.schemaname, s.sequencename)::regclass AND d.deptype='e')")
  [[ -z $sql ]] || q "$2" "$LIVE_DB" <<< "$sql" >/dev/null
}
counts() { tables "$1" | sed "s/.*/SELECT '&|' || count(*) FROM &;/" | q "$1" "$LIVE_DB"; }

flip_service() {   # $1 side that serves radar-postgres from now on
  if [[ $BACKEND == compose ]]; then echo "$1" > "$PG_STATE_DIR/active"; return; fi
  local pod; pod=$(pod_of "$1")
  command kubectl --kubeconfig "$KUBECONFIG" create --dry-run=client -o json -f deploy/k8s/20-postgres-postgis.yaml \
    | jq --arg ns "$NS" --arg pod "$pod" -f tools/make/cutover-pg-service.jq \
    | kc apply --server-side --field-manager=pg-upgrade --force-conflicts -f - >/dev/null
  local deadline=$((SECONDS+60))
  until kc get endpoints radar-postgres -o json \
    | jq -e --arg pod "$pod" '[.subsets[]?|(.addresses//[])[],(.notReadyAddresses//[])[]|.targetRef.name]==[$pod]' >/dev/null; do
    ((SECONDS<deadline)) || return 1
    sleep 1
  done
}
record() {   # receipt of the last operation (ConfigMap radar-pg-upgrade / state file)
  if [[ $BACKEND == compose ]]; then printf '%s\n' "$1" > "$PG_STATE_DIR/receipt.json"; return; fi
  jq -n --arg ns "$NS" --arg r "$1" '{apiVersion:"v1",kind:"ConfigMap",metadata:{name:"radar-pg-upgrade",namespace:$ns},data:{receipt:$r}}' \
    | kc apply --server-side --field-manager=pg-upgrade --force-conflicts -f - >/dev/null
}

# Namespace change lock shared with the cutover tool (same ConfigMap, kind pg-switch).
LOCKED=0
lock_take() {
  [[ $BACKEND == k8s ]] || return 0
  jq -n --arg ns "$NS" --arg run "$(cat /proc/sys/kernel/random/uuid)" --arg host "$(hostname)" --arg pid "$$" \
    '{apiVersion:"v1",kind:"ConfigMap",metadata:{name:"radar-change-lock",namespace:$ns},
      data:{record:({run:$run,kind:"pg-switch",executor:{kind:"local",host:$host,pid:$pid,state:"running"},
        stage:"pg-switch",checkpoints:{},jobs:{},originalJobs:[]}|tojson)}}' \
    | kc create -f - >/dev/null 2>&1 || fail 'radar-change-lock is held by another operation'
  LOCKED=1
}
lock_drop() {
  [[ $LOCKED == 1 ]] || return 0
  kc delete configmap radar-change-lock >/dev/null; LOCKED=0
}

cmd_replicate() {
  if [[ ${ABORT:-0} == 1 ]]; then cmd_abort; return; fi
  local active; active=$(active_side)
  [[ $active == pg16 ]] || fail 'Initial replication runs only while PG16 serves'
  preflight_source pg16
  [[ $(q1 pg18 postgres 'SHOW server_version_num') -ge 180000 ]] || fail 'radar-pg18 is not PostgreSQL 18'
  [[ $BACKEND == compose || $(q1 pg18 postgres 'SHOW file_copy_method') == clone ]] || fail 'radar-pg18 runs without file_copy_method=clone'
  [[ $(q1 pg18 postgres 'SHOW wal_level') == logical ]] || fail 'radar-pg18 runs without wal_level=logical'
  ensure_role pg16
  # Roles first, with their SCRAM hashes: application Secrets stay valid on PG18.
  if [[ $(q1 pg18 postgres "SELECT count(*) FROM pg_roles WHERE rolname='$ROLE'") == 0 ]]; then
    log 'Copying roles from PG16'
    remote pg18 "pg_dumpall --roles-only -d postgres | grep -vxF \"CREATE ROLE \$POSTGRES_USER;\" | psql -X -q -v ON_ERROR_STOP=1 -h /var/run/postgresql -d postgres" >/dev/null
  fi
  if ! db_exists pg18; then
    log "Creating $LIVE_DB on PG18 and copying its schema"
    local spec
    spec=$(q1 pg16 postgres "SELECT format('CREATE DATABASE %I OWNER %I TEMPLATE template0 ENCODING %L LOCALE %L', datname,
      pg_get_userbyid(datdba), pg_encoding_to_char(encoding), datcollate) FROM pg_database WHERE datname='$LIVE_DB'")
    q pg18 postgres <<< "$spec" >/dev/null
    local excl; excl=$(printf -- ' --exclude-extension=%s' "${EXCLUDED_EXTENSIONS[@]}")
    remote pg18 "pg_dump --schema-only --no-publications --no-subscriptions$excl -d $LIVE_DB | psql -X -q -v ON_ERROR_STOP=1 -h /var/run/postgresql -d $LIVE_DB" >/dev/null
  fi
  ensure_role pg18
  [[ $(tables pg18) == "$(tables pg16)" ]] || fail 'PG18 schema differs from PG16 (ABORT=1 then retry)'
  ensure_publication pg16
  subscribe pg18 true
  log 'Initial copy running; waiting for every table to reach state r'
  local deadline=$((SECONDS+${WAIT_SECONDS:-5400}))
  until [[ $(ready pg18) == t ]]; do
    [[ $(q1 pg18 "$LIVE_DB" "SELECT subenabled FROM pg_subscription WHERE subname='$(sub_on pg18)'") == t ]] \
      || fail 'Subscription disabled by an apply error (see the PG18 log)'
    ((SECONDS<deadline)) || fail 'Initial copy still running; re-run pg-replicate to keep waiting'
    log "$(q1 pg18 "$LIVE_DB" "SELECT count(*) FILTER (WHERE srsubstate='r')||'/'||count(*)||' tables ready' FROM pg_subscription_rel")"
    sleep "${POLL_SECONDS:-30}"
  done
  wait_caught_up pg16 120 || fail 'PG18 has not caught up with PG16'
  log "Replication ready: lag $(lag_bytes pg16) bytes"
}

cmd_abort() {   # remove every replication object on both sides (L2 rollback, L6 decommission)
  local side sub
  for side in pg18 pg16; do
    db_exists "$side" || continue
    for sub in $(q1 "$side" "$LIVE_DB" "SELECT subname FROM pg_subscription WHERE subname LIKE 'pgup\_from\_%'"); do
      q1 "$side" "$LIVE_DB" "DROP SUBSCRIPTION $sub" >/dev/null
    done
  done
  for side in pg16 pg18; do
    if db_exists "$side"; then q1 "$side" "$LIVE_DB" "DROP PUBLICATION IF EXISTS $PUB" >/dev/null; fi
    q1 "$side" postgres "SELECT count(pg_drop_replication_slot(slot_name)) FROM pg_replication_slots
      WHERE slot_name LIKE 'pgup\_from\_%' AND NOT active" >/dev/null
    q1 "$side" postgres "DROP ROLE IF EXISTS $ROLE" >/dev/null
  done
  log 'Replication objects removed on both sides (databases and freeze state unchanged)'
}

cmd_verify() {
  local active standby rounds=0 a b mismatch
  active=$(active_side); standby=$(other "$active")
  [[ $(ready "$standby") == t ]] || fail "$standby does not replicate $active"
  while :; do
    wait_caught_up "$active" 120 || fail "$standby lags behind $active"
    a=$(mktemp); b=$(mktemp)
    pg_verify_digest "$active" > "$a" & local pa=$!
    pg_verify_digest "$standby" > "$b" & local pb=$!
    wait "$pa"; wait "$pb"
    mismatch=$(diff "$a" "$b" | grep -c '^[<>]' || true)
    if [[ $mismatch == 0 ]]; then
      log "Tables: $(wc -l < "$a") equal (count + ordered md5) between $active and $standby"; rm -f "$a" "$b"; break
    fi
    rounds=$((rounds+1))
    if ((rounds>=3)); then diff "$a" "$b" >&2 || true; rm -f "$a" "$b"; fail 'Table contents differ'; fi
    log "Difference while writes continue; retrying ($rounds/3)"; rm -f "$a" "$b"; sleep 5
  done
  a=$(acl_matrix "$active"); b=$(acl_matrix "$standby")
  [[ $a == "$b" ]] || { diff <(echo "$a") <(echo "$b") >&2 || true; fail 'Privileges or roles differ'; }
  log "Privileges and roles: equal ($(wc -l <<< "$a") entries)"
  log "Sequences differing (expected on the standby until a switch copies them): $(diff \
    <(q1 "$active" "$LIVE_DB" 'SELECT schemaname||$$.$$||sequencename||$$=$$||coalesce(last_value::text,$$-$$) FROM pg_sequences ORDER BY 1') \
    <(q1 "$standby" "$LIVE_DB" 'SELECT schemaname||$$.$$||sequencename||$$=$$||coalesce(last_value::text,$$-$$) FROM pg_sequences ORDER BY 1') \
    | grep -c '^<' || true)"
}
pg_verify_digest() {   # one line per table: name|rows|md5 of the sorted row md5s
  q1 "$1" "$LIVE_DB" "$(tables "$1" | sed "s/.*/SELECT '&|' || count(*) || '|' || coalesce(md5(string_agg(h, '' ORDER BY h)), '') FROM (SELECT md5(t::text) h FROM & t) s;/")"
}
acl_matrix() {
  q1 "$1" "$LIVE_DB" "SELECT format('%s %s %s', c.oid::regclass, c.relkind, coalesce(c.relacl::text,'-')) FROM pg_class c
      JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind IN ('r','S','v') AND n.nspname NOT LIKE 'pg\_%'
      AND n.nspname NOT IN ('information_schema') AND NOT EXISTS (SELECT 1 FROM pg_depend d
        WHERE d.classid='pg_class'::regclass AND d.objid=c.oid AND d.deptype='e')
    UNION ALL SELECT format('schema %s %s', nspname, coalesce(nspacl::text,'-')) FROM pg_namespace
      WHERE nspname NOT LIKE 'pg\_%' AND nspname NOT IN ('information_schema','tiger','tiger_data','topology')
    UNION ALL SELECT format('default %s %s %s', pg_get_userbyid(defaclrole), defaclobjtype, defaclacl) FROM pg_default_acl
    UNION ALL SELECT format('role %s super=%s login=%s repl=%s bypassrls=%s', rolname, rolsuper, rolcanlogin, rolreplication, rolbypassrls)
      FROM pg_roles WHERE rolname NOT LIKE 'pg\_%' AND rolname<>'$ROLE'
    UNION ALL SELECT format('member %s %s', pg_get_userbyid(roleid), pg_get_userbyid(member)) FROM pg_auth_members
      WHERE pg_get_userbyid(roleid) NOT LIKE 'pg\_%'
    ORDER BY 1"
}

cmd_switch() {
  local target=${TARGET:-} active t0 stage=init
  [[ $target == pg16 || $target == pg18 ]] || fail 'TARGET must be pg16 or pg18'
  if [[ $BACKEND == k8s ]] && ! kc get service radar-postgres -o json | jq -e '.spec.selector["statefulset.kubernetes.io/pod-name"]' >/dev/null; then
    # One-time pin: only while radar-postgres-0 is the sole endpoint (before radar-pg18 exists).
    [[ $target == pg16 ]] || fail 'Pin the Service to PG16 first (pg-switch TARGET=pg16)'
    kc get endpoints radar-postgres -o json | jq -e '[.subsets[]?|(.addresses//[])[],(.notReadyAddresses//[])[]|.targetRef.name]==["radar-postgres-0"]' \
      >/dev/null || fail 'radar-postgres has endpoints other than radar-postgres-0; resolve before pinning'
    lock_take; trap lock_drop EXIT
    flip_service pg16 || fail 'Selector pin not observed on the endpoints'
    record "$(jq -nc --arg at "$(date -u +%FT%TZ)" '{action:"pin",active:"pg16",at:$at}')"
    log 'radar-postgres pinned to radar-postgres-0'
    return
  fi
  active=$(active_side)
  [[ $active != "$target" ]] || { log "$target already serves radar-postgres"; return; }
  [[ $(ready "$target") == t ]] || fail "$target does not replicate $active (pg-replicate / pg-reverse)"
  [[ $(lag_bytes "$active") -ge 0 && $(lag_bytes "$active") -le ${MAX_LAG_BYTES:-67108864} ]] || fail 'Standby lag too large to switch'
  lock_take
  trap 'switch_failed' EXIT
  t0=$(date +%s.%N)
  stage=freeze; freeze "$active"
  stage=catchup; wait_caught_up "$active" "${CATCHUP_SECONDS:-45}"
  stage=sequences; copy_sequences "$active" "$target"
  stage=counts; [[ $(counts "$active") == "$(counts "$target")" ]]
  stage=forward; q1 "$target" "$LIVE_DB" "DROP SUBSCRIPTION $(sub_on "$target")" >/dev/null
  if [[ ${REVERSE:-1} == 1 ]]; then
    stage=reverse; ensure_publication "$target"; subscribe "$active" false
  fi
  stage=unfreeze; unfreeze "$target"
  stage=flip; flip_service "$target"
  stage=done
  freeze "$active"   # end sessions still open on the old side after the flip
  local seconds; seconds=$(awk -v a="$t0" -v b="$(date +%s.%N)" 'BEGIN{printf "%.1f", b-a}')
  trap - EXIT
  record "$(jq -nc --arg from "$active" --arg to "$target" --arg s "$seconds" --arg at "$(date -u +%FT%TZ)" \
    --argjson reverse "$([[ ${REVERSE:-1} == 1 ]] && echo true || echo false)" \
    '{action:"switch",from:$from,active:$to,freezeSeconds:($s|tonumber),reverse:$reverse,at:$at}')"
  lock_drop
  log "radar-postgres now served by $target; writes frozen ${seconds}s; $active is the read-only standby"
}
switch_failed() {
  local code=$?
  trap - EXIT
  log "Switch failed at stage $stage; restoring service on $active"
  case $stage in
    freeze|catchup|sequences|counts) unfreeze "$active";;
    forward|reverse|unfreeze)
      # Still frozen and caught up: the reverse subscription (if any) goes away and
      # the forward one comes back without copy, so no write is lost either way.
      q1 "$active" "$LIVE_DB" "DROP SUBSCRIPTION IF EXISTS $(sub_on "$active")" >/dev/null || true
      subscribe "$target" false
      freeze "$target"; unfreeze "$active";;
    flip)
      if [[ $(active_side) == "$active" ]]; then
        q1 "$active" "$LIVE_DB" "DROP SUBSCRIPTION IF EXISTS $(sub_on "$active")" >/dev/null || true
        subscribe "$target" false; freeze "$target"; unfreeze "$active"
      else
        log "The Service already selects $target; finish with pg-switch TARGET=$target"; exit "$code"
      fi;;
  esac
  lock_drop
  exit "$code"
}

cmd_reverse() {   # status gate of the replication that keeps the standby current
  local active standby lag state
  active=$(active_side); standby=$(other "$active")
  state=$(ready "$standby"); lag=$(lag_bytes "$active")
  jq -nc --arg active "$active" --arg standby "$standby" --arg sub "$(sub_on "$standby")" --arg ready "${state:-f}" \
    --argjson lag "${lag:--1}" --argjson af "$(frozen "$active")" --argjson sf "$(frozen "$standby")" \
    '{active:$active,standby:$standby,subscription:$sub,ready:($ready=="t"),lagBytes:$lag,activeFrozen:($af>0),standbyFrozen:($sf>0)}'
  [[ $state == t && $lag -ge 0 && $lag -le ${MAX_LAG_BYTES:-67108864} && $(frozen "$active") == 0 ]] \
    || fail "The standby $standby is not kept current from $active"
}

case $VERB in
  pg-replicate) cmd_replicate;;
  pg-verify) cmd_verify;;
  pg-switch) cmd_switch;;
  pg-reverse) cmd_reverse;;
  *) fail 'Unknown PG upgrade verb';;
esac
