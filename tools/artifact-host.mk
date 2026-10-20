# Artifact storage/publication test runner (861c lots H1+H2).
#
# Standalone entry point: it NEVER includes the root Makefile (which reads
# .env) and NEVER extends a compose file with `env_file`. Every compose
# invocation runs with COMPOSE_DISABLE_ENV_FILE=1 and an explicit
# --env-file /dev/null. Host-inherited overrides below are emptied so compose
# `${VAR:-default}` interpolation falls back to the synthetic defaults in
# docker-compose.yml; only those defaults plus the exported test ports and
# ARTIFACTS_CONTENT_BASE reach the containers. Any ENV outside test-*/e2e-*
# is refused.
#
# Usage (lot H2):
#   make -f tools/artifact-host.mk test-host SCOPE=src/artifacts API_PORT=18897 UI_PORT=15897 MAILDEV_UI_PORT=11897 ENV=test-861c-h2
#   make -f tools/artifact-host.mk test-host API_PORT=18897 UI_PORT=15897 MAILDEV_UI_PORT=11897 ENV=test-861c-h2
#   make -f tools/artifact-host.mk test-mcp API_PORT=18897 UI_PORT=15897 MAILDEV_UI_PORT=11897 ENV=test-861c-h2
#   make -f tools/artifact-host.mk typecheck API_PORT=18897 UI_PORT=15897 MAILDEV_UI_PORT=11897 ENV=test-861c-h2
#   make -f tools/artifact-host.mk lint API_PORT=18897 UI_PORT=15897 MAILDEV_UI_PORT=11897 ENV=test-861c-h2
#   make -f tools/artifact-host.mk image-smoke API_PORT=18897 UI_PORT=15897 MAILDEV_UI_PORT=11897 ENV=test-861c-h2
#   make -f tools/artifact-host.mk down API_PORT=18897 UI_PORT=15897 MAILDEV_UI_PORT=11897 ENV=test-861c-h2

SHELL := /bin/bash

ENV ?=
SCOPE ?=
API_PORT ?= 18895
UI_PORT ?= 15895
MAILDEV_UI_PORT ?= 11895
ARTIFACTS_CONTENT_BASE ?=
ARTIFACTS_TEST_CONFIG ?= 0
export API_PORT UI_PORT MAILDEV_UI_PORT ARTIFACTS_CONTENT_BASE
export COMPOSE_PROJECT_NAME := radar-$(ENV)
export COMPOSE_DISABLE_ENV_FILE := 1
export BUILDX_CONFIG := $(CURDIR)/tmp/artifact-host-buildx

# Neutralize host-inherited values that docker-compose.yml interpolates into
# the api container (which runs npm ci): empty forces each `${VAR:-default}`
# to its synthetic default instead of a caller-shell secret or override.
export POSTGRES_USER :=
export POSTGRES_PASSWORD :=
export POSTGRES_DB :=
export S3_REGION :=
export S3_BUCKET :=
export S3_ACCESS_KEY :=
export S3_SECRET_KEY :=
export OPENAI_API_KEY :=
export ANTHROPIC_API_KEY :=
export GEMINI_API_KEY :=
export GOOGLE_API_KEY :=
export MISTRAL_API_KEY :=
export COHERE_API_KEY :=

DOCKER_COMPOSE ?= docker compose
COMPOSE_FILES := -f docker-compose.yml -f docker-compose.test.yml
COMPOSE := $(DOCKER_COMPOSE) --env-file /dev/null $(COMPOSE_FILES)
TEST_ARTIFACT_ENV := $(if $(filter 1,$(ARTIFACTS_TEST_CONFIG)),-e ARTIFACTS_STORAGE_SCOPE=h2_suite -e ARTIFACTS_ORG_ID=h2_org -e ARTIFACTS_S3_BUCKET=h2-artifacts-suite -e ARTIFACTS_S3_ENDPOINT=http://minio:9000 -e ARTIFACTS_S3_REGION=us-east-1 -e ARTIFACTS_S3_ACCESS_KEY=test-access -e ARTIFACTS_S3_SECRET_KEY=test-secret -e ARTIFACTS_CONTENT_BASE=pages.example.test,)

.PHONY: guard-env
guard-env:
	@case "$(ENV)" in \
	  test-*|e2e-*) ;; \
	  *) echo "[artifact-host] refused: ENV must be test-* or e2e-*, got '$(ENV)'" >&2; exit 1;; \
	esac

.PHONY: test-api
test-api: guard-env ## Run API tests (SCOPE=<path> for scoped runs)
	@trap '$(COMPOSE) down -v --remove-orphans >/dev/null 2>&1 || true' EXIT INT TERM; \
	$(COMPOSE) up -d postgres minio && \
	$(COMPOSE) run --rm -T -e ARTIFACTS_CONTENT_BASE $(TEST_ARTIFACT_ENV) api sh -c "npm ci && npm run db:migrate --workspace=api && npm run test --workspace=api $(if $(SCOPE),-- $(SCOPE),)"

.PHONY: test-host
test-host: guard-env ## Run artifact storage/publication suites (SCOPE=<path> filters the api suite only)
	@trap '$(COMPOSE) down -v --remove-orphans >/dev/null 2>&1 || true' EXIT INT TERM; \
	$(COMPOSE) up -d postgres minio && \
	$(COMPOSE) run --rm -T -e ARTIFACTS_CONTENT_BASE $(TEST_ARTIFACT_ENV) api sh -c "npm ci && npm run db:migrate --workspace=api && npm run test --workspace=@radar/artifacts-host && npm run test --workspace=api $(if $(SCOPE),-- $(SCOPE),)"

.PHONY: test-mcp
test-mcp: guard-env ## Run the immo-mcp workspace suites
	@trap '$(COMPOSE) down -v --remove-orphans >/dev/null 2>&1 || true' EXIT INT TERM; \
	$(COMPOSE) run --rm --no-deps -T api sh -c "npm ci && npm run test --workspace=@radar/immo-mcp"

.PHONY: image-smoke
image-smoke: guard-env ## Build --target build, refuse .env*, smoke-boot API+MCP bundles, check api/drizzle
	@set -e; trap 'docker image rm radar-artifact-host-smoke:local >/dev/null 2>&1 || true' EXIT INT TERM; \
	if test -n "$$(find . -name '.env*' ! -name '.env.example' -print -quit)"; then \
	  echo "[artifact-host] refused: .env* present in build context" >&2; exit 1; fi; \
	docker build --target build -t radar-artifact-host-smoke:local -f api/Dockerfile .; \
	docker run --rm radar-artifact-host-smoke:local sh -c 'test -s /workspace/api/drizzle/0015_artifacts_core.sql && test -s /workspace/api/drizzle/0016_artifacts_lifecycle.sql && echo "[artifact-host] api/drizzle present in image"'; \
	status=0; docker run --rm -e PORT=18999 radar-artifact-host-smoke:local sh -c "timeout 6 node api/dist/index.js" || status=$$?; test $$status -eq 124; \
	status=0; docker run --rm -e IMMO_MCP_OAUTH_ISSUER=https://idp.example -e IMMO_MCP_OAUTH_RESOURCE=https://immo.example/mcp -e IMMO_MCP_HTTP_PORT=18848 -e IMMO_MCP_DATA_MODE=mock radar-artifact-host-smoke:local sh -c "timeout 5 node packages/immo-mcp/dist/server-http.js" || status=$$?; test $$status -eq 124

.PHONY: typecheck lint
typecheck: guard-env ## Typecheck all workspaces using only the test stack
	@trap '$(COMPOSE) down -v --remove-orphans >/dev/null 2>&1 || true' EXIT INT TERM; \
	$(COMPOSE) run --rm --no-deps -T api sh -c "npm ci && npm run typecheck --workspaces --if-present"

lint: guard-env ## Lint the workspace using only the test stack
	@trap '$(COMPOSE) down -v --remove-orphans >/dev/null 2>&1 || true' EXIT INT TERM; \
	$(COMPOSE) run --rm --no-deps -T api sh -c "npm ci && npx eslint . --ignore-pattern 'tmp/**'"

.PHONY: down
down: guard-env ## Stop the stack and remove volumes/orphans
	$(COMPOSE) down -v --remove-orphans

.PHONY: inspect
inspect: guard-env
	docker ps -a --filter label=com.docker.compose.project=radar-$(ENV)
	docker volume ls --filter label=com.docker.compose.project=radar-$(ENV)
	docker network ls --filter label=com.docker.compose.project=radar-$(ENV)
