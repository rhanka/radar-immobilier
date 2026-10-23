# H5 reader runner (ARTEFACTS A6).
#
# Standalone entry point: it NEVER includes the root Makefile (which reads
# .env) and NEVER extends a compose file with `env_file`. Every compose
# invocation runs with COMPOSE_DISABLE_ENV_FILE=1 and an explicit
# --env-file /dev/null. Host-inherited overrides below are emptied so compose
# `${VAR:-default}` interpolation falls back to synthetic defaults; only
# those defaults plus the exported test ports reach the containers. Any ENV
# outside test-*/e2e-* is refused. No Python anywhere.
#
# Usage (Sol executes, ENV last):
#   make -f tools/h5-artifacts.mk test-reader-discovery API_PORT=18946 UI_PORT=15946 MAILDEV_UI_PORT=11946 ENV=test-artefacts-mcp-a6
#   make -f tools/h5-artifacts.mk image-runtime-smoke API_PORT=18946 UI_PORT=15946 MAILDEV_UI_PORT=11946 ENV=e2e-artefacts-mcp-a6
#   make -f tools/h5-artifacts.mk test-reader-e2e API_PORT=18946 UI_PORT=15946 MAILDEV_UI_PORT=11946 ENV=e2e-artefacts-mcp-a6
#   make -f tools/h5-artifacts.mk down API_PORT=18946 UI_PORT=15946 MAILDEV_UI_PORT=11946 ENV=e2e-artefacts-mcp-a6
#
# A7 owns test-h5-render (opt-in preprod render/activation evidence).

SHELL := /bin/bash
SCOPE ?= src/artifacts/reader-security.test.ts

ENV ?=
API_PORT ?= 18946
UI_PORT ?= 15946
MAILDEV_UI_PORT ?= 11946
export API_PORT UI_PORT MAILDEV_UI_PORT
override COMPOSE_PROJECT_NAME := radar-$(ENV)
override COMPOSE_DISABLE_ENV_FILE := 1
export COMPOSE_PROJECT_NAME COMPOSE_DISABLE_ENV_FILE
export BUILDX_CONFIG := $(CURDIR)/tmp/artefacts-mcp-a6-buildx

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

override DOCKER_COMPOSE := docker compose
COMPOSE_FILES := -f docker-compose.yml -f docker-compose.test.yml
override COMPOSE := $(DOCKER_COMPOSE) --env-file /dev/null -p radar-$(ENV) $(COMPOSE_FILES)
override CLEANUP := status=$$?; if ! $(COMPOSE) down -v --remove-orphans; then status=1; fi; exit $$status
override SET_TRAPS := trap '$(CLEANUP)' EXIT; trap 'exit 130' INT; trap 'exit 143' TERM

.PHONY: guard-env
guard-env:
	@case "$(ENV)" in \
	  test-*|e2e-*) ;; \
	  *) echo "[h5-artifacts] refused: ENV must be test-* or e2e-*, got '$(ENV)'" >&2; exit 1;; \
	esac

.PHONY: guard-test
guard-test: guard-env
	@test "$$(df -Pk . | awk 'NR==2 {print $$4}')" -ge 10485760 || { echo '[h5-artifacts] STOP: less than 10 GiB free'; exit 2; }
	@set -eu; found=$$(find . -name '.env*' ! -name '.env.example' -print -quit); \
	test -z "$$found" || { echo '[h5-artifacts] refused: environment file present'; exit 2; }

.PHONY: test-reader-unit
test-reader-unit: guard-test
	@set -e; $(SET_TRAPS); \
	$(COMPOSE) run --rm --no-deps -T --entrypoint '' api sh -ec \
	'npm ci --ignore-scripts && npm run test --workspace=api -- $(SCOPE)'

.PHONY: test-reader-mutations
test-reader-mutations: guard-test
	@set -e; $(SET_TRAPS); \
	$(COMPOSE) run --rm --no-deps -T --entrypoint '' api sh -ec \
	'npm ci --ignore-scripts && node tools/h5-reader-mutations.mjs'

.PHONY: test-reader-discovery
test-reader-discovery: guard-test ## Collect using the execution configurations; reject missing or empty inventories
	@set -e; $(SET_TRAPS); \
	$(COMPOSE) run --rm --no-deps -T --entrypoint '' api sh -ec \
	'npm ci --ignore-scripts && node tools/h5-reader-discovery.mjs'

.PHONY: image-runtime-smoke
.PHONY: guard-image-contract
guard-image-contract: guard-env
	@git show HEAD:api/Dockerfile | grep -Fq "api/src/artifacts/content-reader-server.ts" || { echo '[h5-artifacts] BLOCKED: committed reader image integration missing'; exit 2; }
	@git show HEAD:api/docker-entrypoint.sh | grep -Fq 'content-reader)' || { echo '[h5-artifacts] BLOCKED: committed reader entrypoint integration missing'; exit 2; }

image-runtime-smoke: guard-test guard-image-contract ## Build the final image; run entrypoint modes api/content-deny/content-reader/unknown refusal
	@set -e; \
	if test -n "$$(find . -name '.env*' ! -name '.env.example' -print -quit)"; then \
	  echo "[h5-artifacts] refused: .env* present in build context" >&2; exit 1; fi; \
	sh tools/h5-image-runtime-smoke.sh

.PHONY: test-reader-e2e
test-reader-e2e: guard-test ## Integrated image/routing prerequisite; source-mounted fixtures do not qualify
	@echo '[h5-artifacts] BLOCKED: final-image API/authority/store integration receipt is required' >&2
	@exit 2

.PHONY: test-reader-browser-fixture
test-reader-browser-fixture: guard-test ## Real Chromium over source fixtures; not final-image/API acceptance
	@set -e; $(SET_TRAPS); \
	$(COMPOSE) run --rm --no-deps -T --entrypoint '' api sh -ec \
	'npm ci --ignore-scripts && npx --no-install playwright install --with-deps --only-shell chromium && \
	PLAYWRIGHT_JSON_OUTPUT_FILE=/workspace/tmp/artefacts-mcp-a6/playwright-fixture.json \
	node node_modules/@playwright/test/cli.js test --config=tools/h5-artifacts.playwright.config.ts --reporter=list,json'

.PHONY: down
.PHONY: test-reader-runner-guards
test-reader-runner-guards: guard-env
	@bash tools/h5-runner-guards.sh

down: guard-env ## Stop the H5 stack and remove volumes/orphans (project-scoped)
	$(COMPOSE) down -v --remove-orphans

.PHONY: inspect
inspect: guard-env
	@set -e; remaining=$$(docker ps -aq --filter label=com.docker.compose.project=radar-$(ENV)); test -z "$$remaining"; \
	remaining=$$(docker volume ls -q --filter label=com.docker.compose.project=radar-$(ENV)); test -z "$$remaining"; \
	remaining=$$(docker network ls -q --filter label=com.docker.compose.project=radar-$(ENV)); test -z "$$remaining"
	@echo '[h5-artifacts] zero project containers, volumes and networks'
