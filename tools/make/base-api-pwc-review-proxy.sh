#!/usr/bin/env bash
write_review_proxy_compose() {
  cat > "$RUN_DIR/proxy.yml" <<YAML
services:
  api:
    networks:
      default:
        aliases: [radar-api, geo-api.geo.svc.cluster.local, geo-api.geo-preprod.svc.cluster.local]
YAML
  local kind config
  for kind in compose cluster preprod; do
    case $kind in
      compose) config=ui/nginx/default.conf;;
      cluster) config=deploy/k8s/nginx/default.conf;;
      preprod) config=deploy/overlays/preprod/nginx/default.conf;;
    esac
    cat >> "$RUN_DIR/proxy.yml" <<YAML
  proxy-$kind:
    image: nginx:1.27-alpine
    mem_limit: 128m
    labels: {org.radar.base.owner: "$OWNER"}
    volumes:
      - $ROOT/$config:/etc/nginx/conf.d/default.conf:ro
YAML
  done
  compose+=(-f "$RUN_DIR/proxy.yml")
}
