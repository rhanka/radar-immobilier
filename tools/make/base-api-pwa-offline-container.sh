#!/usr/bin/env bash
# Run the real local system tools through their own loader; keep Node isolated.
mkdir -p /pwa-tools /pwa-bin /pwa-npm-cache/_cacache
tar -xf /offline-tools.tar -C /pwa-tools
cp -a /offline-npm-seed/. /pwa-npm-cache/_cacache/
for tool in curl jq; do
  printf '#!/bin/bash\nexec /pwa-tools/lib64/ld-linux-x86-64.so.2 --library-path /pwa-tools/usr/lib/x86_64-linux-gnu:/pwa-tools/lib/x86_64-linux-gnu /pwa-tools/usr/bin/%s "$@"\n' "$tool" > "/pwa-bin/$tool"
  chmod 755 "/pwa-bin/$tool"
  ln -sf "/pwa-bin/$tool" "/usr/bin/$tool"
done
export PATH=/pwa-bin:$PATH
export npm_config_offline=true npm_config_cache=/pwa-npm-cache
curl --version > /evidence/system-package-versions.txt
jq --version >> /evidence/system-package-versions.txt
