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
COMPOSE := docker compose --env-file /dev/null -p radar-$(ENV) -f docker-compose.test.yml
RUN_API := $(COMPOSE) run --rm --no-deps -T --entrypoint '' api
CHECK = trap '$(COMPOSE) down -v --remove-orphans' EXIT; $(RUN_API) sh -ec
INSTALL := npm ci --workspace=packages/immo-mcp --include-workspace-root

.PHONY: guard-env guard config typecheck lint test-immo-mcp down inspect clean commit

guard-env:
	@case "$(ENV)" in test-*) ;; *) echo "[guard] refused: ENV must match test-* (got '$(ENV)')"; exit 1;; esac

guard: guard-env
	@while IFS= read -r -d '' file; do \
	  if [[ "$${file##*/}" == .env.example && -f "$$file" && ! -L "$$file" ]] && \
	    git ls-files --error-unmatch -- "$$file" >/dev/null 2>&1 && \
	    git diff --quiet -- "$$file" && git diff --cached --quiet -- "$$file"; then continue; fi; \
	  echo "[guard] refused: environment file present or example is unsafe"; exit 1; \
	done < <(find . -name '.env*' -print0)

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
