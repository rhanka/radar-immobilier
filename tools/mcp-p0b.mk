# Standalone runner: never include the root Makefile or read environment files.
include tools/immo-mcp-test.mk
.DEFAULT_GOAL := verify
INSTALL := npm ci --workspace=packages/immo-mcp --include-workspace-root
SOURCE ?= /home/antoinefa/src/sentropic/tmp/worktrees/artifacts-parity-p0b/packages/artifacts

.PHONY: lock registry verify candidate
lock: guard
	@$(CHECK) 'npm install --package-lock-only --ignore-scripts'
registry: guard
	@$(CHECK) 'npm view @sentropic/artifacts@0.3.0 version'
verify: guard
	@$(CHECK) "$(INSTALL) && npm run typecheck --workspace=packages/immo-mcp && npm run typecheck --workspace=packages/artifacts-host && npx --no-install eslint packages/immo-mcp/src packages/artifacts-host/src && npm run test --workspace=packages/immo-mcp -- --exclude '**/*.e2e.test.ts' && npm run test --workspace=packages/artifacts-host"
# A copy is built inside the container; the upstream checkout is mounted read-only.
candidate: guard
	@trap '$(COMPOSE) down -v --remove-orphans' EXIT; \
	$(RUN_API) -v '$(SOURCE):/candidate:ro' sh -ec "$(INSTALL) && mkdir -p tmp/mcp-p0b && cp -R /candidate tmp/mcp-p0b/artifacts && npx --no-install tsc -p tmp/mcp-p0b/artifacts/tsconfig.json && cp -R tmp/mcp-p0b/artifacts/dist tmp/mcp-p0b/artifacts/migrations node_modules/@sentropic/artifacts/ && npm run typecheck --workspace=packages/immo-mcp && npm run typecheck --workspace=packages/artifacts-host && npm run test --workspace=packages/immo-mcp -- --exclude '**/*.e2e.test.ts' && npm run test --workspace=packages/artifacts-host"
