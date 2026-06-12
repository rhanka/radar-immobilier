#!/usr/bin/env bash
# mount-scw.sh — Monte le bucket SCW Object Storage en lecture seule via rclone
#
# Usage:
#   ./scripts/mount-scw.sh
#
# Variables d'environnement (lues depuis .env, surchargeables) :
#   SCW_MOUNT_DIR   — point de montage (défaut : /tmp/scw-docs)
#
# Prérequis : rclone installé, .env présent à la racine du repo
#
# Le montage est read-only ; les creds ne sont jamais écrits dans le repo.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# 1. Source .env
set -a
. "${SCRIPT_DIR}/../.env"
set +a

# 2. Vérifier que rclone est disponible
if ! command -v rclone &>/dev/null; then
  echo "Erreur : rclone n'est pas installé ou pas dans le PATH." >&2
  exit 1
fi

# 3. Point de montage (overridable)
MOUNT_DIR="${SCW_MOUNT_DIR:-/tmp/scw-docs}"

# 4. Créer le répertoire si inexistant
mkdir -p "$MOUNT_DIR"

# 5. Déjà monté ?
if mountpoint -q "$MOUNT_DIR"; then
  echo "Déjà monté : $MOUNT_DIR"
  exit 0
fi

# 6. Fichier de config rclone temporaire (PID-unique, supprimé en fin de script)
RCLONE_CONF="/tmp/rclone-scw-$$.conf"

cat >"$RCLONE_CONF" <<EOF
[scw-ro]
type = s3
provider = Scaleway
access_key_id = ${SCRAPE_S3_ACCESS_KEY}
secret_access_key = ${SCRAPE_S3_SECRET_KEY}
endpoint = s3.fr-par.scw.cloud
region = fr-par
no_check_bucket = true
EOF

# 7. Lancer rclone mount en daemon
rclone mount "scw-ro:${SCRAPE_S3_BUCKET}" "$MOUNT_DIR" \
  --config "$RCLONE_CONF" \
  --read-only \
  --vfs-cache-mode minimal \
  --dir-cache-time 1h \
  --poll-interval 1m \
  --log-level INFO \
  --log-file /tmp/rclone-scw.log \
  --daemon

# 8. Attendre puis vérifier
sleep 2
if mountpoint -q "$MOUNT_DIR"; then
  echo "Montage réussi : $MOUNT_DIR"
else
  echo "Erreur : le montage a échoué. Consultez /tmp/rclone-scw.log" >&2
  rm -f "$RCLONE_CONF"
  exit 1
fi

# 9. Afficher le chemin et suggestion d'exploration
echo "Chemin de montage : $MOUNT_DIR"
echo "Pour explorer : ls \"$MOUNT_DIR/raw/\" | head -5"

# 10. Supprimer le fichier de conf temporaire
rm -f "$RCLONE_CONF"
