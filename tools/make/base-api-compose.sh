#!/usr/bin/env bash
write_compose() {
  cat > "$RUN_DIR/compose.yml" <<YAML
name: $PROJECT
services:
  postgres:
    image: postgis/postgis:16-3.4
    # Synthetic databases exercise SQL commits, never PostgreSQL crash durability.
    command: postgres -c max_wal_size=64MB -c min_wal_size=32MB -c fsync=off -c synchronous_commit=off
    mem_limit: 2g
    labels: {org.radar.base.owner: "$OWNER"}
    tmpfs: [/var/lib/postgresql/data:size=1536m]
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
    mem_limit: 4g
    tmpfs: [/tmp:size=512m]
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
      S3_ENDPOINT: http://minio:9000
      DOTENV_CONFIG_PATH: /dev/null
    entrypoint: []
volumes:
  runtime:
    driver_opts:
      type: tmpfs
      device: tmpfs
      o: size=1536m
    labels: {org.radar.base.owner: "$OWNER"}
networks:
  default:
    labels: {org.radar.base.owner: "$OWNER"}
YAML
  if [[ ${ACTION:-} == ci-api || ${ACTION:-} == test-api ]]; then
    cat > "$RUN_DIR/ci.yml" <<YAML
services:
  minio:
    image: adobe/s3mock:3.12.0
    mem_limit: 512m
    labels: {org.radar.base.owner: "$OWNER"}
    environment:
      COM_ADOBE_TESTING_S3MOCK_HTTPPORT: '9000'
      initialBuckets: radar-immobilier-raw,radar-immobilier-docs
      JAVA_TOOL_OPTIONS: '-Xms64m -Xmx256m'
    healthcheck:
      test: [CMD-SHELL, 'wget -q -O /dev/null http://localhost:9000/favicon.ico || exit 1']
      interval: 2s
      retries: 45
YAML
    compose+=(-f "$RUN_DIR/ci.yml")
  fi
}
