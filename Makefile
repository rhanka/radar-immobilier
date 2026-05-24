SHELL := /bin/bash

-include .env

# ── Environment / project ─────────────────────────────────────────────
ENV ?= dev
export COMPOSE_PROJECT_NAME ?= radar-$(ENV)

DOCKER_COMPOSE        ?= docker compose
COMPOSE_FILES_BASE    := -f docker-compose.yml
COMPOSE_FILES_DEV     := $(COMPOSE_FILES_BASE) -f docker-compose.dev.yml
COMPOSE_FILES_TEST    := $(COMPOSE_FILES_BASE) -f docker-compose.test.yml
COMPOSE_FILES_E2E     := $(COMPOSE_FILES_BASE) -f docker-compose.e2e.yml

# Per-branch port mapping (defaults align with BR-00 baseline).
export API_PORT            ?= 8801
export UI_PORT             ?= 5301
export MAILDEV_UI_PORT     ?= 1101
export POSTGRES_HOST_PORT  ?= 5532
export S3_HOST_PORT        ?= 9100
export S3_CONSOLE_HOST_PORT ?= 9101
export OBSCURA_HOST_PORT   ?= 9222
export MAILDEV_SMTP_HOST_PORT ?= 1025

# URLs surfaced to the UI build.
export VITE_API_BASE_URL ?= http://localhost:$(API_PORT)

# Image versioning derived from source hashes (built in BR-02+).
export API_VERSION ?= dev
export UI_VERSION  ?= dev
export E2E_VERSION ?= dev

.DEFAULT_GOAL := help

# ─────────────────────────────────────────────────────────────────────
# Help
# ─────────────────────────────────────────────────────────────────────

.PHONY: help
help: ## Show this help
	@echo "Available targets:"
	@grep -E '^[a-zA-Z0-9_.-]+:.*?##' $(MAKEFILE_LIST) \
	  | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[32m%-28s\033[0m %s\n", $$1, $$2}'

# ─────────────────────────────────────────────────────────────────────
# Lifecycle
# ─────────────────────────────────────────────────────────────────────

.PHONY: dev
dev: ## Start the dev stack (api + postgres + minio + obscura + maildev + ui-dev)
	$(DOCKER_COMPOSE) $(COMPOSE_FILES_DEV) up -d --build
	@$(MAKE) s3-init ENV=$(ENV)

.PHONY: down
down: ## Stop and remove the current compose stack
	$(DOCKER_COMPOSE) $(COMPOSE_FILES_DEV) down

.PHONY: clean
clean: ## Stop the stack and remove volumes for the current ENV
	$(DOCKER_COMPOSE) $(COMPOSE_FILES_DEV) down -v

.PHONY: ps
ps: ## Show services of the current ENV
	$(DOCKER_COMPOSE) $(COMPOSE_FILES_DEV) ps

.PHONY: ps-all
ps-all: ## Show ALL containers on the host (any project)
	docker ps -a

.PHONY: logs
logs: ## Tail logs of the current ENV
	$(DOCKER_COMPOSE) $(COMPOSE_FILES_DEV) logs -f --tail=200

.PHONY: logs-%
logs-%: ## Tail logs of a single service (api, ui, postgres, minio, obscura, maildev)
	$(DOCKER_COMPOSE) $(COMPOSE_FILES_DEV) logs -f --tail=200 $*

.PHONY: sh-%
sh-%: ## Open a shell in a service (api, ui, postgres, minio, obscura, maildev)
	$(DOCKER_COMPOSE) $(COMPOSE_FILES_DEV) exec $* /bin/bash || \
	$(DOCKER_COMPOSE) $(COMPOSE_FILES_DEV) exec $* /bin/sh

.PHONY: exec-%
exec-%: ## Exec arbitrary CMD="..." inside a service container
	$(DOCKER_COMPOSE) $(COMPOSE_FILES_DEV) exec $* sh -c "$$CMD"

# ─────────────────────────────────────────────────────────────────────
# Quality gates
# ─────────────────────────────────────────────────────────────────────

.PHONY: typecheck
typecheck: ## TypeScript typecheck across the workspace
	@echo "[typecheck] no workspaces yet — placeholder for BR-02+"

.PHONY: lint
lint: ## Lint across the workspace
	@echo "[lint] no workspaces yet — placeholder for BR-02+"

.PHONY: format
format: ## Auto-format (prettier / dprint, defined later)
	@echo "[format] no formatter wired yet — placeholder for BR-02+"

.PHONY: build
build: ## Build all workspaces
	@echo "[build] no workspaces yet — placeholder for BR-02+"

# ─────────────────────────────────────────────────────────────────────
# Tests
# ─────────────────────────────────────────────────────────────────────

.PHONY: test
test: ## Run unit + integration tests
	@echo "[test] no test suite yet — placeholder for BR-02+"

.PHONY: test-api
test-api: ## Run API tests (SCOPE=<file> for scoped runs)
	@echo "[test-api] no API yet — placeholder for BR-02+"

.PHONY: test-ui
test-ui: ## Run UI unit tests (SCOPE=<file> for scoped runs)
	@echo "[test-ui] no UI yet — placeholder for BR-03+"

.PHONY: test-e2e
test-e2e: ## Run Playwright e2e tests (E2E_SPEC=<file> for scoped runs)
	@echo "[test-e2e] no e2e suite yet — placeholder for BR-07+"

.PHONY: test-smoke
test-smoke: ## Smoke test against deployed env
	@echo "[test-smoke] placeholder for BR-12"

# ─────────────────────────────────────────────────────────────────────
# Database (Postgres)
# ─────────────────────────────────────────────────────────────────────

.PHONY: db-init
db-init: ## Initialize the dev database
	@echo "[db-init] placeholder for BR-02"

.PHONY: db-migrate
db-migrate: ## Run Drizzle migrations
	@echo "[db-migrate] placeholder for BR-02"

.PHONY: db-backup
db-backup: ## pg_dump backup
	$(DOCKER_COMPOSE) $(COMPOSE_FILES_DEV) exec -T postgres \
	  pg_dump -U $(POSTGRES_USER) $(POSTGRES_DB) > backups/$(ENV)-$(shell date +%Y%m%d-%H%M%S).sql

.PHONY: db-restore
db-restore: ## pg_restore from SQL=<file>
	@test -n "$$SQL" || (echo "Pass SQL=<path>"; exit 1)
	$(DOCKER_COMPOSE) $(COMPOSE_FILES_DEV) exec -T postgres \
	  psql -U $(POSTGRES_USER) -d $(POSTGRES_DB) < $$SQL

.PHONY: db-seed
db-seed: ## Seed the dev DB with fixtures
	@echo "[db-seed] placeholder for BR-02"

.PHONY: db-query
db-query: ## Run a one-shot query: make db-query QUERY="SELECT 1"
	@test -n "$$QUERY" || (echo "Pass QUERY=\"...\""; exit 1)
	$(DOCKER_COMPOSE) $(COMPOSE_FILES_DEV) exec -T postgres \
	  psql -U $(POSTGRES_USER) -d $(POSTGRES_DB) -c "$$QUERY"

.PHONY: db-status
db-status: ## Check DB readiness
	$(DOCKER_COMPOSE) $(COMPOSE_FILES_DEV) exec -T postgres \
	  pg_isready -U $(POSTGRES_USER) -d $(POSTGRES_DB)

# ─────────────────────────────────────────────────────────────────────
# Object storage (MinIO local, Scaleway in prod)
# ─────────────────────────────────────────────────────────────────────

.PHONY: s3-init
s3-init: ## Create the local MinIO bucket if missing
	@$(DOCKER_COMPOSE) $(COMPOSE_FILES_DEV) exec -T minio sh -c '\
	  mc alias set local http://localhost:9000 $${MINIO_ROOT_USER} $${MINIO_ROOT_PASSWORD} >/dev/null && \
	  mc mb -p local/$${S3_BUCKET:-radar-immobilier-raw} >/dev/null 2>&1 || true && \
	  echo "[s3-init] bucket ready: $${S3_BUCKET:-radar-immobilier-raw}"' || \
	echo "[s3-init] minio not running yet — skip"

.PHONY: s3-status
s3-status: ## List buckets in MinIO
	$(DOCKER_COMPOSE) $(COMPOSE_FILES_DEV) exec -T minio sh -c '\
	  mc alias set local http://localhost:9000 $${MINIO_ROOT_USER} $${MINIO_ROOT_PASSWORD} >/dev/null && \
	  mc ls local/'

.PHONY: s3-ls
s3-ls: ## List keys under PREFIX=<prefix>
	@test -n "$$PREFIX" || (echo "Pass PREFIX=raw/<...>"; exit 1)
	$(DOCKER_COMPOSE) $(COMPOSE_FILES_DEV) exec -T minio sh -c '\
	  mc alias set local http://localhost:9000 $${MINIO_ROOT_USER} $${MINIO_ROOT_PASSWORD} >/dev/null && \
	  mc ls -r local/$${S3_BUCKET:-radar-immobilier-raw}/$$PREFIX'

# ─────────────────────────────────────────────────────────────────────
# Dependency installation (workspace-aware)
# ─────────────────────────────────────────────────────────────────────

.PHONY: install
install: ## Install root workspace deps
	$(DOCKER_COMPOSE) $(COMPOSE_FILES_DEV) run --rm api npm install

.PHONY: install-api
install-api: ## Add a dep to api: make install-api LIB=foo (LIB+=-dev for devDeps via VAR=)
	@test -n "$$LIB" || (echo "Pass LIB=<name>"; exit 1)
	$(DOCKER_COMPOSE) $(COMPOSE_FILES_DEV) run --rm api npm --workspace=api install $$VAR $$LIB

.PHONY: install-ui
install-ui: ## Add a dep to ui: make install-ui LIB=foo
	@test -n "$$LIB" || (echo "Pass LIB=<name>"; exit 1)
	$(DOCKER_COMPOSE) $(COMPOSE_FILES_DEV) run --rm api npm --workspace=ui install $$VAR $$LIB

.PHONY: install-dev
install-dev: ## Add a devDep at workspace root: make install-dev LIB=foo
	@test -n "$$LIB" || (echo "Pass LIB=<name>"; exit 1)
	$(DOCKER_COMPOSE) $(COMPOSE_FILES_DEV) run --rm api npm install -D $$LIB

# ─────────────────────────────────────────────────────────────────────
# Commit helper
# ─────────────────────────────────────────────────────────────────────
# No automatic co-authoring trailer (project policy).

.PHONY: commit
commit: ## Commit staged changes: make commit MSG="type(scope): description"
	@test -n "$$MSG" || (echo "Pass MSG=\"...\""; exit 1)
	git commit -m "$$MSG"

# ─────────────────────────────────────────────────────────────────────
# OpenAPI / schemas
# ─────────────────────────────────────────────────────────────────────

.PHONY: openapi-json
openapi-json: ## Dump OpenAPI JSON
	@echo "[openapi-json] placeholder for BR-02"

# ─────────────────────────────────────────────────────────────────────
# Deployment (placeholders, real impl in BR-03 / BR-04)
# ─────────────────────────────────────────────────────────────────────

.PHONY: deploy-gh-pages
deploy-gh-pages: ## Deploy the SPA to GitHub Pages
	@echo "[deploy-gh-pages] wired in BR-03"
	@exit 1

.PHONY: deploy-k8s
deploy-k8s: ## Deploy api+postgres+obscura+maildev to K8s poc tenant
	@echo "[deploy-k8s] wired in BR-04"
	@exit 1

# ─────────────────────────────────────────────────────────────────────
# Security
# ─────────────────────────────────────────────────────────────────────

.PHONY: security-scan
security-scan: ## Run Trivy on built images
	@echo "[security-scan] wired in BR-04"
