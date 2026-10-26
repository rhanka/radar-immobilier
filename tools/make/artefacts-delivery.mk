# Standalone runner: never includes environment-loading Makefiles.
SHELL := /bin/bash
export ENV API_PORT UI_PORT MAILDEV_UI_PORT
override CMD := $(value CMD)
export CMD
.PHONY: run inspect commit
run:
	@bash tools/make/artefacts-delivery-run.sh
inspect:
	@rtk bash -euc 'eval "$$CMD"'
commit:
	@git commit -m "$(MSG)"
