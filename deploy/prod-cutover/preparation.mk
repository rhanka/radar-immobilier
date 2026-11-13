# Standalone preparation. Never load the root Makefile or dotenv.
SHELL := /bin/bash
.SHELLFLAGS := -eu -o pipefail -c
export COMPOSE_DISABLE_ENV_FILE := 1
export DOTENV_CONFIG_PATH := /dev/null
export ENV
.PHONY: inventory archive images
inventory archive images:
	@test "$(ENV)" = test-prod-cutover
	@timeout --kill-after=10s 1800s bash deploy/prod-cutover/preparation.sh $@
