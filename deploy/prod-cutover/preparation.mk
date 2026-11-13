# Standalone preparation. Never load the root Makefile or dotenv.
SHELL := /bin/bash
.SHELLFLAGS := -eu -o pipefail -c
export COMPOSE_DISABLE_ENV_FILE := 1
export DOTENV_CONFIG_PATH := /dev/null
export ENV
.PHONY: inventory archive images runtime copy-up copy-down copy-step
inventory archive images:
	@test "$(ENV)" = test-prod-cutover
	@timeout --kill-after=10s 1800s bash deploy/prod-cutover/preparation.sh $@
runtime:
	@test "$(ENV)" = test-prod-cutover
	@bash deploy/prod-cutover/local-runtime.sh
copy-up:
	@test "$(ENV)" = rehearsal
	@test -z "$$(ss -H -ltn 'sport = :25433')"
	@docker compose --env-file /dev/null -p radar-prod-copy-owner -f deploy/prod-cutover/rehearsal.compose.yml up -d --wait --wait-timeout 45
copy-down:
	@test "$(ENV)" = rehearsal
	@docker compose --env-file /dev/null -p radar-prod-copy-owner -f deploy/prod-cutover/rehearsal.compose.yml down -v --remove-orphans
copy-step:
	@test "$(ENV)" = rehearsal
	@bash deploy/prod-cutover/rehearse-copy.sh "$(STEP)"
