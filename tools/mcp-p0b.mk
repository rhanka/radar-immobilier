# Standalone runner: never include the root Makefile or read environment files.
include tools/immo-mcp-test.mk
override COMPOSE := docker compose --env-file /dev/null -p radar-$(ENV) -f docker-compose.test.yml -f tools/mcp-p0b.services.yml
RUN_API := $(COMPOSE) run --rm --no-deps -T --entrypoint '' api
RUN_DATABASE_API := $(COMPOSE) run --rm --no-deps -T --entrypoint '' -e P0B_DATABASE_URL=postgres://p0b:p0b-test-only@postgres:5432/p0b
.DEFAULT_GOAL := verify
INSTALL := npm ci
SOURCE ?= /home/antoinefa/src/sentropic/tmp/worktrees/artifacts-parity-p0b/packages/artifacts

.PHONY: prepare lock registry verify candidate integration database-check
prepare: guard
	@mkdir -p tmp/mcp-p0b
database-check: guard
	@trap '$(COMPOSE) logs --no-color postgres; $(COMPOSE) down -v --remove-orphans' EXIT; $(COMPOSE) up -d --wait postgres
database-logs: guard-env
	@$(COMPOSE) ps -a
	@$(COMPOSE) logs --no-color postgres
	@df -h .
lock: guard
	@$(CHECK) 'npm install --package-lock-only --ignore-scripts'
registry: guard
	@$(CHECK) 'npm view @sentropic/artifacts@0.3.0 version'
verify: guard
	@$(CHECK) "$(INSTALL) && npm run typecheck --workspace=packages/immo-mcp && npm run typecheck --workspace=packages/artifacts-host && npm run typecheck --workspace=api && npx --no-install eslint packages/immo-mcp/src packages/artifacts-host/src api/src/artifacts/control-route*.ts && npm run test --workspace=packages/immo-mcp -- --exclude '**/*.e2e.test.ts' && npm run test --workspace=packages/artifacts-host -- --maxWorkers=1"
# A copy is built inside the container; the upstream checkout is mounted read-only.
candidate: guard
	@trap '$(COMPOSE) down -v --remove-orphans' EXIT; \
	$(COMPOSE) up -d --wait postgres && \
	$(RUN_DATABASE_API) -v '$(SOURCE):/candidate:ro' api sh tools/mcp-p0b-candidate.sh
integration: guard
	@trap '$(COMPOSE) down -v --remove-orphans' EXIT; \
	$(COMPOSE) up -d --wait postgres && \
	$(RUN_DATABASE_API) api sh -ec '$(INSTALL) && npm run test --workspace=packages/artifacts-host -- src/p0b.integration.test.ts'

.PHONY: push clean-deps
push: guard
	git push -u origin HEAD
clean-deps: guard-env
	@$(CHECK) 'rm -rf packages/*/node_modules ui/node_modules tmp/mcp-p0b/artifacts tmp/mcp-p0b/toolchain'
	@rmdir node_modules api/node_modules 2>/dev/null || true
