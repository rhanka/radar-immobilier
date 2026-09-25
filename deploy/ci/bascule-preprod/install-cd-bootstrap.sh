#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Install one-time — bascule prod CD-native v2. OPS-3 : rejouable + auditable.
# Exécuté UNE fois par la lane k8s (cluster-admin), owner-direct. L'owner n'exécute
# AUCUN kubectl : cet acte est CE SCRIPT COMMITTÉ (la trace = le code), pas un ad-hoc.
# 0 python. Les VALEURS (tokens) ne sont JAMAIS committées : le script les minte
# in-cluster puis les pose en GH secrets (jamais imprimées sur stdout).
#
# Mécanisme token = LEGACY SA token secret (type kubernetes.io/service-account-token,
#   NON-expirant), identique aux déployeurs existants du cluster (ci-deployer-token,
#   radar-ci-deployer-preprod-token ; k8s 1.31). Pas d'expiration → 0 rotation
#   (le token bound `kubectl create token` est plafonné/expirant, écarté ici pour
#   un cred CD permanent, comme les autres déployeurs).
#
# Pré-requis : KUBECONFIG=<admin> exporté ; `gh` authentifié (repo+workflow) ;
#   #747 (bundle CD-native-v2) mergée dans main.
# Idempotent : apply/`gh secret set`/`gh variable set` écrasent ; delete = --ignore-not-found.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail
: "${KUBECONFIG:?export KUBECONFIG=<admin kubeconfig> requis}"
REPO=rhanka/radar-immobilier
NS=radar-immobilier
BUNDLE=deploy/ci/bascule-preprod
SERVER="$(kubectl config view --minify -o jsonpath='{.clusters[0].cluster.server}')"

# Minte un legacy SA token secret pour la SA $1, construit le kubeconfig et l'imprime
# en base64 sur STDOUT (à piper dans `gh secret set` — la valeur ne s'affiche jamais).
mint_kubeconfig_b64() {
  local sa="$1" sec="${1}-token"
  kubectl -n "$NS" apply -f - >&2 <<YAML
apiVersion: v1
kind: Secret
metadata: { name: ${sec}, namespace: ${NS}, annotations: { kubernetes.io/service-account.name: ${sa} } }
type: kubernetes.io/service-account-token
YAML
  local i tok=""
  for i in $(seq 1 30); do
    tok="$(kubectl -n "$NS" get secret "$sec" -o jsonpath='{.data.token}' 2>/dev/null || true)"
    [ -n "$tok" ] && break; sleep 2
  done
  [ -n "$tok" ] || { echo "FATAL: token ${sec} non peuplé" >&2; return 1; }
  local ca; ca="$(kubectl -n "$NS" get secret "$sec" -o jsonpath='{.data.ca\.crt}')"
  printf 'apiVersion: v1\nkind: Config\nclusters:\n- name: ovh\n  cluster: { server: %s, certificate-authority-data: %s }\ncontexts:\n- name: c\n  context: { cluster: ovh, user: u, namespace: %s }\ncurrent-context: c\nusers:\n- name: u\n  user: { token: %s }\n' \
    "$SERVER" "$ca" "$NS" "$(printf %s "$tok" | base64 -d)" | base64 -w0
}

echo "== 1) apply RBAC SA CD permanent radar-ci-bascule-prod (VAP ClusterRole + Role ns + impersonate) =="
kubectl apply -f "$BUNDLE/rbac-ci-bascule-prod.yaml"

echo "== 2) mint legacy token radar-ci-bascule-prod -> GH secret KUBE_CONFIG_DATA_PROD (valeur non imprimée) =="
mint_kubeconfig_b64 radar-ci-bascule-prod | gh secret set KUBE_CONFIG_DATA_PROD --repo "$REPO"

echo "== 3) arm apply-au-merge =="
gh variable set BASCULE_BUNDLE_CD_ENABLED --repo "$REPO" --body true

echo "== 4) dispatch bascule-bundle-cd (applique le bundle en prod) + attente (gate anti-RCE inclus) =="
gh workflow run bascule-bundle-cd.yml --repo "$REPO"
sleep 6
RID="$(gh run list --repo "$REPO" --workflow bascule-bundle-cd.yml -L1 --json databaseId --jq '.[0].databaseId')"
echo "   run id=$RID"
gh run watch "$RID" --repo "$REPO" --exit-status   # échoue (set -e) si l'apply/gate échoue

echo "== 5) le bundle a créé la SA trigger : mint legacy token radar-ci-trigger-prod -> KUBE_CONFIG_DATA_PROD_TRIGGER =="
mint_kubeconfig_b64 radar-ci-trigger-prod | gh secret set KUBE_CONFIG_DATA_PROD_TRIGGER --repo "$REPO"

echo "== 6) arm run planifié (03:17 UTC) =="
gh variable set BASCULE_SCHEDULE_ENABLED --repo "$REPO" --body true

echo "== 7) cleanup dormants (superseded par CD-native-v2) =="
# k8s : SA de bootstrap éphémère + accès exécuteur i-infra (le CD applique désormais).
kubectl -n "$NS" delete sa,role,rolebinding radar-ci-setup-prod --ignore-not-found
kubectl delete clusterrole,clusterrolebinding radar-ci-setup-prod-vap --ignore-not-found
kubectl -n "$NS" delete sa,role,rolebinding radar-intratenant-executor --ignore-not-found
kubectl -n "$NS" delete secret radar-ci-setup-prod-token --ignore-not-found
# GH secrets superseded (les creds arrivent en SealedSecrets committées ; vérifié : aucun workflow ne les référence).
for s in KUBE_CONFIG_DATA_PROD_SETUP RADAR_DB_RO_PROD_PASSWORD RADAR_PRA_ADMIN_PROD_ACCESS_KEY RADAR_PRA_ADMIN_PROD_SECRET_KEY; do
  gh secret delete "$s" --repo "$REPO" 2>/dev/null || true
done
echo "== install one-time TERMINÉE — CD-native v2 armé (apply-au-merge + run planifié). 0 owner désormais. =="
