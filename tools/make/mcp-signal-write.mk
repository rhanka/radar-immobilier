# Standalone runner: never includes the root Makefile or an environment file.
SHELL := /bin/bash
ENV ?= test-mcp-signal-write
export ENV SCOPE
.PHONY: verify typecheck lint test-api test-mcp test-ui test-ui-e2e down
verify typecheck lint test-api test-mcp test-ui test-ui-e2e:
	rtk bash tools/make/mcp-signal-write-test.sh $@
down:
	@test "$(ENV)" = test-mcp-signal-write
	docker compose --env-file /dev/null -p radar-$(ENV) -f tmp/mcp-signal-write-test/compose.yml down -v --remove-orphans
