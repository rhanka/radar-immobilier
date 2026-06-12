#!/usr/bin/env bash
# umount-scw.sh — Démonte le bucket SCW monté via rclone
#
# Usage:
#   ./scripts/umount-scw.sh
#
# Variables d'environnement :
#   SCW_MOUNT_DIR   — point de montage (défaut : /tmp/scw-docs)

set -euo pipefail

MOUNT_DIR="${SCW_MOUNT_DIR:-/tmp/scw-docs}"

if mountpoint -q "$MOUNT_DIR"; then
  fusermount -u "$MOUNT_DIR"
  echo "Démonté : $MOUNT_DIR"
else
  echo "Non monté : $MOUNT_DIR"
  exit 0
fi
