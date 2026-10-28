#!/usr/bin/env bash
image_browser_compose() {
  cat > "$RUN_DIR/browser.yml" <<YAML
services:
  api:
    volumes:
      - $RUN_DIR/tls:/tls:ro
    environment:
      L5_IMAGE_SHA: "$CANDIDATE"
      L5_CONTENT_BASE: "$CONTENT_BASE"
      L5_CERT_SPKI: "$CERT_SPKI"
    networks:
      default:
        aliases: [preprod.auth.sent-tech.ca]
YAML
  compose+=(-f "$RUN_DIR/browser.yml")
}
image_runtime_compose() {
  local database scope
  database=$(jq -er '.database' "$LOG_DIR/fixture-ready.json")
  scope=$(jq -er '.scope' "$LOG_DIR/fixture-ready.json")
  [[ $database =~ ^synthetic_6h_[a-f0-9]+$ && $scope =~ ^l5_[a-f0-9]+$ ]]
  cat > "$RUN_DIR/runtime.yml" <<YAML
services:
  runtime:
    image: $IMAGE_ID
    pull_policy: never
    mem_limit: 2g
    labels: {org.radar.base.owner: "$OWNER"}
    volumes: [$RUN_DIR/tls:/tls:ro]
    environment:
      NODE_ENV: test
      PORT: '3000'
      LOG_LEVEL: warn
      POSTGRES_HOST: postgres
      POSTGRES_USER: radar
      POSTGRES_PASSWORD: synthetic-only
      POSTGRES_DB: "$database"
      S3_ENDPOINT: http://minio:9000
      S3_ACCESS_KEY: synthetic
      S3_SECRET_KEY: synthetic
      S3_BUCKET: radar-immobilier-raw
      SENTROPIC_IDP_ISSUER: https://preprod.auth.sent-tech.ca
      SENTROPIC_IDP_JWKS_URI: https://preprod.auth.sent-tech.ca/jwks
      SENTROPIC_OAUTH_CLIENT_ID: l5-synthetic
      SENTROPIC_OAUTH_CLIENT_SECRET: synthetic-client-secret
      SENTROPIC_OAUTH_REDIRECT_URI: https://preprod.immo.sent-tech.ca/api/v1/auth/oauth/callback
      AUTH_CALLBACK_BASE_URL: https://preprod.immo.sent-tech.ca
      SESSION_SECRET: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
      NODE_EXTRA_CA_CERTS: /tls/cert.pem
      ARTIFACTS_CONTENT_BASE: "$CONTENT_BASE"
      ARTIFACTS_STORAGE_SCOPE: "$scope"
      ARTIFACTS_ORG_ID: l5
      ARTIFACTS_S3_BUCKET: radar-immobilier-raw
      ARTIFACTS_S3_ENDPOINT: http://minio:9000
      ARTIFACTS_S3_REGION: us-east-1
      ARTIFACTS_S3_ACCESS_KEY: synthetic
      ARTIFACTS_S3_SECRET_KEY: synthetic
      ARTIFACTS_CONTROL_MODE: general
      ARTIFACTS_READER_ISSUER: https://preprod.immo.sent-tech.ca
      ARTIFACTS_READER_AUDIENCE: l5-reader
      ARTIFACTS_READER_TIER: preprod
      ARTIFACTS_READER_GRANT_SECRET: rrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrr
      ARTIFACTS_READER_SESSION_SECRET: pppppppppppppppppppppppppppppppppppppppp
      CLASSIFICATION_CURSOR_SECRET: BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc=
      CLASSIFICATION_CURSOR_KEY_ID: l5-image
      PW_IDENTITY_TIER: preprod
      PW_WRITE_GRANT_SECRET: wwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwww
      PW_CHALLENGE_SECRET: cccccccccccccccccccccccccccccccccccccccc
  runtime-base:
    extends: {service: runtime}
    environment:
      ARTIFACTS_CONTENT_BASE: ""
      ARTIFACTS_STORAGE_SCOPE: ""
  runtime-read:
    extends: {service: runtime}
    environment:
      PW_WRITE_GRANT_SECRET: ""
YAML
  compose+=(-f "$RUN_DIR/runtime.yml")
}
