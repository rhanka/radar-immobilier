#!/usr/bin/env bash
set -euo pipefail
umask 077
private="$HOME/.local/share/radar-prod-copy"
mkdir -p "$private"
chmod 700 "$private"
prod=(kubectl --kubeconfig "$HOME/.kube/radar-prod-tenant-admin.kubeconfig" --request-timeout=15s -n radar-immobilier)
preprod=(kubectl --kubeconfig "$HOME/.kube/radar-preprod-tenant.kubeconfig" --request-timeout=15s -n radar-immobilier-preprod)
case ${1:-} in
inventory)
  [[ ! -e $private/preprod-inventory.json ]]
  "${preprod[@]}" exec -i radar-postgres-0 -- sh -c 'PGOPTIONS="-c default_transaction_read_only=on -c statement_timeout=15000" psql -X -qAt -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' > "$private/preprod-inventory.json" <<'SQL'
BEGIN READ ONLY;
SELECT json_build_object('accounts',(SELECT json_agg(row_to_json(a) ORDER BY a.sub) FROM
 (SELECT id,sub,status FROM account_users) a),
 'workspaces',(SELECT json_agg(row_to_json(w) ORDER BY w.slug) FROM
 (SELECT id,slug,label,scope FROM workspaces) w),
 'memberships',(SELECT json_agg(row_to_json(m) ORDER BY m.destination,m.sub) FROM
 (SELECT a.sub,a.status AS "accountStatus",w.slug AS destination,m.status,m.revoked_at,
 m.moderate_archive AS "moderateArchive",m.manage_members AS "manageMembers"
 FROM workspace_memberships m JOIN account_users a ON a.id=m.account_id
 JOIN workspaces w ON w.id=m.workspace_id) m));
COMMIT;
SQL
  jq -e '.workspaces|length==1' "$private/preprod-inventory.json" >/dev/null
  jq -e '.memberships|all(.status=="active" and .revoked_at==null and .accountStatus=="approved")' "$private/preprod-inventory.json" >/dev/null
  jq '[.memberships[]|{sub,destination,moderateArchive,manageMembers}]' "$private/preprod-inventory.json" > "$private/roster.json"
  jq --slurpfile accounts "$private/roster.json" '{version:1,
    actorSub:([$accounts[0][]|select(.manageMembers)][0].sub),
    workspaceSlug:.workspaces[0].slug,workspaceLabel:.workspaces[0].label,accounts:$accounts[0]}' \
    "$private/preprod-inventory.json" > "$private/plan.json"
  jq -e '.actorSub!=null and .workspaceSlug=="agence-chaperon-immobilier"' "$private/plan.json" >/dev/null
  "${preprod[@]}" get configmap radar-api -o json | jq '{keyId:.data.CLASSIFICATION_CURSOR_KEY_ID}' > "$private/cursor-reference.json"
  "${preprod[@]}" get secret radar-classification-cursor-preprod -o json |
    jq -er '.data.CLASSIFICATION_CURSOR_SECRET' | base64 -d > "$private/classification-cursor.secret"
  [[ $(base64 -d < "$private/classification-cursor.secret" | wc -c) -ge 32 ]]
  chmod 600 "$private/"*.json "$private/classification-cursor.secret"
  jq '{accounts:(.accounts|length),workspaces:(.workspaces|length),memberships:(.memberships|length),
    managers:([.memberships[]|select(.manageMembers)]|length),moderators:([.memberships[]|select(.moderateArchive)]|length)}' "$private/preprod-inventory.json"
  sha256sum "$private/roster.json" "$private/plan.json"
  ;;
images)
  jq -r '.apiImage,.uiImage' deploy/prod-cutover/release.json | while IFS= read -r image; do
    [[ $image =~ ^ghcr.io/rhanka/radar-(api|ui)@sha256:[a-f0-9]{64}$ ]]
    docker pull "$image"
    docker image inspect "$image" --format '{{json .RepoDigests}}'
  done
  docker image inspect postgis/postgis:16-3.4 --format '{{json .RepoDigests}}'
  ;;
archive)
  file="$private/prod-20261113.dump"
  [[ ! -e $file && ! -e $file.partial ]]
  docker image inspect postgis/postgis:16-3.4 >/dev/null
  "${prod[@]}" get secret radar-db-ro-prod -o json | jq -er '.data.POSTGRES_USER' | base64 -d > "$private/ro-user"
  [[ $(cat "$private/ro-user") == radar_db_ro_prod ]]
  "${prod[@]}" get secret radar-db-ro-prod -o json | jq -er '.data.POSTGRES_DB' | base64 -d > "$private/ro-db"
  [[ $(cat "$private/ro-db") == radar ]]
  "${prod[@]}" get secret radar-db-ro-prod -o json | jq -er '.data.POSTGRES_PASSWORD' | base64 -d > "$private/ro-password"
  export PGHOST=127.0.0.1 PGPORT=25432 PGUSER=radar_db_ro_prod PGDATABASE=radar
  export PGPASSWORD
  PGPASSWORD=$(cat "$private/ro-password")
  export PGOPTIONS='-c default_transaction_read_only=on -c statement_timeout=840000 -c lock_timeout=5000'
  export PGCONNECT_TIMEOUT=5
  [[ -z $(ss -H -ltn 'sport = :25432') ]]
  "${prod[@]}" port-forward --address 127.0.0.1 service/radar-postgres 25432:5432 > "$private/port-forward.log" 2>&1 &
  forward=$!
  cleanup() { kill "$forward" 2>/dev/null || true; wait "$forward" 2>/dev/null || true; unset PGPASSWORD; rm -f "$private/ro-password"; }
  trap cleanup EXIT
  for attempt in {1..30}; do
    [[ -n $(ss -H -ltn 'sport = :25432') ]] && break
    kill -0 "$forward"
    sleep 1
  done
  client=(docker run --rm --network host -e PGHOST -e PGPORT -e PGUSER -e PGDATABASE -e PGPASSWORD -e PGOPTIONS -e PGCONNECT_TIMEOUT postgis/postgis:16-3.4)
  safe=$("${client[@]}" psql -XqAt -v ON_ERROR_STOP=1 -c "SELECT NOT (rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls)
    AND NOT has_database_privilege(current_user,current_database(),'CREATE')
    AND NOT EXISTS (SELECT FROM pg_namespace WHERE nspname NOT IN ('pg_catalog','information_schema') AND has_schema_privilege(current_user,oid,'CREATE'))
    AND NOT EXISTS (SELECT FROM pg_tables WHERE schemaname NOT IN ('pg_catalog','information_schema')
      AND has_table_privilege(current_user,quote_ident(schemaname)||'.'||quote_ident(tablename),'INSERT,UPDATE,DELETE,TRUNCATE,TRIGGER'))
    FROM pg_roles WHERE rolname=current_user;")
  [[ $safe == t ]] || { echo 'STOP: rôle source non strictement RO'; exit 3; }
  "${client[@]}" psql -XqAt -v ON_ERROR_STOP=1 -c "SELECT json_build_object('version',current_setting('server_version'),'postgis',postgis_lib_version(),
    'bytes',pg_database_size(current_database()),'roles',(SELECT json_agg(rolname ORDER BY rolname) FROM pg_roles WHERE rolname !~ '^pg_'));" > "$private/prod-source.json"
  jq -e '.version|startswith("16.")' "$private/prod-source.json" >/dev/null
  bytes=$(jq -r .bytes "$private/prod-source.json")
  available=$(df -PB1 "$private" | awk 'NR==2{print $4}')
  (( available >= bytes * 4 ))
  start=$(date +%s)
  "${client[@]}" pg_dump --format=custom --no-owner --lock-wait-timeout=5s > "$file.partial"
  duration=$(( $(date +%s) - start ))
  mv "$file.partial" "$file"
  chmod 600 "$file"
  sha=$(sha256sum "$file" | awk '{print $1}')
  independent=$(openssl dgst -sha256 "$file" | awk '{print $NF}')
  [[ $sha == "$independent" ]]
  jq -n --arg sha "$sha" --arg independent "$independent" --arg capturedAt "$(date -u +%FT%TZ)" \
    --argjson durationSeconds "$duration" --argjson bytes "$(stat -c %s "$file")" \
    '{sha256:$sha,independentSha256:$independent,capturedAt:$capturedAt,durationSeconds:$durationSeconds,bytes:$bytes,sourceRole:"radar_db_ro_prod",database:"radar",readOnly:true}' > "$private/archive-proof.json"
  cat "$private/archive-proof.json"
  ;;
*) exit 2 ;;
esac
