# PW-E qualification without root Makefile or environment-file discovery.
SHELL := /bin/bash
ENV ?= test-api-paniers-pwe
API_PORT ?= 18935
UI_PORT ?= 15935
MAILDEV_UI_PORT ?= 11935
PHASE ?= pg
SCOPE ?=
override MSG := $(value MSG)
export ENV API_PORT UI_PORT MAILDEV_UI_PORT PHASE SCOPE FILES MSG
.PHONY: pwe-verify pwe-stage pwe-commit pwe-audit pwe-bundle
pwe-verify:
	rtk bash tools/make/base-api-pwe-verify.sh
pwe-stage:
	rtk bash tools/make/base-api-pwe-deliver.sh stage
pwe-commit:
	rtk bash tools/make/base-api-pwe-deliver.sh commit
pwe-audit:
	rtk bash tools/make/base-api-pwe-deliver.sh audit
pwe-bundle:
	rtk bash tools/make/base-api-pwe-deliver.sh bundle
