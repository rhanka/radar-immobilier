# Isolated H4 verification runner (861c P0 skeleton).
#
# Standalone entry point: it NEVER includes the root Makefile (which reads
# .env) and NEVER loads per-service environment files. Every compose
# invocation runs with COMPOSE_DISABLE_ENV_FILE=1 and an explicit
# --env-file /dev/null. Only synthetic test ports and synthetic credentials
# reach the containers. Any ENV outside test-*/e2e-* is refused. Teardown
# (`down -v`) is limited to this isolated project via -p radar-$(ENV).
# The proposed service stack publishes no host ports.
#
# Usage with ENV last:
#   make -f tools/h4-mcp.mk down API_PORT=18914 UI_PORT=15914 MAILDEV_UI_PORT=11914 ENV=test-861c-h4-p0
#   make -f tools/h4-mcp.mk inspect API_PORT=18914 UI_PORT=15914 MAILDEV_UI_PORT=11914 ENV=test-861c-h4-p0
# Phase targets below (qualify-tuple, test-exchange-e2e, image-smoke,
# test-composition-e2e) are owned by P4/P6/P7 and refuse until implemented.

SHELL := /bin/bash

ENV ?=
API_PORT ?= 18914
UI_PORT ?= 15914
MAILDEV_UI_PORT ?= 11914
export ENV API_PORT UI_PORT MAILDEV_UI_PORT
override COMPOSE_PROJECT_NAME := radar-$(ENV)
override COMPOSE_DISABLE_ENV_FILE := 1
export COMPOSE_PROJECT_NAME COMPOSE_DISABLE_ENV_FILE

# Neutralize host-inherited values that compose files interpolate into
# containers: empty forces each `${VAR:-default}` to its synthetic default
# instead of a caller-shell secret or override.
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

override COMPOSE := docker compose --env-file /dev/null -p radar-$(ENV) -f docker-compose.test.yml

.PHONY: guard-env
guard-env:
	@if [[ ! "$$ENV" =~ ^(test|e2e)-[a-z0-9][a-z0-9_-]*$$ ]]; then \
	  echo "[h4-mcp] refused: ENV must be a test-* or e2e-* project slug" >&2; exit 1; \
	fi

.PHONY: guard
guard: guard-env
	@tmp=$$(mktemp) || exit 1; \
	find . -name '.env*' -print0 > "$$tmp"; find_status=$$?; \
	loop_status=0; \
	while IFS= read -r -d '' file; do \
	  if [[ "$${file##*/}" == .env.example && -f "$$file" && ! -L "$$file" ]] && \
	    git ls-files --error-unmatch -- "$$file" >/dev/null 2>&1 && \
	    git diff --quiet -- "$$file" && git diff --cached --quiet -- "$$file"; then continue; fi; \
	  echo "[h4-mcp] refused: environment file present or example is unsafe"; loop_status=1; break; \
	done < "$$tmp"; \
	rm -f "$$tmp"; \
	if [ "$$find_status" -ne 0 ]; then echo "[h4-mcp] refused: incomplete file traversal (find exited with $$find_status)"; exit 1; fi; \
	exit $$loop_status

.PHONY: qualify-tuple
qualify-tuple: guard ## P4 owns this target: strict dependency qualification
	@echo "[h4-mcp] refused: qualify-tuple is implemented in P4" >&2; exit 1

.PHONY: test-exchange-e2e
test-exchange-e2e: guard ## P4 owns this target: isolated issuer exchange proof
	@echo "[h4-mcp] refused: test-exchange-e2e is implemented in P4" >&2; exit 1

.PHONY: image-smoke
image-smoke: guard ## P6 owns this target: built-image inspection
	@echo "[h4-mcp] refused: image-smoke is implemented in P6" >&2; exit 1

.PHONY: test-composition-e2e
test-composition-e2e: guard ## P7 owns this target: provider finalization and typed-failure proof
	@echo "[h4-mcp] refused: test-composition-e2e is implemented in P7" >&2; exit 1

.PHONY: down
down: guard-env ## Stop the stack and remove only this project's volumes/orphans
	$(COMPOSE) down -v --remove-orphans

.PHONY: inspect
inspect: guard-env ## List only this project's containers, volumes and networks
	docker ps -a --filter label=com.docker.compose.project=radar-$(ENV) --format '{{.Names}}'
	docker volume ls --filter label=com.docker.compose.project=radar-$(ENV) --format '{{.Name}}'
	docker network ls --filter label=com.docker.compose.project=radar-$(ENV) --format '{{.Name}}'

.PHONY: test-guard
test-guard: guard-env ## Exercise refusals and project binding without Docker
	@set -eu; runner="$(abspath $(lastword $(MAKEFILE_LIST)))"; \
	tmp=$$(mktemp -d); trap 'rm -rf "$$tmp"' EXIT; \
	mkdir "$$tmp/tree" "$$tmp/bin"; \
	printf '#!/bin/sh\nprintf "%%s\\n" "$$COMPOSE_DISABLE_ENV_FILE" "$$COMPOSE_PROJECT_NAME" "$$@" > "$$H4_GUARD_LOG"\n' > "$$tmp/bin/docker"; \
	chmod +x "$$tmp/bin/docker"; \
	export PATH="$$tmp/bin:$$PATH" H4_GUARD_LOG="$$tmp/docker.log"; cd "$$tmp/tree"; \
	for slug in test-h4-guard e2e-h4-guard; do \
	  $(MAKE) --no-print-directory -f "$$runner" down COMPOSE='docker compose -p radar-dev' COMPOSE_PROJECT_NAME=radar-dev COMPOSE_DISABLE_ENV_FILE=0 ENV="$$slug"; \
	  test "$$(head -n 1 "$$H4_GUARD_LOG")" = 1; \
	  test "$$(sed -n '2p' "$$H4_GUARD_LOG")" = "radar-$$slug"; \
	  test "$$(grep -c '^-p$$' "$$H4_GUARD_LOG")" = 1; \
	  grep -Fxq "radar-$$slug" "$$H4_GUARD_LOG"; \
	  for arg in /dev/null down -v --remove-orphans; do grep -Fxq -- "$$arg" "$$H4_GUARD_LOG"; done; \
	  echo "[test-guard] PASS: project binding $$slug"; \
	done; rm "$$H4_GUARD_LOG"; \
	for slug in dev prod '' test- e2e- 'test-h4 -p radar-dev' 'test-../../dev' test-X; do \
	  if $(MAKE) --no-print-directory -f "$$runner" down ENV="$$slug" > "$$tmp/output" 2>&1; then exit 1; fi; \
	  grep -Fq '[h4-mcp] refused: ENV' "$$tmp/output"; test ! -e "$$H4_GUARD_LOG"; \
	  echo "[test-guard] PASS: refused ENV=[$$slug]"; \
	done; \
	$(MAKE) --no-print-directory -f "$$runner" guard ENV=test-h4-guard; \
	touch .env.guard; \
	if $(MAKE) --no-print-directory -f "$$runner" qualify-tuple ENV=test-h4-guard > "$$tmp/output" 2>&1; then exit 1; fi; \
	grep -Fq 'environment file present or example is unsafe' "$$tmp/output"; \
	test ! -e "$$H4_GUARD_LOG"; rm .env.guard; \
	echo '[test-guard] PASS: refused environment file before Docker'

.PHONY: test-e2e-exclusion
test-e2e-exclusion: guard ## Real Vitest canaries on both ordinary recipes, with inverse controls
	@bash tools/test-mcp-e2e-exclusion.sh
