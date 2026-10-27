# Standalone entry point: never loads application environment files.
SHELL := /bin/bash
ENV ?= test-artefacts-ouv-l3
export ENV API_PORT UI_PORT MAILDEV_UI_PORT
override CMD := $(value CMD)
export CMD
.PHONY: run inspect commit
run:
	@rtk bash tools/make/artefacts-ouv-l3-run.sh
inspect:
	@rtk bash -euo pipefail -c "$$CMD"
commit:
	@test "$$(git --git-dir=tmp/sol-l3.git diff --cached --numstat | awk '{n+=$$1+$$2} END {print n}')" -le 150
	@git --git-dir=tmp/sol-l3.git --work-tree=. diff --cached --check
	@git --git-dir=tmp/sol-l3.git --work-tree=. -c core.hooksPath=/dev/null commit -m "$(MSG)"
