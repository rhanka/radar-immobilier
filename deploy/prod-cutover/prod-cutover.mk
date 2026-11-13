# Standalone. Never include the root Makefile or an environment file.
SHELL := /bin/bash
.SHELLFLAGS := -eu -o pipefail -c
.DEFAULT_GOAL := help
override ROOT := $(abspath $(dir $(lastword $(MAKEFILE_LIST)))/../..)
export COMPOSE_DISABLE_ENV_FILE := 1
export DOTENV_CONFIG_PATH := /dev/null
export ENV OUTPUT ARCHIVE PLAN EVIDENCE RELEASE APPROVAL
export PGHOST PGPORT PGUSER PGDATABASE PGPASSFILE PGSERVICE PGSERVICEFILE
export SOURCE_PGHOST SOURCE_PGPORT SOURCE_PGUSER SOURCE_PGDATABASE SOURCE_PGPASSFILE
export BACKUP_URI BACKUP_ENDPOINT RESTORE_SHA256
export CUTOVER_API_IMAGE CUTOVER_ALLOW_PROD
export ROOT
.PHONY: help prerequisites precheck backup restore-test migrate transition verify smoke rehearsal rollback k8s-plan cd-plan test commit
help:
	@echo 'Préparation : prerequisites precheck k8s-plan cd-plan. Exécution future : backup restore-test migrate transition verify smoke rehearsal rollback.'
prerequisites precheck k8s-plan cd-plan:
	@cd "$(ROOT)" && timeout --signal=TERM --kill-after=5s 150s bash deploy/prod-cutover/inspect.sh $@
backup restore-test migrate transition verify smoke rehearsal rollback:
	@cd "$(ROOT)" && timeout --signal=TERM --kill-after=10s 3600s node deploy/prod-cutover/cli.cjs $@
test:
	@test "$(ENV)" = test-prod-cutover
	@cd "$(ROOT)" && timeout 90s node --test deploy/prod-cutover/*.test.cjs
commit:
	@test -n "$$MSG"
	@git -C "$(ROOT)" -c core.hooksPath=/dev/null commit -m "$$MSG"
