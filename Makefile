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

# URLs surfaced to the UI build. Empty by default so the Vite dev server can
# proxy same-origin API checks without browser CORS requirements.
export VITE_API_BASE_URL ?=
export API_PROXY_TARGET ?= http://api:3000

# Image versioning derived from source hashes (built in BR-02+).
export API_VERSION ?= dev
export UI_VERSION  ?= dev
export E2E_VERSION ?= dev

export K8S_MANIFEST_DIR ?= deploy/k8s
export K8S_NAMESPACE    ?= radar-immobilier
export K8S_REGISTRY_SERVER ?= rg.fr-par.scw.cloud
export K8S_REGISTRY     ?= rg.fr-par.scw.cloud/radar-immobilier
export K8S_IMAGE_TAG    ?= latest
export K8S_API_IMAGE    ?= $(K8S_REGISTRY)/radar-api:$(K8S_IMAGE_TAG)
export K8S_OBSCURA_IMAGE ?= $(K8S_REGISTRY)/radar-obscura:$(K8S_IMAGE_TAG)
export K8S_POSTGRES_USER ?= radar
export K8S_POSTGRES_DB   ?= radar
export KUBECTL ?= kubectl
export TRIVY   ?= trivy

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

# Run a one-off command in the api workspace container, no service deps
# started (used for build-time gates: install / typecheck / lint / build).
COMPOSE_RUN_API_NODEPS := $(DOCKER_COMPOSE) $(COMPOSE_FILES_DEV) run --rm --no-deps -T api

.PHONY: typecheck
typecheck: ## TypeScript typecheck across the workspace
	$(COMPOSE_RUN_API_NODEPS) npm run typecheck --workspaces --if-present

.PHONY: lint
lint: ## Lint across the workspace (ESLint flat config)
	$(COMPOSE_RUN_API_NODEPS) npx eslint .

.PHONY: format
format: ## Auto-format (prettier / dprint, defined later)
	@echo "[format] no formatter wired yet — placeholder for a later branch"

.PHONY: build
build: ## Build all workspaces
	$(COMPOSE_RUN_API_NODEPS) npm run build --workspace=api
	$(COMPOSE_RUN_API_NODEPS) npm run build --workspace=ui

# ─────────────────────────────────────────────────────────────────────
# Tests
# ─────────────────────────────────────────────────────────────────────

# The test stack uses its own node_modules volumes (isolated from dev), so
# it installs deps itself via `npm ci` before migrating and running tests.
.PHONY: test
test: ## Run unit + integration tests (boots postgres + minio)
	$(DOCKER_COMPOSE) $(COMPOSE_FILES_TEST) up -d postgres minio
	$(DOCKER_COMPOSE) $(COMPOSE_FILES_TEST) run --rm -T api sh -c "\
	  npm ci && \
	  npm run db:migrate --workspace=api && \
	  npm run test --workspaces --if-present"

.PHONY: test-api
test-api: ## Run API tests (SCOPE=<file> for scoped runs)
	$(DOCKER_COMPOSE) $(COMPOSE_FILES_TEST) up -d postgres minio
	$(DOCKER_COMPOSE) $(COMPOSE_FILES_TEST) run --rm -T api sh -c "\
	  npm ci && \
	  npm run db:migrate --workspace=api && \
	  npm run test --workspace=api $(if $(SCOPE),-- $(SCOPE),)"

.PHONY: test-ui
test-ui: ## Run UI unit tests (SCOPE=<file> for scoped runs)
	$(COMPOSE_RUN_API_NODEPS) npm run test --workspace=ui $(if $(SCOPE),-- $(SCOPE),)

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
db-init: ## Bring up postgres and apply migrations
	$(DOCKER_COMPOSE) $(COMPOSE_FILES_DEV) up -d postgres
	@$(MAKE) db-migrate ENV=$(ENV)

.PHONY: db-generate
db-generate: ## Generate a Drizzle migration from the schema
	$(COMPOSE_RUN_API_NODEPS) npm run db:generate --workspace=api

.PHONY: db-migrate
db-migrate: ## Run Drizzle migrations against the running postgres
	$(DOCKER_COMPOSE) $(COMPOSE_FILES_DEV) run --rm -T api npm run db:migrate --workspace=api

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
install: ## Install root workspace deps (no service deps started)
	$(COMPOSE_RUN_API_NODEPS) npm install

.PHONY: install-api
install-api: ## Add a dep to api: make install-api LIB=foo (VAR=-D for devDeps)
	@test -n "$$LIB" || (echo "Pass LIB=<name>"; exit 1)
	$(COMPOSE_RUN_API_NODEPS) npm --workspace=api install $$VAR $$LIB

.PHONY: install-ui
install-ui: ## Add a dep to ui: make install-ui LIB=foo
	@test -n "$$LIB" || (echo "Pass LIB=<name>"; exit 1)
	$(COMPOSE_RUN_API_NODEPS) npm --workspace=ui install $$VAR $$LIB

.PHONY: install-dev
install-dev: ## Add a devDep at workspace root: make install-dev LIB=foo
	@test -n "$$LIB" || (echo "Pass LIB=<name>"; exit 1)
	$(COMPOSE_RUN_API_NODEPS) npm install -D $$LIB

.PHONY: build-api-image
build-api-image: ## Build the production api image from api/Dockerfile
	$(DOCKER_COMPOSE) $(COMPOSE_FILES_E2E) build api

.PHONY: build-k8s-images
build-k8s-images: ## Build K8s deployable API and Obscura images
	docker build -t $(K8S_API_IMAGE) -f api/Dockerfile .
	docker build -t $(K8S_OBSCURA_IMAGE) -f obscura/Dockerfile obscura

.PHONY: push-k8s-images
push-k8s-images: ## Push K8s images to the configured registry
	docker push $(K8S_API_IMAGE)
	docker push $(K8S_OBSCURA_IMAGE)

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
	@$(MAKE) k8s-validate ENV=$(ENV)
	$(KUBECTL) -n $(K8S_NAMESPACE) apply -k $(K8S_MANIFEST_DIR)

.PHONY: k8s-validate
k8s-validate: ## Validate K8s manifests client-side
	$(KUBECTL) kustomize $(K8S_MANIFEST_DIR) >/dev/null
	$(KUBECTL) apply --dry-run=client -k $(K8S_MANIFEST_DIR)

.PHONY: k8s-create-secrets
k8s-create-secrets: ## Create/update K8s secrets from local env values
	@test -n "$$K8S_POSTGRES_PASSWORD" || (echo "Pass K8S_POSTGRES_PASSWORD"; exit 1)
	@test -n "$$S3_ACCESS_KEY" || (echo "Pass S3_ACCESS_KEY"; exit 1)
	@test -n "$$S3_SECRET_KEY" || (echo "Pass S3_SECRET_KEY"; exit 1)
	@test -n "$$K8S_REGISTRY_USERNAME" || (echo "Pass K8S_REGISTRY_USERNAME"; exit 1)
	@test -n "$$K8S_REGISTRY_PASSWORD" || (echo "Pass K8S_REGISTRY_PASSWORD"; exit 1)
	@$(KUBECTL) -n $(K8S_NAMESPACE) create secret generic radar-db-credentials \
	  --from-literal=POSTGRES_USER="$(K8S_POSTGRES_USER)" \
	  --from-literal=POSTGRES_PASSWORD="$$K8S_POSTGRES_PASSWORD" \
	  --from-literal=POSTGRES_DB="$(K8S_POSTGRES_DB)" \
	  --dry-run=client -o yaml | $(KUBECTL) apply -f -
	@$(KUBECTL) -n $(K8S_NAMESPACE) create secret generic radar-s3-credentials \
	  --from-literal=S3_ACCESS_KEY="$$S3_ACCESS_KEY" \
	  --from-literal=S3_SECRET_KEY="$$S3_SECRET_KEY" \
	  --dry-run=client -o yaml | $(KUBECTL) apply -f -
	@$(KUBECTL) -n $(K8S_NAMESPACE) create secret generic radar-llm-credentials \
	  --from-literal=OPENAI_API_KEY="$${OPENAI_API_KEY:-}" \
	  --from-literal=ANTHROPIC_API_KEY="$${ANTHROPIC_API_KEY:-}" \
	  --dry-run=client -o yaml | $(KUBECTL) apply -f -
	@$(KUBECTL) -n $(K8S_NAMESPACE) create secret docker-registry radar-registry-pull \
	  --docker-server="$(K8S_REGISTRY_SERVER)" \
	  --docker-username="$$K8S_REGISTRY_USERNAME" \
	  --docker-password="$$K8S_REGISTRY_PASSWORD" \
	  --dry-run=client -o yaml | $(KUBECTL) apply -f -

.PHONY: s3-status-poc
s3-status-poc: ## Show Scaleway POC bucket status
	scw object bucket get $(S3_BUCKET) region=$(S3_REGION)

.PHONY: s3-init-poc
s3-init-poc: ## Create the Scaleway POC bucket if missing
	@if scw object bucket get $(S3_BUCKET) region=$(S3_REGION) >/dev/null 2>&1; then \
	  echo "[s3-init-poc] bucket already exists: $(S3_BUCKET) ($(S3_REGION))"; \
	else \
	  scw object bucket create $(S3_BUCKET) region=$(S3_REGION); \
	fi

# ─────────────────────────────────────────────────────────────────────
# Security
# ─────────────────────────────────────────────────────────────────────

.PHONY: security-scan
security-scan: ## Run Trivy on built images
	@command -v $(TRIVY) >/dev/null || (echo "Install Trivy or set TRIVY=<path>"; exit 127)
	$(TRIVY) image --exit-code 1 --severity HIGH,CRITICAL $(K8S_API_IMAGE)
	$(TRIVY) image --exit-code 1 --severity HIGH,CRITICAL $(K8S_OBSCURA_IMAGE)
