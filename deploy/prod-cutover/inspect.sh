#!/usr/bin/env bash
set -euo pipefail
umask 077
case ${1:-} in
  prerequisites)
    for tool in node psql pg_dump pg_restore s5cmd kubectl docker timeout sha256sum; do
      if command -v "$tool" >/dev/null; then printf '%s disponible\n' "$tool"; else printf '%s MANQUANT\n' "$tool"; fi
    done
    ;;
  precheck)
    [[ ${ENV:-} == prod ]]
    export KUBECONFIG="$HOME/.kube/radar-prod-tenant-admin.kubeconfig"
    k=(kubectl --kubeconfig "$KUBECONFIG" --request-timeout=15s -n radar-immobilier)
    server=$("${k[@]}" config view --minify -o jsonpath='{.clusters[0].cluster.server}')
    [[ $server == https://hlhedx.c1.bhs5.k8s.ovh.net ]]
    node deploy/prod-cutover/cors-precheck.cjs
    node deploy/prod-cutover/artifacts-precheck.cjs
    for path in build.json health; do
      curl -q -fsS --connect-timeout 5 --max-time 15 "https://immo.sent-tech.ca/$path" |
        jq -e 'if .sha!="79c2bd9" then error("unexpected_served_sha") elif has("db") then
          if .db.ok and .objectStore.ok then {sha,db:.db.ok,storage:.objectStore.ok} else error("unhealthy") end else {sha} end'
    done
    lock=$("${k[@]}" get configmap radar-change-lock --ignore-not-found -o name)
    printf 'Verrou : %s\n' "${lock:-libre}"
    "${k[@]}" get deployments radar-api radar-ui radar-immo-mcp -o custom-columns='NAME:.metadata.name,UID:.metadata.uid,IMAGE:.spec.template.spec.containers[*].image,READY:.status.readyReplicas'
    "${k[@]}" get cronjobs -o custom-columns='NAME:.metadata.name,UID:.metadata.uid,SUSPEND:.spec.suspend,IMAGE:.spec.jobTemplate.spec.template.spec.containers[*].image'
    pod=$("${k[@]}" get pods -o jsonpath='{range .items[*]}{.metadata.name}{"\n"}{end}' | awk '/^radar-postgres-/{print; exit}')
    [[ -n $pod ]]
    data=$("${k[@]}" exec "$pod" -- sh -c 'PGOPTIONS="-c default_transaction_read_only=on -c statement_timeout=15000 -c lock_timeout=3000" psql -X -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -Atc "SELECT json_build_object('"'"'database'"'"',current_database(),'"'"'bytes'"'"',pg_database_size(current_database()),'"'"'migrations'"'"',(SELECT json_agg(json_build_object('"'"'hash'"'"',hash,'"'"'created_at'"'"',created_at)) FROM drizzle.__drizzle_migrations),'"'"'roles'"'"',(SELECT json_agg(rolname) FROM pg_roles WHERE rolname IN ('"'"'radar_db_ro_prod'"'"','"'"'immo_mcp_account_reader'"'"','"'"'immo_mcp_artifact_writer'"'"')));"')
    printf '%s' "$data" | node deploy/prod-cutover/inventory.cjs
    free=$("${k[@]}" exec "$pod" -- df -Pk /var/lib/postgresql/data | awk 'NR==2 {print $4}')
    bytes=$(jq -r .bytes <<< "$data")
    printf 'Disque PostgreSQL libre : %s KiB\n' "$free"
    ((free * 1024 >= bytes * 4)) || { echo 'NO-GO : réserve disque inférieure à 4 fois la base'; exit 3; }
    [[ -z $lock ]] || { echo 'NO-GO : verrou présent, traitement réservé à k8s'; exit 3; }
    ;;
  k8s-plan) cat docs/runbooks/prod-cutover-v1220.md ;;
  cd-plan) cat deploy/prod-cutover/cd-plan.txt ;;
  *) exit 2 ;;
esac
