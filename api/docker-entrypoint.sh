#!/bin/sh
# Runtime image entrypoint (861c H3 unit 9): run one bundled service from the
# same image. Only three modes exist; anything else is refused at startup.
# Kubernetes manifests that set `command:` bypass this script entirely.
set -eu
mode="${1-api}"
if [ "$#" -gt 1 ]; then
  echo "[entrypoint] refused: expected one service mode" >&2
  exit 2
fi
case "$mode" in
  api)
    exec node api/dist/index.js
    ;;
  content-reader)
    exec node api/dist/artifacts/content-reader-server.js
    ;;
  content-deny)
    exec node api/dist/artifacts/content-deny-server.js
    ;;
  *)
    echo "[entrypoint] refused: unknown service mode '$mode' (expected 'api', 'content-reader' or 'content-deny')" >&2
    exit 2
    ;;
esac
