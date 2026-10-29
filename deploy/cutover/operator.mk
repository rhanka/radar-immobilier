# Standalone: deliberately never includes the root Makefile or environment files.
SHELL := /bin/bash
.DEFAULT_GOAL := help
override CUTOVER_ROOT := $(abspath $(dir $(lastword $(MAKEFILE_LIST)))/../..)
export ENV RELEASE RUN MODE BACKUP_ID CYCLE_ID OUTPUT
export COMPOSE_DISABLE_ENV_FILE := 1
override COMPOSE := docker compose --env-file /dev/null -p radar-test-cutover -f $(CUTOVER_ROOT)/deploy/cutover/test.compose.yml
.PHONY: help run status resume lock release-lock test lint typecheck test-api down ps commit
help:
	@echo 'run RELEASE=<release.json> ENV=preprod|prod; status; resume RUN=<uuid>'
run status resume lock release-lock:
	@cd "$(CUTOVER_ROOT)" && bash tools/make/cutover.sh $@
test lint typecheck test-api:
	@test "$(ENV)" = test-cutover
	@cd "$(CUTOVER_ROOT)" && bash tools/make/cutover-verify.sh $@
down:
	@test "$(ENV)" = test-cutover
	@$(COMPOSE) down -v --remove-orphans
ps:
	@docker ps --format '{{.Names}}'
commit:
	@test -n "$$MSG"
	@git -C "$(CUTOVER_ROOT)" commit -m "$$MSG"
