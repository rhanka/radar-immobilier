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
override BUILD_RUN := $(value BUILD_RUN)
override SHA := $(value SHA)
override SIZE := $(value SIZE)
override DRAIN := $(value DRAIN)
override OBSERVE := $(value OBSERVE)
override DRILL := $(value DRILL)
override SAMEDB := $(value SAMEDB)
override PROBE := $(value PROBE)
override LOCK_WAIT := $(value LOCK_WAIT)
export ENV RELEASE RUN MODE BACKUP_ID CYCLE_ID OUTPUT BUILD_RUN SHA SIZE DRAIN OBSERVE DRILL SAMEDB PROBE LOCK_WAIT TEST_PATTERN
export COMPOSE_DISABLE_ENV_FILE := 1
override COMPOSE := docker compose --env-file /dev/null -p radar-test-cutover -f $(CUTOVER_ROOT)/deploy/cutover/test.compose.yml
.PHONY: help rehearse run prepare rollback status resume lock release-lock report-refs force-refresh pvc-expand pvc-verify slots-adopt slots-status stage probe-verify ack ack-probe test lint typecheck test-api down ps commit syntax
help:
	@echo 'run RELEASE=<release.json> [OBSERVE=600] [DRAIN=15] [SAMEDB=1] [DRILL=1] ENV=preprod|prod; status; resume RUN=<uuid>; rollback RUN=<uuid>'
run prepare rollback status resume lock release-lock report-refs force-refresh pvc-expand pvc-verify slots-adopt slots-status stage probe-verify ack ack-probe:
	@cd "$(CUTOVER_ROOT)" && bash tools/make/cutover.sh $@
rehearse:
	@cd "$(CUTOVER_ROOT)" && bash tools/make/cutover-rehearse.sh
download-release:
	@cd "$(CUTOVER_ROOT)" && bash tools/make/cutover-download.sh
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
