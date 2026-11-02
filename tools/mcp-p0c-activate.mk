# Operator-only entry point. No root Makefile, environment files, ports or cluster CLI.
SHELL := /bin/bash
ENV ?= unset
override COMPOSE_DISABLE_ENV_FILE := 1
export COMPOSE_DISABLE_ENV_FILE
override COMPOSE := docker compose --env-file /dev/null -p radar-p0c-qualification -f docker-compose.test.yml
PASSTHROUGH := P0C_SCOPE P0C_DATABASE_URL P0C_COOKIE P0C_MCP_TOKEN P0C_MCP_URL P0C_OLD_HTTP_BASE P0C_V1_HTTP_BASE P0C_V2_HTTP_BASE
RUN := $(COMPOSE) run --rm --no-deps -T --entrypoint '' $(foreach key,$(PASSTHROUGH),-e $(key)) -e P0C_APPLY_HOOK=/p0c-apply -v "$${P0C_APPLY_HOOK}:/p0c-apply:ro"
.PHONY: guard preprod-switch-inputs preprod-switch-results down
guard:
	@test '$(ENV)' = preprod
	@test -n "$$P0C_APPLY_HOOK" && test -x "$$P0C_APPLY_HOOK"
preprod-switch-inputs: guard
	@trap '$(COMPOSE) down -v --remove-orphans' EXIT; \
	$(RUN) -e P0C_PHASE=inputs api sh -ec 'npm ci --cache /tmp/immo-p0c-npm && npx --no-install tsx packages/immo-mcp/scripts/p0c-switch.ts'
preprod-switch-results: guard
	@trap '$(COMPOSE) down -v --remove-orphans' EXIT; \
	$(RUN) -e P0C_PHASE=results api sh -ec 'npm ci --cache /tmp/immo-p0c-npm && npx --no-install tsx packages/immo-mcp/scripts/p0c-switch.ts'
down:
	$(COMPOSE) down -v --remove-orphans
