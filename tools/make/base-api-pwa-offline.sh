#!/usr/bin/env bash
# Seed disposable tools and npm storage without changing the host cache.
[[ $(uname -m) == x86_64 ]]
PWA_NPM_SEED=${PWA_NPM_SEED:-${XDG_CACHE_HOME:-$HOME/.cache}/radar-a5-npm/_cacache}
[[ -d $PWA_NPM_SEED && ! -L $PWA_NPM_SEED ]]
mapfile -t libraries < <(ldd /usr/bin/curl /usr/bin/jq |
  awk '/=> \// {print $3} /^[[:space:]]*\/.*ld-linux/ {print $1}' | sort -u)
[[ ${#libraries[@]} -gt 0 ]]
for library in "${libraries[@]}"; do
  case $library in /usr/lib/*|/lib/*|/lib64/*) ;; *) exit 2;; esac
  [[ -f $library ]]
done
inputs=(/usr/bin/curl /usr/bin/jq "${libraries[@]}")
sha256sum "${inputs[@]}" > "$LOG_DIR/offline-system-inputs.sha256"
dpkg-query -W curl jq > "$LOG_DIR/offline-system-packages.txt"
tar -C / --dereference -cf "$RUN_DIR/offline-tools.tar" "${inputs[@]#/}"
sha256sum "$RUN_DIR/offline-tools.tar" > "$LOG_DIR/offline-tools.sha256"
cat > "$RUN_DIR/offline.yml" <<YAML
services:
  api:
    volumes:
      - $RUN_DIR/offline-tools.tar:/offline-tools.tar:ro
      - $PWA_NPM_SEED:/offline-npm-seed:ro
    tmpfs: ["/pwa-npm-cache:size=2048m"]
    environment:
      PWA_OFFLINE: '1'
YAML
compose+=(-f "$RUN_DIR/offline.yml")
