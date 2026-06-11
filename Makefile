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

# ── Kubernetes (radar as a sentropic app) ─────────────────────────────
# Manifests are PREPARED here and validated offline; deploying to a live
# cluster is a deliberate human action with cluster creds (see deploy/k8s/README.md).
KUBECTL              ?= kubectl
K8S_MANIFEST_DIR     ?= deploy/k8s
K8S_NAMESPACE        ?= radar-immobilier
# Set to 1 only when a real KUBECONFIG is present to additionally run a
# server-side dry-run. Offline render works with no cluster.
K8S_VALIDATE_WITH_CLUSTER ?= 0

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
# Worker live (config-only PV cities → scraping object store)
# ─────────────────────────────────────────────────────────────────────

.PHONY: worker-live
worker-live: ## Live-scrape config-only PV cities → SCW (CITIES="a b", LIMIT=n)
	$(DOCKER_COMPOSE) $(COMPOSE_FILES_DEV) run --rm -T \
	  -e LIVE_SCRAPE_LIMIT=$(LIMIT) api \
	  npx tsx src/scripts/worker-live.ts $(CITIES)

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

.PHONY: k8s-validate
k8s-validate: ## Validate the radar/sentropic-app manifests offline (no cluster)
	@command -v $(KUBECTL) >/dev/null 2>&1 || { echo "[k8s-validate] kubectl not found"; exit 1; }
	@echo "[k8s-validate] rendering $(K8S_MANIFEST_DIR) with kustomize…"
	@$(KUBECTL) kustomize $(K8S_MANIFEST_DIR) >/dev/null
	@echo "[k8s-validate] structural check (every doc has apiVersion + kind)…"
	@$(KUBECTL) kustomize $(K8S_MANIFEST_DIR) \
	  | awk 'BEGIN{RS="\n---\n"} /[^[:space:]]/ { if ($$0 !~ /apiVersion:/ || $$0 !~ /kind:/) { print "missing apiVersion/kind in a document"; bad=1 } } END{ exit bad }'
	@if [ "$(K8S_VALIDATE_WITH_CLUSTER)" = "1" ]; then \
	  echo "[k8s-validate] server-side dry-run (KUBECONFIG required)…"; \
	  $(KUBECTL) apply --dry-run=server -k $(K8S_MANIFEST_DIR); \
	else \
	  echo "[k8s-validate] offline render ok; set K8S_VALIDATE_WITH_CLUSTER=1 for a server dry-run"; \
	fi

# PREPARE-ONLY guardrail: deploying to a live cluster is a deliberate human
# action. This target validates and prints the exact apply command instead of
# applying, unless K8S_DEPLOY_CONFIRM=1 AND a KUBECONFIG is explicitly set.
.PHONY: deploy-k8s
deploy-k8s: ## Validate manifests; apply ONLY with K8S_DEPLOY_CONFIRM=1 + KUBECONFIG
	@$(MAKE) k8s-validate ENV=$(ENV)
	@if [ "$(K8S_DEPLOY_CONFIRM)" = "1" ] && [ -n "$$KUBECONFIG" ]; then \
	  echo "[deploy-k8s] applying to $$KUBECONFIG (namespace $(K8S_NAMESPACE))"; \
	  $(KUBECTL) apply -k $(K8S_MANIFEST_DIR); \
	else \
	  echo "[deploy-k8s] PREPARE-ONLY: not applied."; \
	  echo "  Human deploy step (with cluster creds):"; \
	  echo "    KUBECONFIG=<path> make deploy-k8s K8S_DEPLOY_CONFIRM=1 ENV=poc"; \
	fi

# ─────────────────────────────────────────────────────────────────────
# Orchestration / conductor reporting
# ─────────────────────────────────────────────────────────────────────
# Lane registry: one `lane|agent|dir` entry per line in .agents/lanes
# (agent in {gpt, opus, gemini, -}). Override with CONDUCTOR_LANES="a|b|c;..."
# or CONDUCTOR_LANES_FILE=<path>; else auto-glob worktrees.
CONDUCTOR_LANES ?=
CONDUCTOR_LANES_FILE ?= .agents/lanes
CONDUCTOR_AUTO_GLOB ?= tmp/feat-* tmp/fix-* tmp/chore-*
CONDUCTOR_STALL_SECS ?= 900

.PHONY: conductor-report agent-conductor-report conductor-status
conductor-report agent-conductor-report conductor-status: ## Multi-agent status per lane: done/treated % (UAT-excluded), dirty, head, sloc, heartbeat
	@set -euo pipefail; \
	now="$$(date +%s)"; \
	ts="$$(date '+%Y-%m-%d %H:%M:%S %z')"; \
	total_done=0; total_treated=0; total_all=0; \
	lanes=(); \
	if [ -n "$(CONDUCTOR_LANES)" ]; then \
		IFS=';' read -r -a lanes <<< "$(CONDUCTOR_LANES)"; \
	elif [ -n "$(CONDUCTOR_LANES_FILE)" ] && [ -f "$(CONDUCTOR_LANES_FILE)" ]; then \
		while IFS= read -r raw_line; do \
			line="$${raw_line%%#*}"; \
			line="$$(echo "$$line" | xargs)"; \
			if [ -z "$$line" ]; then continue; fi; \
			lanes+=("$$line"); \
		done < "$(CONDUCTOR_LANES_FILE)"; \
	else \
		auto_i=1; \
		for dir in $(CONDUCTOR_AUTO_GLOB); do \
			if [ ! -d "$$dir" ]; then continue; fi; \
			if [ -z "$$(ls -t "$$dir"/plan/*-BRANCH_*.md 2>/dev/null | head -1)" ]; then continue; fi; \
			lanes+=("$$(printf 'AUTO%02d|-|%s' "$$auto_i" "$$dir")"); \
			auto_i="$$((auto_i + 1))"; \
		done; \
	fi; \
	if [ "$${#lanes[@]}" -eq 0 ]; then \
		echo "No conductor lanes. Seed .agents/lanes ('lane|agent|dir') or pass CONDUCTOR_LANES='BR05R|opus|tmp/feat-source-value-review-ui'."; \
		exit 0; \
	fi; \
	echo "Conductor report ($$ts)"; \
	echo "lane | agent | branch | done | treated | dirty | head | sloc | heartbeat"; \
	echo "-----|-------|--------|------|---------|-------|------|------|----------"; \
	for lane_row in "$${lanes[@]}"; do \
		IFS='|' read -r lane agent dir <<< "$$lane_row"; \
		branch="$$(git -C "$$dir" branch --show-current 2>/dev/null || echo '?')"; \
		head="$$(git -C "$$dir" rev-parse --short HEAD 2>/dev/null || echo '?')"; \
		dirty="$$(git -C "$$dir" status --porcelain 2>/dev/null | wc -l | tr -d ' ')"; \
		file="$$(ls -t "$$dir"/plan/*-BRANCH_*.md 2>/dev/null | head -1)"; \
		if [ -n "$$file" ] && [ -f "$$file" ]; then \
			counts="$$(awk '\
				BEGIN { in_uat=0; done=0; defer=0; total=0 } \
				function is_checkbox(s) { return s ~ /^[[:space:]]*-[[:space:]]*\[( |x|!)\]/ } \
				function is_lot_header(s) { return s ~ /^[[:space:]]*-[[:space:]]*\[( |x|!)\][[:space:]]*\*\*Lot/ } \
				{ \
					line=$$0; \
					if (is_lot_header(line)) { if (line ~ /UAT/) in_uat=1; else in_uat=0; } \
					if (!is_checkbox(line)) next; \
					if (in_uat) next; \
					if (line ~ /UAT/) next; \
					total++; \
					if (line ~ /\[x\]/) done++; \
					else if (line ~ /\[!\]/) defer++; \
				} \
				END { printf "%d|%d|%d", done, defer, total } \
			' "$$file")"; \
			IFS='|' read -r done_count defer_count total_count <<< "$$counts"; \
			mtime="$$(stat -c %Y "$$file" 2>/dev/null || echo 0)"; \
		else \
			done_count=0; defer_count=0; total_count=0; mtime=0; \
		fi; \
		treated_count="$$((done_count + defer_count))"; \
		done_pct="$$(awk -v a="$$done_count" -v b="$$total_count" 'BEGIN{if(b==0){printf "0.0"}else{printf "%.1f",(100*a)/b}}')"; \
		treated_pct="$$(awk -v a="$$treated_count" -v b="$$total_count" 'BEGIN{if(b==0){printf "0.0"}else{printf "%.1f",(100*a)/b}}')"; \
		age="$$((now - mtime))"; \
		if [ "$$age" -gt $(CONDUCTOR_STALL_SECS) ]; then hb="STALL($${age}s)"; else hb="ACTIVE($${age}s)"; fi; \
		sloc="$$( (cd "$$dir" 2>/dev/null && cloc --vcs=git --quiet --not-match-f='(package.*\.json|.*-lock\.json|.*_snapshot\.json)$$' . 2>/dev/null | awk '/^SUM:/{print $$5}' | tail -n1) || true)"; \
		if [ -z "$$sloc" ]; then sloc="n/a"; fi; \
		echo "$$lane | $$agent | $$branch | $$done_count/$$total_count ($$done_pct%) | $$treated_count/$$total_count ($$treated_pct%) | $$dirty | $$head | $$sloc | $$hb"; \
		total_done="$$((total_done + done_count))"; \
		total_treated="$$((total_treated + treated_count))"; \
		total_all="$$((total_all + total_count))"; \
	done; \
	total_done_pct="$$(awk -v a="$$total_done" -v b="$$total_all" 'BEGIN{if(b==0){printf "0.0"}else{printf "%.1f",(100*a)/b}}')"; \
	total_treated_pct="$$(awk -v a="$$total_treated" -v b="$$total_all" 'BEGIN{if(b==0){printf "0.0"}else{printf "%.1f",(100*a)/b}}')"; \
	echo "TOTAL | - | - | $$total_done/$$total_all ($$total_done_pct%) | $$total_treated/$$total_all ($$total_treated_pct%) | - | - | - | -"

.PHONY: down-stale
down-stale: ## Stop stale stacks by ENV list: make down-stale STALE="feat-ui-skeleton test-source-spikes"
	@test -n "$$STALE" || (echo 'Pass STALE="env1 env2 ..."'; exit 1)
	@for e in $$STALE; do \
	  echo "[down-stale] stopping radar-$$e"; \
	  $(DOCKER_COMPOSE) $(COMPOSE_FILES_BASE) -p radar-$$e down --remove-orphans 2>/dev/null || true; \
	done

# ─────────────────────────────────────────────────────────────────────
# Security
# ─────────────────────────────────────────────────────────────────────

.PHONY: security-scan
security-scan: ## Run Trivy on built images
	@echo "[security-scan] wired in BR-04"
