# Standalone A5 entrypoint; never includes the environment-loading root Makefile.
SHELL := /bin/bash
export ENV API_PORT UI_PORT MAILDEV_UI_PORT
override CMD := $(value CMD)
export CMD MSG FILES
include tools/h4-mcp.mk
.PHONY: shell status setup stage commit audit bundle run
shell:
	@rtk bash -euc 'eval "$$CMD"'
status:
	@docker ps --format '{{.Names}}'
	@df -Pk .
setup stage commit audit bundle:
	@bash tools/make/artefacts-a5-deliver.sh $@
run: guard
	@bash tools/make/artefacts-a5-run.sh
.PHONY: verify test-api-ci inspect-profile diagnose-provider test-runtime test-composition-contract test-provider migration-proof test-astra test-astra-mutations
verify test-api-ci inspect-profile diagnose-provider test-runtime test-composition-contract test-provider migration-proof test-astra test-astra-mutations: guard
	@bash tools/make/artefacts-a5-verify.sh $@
