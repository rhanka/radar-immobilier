# Isolated immo-mcp runner for lot 1 (0.1.0 baseline, no behavior change).
# Usage with ENV LAST (refused unless test-*):
#   make -f tools/immo-mcp-test.mk typecheck ENV=test-mcp-auth-022
#   make -f tools/immo-mcp-test.mk lint ENV=test-mcp-auth-022
#   make -f tools/immo-mcp-test.mk test-immo-mcp SCOPE=src/http-401-golden.test.ts ENV=test-mcp-auth-022
#   make -f tools/immo-mcp-test.mk down ENV=test-mcp-auth-022
# Isolation: standalone test compose, --env-file /dev/null (never reads .env),
# project -p radar-$(ENV), refuse .env* except unchanged tracked examples, no published
# ports (in-process tests; API 18861 stays reserved for 861-a). Teardown runs
# down -v --remove-orphans in a trap, even on failure.
SHELL := /bin/bash
ENV ?= test-mcp-auth-022
# Effective compose project derives only from ENV: fixed command and -p flag
# ignore inherited DOCKER_COMPOSE/COMPOSE/COMPOSE_PROJECT_NAME values.
override DOCKER_COMPOSE := docker compose
override COMPOSE_PROJECT_NAME := radar-$(ENV)
override COMPOSE_DISABLE_ENV_FILE := 1
export COMPOSE_PROJECT_NAME COMPOSE_DISABLE_ENV_FILE
override COMPOSE := $(DOCKER_COMPOSE) --env-file /dev/null -p radar-$(ENV) -f docker-compose.test.yml
RUN_API := $(COMPOSE) run --rm --no-deps -T --entrypoint '' api
CHECK = trap '$(COMPOSE) down -v --remove-orphans' EXIT; $(RUN_API) sh -ec
INSTALL := npm ci --workspace=packages/immo-mcp --include-workspace-root

.PHONY: guard-env guard test-guard config typecheck lint test-immo-mcp down inspect clean commit

guard-env:
	@case "$(ENV)" in test-*) ;; *) echo "[guard] refused: ENV must match test-* (got '$(ENV)')"; exit 1;; esac

guard: guard-env
	@tmp=$$(mktemp) || exit 1; \
	find . -name '.env*' -print0 > "$$tmp"; find_status=$$?; \
	loop_status=0; \
	while IFS= read -r -d '' file; do \
	  if [[ "$${file##*/}" == .env.example && -f "$$file" && ! -L "$$file" ]] && \
	    git ls-files --error-unmatch -- "$$file" >/dev/null 2>&1 && \
	    git diff --quiet -- "$$file" && git diff --cached --quiet -- "$$file"; then continue; fi; \
	  echo "[guard] refused: environment file present or example is unsafe"; loop_status=1; break; \
	done < "$$tmp"; \
	rm -f "$$tmp"; \
	if [ "$$find_status" -ne 0 ]; then echo "[guard] refused: incomplete file traversal (find exited with $$find_status)"; exit 1; fi; \
	exit $$loop_status

test-guard: guard-env ## Exercise preflight without starting Docker or reading environment files
	@set -eu; runner="$(abspath $(lastword $(MAKEFILE_LIST)))"; \
	tmp=$$(mktemp -d); trap 'rm -rf "$$tmp"' EXIT; \
	mkdir "$$tmp/tree" "$$tmp/bin" "$$tmp/scratch"; \
	export TMPDIR="$$tmp/scratch"; \
	printf '#!/bin/sh\ntouch "$$MCP_GUARD_DOCKER_SENTINEL"\n' > "$$tmp/bin/docker"; \
	chmod +x "$$tmp/bin/docker"; \
	export MCP_GUARD_DOCKER_SENTINEL="$$tmp/docker-ran"; \
	cd "$$tmp/tree"; \
	$(MAKE) --no-print-directory -f "$$runner" guard ENV=$(ENV); \
	echo '[test-guard] PASS: readable tree'; \
	touch .env; \
	if $(MAKE) --no-print-directory -f "$$runner" guard ENV=$(ENV) > "$$tmp/output" 2>&1; then \
	  echo '[test-guard] FAIL: environment file accepted'; exit 1; fi; \
	grep -Fq 'environment file present or example is unsafe' "$$tmp/output"; \
	rm .env; echo '[test-guard] PASS: environment file refused'; \
	for status in 1 23; do \
	  printf '#!/bin/sh\nexit %s\n' "$$status" > "$$tmp/bin/find"; \
	  chmod +x "$$tmp/bin/find"; \
	  if PATH="$$tmp/bin:$$PATH" $(MAKE) --no-print-directory -f "$$runner" config ENV=$(ENV) > "$$tmp/output" 2>&1; then \
	    echo '[test-guard] FAIL: incomplete traversal accepted'; exit 1; fi; \
	  grep -Fq "incomplete file traversal (find exited with $$status)" "$$tmp/output"; \
	  test ! -e "$$MCP_GUARD_DOCKER_SENTINEL"; \
	  test -z "$$(ls -A "$$TMPDIR")"; \
	  echo "[test-guard] PASS: find exit $$status blocks Docker and removes temporary files"; \
	done

config: guard ## Render the exact test-only configuration for canary inspection
	@$(COMPOSE) config --format json

typecheck: guard ## Typecheck the immo-mcp workspace only
	@$(CHECK) '$(INSTALL) && npm run typecheck --workspace=packages/immo-mcp'

lint: guard ## Lint the immo-mcp sources only
	@$(CHECK) '$(INSTALL) && npx --no-install eslint packages/immo-mcp/src'

test-immo-mcp: guard ## Run immo-mcp Vitest (SCOPE=<file>, service E2E excluded)
	@$(CHECK) "$(INSTALL) && npm run test --workspace=packages/immo-mcp -- --exclude '**/*.e2e.test.ts' $(SCOPE)"

down: guard-env ## Teardown even when an environment file blocks the checks
	$(COMPOSE) down -v --remove-orphans

inspect: guard-env ## List only this project's containers, volumes and networks
	docker ps -a --filter label=com.docker.compose.project=radar-$(ENV) --format '{{.Names}}'
	docker volume ls --filter label=com.docker.compose.project=radar-$(ENV) --format '{{.Name}}'
	docker network ls --filter label=com.docker.compose.project=radar-$(ENV) --format '{{.Name}}'

clean: guard down ## Remove MCP dependencies only; the runner never installs UI dependencies
	@trap '$(COMPOSE) down -v --remove-orphans; rmdir node_modules api/node_modules' EXIT; \
	$(RUN_API) sh -ec 'rm -rf packages/immo-mcp/node_modules'

commit: guard ## Single-line commit without loading the root Makefile
	@test -n "$$MSG"
	git commit -m "$$MSG"
