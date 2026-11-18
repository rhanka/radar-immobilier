#!/usr/bin/env bash
# Every pod template applied by bascule-bundle-cd.yml must set
# automountServiceAccountToken: false: none of these pods calls the
# Kubernetes API (pg_dump, psql, Node S3 only), so the default SA token
# must never be mounted. Usage: check-bascule-automount.sh [file ...]
set -euo pipefail
if [[ $# -gt 0 ]]; then files=("$@"); else
  files=(
    deploy/ci/bascule-preprod/db-ro-role-provision.yaml
    deploy/ci/bascule-preprod/cronjob-db-backup-prod.yaml
    deploy/ci/backup/cronjob-backup-daily.yaml
    deploy/ci/backup/cronjob-backup-freshness.yaml
  )
fi
bad=0
for f in "${files[@]}"; do
  [[ -f $f ]] || { echo "automount guard: missing file: $f" >&2; bad=1; continue; }
  grep -Eq 'kind: (Job|CronJob)' "$f" || { echo "automount guard: $f has no Job/CronJob" >&2; bad=1; continue; }
  if ! grep -Eq '^[[:space:]]*automountServiceAccountToken: false[[:space:]]*$' "$f"; then
    echo "automount guard: $f does not set automountServiceAccountToken: false on its pod template" >&2
    bad=1
  fi
done
[[ $bad -eq 0 ]] || exit 1
echo "automount guard: ok (${#files[@]} pod templates, automount false)"
