# Déclenchement à la demande du refresh PV en préprod

En préprod (`radar-immobilier-preprod`), le CronJob `radar-refresh-pv` tourne **1 fois par jour à `06:00` UTC** (`spec.schedule: "0 6 * * *"`, `timeZone: "Etc/UTC"`, `spec.suspend: false`) dans `deploy/k8s/refresh-cronjobs/kustomization.yaml`.

Cette cadence est définie par la décision owner documentée dans `docs/decisions/2026-11-20-refresh-preprod-1-par-jour.md`. Le gardien `radar-refresh-pending-watchdog` reste actif (`spec.suspend: false`), et la production (`radar-immobilier`) reste inchangée à 4 passages par jour (`0 5,11,17,23 * * *`, `Etc/UTC`, `spec.suspend: false`).

## Lancer un passage à la demande en préprod

### 1. Via GitHub Actions (méthode recommandée)

Le workflow manuel `.github/workflows/bascule-refresh.yml` (« `bascule-refresh (force preprod refresh)` ») pose le verrou writer, exécute un Job `radar-refresh-pv` à la demande via `tools/make/cutover.sh force-refresh`, puis libère le verrou :

```bash
gh workflow run bascule-refresh.yml -f RUN=true
```

### 2. Directement depuis le CronJob Kubernetes

Un Job ponctuel peut aussi être créé directement depuis le gabarit du CronJob :

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

- **Déclenchement forcé (`bascule-refresh`)** : `.github/workflows/bascule-refresh.yml` appelle `tools/make/cutover.sh force-refresh`, qui exécute `run_job refresh 19800 21600` indépendamment de la fréquence du CronJob.
- **Restauration quotidienne (`bascule-preprod`)** : la fenêtre `0 4 * * *` UTC reste compatible avec `bascule-window.awk` (le refresh préprod démarre à `06:00` UTC, soit 2 h après la fenêtre de restauration ; la prod démarre à `05:00` UTC, soit 1 h après). Le workflow reste désactivé à la main depuis fin octobre 2026 conformément à `docs/decisions/2026-11-20-refresh-preprod-1-par-jour.md`.
- **Reprise de classification préprod (`make reannotate-signals-preprod`)** : `tools/make/reannotate-signals-preprod.sh:55` crée son Job depuis `--from=cronjob/radar-refresh-pv --dry-run=client -o json` puis `kubectl create -f`, sans dépendance sur le calendrier du CronJob.
