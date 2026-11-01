# Standalone runner: never include the root Makefile or read environment files.
include tools/immo-mcp-test.mk
override COMPOSE := docker compose --env-file /dev/null -p radar-$(ENV) -f docker-compose.test.yml -f tools/mcp-p0b.services.yml
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
	@$(CHECK) "$(INSTALL) && npm run typecheck --workspace=packages/immo-mcp && npm run typecheck --workspace=packages/artifacts-host && npm run typecheck --workspace=api && npx --no-install eslint packages/immo-mcp/src packages/artifacts-host/src api/src/artifacts/control-route*.ts && npm run test --workspace=packages/immo-mcp -- --exclude '**/*.e2e.test.ts' && npm run test --workspace=packages/artifacts-host"
# A copy is built inside the container; the upstream checkout is mounted read-only.
candidate: guard
	@trap '$(COMPOSE) down -v --remove-orphans' EXIT; \
	$(COMPOSE) up -d --wait postgres && \
	$(RUN_API) -e P0B_DATABASE_URL=postgres://p0b:p0b-test-only@postgres:5432/p0b -v '$(SOURCE):/candidate:ro' sh -ec "$(INSTALL) && mkdir -p tmp/mcp-p0b && rm -rf tmp/mcp-p0b/artifacts && mkdir tmp/mcp-p0b/artifacts && cp -R /candidate/src /candidate/l0-freeze /candidate/migrations /candidate/sql /candidate/docs /candidate/examples /candidate/package.json /candidate/tsconfig.json /candidate/README.md /candidate/CHANGELOG.md /candidate/LICENSE tmp/mcp-p0b/artifacts/ && npx --no-install tsc -p tmp/mcp-p0b/artifacts/tsconfig.json && cd tmp/mcp-p0b/artifacts && npm pack --pack-destination .. && cd /workspace && tar -xzf tmp/mcp-p0b/sentropic-artifacts-0.3.0.tgz -C node_modules/@sentropic/artifacts --strip-components=1 && npm run typecheck --workspace=packages/immo-mcp && npm run typecheck --workspace=packages/artifacts-host && npm run typecheck --workspace=api && npm run test --workspace=packages/immo-mcp -- --exclude '**/*.e2e.test.ts' && npm run test --workspace=packages/artifacts-host"
integration: guard
	@trap '$(COMPOSE) down -v --remove-orphans' EXIT; \
	$(COMPOSE) up -d --wait postgres && \
	$(RUN_API) -e P0B_DATABASE_URL=postgres://p0b:p0b-test-only@postgres:5432/p0b sh -ec '$(INSTALL) && npm run test --workspace=packages/artifacts-host -- src/p0b.integration.test.ts'
