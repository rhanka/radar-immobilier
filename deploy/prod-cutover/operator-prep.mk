# Standalone operator preparation. No dotenv inclusion.
SHELL := /bin/bash
.SHELLFLAGS := -eu -o pipefail -c
export COMPOSE_DISABLE_ENV_FILE := 1
export DOTENV_CONFIG_PATH := /dev/null
.PHONY: operator-prep operator-history operator-check
operator-prep:
	@test "$(ENV)" = prod
	@bash deploy/prod-cutover/operator-prep.sh
operator-history:
	@test "$(ENV)" = prod
	@bash deploy/prod-cutover/operator-history.sh
operator-check:
	@bash -n deploy/prod-cutover/operator-prep.sh deploy/prod-cutover/operator-prep-local.sh deploy/prod-cutover/operator-history.sh
	@git diff --check
