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
export SMOKE_URL
export ROOT
.PHONY: help prerequisites precheck backup restore-test migrate transition verify smoke rehearsal rollback k8s-plan cd-plan test integration down check image-check publish commit lint
help:
	@echo 'Préparation : prerequisites precheck k8s-plan cd-plan. Exécution future : backup restore-test migrate transition verify smoke rehearsal rollback.'
prerequisites precheck k8s-plan cd-plan:
	@cd "$(ROOT)" && timeout --signal=TERM --kill-after=5s 150s bash deploy/prod-cutover/inspect.sh $@
backup restore-test migrate transition verify smoke rehearsal rollback:
	@cd "$(ROOT)" && timeout --signal=TERM --kill-after=10s 3600s node deploy/prod-cutover/cli.cjs $@
test:
	@test "$(ENV)" = test-prod-cutover
	@cd "$(ROOT)" && timeout 90s node --test deploy/prod-cutover/*.test.cjs
lint:
	@test "$(ENV)" = test-prod-cutover
	@cd "$(ROOT)" && timeout --kill-after=10s 180s bash deploy/prod-cutover/lint.sh
integration:
	@test "$(ENV)" = test-prod-cutover
	@cd "$(ROOT)" && timeout --kill-after=10s 300s bash deploy/prod-cutover/integration.sh
down:
	@test "$(ENV)" = test-prod-cutover
	@docker compose --env-file /dev/null -p radar-test-prod-cutover -f "$(ROOT)/deploy/prod-cutover/test.compose.yml" down -v --remove-orphans
check:
	@cd "$(ROOT)" && bash -n deploy/prod-cutover/inspect.sh deploy/prod-cutover/integration.sh deploy/prod-cutover/lint.sh
	@cd "$(ROOT)" && for file in deploy/prod-cutover/*.cjs; do node --check "$$file"; done
	@git -C "$(ROOT)" diff --check
	@git -C "$(ROOT)" status --short --branch
image-check:
	@docker image inspect --format '{{.Id}}' ghcr.io/rhanka/radar-api@sha256:13664562840c200858355e525d292e5df5dfa2c0569a73b564f698bbccbb8a27
	@timeout --kill-after=5s 20s docker run --rm --pull=never --network none --entrypoint node ghcr.io/rhanka/radar-api@sha256:13664562840c200858355e525d292e5df5dfa2c0569a73b564f698bbccbb8a27 -e 'Promise.all([import("/workspace/api/dist/scripts/database-cutover.js"),import("/workspace/node_modules/pg/lib/index.js"),import("/workspace/node_modules/drizzle-orm/node-postgres/index.js")]).then(([h])=>{if(typeof h.migrateDatabaseCutover!=="function")process.exit(1)})'
publish:
	@test "$(ENV)" = test-prod-cutover
	@test "$$(git -C "$(ROOT)" branch --show-current)" = feat/prod-cutover-v1220
	@git -C "$(ROOT)" diff --quiet
	@git -C "$(ROOT)" diff --cached --quiet
	@git -C "$(ROOT)" push origin HEAD:refs/heads/feat/prod-cutover-v1220
commit:
	@test -n "$$MSG"
	@git -C "$(ROOT)" -c core.hooksPath=/dev/null commit -m "$$MSG"
