#!/usr/bin/env bash
image_compose() {
  : > "$LOG_DIR/termination.json"
  chmod 666 "$LOG_DIR/termination.json"
  cat > "$RUN_DIR/compose.yml" <<YAML
name: $PROJECT
services:
  postgres:
    image: postgis/postgis:16-3.4
    mem_limit: 1g
    labels: {org.radar.base.owner: "$OWNER"}
    tmpfs: [/var/lib/postgresql/data:size=768m]
    environment:
      POSTGRES_USER: radar
      POSTGRES_PASSWORD: synthetic-only
      POSTGRES_DB: radar
    healthcheck:
      test: [CMD-SHELL, "pg_isready -U radar -d radar"]
      interval: 2s
      retries: 30
  api:
    image: radar-base-preprod-p1o1:qualified
    mem_limit: 512m
    labels: {org.radar.base.owner: "$OWNER"}
    working_dir: /workspace
    entrypoint: [node, /workspace/image-proof.mjs]
    volumes:
      - $ROOT/tools/make/base-preprod-image-proof.mjs:/workspace/image-proof.mjs:ro
      - $LOG_DIR/termination.json:/dev/termination-log
    environment:
      NODE_ENV: test
      LOG_LEVEL: silent
      POSTGRES_HOST: postgres
      POSTGRES_USER: radar
      POSTGRES_PASSWORD: synthetic-only
      POSTGRES_DB: radar
      OPERATOR_IMAGE: local/synthetic-api@$(docker image inspect --format '{{.Id}}' radar-base-preprod-p1o1:qualified)
networks:
  default:
    labels: {org.radar.base.owner: "$OWNER"}
YAML
}
