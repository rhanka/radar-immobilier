#!/usr/bin/env bash
set -euo pipefail
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
    for path in build.json health; do
      curl -q -fsS --connect-timeout 5 --max-time 15 "https://immo.sent-tech.ca/$path" |
        jq -e 'if has("db") then {sha,db:.db.ok,storage:.objectStore.ok} else {sha} end'
    done
    "${k[@]}" get configmap radar-change-lock --ignore-not-found -o name
    "${k[@]}" get deployments radar-api radar-ui radar-immo-mcp -o custom-columns='NAME:.metadata.name,UID:.metadata.uid,IMAGE:.spec.template.spec.containers[*].image,READY:.status.readyReplicas'
    "${k[@]}" get cronjobs -o custom-columns='NAME:.metadata.name,UID:.metadata.uid,SUSPEND:.spec.suspend,IMAGE:.spec.jobTemplate.spec.template.spec.containers[*].image'
    pod=$("${k[@]}" get pods -o jsonpath='{range .items[*]}{.metadata.name}{"\n"}{end}' | awk '/^radar-postgres-/{print; exit}')
    [[ -n $pod ]]
    "${k[@]}" exec "$pod" -- sh -c 'PGOPTIONS="-c default_transaction_read_only=on -c statement_timeout=15000 -c lock_timeout=3000" psql -X -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -Atc "SELECT current_database(),pg_database_size(current_database()); SELECT hash,created_at FROM drizzle.__drizzle_migrations ORDER BY id; SELECT rolname,rolcanlogin,rolsuper,rolcreatedb,rolcreaterole,rolreplication FROM pg_roles WHERE rolname IN ('"'"'radar_db_ro_prod'"'"','"'"'immo_mcp_account_reader'"'"','"'"'immo_mcp_artifact_writer'"'"');"'
    "${k[@]}" exec "$pod" -- df -Pk /var/lib/postgresql/data
    ;;
  k8s-plan) cat docs/runbooks/prod-cutover-v1220.md ;;
  cd-plan) cat deploy/prod-cutover/cd-plan.txt ;;
  *) exit 2 ;;
esac
