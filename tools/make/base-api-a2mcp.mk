# Isolated MCP A2-BASE tooling; never load the root Makefile or .env.
SHELL := /bin/bash
export ENV API_PORT UI_PORT MAILDEV_UI_PORT
override CMD := $(value CMD)
export CMD
override FILES := $(value FILES)
override MSG := $(value MSG)
export FILES MSG
.PHONY: inspect setup stage commit audit bundle test check mutations status
inspect:
	@rtk bash -euc 'eval "$$CMD"'
setup stage commit audit bundle:
	@rtk bash tools/make/base-api-a2mcp-deliver.sh $@
test check mutations:
	@rtk bash tools/make/base-api-a2mcp-verify.sh $@
status:
	@rtk bash -euc 'docker ps --format "{{.Names}}"; df -Pk .'
