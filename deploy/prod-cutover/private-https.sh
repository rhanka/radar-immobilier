#!/usr/bin/env bash
# Local TLS bypass. No public Ingress is changed.
private_https() {
  local name value deadline=$((SECONDS+30)) ui api mcp image
  for name in TLS_CERT TLS_KEY CONTENT_TLS_CERT CONTENT_TLS_KEY; do
    value=${!name:-}
    [[ $value == /* && -f $value && ! -L $value && $value != */.env* ]] || fail 'Fichier TLS privé explicite requis'
  done
  [[ ${ARTIFACTS_CONTENT_HOST:-} =~ ^[a-z0-9.-]+$ ]] || fail 'Hôte de contenu requis'
  start_forward radar-ui :8080 "$WORK/private-ui"
  start_forward radar-api :3000 "$WORK/private-api"
  start_forward radar-immo-mcp :8848 "$WORK/private-mcp"
  for name in ui api mcp; do
    until grep -q 'Forwarding from 127.0.0.1:' "$WORK/private-$name"; do
      ((SECONDS<deadline)) || fail 'Port-forward privé indisponible'
      sleep 1
    done
  done
  ui=$(sed -nE 's/.*127.0.0.1:([0-9]+) ->.*/\1/p' "$WORK/private-ui" | head -1)
  api=$(sed -nE 's/.*127.0.0.1:([0-9]+) ->.*/\1/p' "$WORK/private-api" | head -1)
  mcp=$(sed -nE 's/.*127.0.0.1:([0-9]+) ->.*/\1/p' "$WORK/private-mcp" | head -1)
  cat > "$WORK/private-nginx.conf" <<EOF
pid /tmp/nginx.pid;
error_log /dev/null;
events {}
http {
  access_log off;
  client_body_temp_path /tmp/body;
  proxy_temp_path /tmp/proxy;
  fastcgi_temp_path /tmp/fastcgi;
  uwsgi_temp_path /tmp/uwsgi;
  scgi_temp_path /tmp/scgi;
  server {
    listen 127.0.0.2:443 ssl;
    server_name immo.sent-tech.ca;
    ssl_certificate /private/app.crt;
    ssl_certificate_key /private/app.key;
    location / { proxy_pass http://127.0.0.1:$ui; proxy_set_header Host \$host; proxy_set_header X-Forwarded-Proto https; }
    location /api/ { proxy_pass http://127.0.0.1:$api; proxy_set_header Host \$host; proxy_set_header X-Forwarded-Proto https; }
    location /mcp { proxy_pass http://127.0.0.1:$mcp; proxy_set_header Host \$host; proxy_set_header X-Forwarded-Proto https; proxy_buffering off; }
    location = /.well-known/oauth-protected-resource/mcp { proxy_pass http://127.0.0.1:$mcp/mcp/.well-known/oauth-protected-resource; }
  }
  server {
    listen 127.0.0.2:443 ssl;
    server_name .$ARTIFACTS_CONTENT_HOST;
    ssl_certificate /private/content.crt;
    ssl_certificate_key /private/content.key;
    location / { proxy_pass http://127.0.0.1:$api; proxy_set_header Host \$host; proxy_set_header X-Forwarded-Proto https; }
  }
}
EOF
  image=$(jq -r .release.uiImage "$WORK/record.json")
  # The existing supervised container launcher handles TERM/KILL and removal.
  CUTOVER_CONTAINER_TIMEOUT=1100 bash deploy/prod-cutover/run-container.sh "$RUN" run --rm --pull=never \
    --name "immo-private-$RUN" --user 0:0 --network=host --read-only --tmpfs /tmp \
    --cap-drop=ALL --cap-add=NET_BIND_SERVICE --cap-add=DAC_OVERRIDE --cap-add=CHOWN \
    --cap-add=SETUID --cap-add=SETGID --security-opt=no-new-privileges \
    --label "ca.sent-tech.immo.cutover-run=$RUN" \
    -v "$WORK/private-nginx.conf:/private/nginx.conf:ro" \
    -v "$TLS_CERT:/private/app.crt:ro" -v "$TLS_KEY:/private/app.key:ro" \
    -v "$CONTENT_TLS_CERT:/private/content.crt:ro" -v "$CONTENT_TLS_KEY:/private/content.key:ro" \
    --entrypoint nginx "$image" -c /private/nginx.conf -g 'daemon off;'
}
