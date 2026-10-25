# Standalone A4 entrypoint; never includes the environment-loading root Makefile.
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
	@bash tools/make/artefacts-a4-deliver.sh $@
run: guard
	@bash tools/make/artefacts-a4-run.sh
