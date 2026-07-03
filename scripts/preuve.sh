#!/usr/bin/env bash
# Ops PREUVE (citations + liaisons PDF) — read-only + projection.
# But : éviter les commandes ad-hoc (psql heredoc, kubectl exec) à valider une par une.
# Une seule entrée allowlist `Bash(bash scripts/preuve.sh:*)` suffit.
#
#   bash scripts/preuve.sh global            # complétude globale (Signal+DesignationEvent)
#   bash scripts/preuve.sh city <slug>       # détail d'une ville (citation/pdf par nœud)
#   bash scripts/preuve.sh cities <s1> <s2>… # complétude agrégée pour une liste de villes
#   bash scripts/preuve.sh reproject         # projection SCW->PG complète + attente (SANS boucle) + global
#   bash scripts/preuve.sh reproject-city <slug> # projection ciblée d'une ville + global
#
set -uo pipefail
export KUBECONFIG="${KUBECONFIG:-$HOME/.kube/poc.yaml}"
NS=radar-immobilier
PSQL() { kubectl exec -i -n "$NS" radar-postgres-0 -- psql -U radar -d radar -tA "$@"; }
# expression "a une citation" / "a un pdf" réutilisée partout
EXC="coalesce(props->'refs'->0->>'excerpt','')<>''"
PDF="(coalesce(props->'refs'->0->>'rawRef','')<>'' OR coalesce(props->'refs'->0->>'docSha','')<>'')"

cmd="${1:-global}"; shift || true
case "$cmd" in
  global)
    PSQL <<SQL
SELECT 'total=' || count(*)
     || '  citation=' || count(*) FILTER (WHERE $EXC)
     || '  pdf=' || count(*) FILTER (WHERE $PDF)
     || '  complets=' || count(*) FILTER (WHERE $EXC AND $PDF)
     || '  (' || round(100.0*count(*) FILTER (WHERE $EXC AND $PDF)/nullif(count(*),0),1) || '%)'
FROM graph_nodes WHERE type IN ('Signal','DesignationEvent');
SQL
    ;;
  city)
    slug="${1:?usage: preuve.sh city <slug>}"
    PSQL <<SQL
SELECT left(coalesce(props->>'label',id),60)
     || '  | citation=' || ($EXC)
     || '  | pdf=' || ($PDF)
     || '  | link=' || coalesce(props->'refs'->0->>'linkSource','-')
FROM graph_nodes WHERE city_slug='$slug' AND type IN ('Signal','DesignationEvent') ORDER BY 1;
SQL
    ;;
  cities)
    [ "$#" -ge 1 ] || { echo "usage: preuve.sh cities <slug> [slug…]"; exit 1; }
    list=$(printf "'%s'," "$@"); list="${list%,}"
    PSQL <<SQL
SELECT city_slug
     || ': complets ' || count(*) FILTER (WHERE $EXC AND $PDF) || '/' || count(*)
     || ' (cit ' || count(*) FILTER (WHERE $EXC) || ', pdf ' || count(*) FILTER (WHERE $PDF) || ')'
FROM graph_nodes WHERE city_slug IN ($list) AND type IN ('Signal','DesignationEvent')
GROUP BY city_slug ORDER BY city_slug;
SQL
    ;;
  reproject)
    job="radar-reproj-$(date +%H%M%S)"
    kubectl create job "$job" --from=cronjob/radar-refresh-projection -n "$NS"
    kubectl wait --for=condition=complete "job/$job" -n "$NS" --timeout=900s
    echo "--- global après projection ---"
    bash "$0" global
    ;;
  reproject-city)
    slug="${1:?usage: preuve.sh reproject-city <slug>}"
    job="radar-reproj-${slug}-$(date +%H%M%S)"
    kubectl get cronjob radar-refresh-projection -n "$NS" -o json \
      | JOB="$job" NS="$NS" SLUG="$slug" python3 -c 'import json,sys,os; cj=json.load(sys.stdin); job={"apiVersion":"batch/v1","kind":"Job","metadata":{"name":os.environ["JOB"],"namespace":os.environ["NS"]},"spec":cj["spec"]["jobTemplate"]["spec"]}; c=job["spec"]["template"]["spec"]["containers"][0]; c["command"]=["node","dist/scripts/project-graph-from-s3.js",os.environ["SLUG"]]; c.pop("args",None); print(json.dumps(job))' \
      | kubectl apply -f -
    kubectl wait --for=condition=complete "job/$job" -n "$NS" --timeout=300s
    echo "--- ville après projection ---"
    bash "$0" cities "$slug"
    echo "--- global après projection ---"
    bash "$0" global
    ;;
  *)
    echo "usage: preuve.sh {global | city <slug> | cities <slug…> | reproject | reproject-city <slug>}"; exit 1 ;;
esac
