# Isolated MCP A2-BASE tooling; never load the root Makefile or .env.
SHELL := /bin/bash
export ENV API_PORT UI_PORT MAILDEV_UI_PORT
override CMD := $(value CMD)
export CMD
override FILES := $(value FILES)
override MSG := $(value MSG)
export FILES MSG
override SCOPE := $(value SCOPE)
override MCP_SCOPE := $(value MCP_SCOPE)
export SCOPE MCP_SCOPE
.PHONY: inspect setup stage commit audit bundle test check mutations status
inspect:
	@rtk bash -euc 'eval "$$CMD"'
setup stage commit audit bundle:
	@rtk bash tools/make/base-api-a2rest-deliver.sh $@
test check mutations:
	@rtk bash tools/make/base-api-a2rest-verify.sh $@
status:
	@rtk bash -euc 'docker ps --format "{{.Names}}"; df -Pk .'
