# Standalone PW-C campaign; never includes the root environment discovery.
SHELL := /bin/bash
ENV ?= test-api-paniers-pwc
API_PORT ?= 18934
UI_PORT ?= 15934
MAILDEV_UI_PORT ?= 11934
PHASE ?= final
override MSG := $(value MSG)
export ENV API_PORT UI_PORT MAILDEV_UI_PORT PHASE FILES MSG
.PHONY: pwc-verify
pwc-verify:
	rtk bash tools/make/base-api-pwc-verify.sh
.PHONY: pwc-stage pwc-commit pwc-audit pwc-bundle
pwc-stage:
	rtk bash tools/make/base-api-pwc-deliver.sh stage
pwc-commit:
	rtk bash tools/make/base-api-pwc-deliver.sh commit
pwc-audit:
	rtk bash tools/make/base-api-pwc-deliver.sh audit
pwc-bundle:
	rtk bash tools/make/base-api-pwc-deliver.sh bundle
