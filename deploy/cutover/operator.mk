# Standalone: deliberately never includes the root Makefile or environment files.
SHELL := /bin/bash
.DEFAULT_GOAL := help
override CUTOVER_ROOT := $(abspath $(dir $(lastword $(MAKEFILE_LIST)))/../..)
override RELEASE := $(value RELEASE)
override RUN := $(value RUN)
override ENV := $(value ENV)
override MODE := $(value MODE)
override BACKUP_ID := $(value BACKUP_ID)
override CYCLE_ID := $(value CYCLE_ID)
override OUTPUT := $(value OUTPUT)
export ENV RELEASE RUN MODE BACKUP_ID CYCLE_ID OUTPUT
export COMPOSE_DISABLE_ENV_FILE := 1
override COMPOSE := docker compose --env-file /dev/null -p radar-test-cutover -f $(CUTOVER_ROOT)/deploy/cutover/test.compose.yml
.PHONY: help run status resume lock release-lock report-refs force-refresh test lint typecheck test-api down ps commit syntax
help:
	@echo 'run RELEASE=<release.json> ENV=preprod|prod; status; resume RUN=<uuid>'
run status resume lock release-lock report-refs force-refresh:
	@cd "$(CUTOVER_ROOT)" && bash tools/make/cutover.sh $@
test lint typecheck test-api:
	@test "$(ENV)" = test-cutover
	@cd "$(CUTOVER_ROOT)" && bash tools/make/cutover-verify.sh $@
down:
	@test "$(ENV)" = test-cutover
	@$(COMPOSE) down -v --remove-orphans
ps:
	@docker ps --format '{{.Names}} {{.Status}}'
syntax:
	@bash tools/make/cutover-syntax.sh
commit:
	@test -n "$$MSG"
	@git -C "$(CUTOVER_ROOT)" commit -m "$$MSG"
