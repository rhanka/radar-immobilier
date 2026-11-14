#!/usr/bin/env bash
# Called by operator-prep.sh with its private paths and pinned image.
set -euo pipefail
container=radar-cutover-final-v1220
if ! docker container inspect "$container" >/dev/null 2>&1; then
  [[ -z $(ss -H -ltn 'sport = :25435') ]] || fail port_25435_occupied
  [[ ! -e $private/final-password ]] || fail unexpected_final_password
  openssl rand -hex 32 > "$private/final-password"
  docker run -d --pull=never --name "$container" --restart unless-stopped \
    --label ca.sent-tech.immo.operator-prep=v1220 \
    -p 127.0.0.1:25435:5432 \
    -e POSTGRES_USER=radar -e POSTGRES_DB=postgres -e POSTGRES_PASSWORD_FILE=/run/final-password \
    -v "$private/final-password:/run/final-password:ro" \
    -v radar-cutover-final-v1220:/var/lib/postgresql/data "$image" > "$private/final-container.id"
fi
docker inspect "$container" | jq -e --arg image "$image" '
  .[0] | .Config.Image==$image and .Config.Labels["ca.sent-tech.immo.operator-prep"]=="v1220"
  and .HostConfig.PortBindings["5432/tcp"]==[{HostIp:"127.0.0.1",HostPort:"25435"}]' >/dev/null || fail final_container_identity
for attempt in {1..45}; do
  if docker exec "$container" pg_isready -h 127.0.0.1 -U radar -d radar_cutover_final >/dev/null 2>&1; then break; fi
  sleep 1
done
docker exec -i "$container" psql -XqAt -U radar -d postgres -v ON_ERROR_STOP=1 <<'SQL' > /dev/null
SELECT format('CREATE ROLE %I NOLOGIN', name) FROM
  (VALUES ('radar_db_ro_prod'), ('radar_snapshot_ro'), ('immo_mcp_account_reader'), ('immo_mcp_artifact_writer')) AS roles(name)
  WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname=name) \gexec
SELECT 'CREATE DATABASE radar_cutover_final OWNER radar TEMPLATE template0'
  WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname='radar_cutover_final') \gexec
SQL
[[ ! -L $private/final-copy.pgpass ]] || fail final_pgpass_symlink
awk '{print "127.0.0.1:25435:radar_cutover_final:radar:" $0}' "$private/final-password" > "$private/final-copy.pgpass"
chmod 600 "$private/final-copy.pgpass"
result=$(docker run --rm --pull=never --network host --user "$(id -u):$(id -g)" \
  -v "$private:$private:ro" -e PGHOST=127.0.0.1 -e PGPORT=25435 -e PGDATABASE=radar_cutover_final \
  -e PGUSER=radar -e PGPASSFILE="$private/final-copy.pgpass" -e PGCONNECT_TIMEOUT=5 \
  "$image" psql -XqAt -v ON_ERROR_STOP=1 -c "SELECT count(*) FROM pg_tables WHERE schemaname NOT IN ('pg_catalog','information_schema');" \
  2> "$private/final-check.error") || fail final_connection
[[ $result == 0 ]] || fail final_database_not_empty_preserved
printf '5 OK empty PG16/PostGIS target, template0, dump roles, loopback 25435\n'
if [[ ! -e $private/prod-approval.json ]]; then
  jq -e --slurpfile roster "$private/roster.json" '.accounts==$roster[0]' "$private/plan.json" >/dev/null || fail roster_plan_mismatch
  jq -n --arg expiresAt "$(date -u -d '+4 hours' +%FT%TZ)" \
    --arg plan "$(sha256sum "$private/plan.json" | cut -d' ' -f1)" \
    --arg roster "$(sha256sum "$private/roster.json" | cut -d' ' -f1)" \
    '{owner:"owner (autorisation du 13/11, transmise par i-cond)",operator:"i-cond",sha:"b7724bdd9015a4f26319897bf240baaf9ee636ae",
      expiresAt:$expiresAt,host:"127.0.0.1",port:25432,database:"radar",planSha256:$plan,rosterSha256:$roster,
      drain:null,writersStopped:false,ownerGoDate:"2026-11-13",
      ownerGoVerbatim:["go provision-prod","puis go","vas y pour la bascule 22h30 23h00 stp"]}' > "$private/prod-approval.json"
  chmod 600 "$private/prod-approval.json"
fi
jq -e --arg plan "$(sha256sum "$private/plan.json" | cut -d' ' -f1)" \
  --arg roster "$(sha256sum "$private/roster.json" | cut -d' ' -f1)" '
  .owner and .sha=="b7724bdd9015a4f26319897bf240baaf9ee636ae" and .host=="127.0.0.1"
  and .port==25432 and .database=="radar" and .planSha256==$plan and .rosterSha256==$roster
  and ((.expiresAt|fromdateiso8601)>now)' "$private/prod-approval.json" >/dev/null || fail approval_invalid_or_expired
docker exec "$container" psql -XqAt -U radar -d postgres -v ON_ERROR_STOP=1 \
  -c "SELECT count(*)=4 FROM pg_roles WHERE rolname IN ('radar_db_ro_prod','radar_snapshot_ro','immo_mcp_account_reader','immo_mcp_artifact_writer') AND NOT rolcanlogin;" \
  | { read -r roles; [[ $roles == t ]]; } || fail final_roles
printf '7 approval retained; drain must be filled during actual window\n'
if [[ ! -e $private/configuration-tonight.json ]]; then
  PLAN="$private/plan.json" CONFIGURATION="$private/configuration-tonight.json" \
    make --no-print-directory -f deploy/prod-cutover/prod-cutover.mk render ENV=prod
fi
mkdir -p "$private/prod-window-v1220" "$private/final-restore-v1220"
chmod 700 "$private/prod-window-v1220" "$private/final-restore-v1220"
for file in plan.json roster.json previous-release.json classification-cursor.secret prod-approval.json configuration-tonight.json prod-admin.pgpass prod-ro.pgpass backup-writer.env s3-provision.input final-copy.pgpass; do
  if [[ -s $private/$file && ! -L $private/$file ]]; then
    printf '8 present %s mode=%s\n' "$file" "$(stat -c %a "$private/$file")"
  else printf '8 MISSING %s\n' "$file"; fi
done
[[ -s deploy/prod-cutover/release.json ]] || fail candidate_release_missing
printf '8 deferred outputs: drain.json, prod-final-v1220.dump, final-restore-v1220/restore.json\n'
