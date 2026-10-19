# Artifact content-host test runner (861c lot H1).
#
# Standalone entry point: it NEVER includes the root Makefile (which reads
# .env) and NEVER extends a compose file with `env_file`. Every compose
# invocation runs with COMPOSE_DISABLE_ENV_FILE=1 and an explicit
# --env-file /dev/null; only synthetic test values from the process
# environment reach the containers. Any ENV outside test-*/e2e-* is refused.
#
# Usage:
#   make -f tools/artifact-host.mk test-api SCOPE=src/artifacts API_PORT=18895 UI_PORT=15895 MAILDEV_UI_PORT=11895 ENV=test-861c-h1
#   make -f tools/artifact-host.mk down API_PORT=18895 UI_PORT=15895 MAILDEV_UI_PORT=11895 ENV=test-861c-h1

SHELL := /bin/bash

ENV ?=
SCOPE ?=
API_PORT ?= 18895
UI_PORT ?= 15895
MAILDEV_UI_PORT ?= 11895
ARTIFACTS_CONTENT_BASE ?=
export API_PORT UI_PORT MAILDEV_UI_PORT ARTIFACTS_CONTENT_BASE
export COMPOSE_PROJECT_NAME := radar-$(ENV)
export COMPOSE_DISABLE_ENV_FILE := 1

DOCKER_COMPOSE ?= docker compose
COMPOSE_FILES := -f docker-compose.yml -f docker-compose.test.yml
COMPOSE := $(DOCKER_COMPOSE) --env-file /dev/null $(COMPOSE_FILES)

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
	$(COMPOSE) run --rm -T -e ARTIFACTS_CONTENT_BASE api sh -c "npm ci && npm run db:migrate --workspace=api && npm run test --workspace=api $(if $(SCOPE),-- $(SCOPE),)"

.PHONY: typecheck lint
typecheck: guard-env ## Typecheck all workspaces using only the test stack
	$(COMPOSE) run --rm --no-deps -T api sh -c "npm ci && npm run typecheck --workspaces --if-present"

lint: guard-env ## Lint the workspace using only the test stack
	$(COMPOSE) run --rm --no-deps -T api sh -c "npm ci && npx eslint ."

.PHONY: down
down: guard-env ## Stop the stack and remove volumes/orphans
	$(COMPOSE) down -v --remove-orphans
