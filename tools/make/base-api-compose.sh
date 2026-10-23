#!/usr/bin/env bash
write_compose() {
  cat > "$RUN_DIR/compose.yml" <<YAML
name: $PROJECT
services:
  postgres:
    image: postgis/postgis:16-3.4
    labels: {org.radar.base.owner: "$OWNER"}
    tmpfs: [/var/lib/postgresql/data:size=512m]
    environment:
      POSTGRES_USER: radar
      POSTGRES_PASSWORD: synthetic-only
      POSTGRES_DB: radar
      POSTGRES_INITDB_ARGS: --no-sync
    healthcheck:
      test: [CMD-SHELL, "pg_isready -U radar -d radar"]
      interval: 2s
      retries: 30
  api:
    image: node:24-bookworm-slim
    labels: {org.radar.base.owner: "$OWNER"}
    working_dir: /workspace
    volumes:
      - $RUN_DIR/source.tar:/source.tar:ro
      - $LOG_DIR:/evidence
      - runtime:/workspace
    environment:
      NODE_ENV: test
      LOG_LEVEL: silent
      LOT_MIGRATION_DB_TEST: '1'
      POSTGRES_HOST: postgres
      POSTGRES_USER: radar
      POSTGRES_PASSWORD: synthetic-only
      POSTGRES_DB: radar
      S3_ACCESS_KEY: synthetic
      S3_SECRET_KEY: synthetic
      DOTENV_CONFIG_PATH: /dev/null
    entrypoint: []
volumes:
  runtime:
    labels: {org.radar.base.owner: "$OWNER"}
networks:
  default:
    labels: {org.radar.base.owner: "$OWNER"}
YAML
}
