# Déclenchement manuel du refresh PV en préprod

En préprod (`radar-immobilier-preprod`), le CronJob `radar-refresh-pv` est configuré avec `spec.suspend: true` dans `deploy/k8s/refresh-cronjobs/kustomization.yaml`.

La restauration quotidienne prod → préprod (`bascule-preprod`) fournit déjà les données à jour. Couper les passages planifiés en préprod évite un coût LLM redondant. Le gardien `radar-refresh-pending-watchdog` reste actif (`spec.suspend: false`), et la production (`radar-immobilier`) reste inchangée (`spec.suspend: false`).

## Lancer un passage ponctuel en préprod

Un CronJob Kubernetes suspendu (`spec.suspend: true`) n'exécute plus son calendrier, mais reste un gabarit valide pour créer un Job manuel :

```bash
kubectl --kubeconfig "$KUBECONFIG_PREPROD" -n radar-immobilier-preprod \
  create job "radar-refresh-pv-manual-$(date -u +%Y%m%d%H%M%S)" \
  --from=cronjob/radar-refresh-pv
```

Équivalent via la cible dédiée de `refresh-018.mk` :

```bash
make -f deploy/k8s/refresh-cronjobs/refresh-018.mk trigger-preprod \
  KUBECONFIG="$KUBECONFIG_PREPROD" PREPROD_CONFIRM=1 \
  RUN_ID="manual-$(date -u +%Y%m%d%H%M%S)" ENV=preprod
```

## Compatibilité vérifiée

- **Restauration quotidienne (`bascule-preprod`)** : ne dépend pas du CronJob `radar-refresh-pv` (`.github/workflows/bascule-preprod.yml:79`). Le contrôleur de bascule capture l'état initial `spec.suspend` de chaque CronJob et laisse les CronJobs initialement suspendus à `suspend: true` lors de la réouverture (`deploy/cutover/README.md:232`).
- **Reprise de classification préprod (`make reannotate-signals-preprod`)** : `tools/make/reannotate-signals-preprod.sh:55` crée son Job depuis `--from=cronjob/radar-refresh-pv --dry-run=client -o json` puis `kubectl create -f`. Le gabarit du CronJob suspendu fonctionne sans modification.
